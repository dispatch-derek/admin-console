// White-box unit tests for the F-010 shared-secret credential across all three touched modules
// (bff/src/relay/config.ts, bff/src/relay/http-peer-transport.ts, bff/src/relay/transport.ts).
// Supplements — and does NOT modify — the qa-engineer's bff/test/relay/*.f010.test.ts suites and
// the pre-existing bff/test/relay/*.unit.test.ts files. v8 branch coverage on the three F-010
// source files is already 100% via the combined existing suites; the gaps this file targets are
// CROSS-BRANCH combinations the existing suites don't exercise together, found by reading the
// implementation directly:
//
// config.ts:
//   - The header-illegal-byte check (line ~50) is NOT gated on `peerUrls.length` at all — unlike
//     the empty-credential check (line ~63), which IS gated on `peerUrls.length > 0`. The spec-level
//     suite (relay-config.f010.test.ts) only ever exercises the illegal-byte check with a peer
//     configured. This file adds the "no peer configured" cross with an illegal-byte credential,
//     in BOTH environments, to pin down that the illegal-byte refusal is peer-independent too (not
//     just environment-independent) -- in development, where the peerUrls.length===0 hard-refuse
//     branch never fires, the illegal-byte check is the ONLY thing that can reject the boot, which
//     positively proves it runs unconditionally.
//   - Documents the check ORDER in production+no-peer+illegal-byte-credential: the pre-existing
//     REQ-F004-045 empty-peer-list refusal fires BEFORE the illegal-byte check is ever reached (it
//     is textually earlier in the module), so the boot still refuses, but for the peer-list reason.
//
// http-peer-transport.ts:
//   - Interaction between the STATEFUL ack-map/pending-filter branch and the credential-attachment
//     branch, which no existing file exercises TOGETHER: a partial-ack re-drive re-POSTs only the
//     still-pending peer, and that re-POST must still carry the configured credential header.
//
// transport.ts:
//   - An explicit empty-string peerAuthToken threaded through createTransport (as opposed to simply
//     omitting the option) reaches HttpPeerTransport and is treated as absent end-to-end.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// config.ts — env-snapshot harness (mirrors relay-config.unit.test.ts / .f010.test.ts convention)
// ---------------------------------------------------------------------------

const RELAY_ONLY_KEYS = [
  'EVENT_BUS_URL',
  'EVENT_BUS_TRANSPORT',
  'EVENT_BUS_PEER_AUTH_TOKEN',
  'EVENT_BUS_BACKLOG_THRESHOLD',
  'EVENT_BUS_LAG_THRESHOLD_MS',
  'DB_PATH',
  'NODE_ENV',
] as const;

let snapshot: Record<string, string | undefined>;

function snapshotEnv(): void {
  snapshot = {};
  for (const key of RELAY_ONLY_KEYS) snapshot[key] = process.env[key];
}

afterEach(() => {
  if (snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  vi.resetModules();
});

async function loadRelayConfig() {
  vi.resetModules();
  return import('../../src/relay/config.js');
}

describe('relay/config.ts — header-illegal-byte refusal is PEER-INDEPENDENT (not gated on peerUrls.length, unlike the empty-credential check)', () => {
  it('development + NO peer configured + a CR-bearing credential still refuses to boot (the peerUrls.length===0 hard-refuse never fires in dev, so this positively isolates the illegal-byte check as the sole cause)', async () => {
    snapshotEnv();
    process.env['NODE_ENV'] = 'development';
    delete process.env['EVENT_BUS_URL'];
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\rmore';
    await expect(loadRelayConfig()).rejects.toThrow(/illegal|invalid|control character|header/i);
  });

  it('development + NO peer configured + a VT (0x0B)-bearing credential still refuses to boot (VT chosen as a non-CR/LF illegal byte, per REQ-F010-017\'s "non-exhaustive illustrations")', async () => {
    snapshotEnv();
    process.env['NODE_ENV'] = 'development';
    delete process.env['EVENT_BUS_URL'];
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tokmore';
    await expect(loadRelayConfig()).rejects.toThrow();
  });

  it('development + NO peer configured + a LEGAL credential value boots normally (contrast case: proves the failures above are about the illegal byte, not merely "no peer configured")', async () => {
    snapshotEnv();
    process.env['NODE_ENV'] = 'development';
    delete process.env['EVENT_BUS_URL'];
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok-fine';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it('production + NO peer configured + a CR-bearing credential still refuses to boot — but for the PRE-EXISTING REQ-F004-045 empty-peer-list reason (that check runs first in module load order), not the credential (documents check ORDER, not a new requirement)', async () => {
    snapshotEnv();
    process.env['NODE_ENV'] = 'production';
    delete process.env['EVENT_BUS_URL'];
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\rmore';
    // Either reason satisfies "refuses to boot"; assert the OBSERVED reason to pin current order.
    await expect(loadRelayConfig()).rejects.toThrow(/EVENT_BUS_URL/);
  });
});

describe('relay/config.ts — empty-credential fail-fast IS gated on peerUrls.length (contrast with the illegal-byte check above)', () => {
  it('production + NO peer configured + credential ABSENT boots (the credential-required fail-fast never applies with zero peers — REQ-F004-045\'s own empty-peer-list refusal already covers the no-peer-in-production case, and that requires EVENT_BUS_URL, not the credential)', async () => {
    // Not reachable in production with a genuinely empty peer list (line ~30 always throws first
    // in that case) — this test targets development, where no peer-list refusal applies, to isolate
    // the credential-fail-fast's own peer-gating in an environment where it's actually observable.
    snapshotEnv();
    process.env['NODE_ENV'] = 'development';
    delete process.env['EVENT_BUS_URL'];
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// http-peer-transport.ts — partial-ack re-drive + credential interaction
// ---------------------------------------------------------------------------

interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface FakePeer {
  url: string;
  requests: CapturedRequest[];
  respondWith: (status: number) => void;
  close: () => Promise<void>;
}

function startFakePeer(initialStatus = 200): Promise<FakePeer> {
  let status = initialStatus;
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.on('data', () => undefined);
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

const { HttpPeerTransport } = await import('../../src/relay/http-peer-transport.js');

describe('HttpPeerTransport — a partial-ack re-drive still attaches the credential to the re-POST of the still-pending peer only', () => {
  it('peer A acks (200) on the first attempt, peer B permanently rejects (403); re-driving the SAME deliveryId without release() re-POSTs ONLY peer B, and that re-POST still carries X-Event-Auth-Token', async () => {
    const acker = await startFakePeer(200);
    const rejecter = await startFakePeer(403);
    peers = [acker, rejecter];
    const transport = new HttpPeerTransport([acker.url, rejecter.url], undefined, 'partial-ack-secret');

    await expect(transport.deliver('{}', 'epoch-1:partial-ack')).rejects.toMatchObject({
      classification: 'permanent',
      partialAck: true,
    });
    expect(acker.requests).toHaveLength(1);
    expect(rejecter.requests).toHaveLength(1);

    // Re-drive: acker must NOT be re-invoked (already in the ack map); rejecter (still pending) is.
    rejecter.respondWith(200); // simulate the peer now accepting on retry
    await expect(transport.deliver('{}', 'epoch-1:partial-ack')).resolves.toBeUndefined();

    expect(acker.requests).toHaveLength(1); // unchanged — was never re-POSTed
    expect(rejecter.requests).toHaveLength(2); // re-POSTed exactly once more

    // The credential header rides EVERY outbound POST for the still-pending peer, including re-drives.
    expect(lowerHeaders(rejecter.requests[1]!)['x-event-auth-token']).toBe('partial-ack-secret');
  });
});

// ---------------------------------------------------------------------------
// transport.ts — explicit empty-string peerAuthToken threaded through createTransport
// ---------------------------------------------------------------------------

const { createTransport } = await import('../../src/relay/transport.js');

describe('createTransport — an explicit empty-string peerAuthToken (as opposed to an omitted option) still results in NO credential header end-to-end', () => {
  it('peerAuthToken: "" threaded through createTransport reaches HttpPeerTransport and is treated as absent, same as omitting the option entirely', async () => {
    const p = await startFakePeer(200);
    peers = [p];
    const transport = createTransport({ kind: 'http', peerUrls: [p.url], peerAuthToken: '' });
    await transport.deliver('{}', 'epoch-1:threaded-empty-string');
    const names = Object.keys(p.requests[0]!.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain('x-event-auth-token');
  });
});
