// bff/src/relay/http-peer-transport.ts — HttpPeerTransport (spec REQ-F004-050/051/043/052;
// design §2.2). Exercised against REAL local HTTP servers (node:http) standing in for peers —
// no mocking of the transport's own networking, so this genuinely proves the wire behavior.
//
// ASSUMED EXPORT / CONSTRUCTOR SHAPE (design §2.2 pins the BEHAVIOR precisely; the literal
// constructor signature is not spec-pinned. Most defensible reading of "owns the peer list
// parsed from EVENT_BUS_URL" + design §1.1's factory table ("http -> HttpPeerTransport")):
//   new HttpPeerTransport(peerUrls: string[])   // already-parsed, trimmed, non-empty list
//   .deliver(envelope: string, deliveryId: string): Promise<void>
//   .release(deliveryId: string): void
//
// SPEC-AMBIGUITY (flagged, not blocking — see final QA report): the spec pins the conforming-
// transport CONTRACT (ack / delivery-id carriage / permanent-vs-transient signal, REQ-F004-043)
// but does NOT pin HttpPeerTransport's concrete HTTP-status-code -> classification mapping
// (design §1.1 explicitly calls "status-code mapping" transport-internal, deliberately not
// leaked to orchestration). This suite uses the most defensible convention (4xx except 429 =
// permanent; 5xx / connection failure = transient) for the one test that needs SOME permanent
// signal from the real HTTP layer; the REQ-F004-051(d) orchestration-level permanent-park
// behavior itself is verified transport-agnostically against the FakeTransport double in
// drainer.test.ts, which does not depend on this assumption.

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

describe.skipIf(!HttpPeerTransport)('HttpPeerTransport — permanent vs transient classification (REQ-F004-043(c)/047, SPEC-AMBIGUITY on the exact status mapping)', () => {
  it('a 5xx / server-error peer response is classified TRANSIENT (uncontroversial per REQ-F004-047: "errors ... treated as transient")', async () => {
    const p1 = await startFakePeer(503);
    peers = [p1];
    const transport = new HttpPeerTransport!([p1.url]);
    try {
      await transport.deliver('{}', 'epoch-1:8');
      expect.fail('expected deliver() to reject');
    } catch (err) {
      expect((err as { classification?: string }).classification).toBe('transient');
    }
  });

  it('an unreachable peer (connection refused) is classified TRANSIENT (REQ-F004-047: "unreachable transport ... treated as transient")', async () => {
    // A closed local port: nothing is listening, so the connection is refused immediately.
    const closedPort = 'http://127.0.0.1:1'; // port 1 is reserved/unlikely to be bound; refused fast
    const transport = new HttpPeerTransport!([closedPort]);
    try {
      await transport.deliver('{}', 'epoch-1:9');
      expect.fail('expected deliver() to reject');
    } catch (err) {
      expect((err as { classification?: string }).classification).toBe('transient');
    }
  });
});
