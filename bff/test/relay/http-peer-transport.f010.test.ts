// bff/src/relay/http-peer-transport.ts — F-010 shared-secret credential additions (spec
// specs/F-010-deliver-admin-events-to-customer-web-app.md §3.2, REQ-F010-004/005/006/009/013/022).
// A NEW, separate file — mirrors this repo's own precedent (bff/test/config.f004.test.ts is a
// dedicated file for one feature's additions to a pre-existing module, left alongside, not
// merged into, the module's original spec-level test file) so the F-004-owned
// bff/test/relay/http-peer-transport.test.ts is left completely untouched by this task.
//
// ASSUMED CONSTRUCTOR EXTENSION (the spec pins the WIRE BEHAVIOR exactly — REQ-F010-004/005/007/
// 008 — but not the literal constructor call shape). The pre-existing
// http-peer-transport.unit.test.ts already established the precedent of extending
// HttpPeerTransport's constructor with a new trailing OPTIONAL positional parameter for a
// wire-adjacent per-peer concern (`peerTimeoutMs`: `new HttpPeerTransport(peerUrls, peerTimeoutMs)`).
// This file assumes the SAME precedent for the credential, the next wire-adjacent concern F-010
// introduces:
//   new HttpPeerTransport(peerUrls: string[], peerTimeoutMs?: number, peerAuthToken?: string)
// A credential is attached (REQ-F010-005's three-application-level-header set) iff peerAuthToken is
// a non-empty string. This maps directly onto REQ-F010-017's own "absent OR zero-length is empty;
// whitespace-only is NOT empty, sent verbatim" definition via ordinary JS truthiness (`undefined`
// and `''` are falsy; `' '` is truthy) — no extra plumbing assumption is needed beyond the
// parameter itself. If the real implementation instead threads the credential through an options
// object, only the CALL SITES below need adjusting; every assertion is behavioral (headers observed
// by a real local HTTP peer, or the value passed to the HTTP client), not shape-derived.
//
// DOCUMENTED RISK (flagged, not silently guessed): the REQ-F010-005 "whitespace-verification
// point" test below assumes the transport's underlying HTTP client is the global `fetch` (Node
// >=20, no alternate HTTP client dependency in bff/package.json) and spies on `globalThis.fetch` to
// inspect the value BEFORE any client-level normalization, per the spec's own explicit instruction
// ("asserted at the point the transport sets the header value... because some HTTP clients strip
// optional surrounding whitespace in transit"). If the real transport uses `node:http` directly
// instead of `fetch`, the spy will never be invoked and the test below converts that into an
// explicit, labeled `expect.fail(...)` rather than a false pass/fail — flagged in TEST_PLAN.md's
// Ambiguities section, not guessed at silently.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const mod = await import('../../src/relay/http-peer-transport.js').catch((e: unknown) => ({ __importError: e as Error }));
type HttpPeerTransportCtor = new (
  peerUrls: string[],
  peerTimeoutMs?: number,
  peerAuthToken?: string,
) => {
  deliver: (envelope: string, deliveryId: string) => Promise<void>;
  release?: (deliveryId: string) => void;
};
const HttpPeerTransport = (mod as { HttpPeerTransport?: HttpPeerTransportCtor }).HttpPeerTransport;

interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
interface FakePeer {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
  respondWith: (status: number) => void;
}

function startFakePeer(initialStatus = 200): Promise<FakePeer> {
  let status = initialStatus;
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(status).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        respondWith: (s: number) => {
          status = s;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function lowerHeaders(req: CapturedRequest): Record<string, string | string[] | undefined> {
  return Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
}

let peers: FakePeer[] = [];
afterEach(async () => {
  await Promise.all(peers.map((p) => p.close()));
  peers = [];
});

describe('http-peer-transport.ts — module resolution (F-010 credential extension)', () => {
  it('exists and exports HttpPeerTransport', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail('bff/src/relay/http-peer-transport.ts does not exist yet — expected pre-implementation RED signal.');
    }
    expect(typeof HttpPeerTransport).toBe('function');
  });
});

describe.skipIf(!HttpPeerTransport)('REQ-F010-004/005 — the credential is carried as the third wire element, on the SAME POST, verbatim', () => {
  it('with a credential configured, the outbound POST carries all three application-level headers: content-type, x-event-delivery-id, X-Event-Ingest-Secret', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'super-secret-token');
    const envelope = JSON.stringify({
      event: 'admin.user.created',
      actor: 's1',
      target: { id: 'u1' },
      changes: { username: 'alice', role: 'admin' },
      verified: true,
      timestamp: 't',
    });

    await transport.deliver(envelope, 'epoch-1:1');

    expect(p.requests).toHaveLength(1);
    expect(p.requests[0]!.body).toBe(envelope); // still byte-for-byte, unchanged (REQ-F010-012)
    const h = lowerHeaders(p.requests[0]!);
    expect(h['content-type']).toMatch(/application\/json/);
    expect(h['x-event-delivery-id']).toBe('epoch-1:1');
    expect(h['x-event-ingest-secret']).toBe('super-secret-token');
  });

  it('F-010 introduces EXACTLY ONE new application-level header vs. the pre-F-010 (no-credential) baseline — the header-NAME-SET differs by exactly {x-event-ingest-secret}', async () => {
    const pBaseline = await startFakePeer(200);
    const pWithCred = await startFakePeer(200);
    peers = [pBaseline, pWithCred];

    const t1 = new HttpPeerTransport!([pBaseline.url]);
    await t1.deliver('{}', 'epoch-1:baseline');
    const t2 = new HttpPeerTransport!([pWithCred.url], undefined, 'tok');
    await t2.deliver('{}', 'epoch-1:withcred');

    const baselineNames = new Set(Object.keys(pBaseline.requests[0]!.headers).map((h) => h.toLowerCase()));
    const withCredNames = new Set(Object.keys(pWithCred.requests[0]!.headers).map((h) => h.toLowerCase()));
    const added = [...withCredNames].filter((h) => !baselineNames.has(h));
    expect(added).toEqual(['x-event-ingest-secret']);
  });

  // Shared fetch-spy helper (extracted during Phase-4 verification so the whitespace-only case
  // below can reuse the SAME transport-boundary technique as the padded-value case, rather than
  // duplicating the plumbing). Spies on globalThis.fetch, captures the header value the TRANSPORT
  // itself passed into the HTTP client call — BEFORE any client-internal (WHATWG Headers/undici)
  // normalization — and returns it, or `undefined` if fetch was never called at all.
  async function captureTransportHeaderValue(peerAuthToken: string): Promise<string | null | undefined> {
    const calls: Array<{ init: Record<string, unknown> | undefined }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: unknown, init?: unknown) => {
      calls.push({ init: init as Record<string, unknown> | undefined });
      return new Response(null, { status: 200 });
    });
    try {
      const transport = new HttpPeerTransport!(['http://127.0.0.1:1'], undefined, peerAuthToken);
      await transport.deliver('{}', 'epoch-1:ws').catch(() => undefined);
      if (calls.length === 0) return undefined;
      const headersArg = calls[0]!.init?.['headers'];
      if (headersArg instanceof Headers) return headersArg.get('X-Event-Ingest-Secret');
      if (headersArg && typeof headersArg === 'object') {
        const rec = headersArg as Record<string, string>;
        return rec['X-Event-Ingest-Secret'] ?? rec['x-event-ingest-secret'];
      }
      return undefined;
    } finally {
      fetchSpy.mockRestore();
    }
  }

  it('the credential value is delivered BYTE-FOR-BYTE verbatim — no trim/case-fold/re-encode — asserted at the point the transport sets the header value (REQ-F010-005 whitespace-verification point: some HTTP clients strip optional surrounding whitespace in transit, so this is NOT asserted via the peer-observed wire value)', async () => {
    if (typeof globalThis.fetch !== 'function') {
      expect.fail('globalThis.fetch is not available in this runtime — cannot apply the assumed fetch-spy technique.');
      return;
    }
    const value = await captureTransportHeaderValue(' abc ');
    if (value === undefined) {
      expect.fail(
        'HttpPeerTransport does not appear to call globalThis.fetch — this whitespace-verbatim-at-the-' +
          'transport-boundary assertion assumed a fetch-based client (bff/package.json ships no alternate ' +
          'HTTP client dependency). If the real transport uses node:http directly instead, this test needs ' +
          'adapting to spy on that client instead; REQ-F010-005 whitespace-verbatim MUST still be verified ' +
          'at the transport boundary via an equivalent white-box hook. Flagged in TEST_PLAN.md Ambiguities.',
      );
      return;
    }
    expect(value).toBe(' abc ');
  });

  it('with NO credential configured (constructor arg omitted entirely), the outbound POST carries only the two pre-F-010 headers — no X-Event-Ingest-Secret at all (REQ-F010-005 scoping: the three-header MUST applies only "when a credential is configured")', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url]); // no peerAuthToken arg
    await transport.deliver('{}', 'epoch-1:no-cred');
    const names = Object.keys(p.requests[0]!.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain('x-event-ingest-secret');
  });

  it('an EMPTY-STRING credential ("") is treated as absent — no header attached (REQ-F010-017 "unset or empty" definition, mirrored at the transport boundary)', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, '');
    await transport.deliver('{}', 'epoch-1:empty-cred');
    const names = Object.keys(p.requests[0]!.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain('x-event-ingest-secret');
  });

  // CORRECTED (Phase-4 verification, 2026-07-23): the original assertion here checked the
  // whitespace-only value as OBSERVED BY THE PEER (`lowerHeaders(...)`) and expected literal ' '
  // to survive. Independently verified (NOT taking the implementer's word for it — reproduced
  // with a standalone script against a real local node:http server) that WHATWG `Headers`/undici
  // (Node's global `fetch`) normalizes a header value's OPTIONAL leading/trailing HTTP whitespace
  // AWAY at `Headers` construction/`.set()` time — i.e. `new Headers({'x': ' '}).get('x')` is
  // already `''`, synchronously, with ZERO network I/O involved — so NO conforming fetch-based
  // HTTP client can ever deliver a whitespace-only value to a peer un-normalized. This is exactly
  // the failure mode REQ-F010-005 itself names and explicitly routes AROUND: "some HTTP clients
  // or intermediaries strip optional surrounding whitespace in transit; a peer stub that observes
  // trimmed surrounding whitespace does not by itself prove a spec violation, whereas the
  // transport setting a trimmed value does." The peer-observed assertion was therefore asserting
  // a byte-for-byte-at-the-wire claim the spec's OWN text says is not the correct verification
  // point — replaced with two tests: (1) below, the CORRECT transport-boundary check (reusing the
  // padded-value case's fetch-spy technique), which is the test that actually proves/disproves
  // REQ-F010-017's "whitespace-only is non-empty, sent verbatim" claim; (2) further below, the
  // peer-observed behavior is kept as an explicitly-labeled DOCUMENTATION test of the client's own
  // normalization (asserting the real, verified outcome), not a false expectation.
  it('a WHITESPACE-ONLY credential (" ") is NOT treated as absent — the TRANSPORT sets the header value verbatim (asserted at the fetch() call boundary, per REQ-F010-005\'s own whitespace-verification-point instruction, NOT via the peer-observed wire value)', async () => {
    if (typeof globalThis.fetch !== 'function') {
      expect.fail('globalThis.fetch is not available in this runtime — cannot apply the assumed fetch-spy technique.');
      return;
    }
    const value = await captureTransportHeaderValue(' ');
    if (value === undefined) {
      expect.fail(
        'HttpPeerTransport does not appear to call globalThis.fetch — see the sibling padded-value test for ' +
          'the full explanation of this assumption.',
      );
      return;
    }
    expect(value).toBe(' ');
  });

  it('a WHITESPACE-ONLY credential (" ") IS attached as a header (the KEY is present at the peer, proving the transport did not treat it as absent) even though undici/fetch\'s own Headers normalization empties its VALUE in transit — DOCUMENTED, not a spec violation (REQ-F010-005\'s own text: a peer observing trimmed whitespace "does not by itself prove a spec violation")', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, ' ');
    await transport.deliver('{}', 'epoch-1:ws-only-cred');
    const h = lowerHeaders(p.requests[0]!);
    expect(Object.keys(h)).toContain('x-event-ingest-secret'); // attached, not omitted (contrast with the "" -> absent case above)
    // The value itself is normalized to '' by the fetch/undici client BEFORE it ever reaches the
    // wire (confirmed independently, see comment above) — this is the client's own behavior, not
    // a transport defect, and is exactly why REQ-F010-005 pins verbatim-value verification to the
    // transport boundary (the test above), not here.
    expect(h['x-event-ingest-secret']).toBe('');
  });
});

describe.skipIf(!HttpPeerTransport)('REQ-F010-006 — the two pre-existing wire elements are unchanged by F-010', () => {
  it('content-type stays application/json and x-event-delivery-id keeps the <epoch>:<row-id> shape; the credential is added ALONGSIDE, never in place of them', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'tok');
    await transport.deliver('{}', 'epoch-42:7');
    const h = lowerHeaders(p.requests[0]!);
    expect(h['content-type']).toMatch(/application\/json/);
    expect(h['x-event-delivery-id']).toBe('epoch-42:7');
  });
});

describe.skipIf(!HttpPeerTransport)('REQ-F010-009 — a single configured credential is applied to EVERY configured peer (default: one shared secret)', () => {
  it('two distinct peers both receive the IDENTICAL credential header value', async () => {
    const p1 = await startFakePeer(200);
    const p2 = await startFakePeer(200);
    peers = [p1, p2];
    const transport = new HttpPeerTransport!([p1.url, p2.url], undefined, 'shared-secret');
    await transport.deliver('{}', 'epoch-1:multi');
    expect(lowerHeaders(p1.requests[0]!)['x-event-ingest-secret']).toBe('shared-secret');
    expect(lowerHeaders(p2.requests[0]!)['x-event-ingest-secret']).toBe('shared-secret');
  });
});

describe.skipIf(!HttpPeerTransport)('REQ-F010-022 — the credential rides the EXISTING single POST; no additional request/round-trip is introduced', () => {
  it('a credentialed delivery to one peer results in exactly ONE HTTP request, not two', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'tok');
    await transport.deliver('{}', 'epoch-1:single-post');
    expect(p.requests).toHaveLength(1);
  });
});

describe.skipIf(!HttpPeerTransport)('REQ-F010-013/028 — the REQ-F004-055 classification table is UNCHANGED when a credential is configured', () => {
  it.each([
    [200, 'ack'],
    [204, 'ack'],
    [401, 'permanent'],
    [403, 'permanent'],
    [500, 'transient'],
    [429, 'transient'],
  ] as const)('status %d still classifies %s with a credential configured (F-010 adds a header, not new response handling)', async (status, expected) => {
    const p = await startFakePeer(status);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'tok');
    let classification: string | undefined;
    try {
      await transport.deliver('{}', `epoch-1:cls-${status}`);
      classification = 'ack';
    } catch (err) {
      classification = (err as { classification?: string }).classification;
    }
    expect(classification).toBe(expected);
  });
});
