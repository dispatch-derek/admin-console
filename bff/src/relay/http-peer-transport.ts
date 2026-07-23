// bff/src/relay/http-peer-transport.ts — the single GTM EventTransport: HTTP POST to N known
// peers (spec REQ-F004-050/051/043/055; design §2.2/§4.4). It owns EVERYTHING on the wire — the
// peer list, the POST, the per-deliveryId fan-out ack map, and the HTTP-status → permanent/transient
// classification (REQ-F004-055) — so none of that leaks above the EventTransport seam (REQ-F004-049).

import { TransportError, type EventTransport } from './transport.js';

// Header carrying the stable delivery id to each peer as MESSAGE metadata (REQ-F004-043(b)) —
// distinct from the frozen envelope body (REQ-F004-004).
const DELIVERY_ID_HEADER = 'x-event-delivery-id';

// Header carrying the shared-secret credential to each peer as the third wire element cwa requires
// (F-010 REQ-F010-004/005; cwa REQ-F005-061). Added ALONGSIDE the two pre-existing headers, never in
// place of them. The value is the configured secret byte-for-byte at this point (no trim/case-fold/
// re-encode here), though WHATWG Fetch may strip leading/trailing HTTP whitespace in transit.
// The credential is owned entirely inside this transport (REQ-F010-008 seam) and never appears in
// logs, errors, metrics, or /ready (REQ-F010-011).
const AUTH_TOKEN_HEADER = 'X-Event-Auth-Token';

// Default per-peer request timeout — a provisional constant of record, operator-tunable via
// EVENT_BUS_PEER_TIMEOUT_MS (threaded in through the relay-scoped config → createTransport → this
// constructor; the value stays a WIRE concern inside the transport, never seen by the drainer, to
// preserve the REQ-F004-049 seam). Bounds a peer that accepts the socket but never responds so
// deliver() cannot hang indefinitely and wedge an ordering key with no backoff/retry/metric. On
// timeout the fetch aborts and is classified TRANSIENT (REQ-F004-055 "connection timeout" /
// network-level), so the row retries with backoff and eventually parks at the cap like any other
// transient failure — never a silent, unbounded stall.
const DEFAULT_PEER_REQUEST_TIMEOUT_MS = 10_000;

// Predicate: "unset or empty" (REQ-F010-017 normative definition). The credential is configured iff
// it is a non-empty string; `undefined` and `''` are absent/unset; a whitespace-only value (' ') is
// non-empty and IS configured (though the HTTP client may strip surrounding whitespace in transit,
// so padding is almost certainly a misconfiguration). Single home for this predicate — imported by
// config.ts (boot-time fail-fast) and used below (attach-or-not-attach) so the definition never drifts.
export function isCredentialConfigured(token: string | undefined): token is string {
  return token !== undefined && token !== '';
}

type PeerOutcome = 'ack' | 'transient' | 'permanent';

// REQ-F004-055 (rev 11) — the closed, total per-peer HTTP-response → permanent/transient mapping,
// owned entirely here (kept OUT of the drainer per the REQ-F004-049 seam):
//   ACK       : 2xx
//   TRANSIENT : all 5xx, 408, 429 (network-level failures are handled in the catch below)
//   PERMANENT : all other 4xx, any 3xx, any other unexpected non-2xx
function classifyStatus(status: number): PeerOutcome {
  if (status >= 200 && status < 300) return 'ack';
  if (status >= 500) return 'transient';
  if (status === 408 || status === 429) return 'transient';
  return 'permanent';
}

export class HttpPeerTransport implements EventTransport {
  // Per-deliveryId set of peers that have already accepted (2xx). STATEFUL across orchestration
  // re-drives so a re-POST hits ONLY the still-un-acked peers (REQ-F004-051(b)). Evicted on a
  // terminal outcome via release() (REQ-F004-051(c)) — bounded memory.
  private readonly ackMap = new Map<string, Set<string>>();

  constructor(
    private readonly peerUrls: string[],
    private readonly peerTimeoutMs: number = DEFAULT_PEER_REQUEST_TIMEOUT_MS,
    // Shared-secret credential (F-010 REQ-F010-005/008). A credential is attached iff this is a
    // non-empty string: `undefined` and `''` are treated as absent (REQ-F010-017 "unset or empty"),
    // while a whitespace-only value (' ') is non-empty and IS attached (though HTTP client may strip
    // surrounding whitespace in transit, so padding whitespace should not be relied upon).
    private readonly peerAuthToken?: string,
  ) {}

  async deliver(envelope: string, deliveryId: string): Promise<void> {
    let acked = this.ackMap.get(deliveryId);
    if (!acked) {
      acked = new Set<string>();
      this.ackMap.set(deliveryId, acked);
    }

    // Re-POST only the peers not yet acked for this deliveryId (REQ-F004-051(b)).
    const pending = this.peerUrls.filter((url) => !acked!.has(url));

    const results = await Promise.all(
      pending.map(async (url): Promise<{ url: string; outcome: PeerOutcome }> => {
        try {
          // Two pre-existing headers unchanged (REQ-F010-006); the credential header is added
          // alongside them ONLY when a credential is configured (non-empty string), carrying the
          // value byte-for-byte at this point (REQ-F010-005/017). Note: WHATWG Fetch may strip
          // leading/trailing HTTP whitespace in transit, so don't rely on padding.
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            [DELIVERY_ID_HEADER]: deliveryId,
          };
          if (isCredentialConfigured(this.peerAuthToken)) {
            headers[AUTH_TOKEN_HEADER] = this.peerAuthToken;
          }
          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: envelope,
            // Bound a peer that never responds (REQ-F004-055 connection-timeout / network-level
            // transient); the abort surfaces in the catch below and is classified transient.
            signal: AbortSignal.timeout(this.peerTimeoutMs),
          });
          return { url, outcome: classifyStatus(res.status) };
        } catch {
          // Network / connection-level failure (refused, timeout/abort, DNS, socket reset) — transient.
          return { url, outcome: 'transient' };
        }
      }),
    );

    for (const r of results) {
      if (r.outcome === 'ack') acked.add(r.url);
    }

    // Partial-delivery signal (REQ-F004-051(e)/025): if >= 1 peer has already accepted this
    // deliveryId (this call or a prior re-drive) while the FULL fan-out ack is not yet achieved, a
    // resulting park is "partially delivered" — those peers hold dedupable copies. Surfaced on the
    // TransportError so the drainer can split the park counter without seeing peer/HTTP detail.
    const partialAck = acked.size > 0;

    // Fan-out composition (REQ-F004-051/055): a permanent from ANY not-yet-acked peer makes the
    // whole deliver() reject permanent (immediate park), even if others acked or were transient.
    if (results.some((r) => r.outcome === 'permanent')) {
      throw new TransportError('a peer permanently rejected the delivery', 'permanent', partialAck);
    }
    // Otherwise any transient peer means reject transient (re-drive re-POSTs only the un-acked ones).
    if (results.some((r) => r.outcome === 'transient')) {
      throw new TransportError('a peer transiently failed the delivery', 'transient', partialAck);
    }
    // Every peer accepted (2xx) → full fan-out ack → resolve (gates markPublished, REQ-F004-051).
  }

  // Evict the per-deliveryId ack state on a terminal row outcome (REQ-F004-051(c)).
  release(deliveryId: string): void {
    this.ackMap.delete(deliveryId);
  }
}
