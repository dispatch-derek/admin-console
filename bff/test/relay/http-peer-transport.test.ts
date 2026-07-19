// bff/src/relay/http-peer-transport.ts — HttpPeerTransport (spec REQ-F004-050/051/043/052/055;
// design §2.2, §4.4 rev 11). Exercised against REAL local HTTP servers (node:http) standing in
// for peers — no mocking of the transport's own networking, so this genuinely proves the wire
// behavior.
//
// ASSUMED EXPORT / CONSTRUCTOR SHAPE (design §2.2 pins the BEHAVIOR precisely; the literal
// constructor signature is not spec-pinned. Most defensible reading of "owns the peer list
// parsed from EVENT_BUS_URL" + design §1.1's factory table ("http -> HttpPeerTransport")):
//   new HttpPeerTransport(peerUrls: string[])   // already-parsed, trimmed, non-empty list
//   .deliver(envelope: string, deliveryId: string): Promise<void>
//   .release(deliveryId: string): void
//
// REQ-F004-055 (rev 11, §4.4 — RULED, formerly the one SPEC-AMBIGUITY this suite flagged; now
// pinned) — the concrete HTTP-status/network-failure -> permanent/transient classification table,
// owned entirely by HttpPeerTransport (kept out of the drainer per the REQ-F004-049 seam):
//   ACK        : 2xx (e.g. 200, 204)
//   TRANSIENT  : connection-refused / timeout / DNS failure / socket reset (network-level);
//                ALL 5xx; 408; 429  ->  deliver() rejects TRANSIENT (retry w/ backoff to the
//                max-attempt bound, then park, REQ-F004-013/014)
//   PERMANENT  : all other 4xx (400/401/403/404/422/...); any 3xx; any other unexpected non-2xx
//                ->  deliver() rejects PERMANENT (immediate park, no backoff, REQ-F004-047/051(d))
//   FAN-OUT COMPOSITION (REQ-F004-051): a PERMANENT response from any not-yet-acked peer means
//   the WHOLE deliver() rejects permanent (immediate park) even if other peers acked/were
//   transient; with no permanent peer, any not-yet-acked TRANSIENT peer means deliver() rejects
//   transient (re-drive re-POSTs only the still-un-acked peers).

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const mod = await import('../../src/relay/http-peer-transport.js').catch((e: unknown) => ({ __importError: e as Error }));
type HttpPeerTransportCtor = new (peerUrls: string[]) => {
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

let peers: FakePeer[] = [];
afterEach(async () => {
  await Promise.all(peers.map((p) => p.close()));
  peers = [];
});

describe('http-peer-transport.ts — module resolution', () => {
  it('exists and exports HttpPeerTransport', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail(`bff/src/relay/http-peer-transport.ts does not exist yet — expected pre-implementation RED signal.`);
    }
    expect(typeof HttpPeerTransport).toBe('function');
  });
});

describe.skipIf(!HttpPeerTransport)('HttpPeerTransport — fan-out ack (REQ-F004-051, REQ-F004-050)', () => {
  it('POSTs the envelope byte-for-byte to every configured peer (REQ-F004-002/050)', async () => {
    const p1 = await startFakePeer(200);
    const p2 = await startFakePeer(200);
    peers = [p1, p2];
    const transport = new HttpPeerTransport!([p1.url, p2.url]);
    const envelope = JSON.stringify({ event: 'admin.user.created', actor: 's1', target: { id: 'u1' }, verified: true, timestamp: 't' });

    await transport.deliver(envelope, 'epoch-1:1');

    expect(p1.requests).toHaveLength(1);
    expect(p2.requests).toHaveLength(1);
    expect(p1.requests[0]!.body).toBe(envelope);
    expect(p2.requests[0]!.body).toBe(envelope);
  });

  it('carries the deliveryId as request/message metadata reaching every peer (REQ-F004-043(b))', async () => {
    const p1 = await startFakePeer(200);
    peers = [p1];
    const transport = new HttpPeerTransport!([p1.url]);
    await transport.deliver('{}', 'epoch-1:99');
    const headerValues = Object.values(p1.requests[0]!.headers).flat();
    expect(headerValues).toContain('epoch-1:99');
  });

  it('resolves ONLY when EVERY peer accepts (2xx) — one peer failing keeps deliver() pending/rejected', async () => {
    const good = await startFakePeer(200);
    const bad = await startFakePeer(500);
    peers = [good, bad];
    const transport = new HttpPeerTransport!([good.url, bad.url]);
    await expect(transport.deliver('{}', 'epoch-1:2')).rejects.toBeTruthy();
  });

  it('all-peers-accept resolves cleanly with no rejection', async () => {
    const p1 = await startFakePeer(200);
    const p2 = await startFakePeer(201);
    peers = [p1, p2];
    const transport = new HttpPeerTransport!([p1.url, p2.url]);
    await expect(transport.deliver('{}', 'epoch-1:3')).resolves.toBeUndefined();
  });

  it('STATEFUL re-drive: after a partial failure, re-invoking deliver() with the SAME deliveryId re-POSTs ONLY the un-acked peer — the already-acked peer receives NO second POST (REQ-F004-051(a)(b))', async () => {
    const good = await startFakePeer(200);
    const flaky = await startFakePeer(500); // fails first, will be made to succeed on retry
    peers = [good, flaky];
    const transport = new HttpPeerTransport!([good.url, flaky.url]);

    await expect(transport.deliver('{}', 'epoch-1:4')).rejects.toBeTruthy();
    expect(good.requests).toHaveLength(1); // accepted on the first attempt
    expect(flaky.requests).toHaveLength(1); // failed on the first attempt

    flaky.respondWith(200); // now the previously-failing peer will accept
    await expect(transport.deliver('{}', 'epoch-1:4')).resolves.toBeUndefined();

    expect(good.requests).toHaveLength(1); // NOT re-POSTed — already acked
    expect(flaky.requests).toHaveLength(2); // re-POSTed exactly once more
  });

  it('a fresh deliveryId is unaffected by another deliveryId\'s ack state (per-deliveryId map, REQ-F004-051(b))', async () => {
    const p1 = await startFakePeer(200);
    peers = [p1];
    const transport = new HttpPeerTransport!([p1.url]);
    await transport.deliver('{}', 'epoch-1:5');
    await transport.deliver('{}', 'epoch-1:6'); // different deliveryId -> must be POSTed again
    expect(p1.requests).toHaveLength(2);
  });

  it('release(deliveryId) evicts the ack-map entry — a later delivery reusing the SAME deliveryId re-POSTs every peer again (REQ-F004-051(c), bounded memory)', async () => {
    const p1 = await startFakePeer(200);
    const p2 = await startFakePeer(200);
    peers = [p1, p2];
    const transport = new HttpPeerTransport!([p1.url, p2.url]);
    await transport.deliver('{}', 'epoch-1:7');
    expect(p1.requests).toHaveLength(1);
    expect(p2.requests).toHaveLength(1);

    transport.release?.('epoch-1:7');
    await transport.deliver('{}', 'epoch-1:7');
    // Evicted -> both peers are treated as un-acked again and POSTed a second time.
    expect(p1.requests).toHaveLength(2);
    expect(p2.requests).toHaveLength(2);
  });
});

// Server that accepts the TCP connection then immediately destroys the socket without ever
// writing a response — a fast, deterministic stand-in for a mid-response "socket reset"
// (REQ-F004-055's "socket reset" network-level transient case), no real timeout wait needed.
function startResetPeer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.socket?.destroy();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

async function classificationOf(deliverPromise: Promise<void>): Promise<string | undefined> {
  try {
    await deliverPromise;
    return 'ack';
  } catch (err) {
    return (err as { classification?: string }).classification;
  }
}

describe.skipIf(!HttpPeerTransport)('HttpPeerTransport — REQ-F004-055 single-peer classification table (rev 11, §4.4, RULED)', () => {
  describe('ACK — 2xx', () => {
    it.each([200, 204])('status %d resolves deliver() (ack, no rejection)', async (status) => {
      const p1 = await startFakePeer(status);
      peers = [p1];
      const transport = new HttpPeerTransport!([p1.url]);
      await expect(transport.deliver('{}', `epoch-1:ack-${status}`)).resolves.toBeUndefined();
    });
  });

  describe('TRANSIENT — 5xx, 408, 429, and network-level failures', () => {
    it.each([500, 502, 503, 408, 429])('status %d is classified TRANSIENT', async (status) => {
      const p1 = await startFakePeer(status);
      peers = [p1];
      const transport = new HttpPeerTransport!([p1.url]);
      const classification = await classificationOf(transport.deliver('{}', `epoch-1:transient-${status}`));
      expect(classification).toBe('transient');
    });

    it('connection-refused (nothing listening) is classified TRANSIENT', async () => {
      const closedPort = 'http://127.0.0.1:1'; // port 1 is reserved/unlikely to be bound; refused fast
      const transport = new HttpPeerTransport!([closedPort]);
      const classification = await classificationOf(transport.deliver('{}', 'epoch-1:conn-refused'));
      expect(classification).toBe('transient');
    });

    it('DNS resolution failure (unresolvable host) is classified TRANSIENT', async () => {
      // .invalid is an RFC 2606 reserved TLD guaranteed to never resolve.
      const transport = new HttpPeerTransport!(['http://this-host-does-not-exist.invalid']);
      const classification = await classificationOf(transport.deliver('{}', 'epoch-1:dns-failure'));
      expect(classification).toBe('transient');
    }, 15_000);

    it('a socket reset mid-connection (no response ever written) is classified TRANSIENT', async () => {
      const p1 = await startResetPeer();
      peers = [{ ...p1, requests: [], respondWith: () => undefined }];
      const transport = new HttpPeerTransport!([p1.url]);
      const classification = await classificationOf(transport.deliver('{}', 'epoch-1:socket-reset'));
      expect(classification).toBe('transient');
    });
  });

  describe('PERMANENT — all other 4xx, any 3xx', () => {
    it.each([400, 401, 403, 404, 422])('status %d is classified PERMANENT', async (status) => {
      const p1 = await startFakePeer(status);
      peers = [p1];
      const transport = new HttpPeerTransport!([p1.url]);
      const classification = await classificationOf(transport.deliver('{}', `epoch-1:permanent-${status}`));
      expect(classification).toBe('permanent');
    });

    it.each([301, 302])('status %d (a redirect / any 3xx) is classified PERMANENT', async (status) => {
      const p1 = await startFakePeer(status);
      peers = [p1];
      const transport = new HttpPeerTransport!([p1.url]);
      const classification = await classificationOf(transport.deliver('{}', `epoch-1:permanent-3xx-${status}`));
      expect(classification).toBe('permanent');
    });
  });
});

describe.skipIf(!HttpPeerTransport)('HttpPeerTransport — REQ-F004-055/051 fan-out composition rule', () => {
  it('a PERMANENT response from ANY not-yet-acked peer makes the WHOLE deliver() reject PERMANENT — even with another peer already transient-failing (permanent wins, immediate park)', async () => {
    const transientPeer = await startFakePeer(503);
    const permanentPeer = await startFakePeer(403);
    peers = [transientPeer, permanentPeer];
    const transport = new HttpPeerTransport!([transientPeer.url, permanentPeer.url]);
    const classification = await classificationOf(transport.deliver('{}', 'epoch-1:mixed-transient-permanent'));
    expect(classification).toBe('permanent');
  });

  it('permanent-wins holds regardless of peer array order', async () => {
    const permanentPeer = await startFakePeer(404);
    const transientPeer = await startFakePeer(500);
    peers = [permanentPeer, transientPeer];
    const transport = new HttpPeerTransport!([permanentPeer.url, transientPeer.url]); // permanent listed FIRST this time
    const classification = await classificationOf(transport.deliver('{}', 'epoch-1:mixed-permanent-first'));
    expect(classification).toBe('permanent');
  });

  it('a PERMANENT response wins even when another peer has ALREADY ACKED (2xx)', async () => {
    const ackedPeer = await startFakePeer(200);
    const permanentPeer = await startFakePeer(422);
    peers = [ackedPeer, permanentPeer];
    const transport = new HttpPeerTransport!([ackedPeer.url, permanentPeer.url]);
    const classification = await classificationOf(transport.deliver('{}', 'epoch-1:acked-plus-permanent'));
    expect(classification).toBe('permanent');
  });

  it('with NO permanent peer, a mix of ACK + TRANSIENT makes deliver() reject TRANSIENT — and re-drive re-POSTs ONLY the still-un-acked (transient) peer', async () => {
    const ackedPeer = await startFakePeer(200);
    const flakyPeer = await startFakePeer(503);
    peers = [ackedPeer, flakyPeer];
    const transport = new HttpPeerTransport!([ackedPeer.url, flakyPeer.url]);

    const classification = await classificationOf(transport.deliver('{}', 'epoch-1:mixed-ack-transient'));
    expect(classification).toBe('transient');
    expect(ackedPeer.requests).toHaveLength(1);
    expect(flakyPeer.requests).toHaveLength(1);

    flakyPeer.respondWith(200);
    await expect(transport.deliver('{}', 'epoch-1:mixed-ack-transient')).resolves.toBeUndefined();
    expect(ackedPeer.requests).toHaveLength(1); // never re-POSTed — already acked
    expect(flakyPeer.requests).toHaveLength(2); // re-POSTed exactly once more
  });
});
