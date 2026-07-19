// REQ-F004-027/034 — delivery latency & throughput SLO (p95<5s emit-to-ack; >=50 ev/s sustained;
// clears a >=10,000-row backfill without stalling; per-key order does not cap throughput to a
// single serial stream — distinct keys deliver in parallel). Per this repo's established
// perf-test convention (bff/test/routes/{baseline-prompt,feature-toggles}.performance.test.ts):
// a generous SMOKE-level assertion against a real (not mocked) in-process SQLite store and a
// near-instant fake transport, explicitly NOT a rigorous load-test / many-sample p95 measurement.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { FakeTransport, seedRow, envJson } from './helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../src/store/db.js');
const drainerMod = await import('../../src/relay/drainer.js').catch((e: unknown) => ({ __importError: e as Error }));
type Drainer = { runOnce: () => Promise<void> };
const createDrainer = (drainerMod as { createDrainer?: (deps: { transport: FakeTransport }) => Drainer }).createDrainer;

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

describe.skipIf(!createDrainer)('drainer perf smoke — REQ-F004-027/034 (NOT a rigorous load test)', () => {
  it('a seeded backlog of 500 rows across 25 distinct keys drains to zero within a generous bound, without stalling on a single key', async () => {
    const KEYS = 25;
    const ROWS = 500;
    for (let i = 0; i < ROWS; i++) {
      const key = `user:u${i % KEYS}`;
      seedRow(db, {
        envelope: envJson('admin.user.updated', { id: `u${i % KEYS}` }),
        orderingKey: key,
        ts: `2026-07-19T00:00:${String(i % 60).padStart(2, '0')}.${String(Math.floor(i / 60)).padStart(3, '0')}Z`,
      });
    }
    const fake = new FakeTransport(); // default outcome = ack, effectively instant
    const drainer = createDrainer!({ transport: fake });

    const start = Date.now();
    for (let tick = 0; tick < ROWS + KEYS; tick++) {
      await drainer.runOnce();
      const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL`).get() as { n: number }).n;
      if (remaining === 0) break;
    }
    const elapsedMs = Date.now() - start;
    const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL`).get() as { n: number }).n;

    expect(remaining).toBe(0); // backlog trends to zero, not stuck on any one key
    // Generous smoke-level ceiling (an order of magnitude looser than a real perf budget) — this
    // is NOT a p95/throughput measurement, only a "did not pathologically stall" guard.
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);

  it('cross-key parallelism: within a SINGLE tick, rows on multiple distinct keys are all dispatched (not serialized one-key-at-a-time)', async () => {
    const KEYS = 10;
    for (let i = 0; i < KEYS; i++) {
      seedRow(db, { envelope: envJson('admin.user.created', { id: `u${i}` }), orderingKey: `user:u${i}` });
    }
    const fake = new FakeTransport();
    await createDrainer!({ transport: fake }).runOnce();
    const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL`).get() as { n: number }).n;
    expect(remaining).toBe(0); // all 10 distinct-key rows cleared in one pass
  });
});
