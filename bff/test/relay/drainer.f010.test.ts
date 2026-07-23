// Integration test: the REAL HttpPeerTransport (not the FakeTransport double) driven by the REAL
// createDrainer against a REAL local HTTP stub peer that authenticates the credential header —
// proving REQ-F010-014/018/019's credential-caused-401-park / re-provision-and-replay / no-
// silent-drop loop end-to-end at the unit/integration level (in-process; NOT a spawned child
// process / real relay boot). The full e2e stub-peer journey — REQ-F010-024's env-pinned
// (a)/(b-wrong)/(b-missing) acceptance arms, and REQ-F010-015's two-peer partially-delivered park
// — is Phase-6 e2e-tester territory under tests/e2e/relay, per this task's explicit
// directory-ownership boundary, and is deliberately NOT duplicated here.
//
// NOTE ON PRE-IMPLEMENTATION "RED"-NESS: several assertions below (e.g. "wrong credential -> 401
// -> park") happen to ALREADY HOLD before F-010 ships, because HttpPeerTransport today sends NO
// credential header at all regardless of the (currently-ignored) third constructor argument — an
// AuthPeer that requires a matching header therefore already sees a mismatch (no header at all)
// and returns 401 either way. This is legitimate: it reuses F-004's already-proven
// classify/park/metrics machinery (REQ-F004-047/051(d)/025), and F-010 must not regress it. The
// tests that are NEW, genuinely-F-010 RED signal are the ones that require the CORRECT credential
// to actually reach the peer (REQ-F010-018's replay-then-succeeds assertion) — see TEST_PLAN.md.

import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seedRow, envJson, readRow } from './helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../src/store/db.js');

const transportMod = await import('../../src/relay/http-peer-transport.js').catch((e: unknown) => ({ __importError: e as Error }));
type HttpPeerTransportCtor = new (
  peerUrls: string[],
  peerTimeoutMs?: number,
  peerAuthToken?: string,
) => {
  deliver: (envelope: string, deliveryId: string) => Promise<void>;
  release?: (deliveryId: string) => void;
};
const HttpPeerTransport = (transportMod as { HttpPeerTransport?: HttpPeerTransportCtor }).HttpPeerTransport;

const drainerMod = await import('../../src/relay/drainer.js').catch((e: unknown) => ({ __importError: e as Error }));
type Drainer = { runOnce: () => Promise<void>; shutdown: (timeoutMs: number) => Promise<void> };
const createDrainer = (drainerMod as { createDrainer?: (deps: { transport: unknown }) => Drainer }).createDrainer;

const metricsMod = await import('../../src/relay/metrics.js').catch(() => ({}));
const m = metricsMod as { getCounters?: () => Record<string, number> };

function epoch(): string {
  return (db.prepare(`SELECT epoch FROM outbox_meta WHERE id = 1`).get() as { epoch: string }).epoch;
}
function deliveryIdOf(rowId: number): string {
  return `${epoch()}:${rowId}`;
}
void deliveryIdOf; // available for future assertions; not every test needs it

// A stub peer that authenticates the X-Event-Auth-Token header against a fixed expected value —
// 200 on match, 401 (permanent per REQ-F004-055) on mismatch/absence, mirroring cwa's documented
// REQ-F005-063 contract ("401 = permanent park by design", cited by REQ-F010-014).
interface AuthPeer {
  url: string;
  requestCount: number;
  close: () => Promise<void>;
}
function startAuthPeer(expectedToken: string): Promise<AuthPeer> {
  let count = 0;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    count += 1;
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const got = req.headers['x-event-auth-token'];
      const ok = got === expectedToken;
      res.writeHead(ok ? 200 : 401).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        get requestCount() {
          return count;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

let openPeers: AuthPeer[] = [];
afterEach(async () => {
  await Promise.all(openPeers.map((p) => p.close()));
  openPeers = [];
});

beforeEach(() => {
  migrate();
  db.exec(`DELETE FROM event_outbox`);
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

const ready = HttpPeerTransport !== undefined && createDrainer !== undefined;

describe('drainer.ts + http-peer-transport.ts — module resolution (F-010 credential-driven park integration)', () => {
  it('both modules exist and export the expected factories', () => {
    if (!HttpPeerTransport) expect.fail('bff/src/relay/http-peer-transport.ts does not export HttpPeerTransport yet.');
    if (!createDrainer) expect.fail('bff/src/relay/drainer.ts does not export createDrainer yet.');
  });
});

describe.skipIf(!ready)('REQ-F010-014 — a credential rejected by the peer (401) classifies PERMANENT and parks the row IMMEDIATELY, end-to-end through the REAL transport + REAL drainer', () => {
  it('the row parks on the FIRST attempt (no backoff retries), published_at stays NULL, and the never-delivered-park counter fires', async () => {
    const peer = await startAuthPeer('correct-secret');
    openPeers = [peer];
    const id = seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u1' }, { changes: { username: 'u1', role: 'member' } }),
      orderingKey: 'user:u1',
    });

    const transport = new HttpPeerTransport!([peer.url], undefined, 'WRONG-secret');
    const before = m.getCounters ? { ...m.getCounters() } : undefined;
    await createDrainer!({ transport }).runOnce();

    expect(peer.requestCount).toBe(1); // parked on the FIRST failure, no retries (REQ-F004-047/051(d))
    const row = readRow(db, id);
    expect(row['parked_at']).not.toBeNull();
    expect(row['published_at']).toBeNull();
    expect(row['attempt_count']).toBeLessThanOrEqual(1); // no backoff accumulation on a permanent outcome

    if (before && m.getCounters) {
      const after = m.getCounters();
      expect((after['neverDeliveredPark'] ?? 0) - (before['neverDeliveredPark'] ?? 0)).toBe(1);
    }
  });
});

describe.skipIf(!ready)('REQ-F010-018 — a wrong/stale credential is RECOVERABLE: re-provisioning the correct credential and replaying the parked row delivers it; no envelope is ever lost', () => {
  it('after a 401-induced park, clearing parked_at (operator replay) and re-driving with the CORRECT credential publishes the row', async () => {
    const peer = await startAuthPeer('correct-secret');
    openPeers = [peer];
    const envelope = envJson('admin.user.created', { id: 'u2' }, { changes: { username: 'u2', role: 'member' } });
    const id = seedRow(db, { envelope, orderingKey: 'user:u2' });

    const wrongTransport = new HttpPeerTransport!([peer.url], undefined, 'WRONG');
    await createDrainer!({ transport: wrongTransport }).runOnce();
    expect(readRow(db, id)['parked_at']).not.toBeNull();
    expect(readRow(db, id)['published_at']).toBeNull();

    // Operator response (REQ-F010-016(d)/018): re-provision the correct credential, then replay
    // the parked row for that key. This models F-004's own park/replay machinery — clearing
    // parked_at makes the row eligible again (idx_outbox_eligible's WHERE parked_at IS NULL) — no
    // F-010-specific replay API is invented here.
    db.prepare(`UPDATE event_outbox SET parked_at = NULL WHERE id = ?`).run(id);

    const correctTransport = new HttpPeerTransport!([peer.url], undefined, 'correct-secret');
    await createDrainer!({ transport: correctTransport }).runOnce();

    const row = readRow(db, id);
    expect(row['published_at']).not.toBeNull(); // delivered and published after re-provisioning
    expect(row['envelope']).toBe(envelope); // the event itself was never lost/mangled
  });
});

describe.skipIf(!ready)('REQ-F010-019 — a credential misconfiguration never silently drops an event and never corrupts bookkeeping; other ordering keys are unaffected', () => {
  it('a permanent (credential) park retains the row (queryable, not deleted) and does NOT wedge an UNRELATED ordering key in the same tick', async () => {
    const peer = await startAuthPeer('correct-secret');
    openPeers = [peer];
    const rowA = seedRow(db, { envelope: envJson('admin.user.created', { id: 'a' }), orderingKey: 'user:a' });
    const rowB = seedRow(db, { envelope: envJson('admin.user.created', { id: 'b' }), orderingKey: 'user:b' });

    const beforeCount = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox`).get() as { n: number }).n;

    const transport = new HttpPeerTransport!([peer.url], undefined, 'WRONG-secret-for-both-keys');
    await createDrainer!({ transport }).runOnce();

    expect(peer.requestCount).toBe(2); // BOTH keys were attempted — no wedge/stall across keys
    const a = readRow(db, rowA);
    const b = readRow(db, rowB);
    expect(a['parked_at']).not.toBeNull();
    expect(b['parked_at']).not.toBeNull();
    expect(a['published_at']).toBeNull();
    expect(b['published_at']).toBeNull();

    const afterCount = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox`).get() as { n: number }).n;
    expect(afterCount).toBe(beforeCount); // zero rows deleted
  });
});
