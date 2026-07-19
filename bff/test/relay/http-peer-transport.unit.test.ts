// White-box unit tests for bff/src/relay/http-peer-transport.ts — supplements
// bff/test/relay/http-peer-transport.test.ts (qa-engineer's spec-level suite, already 100%
// branch-covered per v8; NOT modified here). These add behavioral edges on the SAME branches
// that are worth pinning explicitly as documented current behavior, read directly from the
// `pending = this.peerUrls.filter((url) => !acked!.has(url))` fan-out-scoping line:
//   - a deliveryId that has ALREADY been fully acked, re-delivered WITHOUT an intervening
//     release() call, has an empty `pending` array -> zero new network calls, trivial resolve
//     (the ack-map-eviction-vs-idempotent-redeliver distinction the task brief calls out).
//   - a transport configured with ZERO peers resolves trivially (vacuous fan-out truth).
//
// Phase 7 review-gate remediation addition (coordinator-directed, 2026-07-19): the constructor's
// new optional `peerTimeoutMs` parameter — a per-peer request that exceeds it must abort and be
// classified TRANSIENT (REQ-F004-055 network-level/connection-timeout), deterministically and
// fast (a tiny timeout against a deliberately-slow fake peer, never a real multi-second wait).

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

// A peer that deliberately delays its response by `delayMs` — used to force a peerTimeoutMs abort
// deterministically without any real multi-second wait (the delay is always well ABOVE the tiny
// peerTimeoutMs under test, and the test never waits for the delay to actually elapse).
interface SlowPeer {
  url: string;
  close: () => Promise<void>;
}
function startSlowPeer(delayMs: number, status = 200): Promise<SlowPeer> {
  const server: Server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    const timer = setTimeout(() => {
      try {
        res.writeHead(status).end();
      } catch {
        // client already gave up (aborted) — nothing to do.
      }
    }, delayMs);
    res.on('close', () => clearTimeout(timer));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

let slowPeers: SlowPeer[] = [];
afterEach(async () => {
  await Promise.all(slowPeers.map((p) => p.close()));
  slowPeers = [];
});

describe('HttpPeerTransport — constructor peerTimeoutMs (per-peer request timeout, REQ-F004-055)', () => {
  it('a peer that does not respond within peerTimeoutMs aborts and is classified TRANSIENT — resolves fast, without waiting for the peer\'s (much slower) eventual response', async () => {
    const slow = await startSlowPeer(2_000); // would take 2s to respond
    slowPeers = [slow];
    const transport = new HttpPeerTransport([slow.url], 30); // 30ms peer timeout, far under the 2000ms delay

    const start = Date.now();
    let classification: string | undefined;
    try {
      await transport.deliver('{}', 'epoch-1:peer-timeout');
    } catch (err) {
      classification = (err as { classification?: string }).classification;
    }
    const elapsed = Date.now() - start;

    expect(classification).toBe('transient');
    expect(elapsed).toBeLessThan(1_000); // aborted well before the peer's 2000ms delay would fire
  });

  it('a fast peer under a short peerTimeoutMs still acks normally (no false-timeout)', async () => {
    const p1 = await startFakePeer(200);
    peers = [p1];
    const transport = new HttpPeerTransport([p1.url], 2_000); // generous relative to a near-instant local response
    await expect(transport.deliver('{}', 'epoch-1:fast-under-timeout')).resolves.toBeUndefined();
  });

  it('omitting peerTimeoutMs (using the built-in default) does not regress normal fast-peer delivery', async () => {
    const p1 = await startFakePeer(200);
    peers = [p1];
    const transport = new HttpPeerTransport([p1.url]); // no third constructor arg
    await expect(transport.deliver('{}', 'epoch-1:default-timeout')).resolves.toBeUndefined();
  });

  it('in a fan-out, ONE peer timing out (transient) while another acks yields an overall TRANSIENT rejection (fan-out composition unaffected by the timeout source)', async () => {
    const fast = await startFakePeer(200);
    const slow = await startSlowPeer(2_000);
    peers = [fast];
    slowPeers = [slow];
    const transport = new HttpPeerTransport([fast.url, slow.url], 30);

    let classification: string | undefined;
    try {
      await transport.deliver('{}', 'epoch-1:fanout-timeout');
    } catch (err) {
      classification = (err as { classification?: string }).classification;
    }
    expect(classification).toBe('transient');
    expect(fast.requestCount).toBe(1);
  });
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
