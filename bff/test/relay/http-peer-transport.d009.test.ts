// D-009 regression test (GH #47) — bff/src/relay/http-peer-transport.ts.
//
// Root cause (debugger's report): http-peer-transport.ts:18 sets
// `AUTH_TOKEN_HEADER = 'X-Event-Auth-Token'`, but customer-web-app's ingest endpoint requires the
// credential in the `X-Event-Ingest-Secret` header (customer-web-app/bff/src/server/ingest-auth.ts:26,
// `req.headers['x-event-ingest-secret']`) and 401s (permanent-parks) on any request that lacks it —
// cwa reads `x-event-auth-token` NOWHERE. cwa's own relay peer also sends `x-event-ingest-secret`
// (the frozen wire contract on cwa's side, REQ-F005-061). So every credentialed delivery from this
// relay to a real cwa ingest endpoint sends the WRONG header name, cwa never sees a credential at
// all, and the delivery 401s -> permanent-parks on the FIRST attempt, regardless of how correct the
// configured secret value is.
//
// Expected-fixed behavior this test locks in: with a credential configured, the outbound peer POST
// carries the secret in the `X-Event-Ingest-Secret` header (byte-for-byte the configured value), and
// does NOT use `X-Event-Auth-Token` at all (old name fully retired, not merely aliased/duplicated).
//
// This MUST fail (RED) against the current, unfixed source (which still emits `X-Event-Auth-Token`)
// and pass once the constant at http-peer-transport.ts:18 is renamed to
// `X-Event-Ingest-Secret` — no other wire/behavioral change is expected or asserted here.
//
// Harness mirrors bff/test/relay/http-peer-transport.f010.test.ts's real-local-HTTP-peer +
// lowerHeaders() convention (a NEW, separate file per this repo's per-defect isolation precedent,
// e.g. metrics-endpoint.d008.test.ts / relay-config.d006.test.ts alongside their *.f0NN.test.ts
// siblings) — the F-010 file is left completely untouched by this task except for the wire-contract
// correction already applied to its own pre-existing assertions (see QA report).
//
// Spec/defect: GH #47 (D-009); F-010 REQ-F010-004/005 (credential is the third wire element);
// cwa REQ-F005-061/080 (frozen `X-Event-Ingest-Secret` contract, customer-web-app/bff/src/server/ingest-auth.ts).

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

function startFakePeer(initialStatus = 200): Promise<FakePeer> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(initialStatus).end();
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

describe('http-peer-transport.ts — module resolution (D-009 header-rename regression)', () => {
  it('exists and exports HttpPeerTransport', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail('bff/src/relay/http-peer-transport.ts does not exist — cannot verify D-009.');
    }
    expect(typeof HttpPeerTransport).toBe('function');
  });
});

describe.skipIf(!HttpPeerTransport)('D-009 (GH #47) — the credential rides X-Event-Ingest-Secret, matching cwa\'s frozen ingest-auth contract', () => {
  it('with a credential configured, the outbound POST carries the secret in the X-Event-Ingest-Secret header, byte-for-byte the configured value', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'cwa-shared-secret-value');
    await transport.deliver('{}', 'epoch-1:d009');

    expect(p.requests).toHaveLength(1);
    const h = lowerHeaders(p.requests[0]!);
    expect(h['x-event-ingest-secret']).toBe('cwa-shared-secret-value');
  });

  it('with a credential configured, the outbound POST does NOT carry X-Event-Auth-Token at all — the old header name is fully retired, not sent alongside the new one', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = new HttpPeerTransport!([p.url], undefined, 'cwa-shared-secret-value');
    await transport.deliver('{}', 'epoch-1:d009-no-old-header');

    const names = Object.keys(p.requests[0]!.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain('x-event-auth-token');
  });

  it('two distinct peers (mirroring a real cwa multi-peer fan-out) both receive the identical secret under X-Event-Ingest-Secret', async () => {
    const p1 = await startFakePeer(200);
    const p2 = await startFakePeer(200);
    peers = [p1, p2];
    const transport = new HttpPeerTransport!([p1.url, p2.url], undefined, 'shared-across-peers');
    await transport.deliver('{}', 'epoch-1:d009-multi');

    expect(lowerHeaders(p1.requests[0]!)['x-event-ingest-secret']).toBe('shared-across-peers');
    expect(lowerHeaders(p2.requests[0]!)['x-event-ingest-secret']).toBe('shared-across-peers');
  });
});
