// bff/src/relay/http-peer-transport.ts — the single GTM EventTransport: HTTP POST to N known
// peers (spec REQ-F004-050/051/043/055; design §2.2/§4.4). It owns EVERYTHING on the wire — the
// peer list, the POST, the per-deliveryId fan-out ack map, and the HTTP-status → permanent/transient
// classification (REQ-F004-055) — so none of that leaks above the EventTransport seam (REQ-F004-049).

import { TransportError, type EventTransport } from './transport.js';

// Header carrying the stable delivery id to each peer as MESSAGE metadata (REQ-F004-043(b)) —
// distinct from the frozen envelope body (REQ-F004-004).
const DELIVERY_ID_HEADER = 'x-event-delivery-id';

// Per-peer request timeout — a documented constant of record alongside the backoff constants
// (backoff.ts BASE_MS/FACTOR/CAP_MS). Bounds a peer that accepts the socket but never responds so
// deliver() cannot hang indefinitely and wedge an ordering key with no backoff/retry/metric. On
// timeout the fetch aborts and is classified TRANSIENT (REQ-F004-055 "connection timeout" /
// network-level), so the row retries with backoff and eventually parks at the cap like any other
// transient failure — never a silent, unbounded stall.
const PEER_REQUEST_TIMEOUT_MS = 10_000;

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

  constructor(private readonly peerUrls: string[]) {}

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
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [DELIVERY_ID_HEADER]: deliveryId },
            body: envelope,
            // Bound a peer that never responds (REQ-F004-055 connection-timeout / network-level
            // transient); the abort surfaces in the catch below and is classified transient.
            signal: AbortSignal.timeout(PEER_REQUEST_TIMEOUT_MS),
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
