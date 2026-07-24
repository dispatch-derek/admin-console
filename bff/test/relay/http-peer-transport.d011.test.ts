// D-011 (GH #51) regression test — bff/src/relay/http-peer-transport.ts
//
// The relay's outbound shared-secret wire header is being RENAMED:
//   X-Event-Auth-Token  ->  X-Event-Bus-Peer-Auth-Token   (final, unified name)
// The env var the value is sourced from (EVENT_BUS_PEER_AUTH_TOKEN) is UNCHANGED — only the
// wire header NAME changes. The implementer's fix (next phase) is expected to change the
// `AUTH_TOKEN_HEADER` constant in bff/src/relay/http-peer-transport.ts.
//
// NOTE on today's baseline (as of this writing, admin-console `main`): the transport currently
// sends `X-Event-Auth-Token` — a prior attempt to rename it to `X-Event-Ingest-Secret` (D-009)
// never actually landed on this header. This test targets the D-011 rename target directly
// (X-Event-Bus-Peer-Auth-Token) and is expected to be RED against today's `X-Event-Auth-Token`
// baseline, regardless of exactly which wrong name is currently being sent.
//
// A NEW, separate file — mirrors this directory's existing per-defect isolation convention
// (relay-config.d006.test.ts alongside relay-config.test.ts / .f010.test.ts): leaves
// http-peer-transport.f010.test.ts (whose own header-literal assertions were corrected in this
// same change to expect the NEW name, per this task) and http-peer-transport.test.ts /
// .unit.test.ts completely untouched by this file.
//
// Harness mirrored 1:1 from http-peer-transport.f010.test.ts's fake-peer + constructor-shape
// assumptions (peerAuthToken as the third, optional, positional constructor argument) — see that
// file's own header comment for the documented assumption/risk this rests on.

import { describe, it, expect, afterEach } from 'vitest';
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
}

function startFakePeer(): Promise<FakePeer> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200).end();
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

function lowerHeaders(req: CapturedRequest): Record<string, string | string[] | undefined> {
  return Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
}

let peers: FakePeer[] = [];
afterEach(async () => {
  await Promise.all(peers.map((p) => p.close()));
  peers = [];
});

describe('http-peer-transport.ts — module resolution (D-011 header-rename regression)', () => {
  it('exists and exports HttpPeerTransport', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail('bff/src/relay/http-peer-transport.ts does not exist.');
    }
    expect(typeof HttpPeerTransport).toBe('function');
  });
});

describe.skipIf(!HttpPeerTransport)('D-011 (GH #51) — the outbound shared-secret credential header is X-Event-Bus-Peer-Auth-Token, not X-Event-Auth-Token', () => {
  it('with a credential configured, the outbound POST carries the credential under X-Event-Bus-Peer-Auth-Token (value = the configured secret, verbatim)', async () => {
    const p = await startFakePeer();
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'd011-secret-value');
    await transport.deliver('{}', 'epoch-1:d011-rename');

    expect(p.requests).toHaveLength(1);
    const h = lowerHeaders(p.requests[0]!);
    expect(h['x-event-bus-peer-auth-token']).toBe('d011-secret-value');
  });

  it('the outbound POST does NOT carry the old X-Event-Auth-Token header name at all — the rename is a REPLACEMENT of the header name, not an addition alongside it', async () => {
    const p = await startFakePeer();
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'd011-secret-value');
    await transport.deliver('{}', 'epoch-1:d011-no-old-name');

    const names = Object.keys(p.requests[0]!.headers).map((n) => n.toLowerCase());
    expect(names).not.toContain('x-event-auth-token');
    expect(names).toContain('x-event-bus-peer-auth-token');
  });
});
