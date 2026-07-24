// bff/src/relay/transport.ts — F-010 credential threading through the createTransport factory
// (spec §3.3, REQ-F010-008/009/029). A NEW, separate file — the F-004-owned
// bff/test/relay/transport.test.ts / transport.unit.test.ts are left untouched.
//
// ASSUMED FACTORY EXTENSION: transport.test.ts pins `createTransport(opts: { kind, peerUrls })`;
// this file assumes the SAME opts object grows two new OPTIONAL fields, mirroring the
// `peerTimeoutMs` extension already threaded through this factory for HttpPeerTransport
// (bff/test/relay/relay-config.unit.test.ts's EVENT_BUS_PEER_TIMEOUT_MS plumbing):
//   createTransport(opts: { kind, peerUrls, peerTimeoutMs?, peerAuthToken? })
// This is the minimal seam needed to prove REQ-F010-008 ("threaded config -> createTransport ->
// HttpPeerTransport") behaviorally rather than merely re-testing HttpPeerTransport's own
// constructor in isolation (already covered by http-peer-transport.f010.test.ts).

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const mod = await import('../../src/relay/transport.js').catch((e: unknown) => ({ __importError: e as Error }));
type CreateTransportOpts = {
  kind: string | undefined;
  peerUrls: string[];
  peerTimeoutMs?: number;
  peerAuthToken?: string;
};
type TransportMod = {
  createTransport?: (opts: CreateTransportOpts) => { deliver: (envelope: string, deliveryId: string) => Promise<void> };
};
const { createTransport } = mod as TransportMod;

interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface FakePeer {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

function startFakePeer(status = 200): Promise<FakePeer> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ headers: req.headers });
      res.writeHead(status).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
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

describe('transport.ts — module resolution (F-010 credential threading)', () => {
  it('exists and exports createTransport', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail('bff/src/relay/transport.ts does not exist yet — expected pre-implementation RED signal.');
    }
    expect(typeof createTransport).toBe('function');
  });
});

describe.skipIf(!createTransport)('REQ-F010-008 — the credential is threaded config -> createTransport -> HttpPeerTransport', () => {
  it('a peerAuthToken passed to createTransport reaches the outbound POST as the X-Event-Bus-Peer-Auth-Token header — proves the THREADING, not just the transport constructor in isolation', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = createTransport!({ kind: 'http', peerUrls: [p.url], peerAuthToken: 'threaded-secret' });
    await transport.deliver('{}', 'epoch-1:threaded');
    const h = Object.fromEntries(Object.entries(p.requests[0]!.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(h['x-event-bus-peer-auth-token']).toBe('threaded-secret');
  });

  it('omitting peerAuthToken from createTransport opts sends no credential header (mirrors the constructor-level default)', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = createTransport!({ kind: 'http', peerUrls: [p.url] });
    await transport.deliver('{}', 'epoch-1:threaded-none');
    const names = Object.keys(p.requests[0]!.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain('x-event-bus-peer-auth-token');
  });

  it('kind undefined (defaults to "http") also threads the credential correctly', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = createTransport!({ kind: undefined, peerUrls: [p.url], peerAuthToken: 'default-kind-secret' });
    await transport.deliver('{}', 'epoch-1:threaded-default-kind');
    const h = Object.fromEntries(Object.entries(p.requests[0]!.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(h['x-event-bus-peer-auth-token']).toBe('default-kind-secret');
  });
});

describe.skipIf(!createTransport)('REQ-F010-029 — EVENT_BUS_TRANSPORT=broker still hard-refuses, even when a credential is supplied (F-010 adds no broker/non-HTTP transport)', () => {
  it('kind "broker" refuses regardless of peerAuthToken being set', () => {
    expect(() => createTransport!({ kind: 'broker', peerUrls: [], peerAuthToken: 'tok' })).toThrow(
      /broker transport not available/i,
    );
  });
});
