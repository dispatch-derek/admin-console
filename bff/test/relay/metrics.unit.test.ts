// White-box unit tests for bff/src/relay/metrics.ts — supplements bff/test/relay/metrics.test.ts
// (qa-engineer's spec-level suite, NOT modified here). Targets the one gauge branch v8 coverage
// showed unexercised: `return age > 0 ? age : 0;` (metrics.ts:20) — the spec suite only ever
// seeds rows with a `ts` strictly in the PAST relative to `now`, so the non-positive-age (`ts` at
// or after `now`) clamp is never hit. Also covers getBacklogCount's `next_attempt_at`-independence
// (a row mid-backoff is still "backlog", read directly from the SQL predicate which — unlike
// selectEligible — does not filter on next_attempt_at at all).

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { seedRow, envJson } from './helpers.js';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../src/store/db.js');
const { getRelayLagMs, getBacklogCount } = await import('../../src/relay/metrics.js');

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

describe('getRelayLagMs — non-positive-age clamp (metrics.ts:20)', () => {
  it('a row whose ts is EXACTLY `now` reports 0 lag (age === 0, not negative)', () => {
    const ts = '2026-07-19T00:00:00.000Z';
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts });
    expect(getRelayLagMs(new Date(ts))).toBe(0);
  });

  it('a row whose ts is in the FUTURE relative to `now` (clock skew) clamps to 0, never negative', () => {
    const future = '2026-07-19T01:00:00.000Z';
    const now = new Date('2026-07-19T00:00:00.000Z');
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: future });
    const lag = getRelayLagMs(now);
    expect(lag).toBe(0);
    expect(lag).toBeGreaterThanOrEqual(0);
  });

  it('defaults `now` to the real clock when omitted (no argument)', () => {
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: new Date().toISOString() });
    expect(getRelayLagMs()).toBeGreaterThanOrEqual(0);
  });
});

describe('getBacklogCount — independent of next_attempt_at (mid-backoff rows still count as backlog)', () => {
  it('a row mid-backoff (next_attempt_at in the future, so NOT selectEligible) is still counted in the backlog', () => {
    seedRow(db, {
      envelope: envJson('admin.user.created', { id: 'u1' }),
      orderingKey: 'user:u1',
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
    });
    expect(getBacklogCount()).toBe(1);
  });

  it('a row blocked by per-key head-of-line (not selectEligible) is still counted in the backlog', () => {
    // Backlog is a coarser signal than eligibility: both the head-of-line-blocked row and the
    // row blocking it are unpublished/non-parked, so both count.
    seedRow(db, { envelope: envJson('admin.user.created', { id: 'u1' }), orderingKey: 'user:u1', ts: '2026-07-19T00:00:00.000Z' });
    seedRow(db, { envelope: envJson('admin.user.updated', { id: 'u1' }), orderingKey: 'user:u1', ts: '2026-07-19T00:00:01.000Z' });
    expect(getBacklogCount()).toBe(2);
  });
});
