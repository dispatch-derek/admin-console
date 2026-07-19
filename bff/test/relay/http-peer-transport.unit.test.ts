// White-box unit tests for bff/src/relay/http-peer-transport.ts — supplements
// bff/test/relay/http-peer-transport.test.ts (qa-engineer's spec-level suite, already 100%
// branch-covered per v8; NOT modified here). These add behavioral edges on the SAME branches
// that are worth pinning explicitly as documented current behavior, read directly from the
// `pending = this.peerUrls.filter((url) => !acked!.has(url))` fan-out-scoping line:
//   - a deliveryId that has ALREADY been fully acked, re-delivered WITHOUT an intervening
//     release() call, has an empty `pending` array -> zero new network calls, trivial resolve
//     (the ack-map-eviction-vs-idempotent-redeliver distinction the task brief calls out).
//   - a transport configured with ZERO peers resolves trivially (vacuous fan-out truth).

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const { HttpPeerTransport } = await import('../../src/relay/http-peer-transport.js');

interface FakePeer {
  url: string;
  requestCount: number;
  close: () => Promise<void>;
}

function startFakePeer(status = 200): Promise<FakePeer> {
  const state = { count: 0 };
  const server: Server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    state.count += 1;
    res.writeHead(status).end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        get requestCount() {
          return state.count;
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

describe('HttpPeerTransport — re-delivery of an already-fully-acked deliveryId WITHOUT release() (idempotent, pending=[] branch)', () => {
  it('sends ZERO new requests to any peer and resolves trivially — the ack map already marks every peer acked', async () => {
    const p1 = await startFakePeer(200);
    const p2 = await startFakePeer(200);
    peers = [p1, p2];
    const transport = new HttpPeerTransport([p1.url, p2.url]);

    await transport.deliver('{}', 'epoch-1:idempotent');
    expect(p1.requestCount).toBe(1);
    expect(p2.requestCount).toBe(1);

    // Re-invoke with the SAME deliveryId, no release() in between.
    await expect(transport.deliver('{}', 'epoch-1:idempotent')).resolves.toBeUndefined();
    expect(p1.requestCount).toBe(1); // no new request — already acked
    expect(p2.requestCount).toBe(1);
  });
});

describe('HttpPeerTransport — zero configured peers', () => {
  it('deliver() with an empty peer list resolves trivially (vacuous fan-out — no peer to reject)', async () => {
    const transport = new HttpPeerTransport([]);
    await expect(transport.deliver('{}', 'epoch-1:no-peers')).resolves.toBeUndefined();
  });

  it('release() on a transport with no prior deliver() calls does not throw (defensive no-op)', () => {
    const transport = new HttpPeerTransport(['http://unused.example']);
    expect(() => transport.release?.('never-delivered')).not.toThrow();
  });
});
