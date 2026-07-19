// perf/f004-relay/bench-scale.ts — follow-up to bench.ts Section E: quantify how
// outboxRepo.selectEligible() cost scales with TOTAL table size (not just backlog size), at
// scale points representative of accumulated published rows between the relay's default hourly
// prune cadence (EVENT_BUS_PRUNE_EVERY_CYCLES=3600 ticks @ 1s poll = ~hourly, EVENT_BUS_RETENTION_MS
// default 7 days). MEASUREMENT ARTIFACT ONLY.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'f004-perf-scale-'));
process.env['DB_PATH'] = join(workDir, 'console.db');

const { db } = await import('../../bff/src/store/db.js');
const { outboxRepo } = await import('../../bff/src/store/repositories/outbox.repo.js');

function envJson(event: string, target: Record<string, unknown>): string {
  return JSON.stringify({ event, actor: 'staff-1', target, verified: true, timestamp: '2026-07-19T00:00:00.000Z' });
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : String(n);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

const KEYS = 500;
const UNPUBLISHED = 5000;

async function measureAt(publishedCount: number): Promise<void> {
  db.exec(`DELETE FROM event_outbox`);

  const insertPublished = db.transaction((n: number) => {
    const stmt = db.prepare(`INSERT INTO event_outbox (ts, envelope, published_at, ordering_key) VALUES (?, ?, ?, ?)`);
    for (let i = 0; i < n; i++) {
      const key = `user:pub${i % KEYS}`;
      stmt.run(new Date().toISOString(), envJson('admin.user.updated', { id: `pub${i % KEYS}` }), new Date().toISOString(), key);
    }
  });
  insertPublished(publishedCount);

  const insertUnpublished = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) {
      outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i % KEYS}` }), `user:u${i % KEYS}`);
    }
  });
  insertUnpublished(UNPUBLISHED);

  const now = new Date().toISOString();
  const N = 10;
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    outboxRepo.selectEligible(now, 500);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const total = publishedCount + UNPUBLISHED;
  console.log(
    `  total=${String(total).padStart(7)} rows (published=${publishedCount}, unpublished=${UNPUBLISHED}, keys=${KEYS}) ` +
      `-> selectEligible median=${fmt(times[Math.floor(N / 2)]!)}ms p95=${fmt(percentile(times, 95))}ms max=${fmt(times[N - 1]!)}ms ` +
      `=> max tick rate ~${fmt(1000 / times[Math.floor(N / 2)]!)} ticks/sec from this query alone`,
  );
}

async function main(): Promise<void> {
  console.log('=== F-004 selectEligible cost vs TOTAL table size (simulating accumulated published rows before hourly prune) ===');
  console.log(`config: UNPUBLISHED backlog held constant at ${UNPUBLISHED} across ${KEYS} keys; PUBLISHED (already-delivered, retained) count varies.`);
  try {
    for (const publishedCount of [0, 10_000, 50_000, 100_000, 200_000]) {
      await measureAt(publishedCount);
    }
  } finally {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
