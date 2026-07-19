// perf/f004-relay/bench.ts — F-004 outbox relay perf harness.
//
// MEASUREMENT ARTIFACT, NOT PRODUCTION CODE. Exercises the REAL relay code
// (bff/src/relay/drainer.ts, bff/src/relay/http-peer-transport.ts,
// bff/src/store/repositories/outbox.repo.ts) against a real temp SQLite file and a real local
// HTTP stub peer (node:http), per the F-004 spec's REQ-F004-027/034 targets:
//   - throughput >= 50 events/sec (backlog trending to zero, not growing)
//   - p95 end-to-end (outbox-commit -> transport-ack) delivery latency < 5s
//   - clears a backfill backlog of >= 10,000 rows without stalling
//   - per-key ordering does not collapse cross-key throughput to a single serial stream
//   - selectEligible / idx_outbox_eligible scales (checked via EXPLAIN QUERY PLAN)
//
// Run: DB_PATH=<tmp> tsx perf/f004-relay/bench.ts   (see run.sh, which sets up the tmp dir)

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

// ── temp DB, wired the same way bff/test/setup.ts wires it for the relay test suite ──────────
const workDir = mkdtempSync(join(tmpdir(), 'f004-perf-'));
process.env['DB_PATH'] = join(workDir, 'console.db');

const { db } = await import('../../bff/src/store/db.js');
const { outboxRepo } = await import('../../bff/src/store/repositories/outbox.repo.js');
const { createDrainer } = await import('../../bff/src/relay/drainer.js');
const { HttpPeerTransport } = await import('../../bff/src/relay/http-peer-transport.js');

// ── envelope + stub peer helpers (mirrors bff/test/relay/helpers.ts's envJson) ───────────────
function envJson(event: string, target: Record<string, unknown>): string {
  return JSON.stringify({
    event,
    actor: 'staff-1',
    target,
    changes: undefined,
    verified: true,
    timestamp: '2026-07-19T00:00:00.000Z',
    payload: undefined,
  });
}

function startStubPeer(opts: { delayMs?: number; status?: number } = {}): Promise<{ url: string; close: () => Promise<void>; requestCount: () => number }> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    const respond = (): void => {
      // Drain the request body (fetch keeps the socket open until it's consumed in some cases).
      res.statusCode = opts.status ?? 200;
      res.end('{}');
    };
    req.on('data', () => {});
    req.on('end', () => {
      if (opts.delayMs) setTimeout(respond, opts.delayMs);
      else respond();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
        requestCount: () => count,
      });
    });
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function stats(samples: number[]): { median: number; p95: number; p99: number; min: number; max: number; n: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? NaN,
    max: sorted[sorted.length - 1] ?? NaN,
    n: samples.length,
  };
}

function clearOutbox(): void {
  db.exec(`DELETE FROM event_outbox`);
}

function unpublishedCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL`).get() as { n: number }).n;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : String(n);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SECTION A — drain/delivery throughput (fast-acking stub peer, DRAIN_BATCH=500, real drainer)
// ══════════════════════════════════════════════════════════════════════════════════════════════
async function sectionThroughput(): Promise<void> {
  console.log('\n=== SECTION A: drain/delivery throughput (target >= 50 events/sec) ===');
  const peer = await startStubPeer();
  const transport = new HttpPeerTransport([peer.url]);
  const drainer = createDrainer({ transport });

  const RUNS = 3;
  const ROWS = 5000;
  const KEYS = 200;
  const throughputs: number[] = [];

  for (let run = 0; run < RUNS; run++) {
    clearOutbox();
    for (let i = 0; i < ROWS; i++) {
      const key = `user:u${i % KEYS}`;
      outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i % KEYS}` }), key);
    }
    const start = performance.now();
    let ticks = 0;
    while (unpublishedCount() > 0 && ticks < ROWS + KEYS + 10) {
      await drainer.runOnce();
      ticks++;
    }
    const elapsedMs = performance.now() - start;
    const remaining = unpublishedCount();
    const throughput = ROWS / (elapsedMs / 1000);
    throughputs.push(throughput);
    console.log(
      `  run ${run + 1}/${RUNS}: ${ROWS} rows / ${KEYS} keys drained in ${fmt(elapsedMs)} ms over ${ticks} ticks ` +
        `-> ${fmt(throughput)} events/sec (remaining=${remaining}, peer requests=${peer.requestCount()})`,
    );
  }

  const s = stats(throughputs);
  console.log(
    `  THROUGHPUT median=${fmt(s.median)} ev/s, p95(min of samples)=${fmt(s.min)} ev/s, max=${fmt(s.max)} ev/s (n=${s.n})`,
  );
  console.log(`  SPEC FLOOR: >= 50 events/sec  =>  ${s.min >= 50 ? 'PASS' : 'FAIL'} (worst observed run)`);
  await peer.close();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SECTION B — end-to-end delivery latency distribution (insert -> published_at)
// ══════════════════════════════════════════════════════════════════════════════════════════════
async function sectionLatency(): Promise<void> {
  console.log('\n=== SECTION B: end-to-end delivery latency (target p95 < 5000 ms) ===');
  const peer = await startStubPeer();
  const transport = new HttpPeerTransport([peer.url]);
  const drainer = createDrainer({ transport });

  clearOutbox();
  const ROWS = 2000;
  const KEYS = 100;
  const insertedAtMs = new Map<number, number>();

  for (let i = 0; i < ROWS; i++) {
    const key = `user:u${i % KEYS}`;
    const id = outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i % KEYS}` }), key);
    insertedAtMs.set(id, Date.now());
  }

  // Tight poll loop (no artificial sleep) — isolates drain+deliver latency from the poll-interval
  // component. Production's relay/index.ts polls every POLL_INTERVAL_MS=1000ms; that adds up to
  // ~1s of additional queueing latency on top of what's measured here (noted in the report).
  let ticks = 0;
  while (unpublishedCount() > 0 && ticks < ROWS + KEYS + 10) {
    await drainer.runOnce();
    ticks++;
  }

  const rows = db.prepare(`SELECT id, published_at FROM event_outbox`).all() as Array<{ id: number; published_at: string | null }>;
  const latencies: number[] = [];
  for (const r of rows) {
    if (!r.published_at) continue;
    const insertedMs = insertedAtMs.get(r.id);
    if (insertedMs === undefined) continue;
    latencies.push(new Date(r.published_at).getTime() - insertedMs);
  }

  const s = stats(latencies);
  console.log(
    `  ${ROWS} rows / ${KEYS} keys, tight poll loop, ${ticks} ticks. Latency (ms) — ` +
      `median=${fmt(s.median)} p95=${fmt(s.p95)} p99=${fmt(s.p99)} min=${fmt(s.min)} max=${fmt(s.max)} (n=${s.n})`,
  );
  console.log(`  SPEC TARGET: p95 < 5000 ms  =>  ${s.p95 < 5000 ? 'PASS' : 'FAIL'}`);

  // Also report with the PRODUCTION poll cadence (1000ms) folded in, since relay/index.ts's actual
  // loop sleeps POLL_INTERVAL_MS between ticks (implementation-defined cadence, REQ-F004-010).
  clearOutbox();
  insertedAtMs.clear();
  const ROWS2 = 200; // smaller N: this variant is wall-clock-expensive (real 1s sleeps)
  for (let i = 0; i < ROWS2; i++) {
    const key = `user:u${i % KEYS}`;
    const id = outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i % KEYS}` }), key);
    insertedAtMs.set(id, Date.now());
  }
  let ticks2 = 0;
  while (unpublishedCount() > 0 && ticks2 < 5) {
    await drainer.runOnce();
    ticks2++;
    if (unpublishedCount() > 0) await new Promise((r) => setTimeout(r, 1000));
  }
  const rows2 = db.prepare(`SELECT id, published_at FROM event_outbox`).all() as Array<{ id: number; published_at: string | null }>;
  const latencies2: number[] = [];
  for (const r of rows2) {
    if (!r.published_at) continue;
    const insertedMs = insertedAtMs.get(r.id);
    if (insertedMs === undefined) continue;
    latencies2.push(new Date(r.published_at).getTime() - insertedMs);
  }
  const s2 = stats(latencies2);
  console.log(
    `  [with production 1000ms poll cadence] ${ROWS2} rows: median=${fmt(s2.median)} p95=${fmt(s2.p95)} ` +
      `max=${fmt(s2.max)} ms (n=${s2.n}) — dominated by poll-interval queueing, not drain/deliver cost`,
  );

  await peer.close();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SECTION C — backfill bound: >= 10,000-row backlog, wall clock + RSS
// ══════════════════════════════════════════════════════════════════════════════════════════════
async function sectionBackfill(): Promise<void> {
  console.log('\n=== SECTION C: backfill bound (target >= 10,000 rows, no pathological stall, bounded RSS) ===');
  const peer = await startStubPeer();
  const transport = new HttpPeerTransport([peer.url]);
  const drainer = createDrainer({ transport });

  clearOutbox();
  const ROWS = 12_000;
  const KEYS = 300;
  console.log(`  seeding ${ROWS} rows across ${KEYS} ordering keys...`);
  const insertMany = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) {
      const key = `user:u${i % KEYS}`;
      outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i % KEYS}` }), key);
    }
  });
  insertMany(ROWS);

  if (global.gc) global.gc();
  const baselineRss = process.memoryUsage().rss;
  const rssSamples: number[] = [baselineRss];

  const start = performance.now();
  let ticks = 0;
  const maxTicks = ROWS + KEYS + 10;
  while (unpublishedCount() > 0 && ticks < maxTicks) {
    await drainer.runOnce();
    ticks++;
    if (ticks % 25 === 0) rssSamples.push(process.memoryUsage().rss);
  }
  const elapsedMs = performance.now() - start;
  const remaining = unpublishedCount();
  if (global.gc) global.gc();
  const finalRss = process.memoryUsage().rss;

  const peakRss = Math.max(...rssSamples);
  const throughput = ROWS / (elapsedMs / 1000);

  console.log(`  drained ${ROWS - remaining}/${ROWS} rows in ${fmt(elapsedMs)} ms over ${ticks} ticks -> ${fmt(throughput)} events/sec`);
  console.log(`  remaining unpublished: ${remaining} (expect 0)`);
  console.log(
    `  RSS (MB): baseline=${fmt(baselineRss / 1e6)} peak-during-drain=${fmt(peakRss / 1e6)} ` +
      `final=${fmt(finalRss / 1e6)} delta(peak-baseline)=${fmt((peakRss - baselineRss) / 1e6)}`,
  );
  console.log(`  RSS growth vs. total rows processed (bytes/row): ${fmt((peakRss - baselineRss) / ROWS)}`);
  console.log(`  SPEC TARGET: clears >= 10,000-row backlog without stalling  =>  ${remaining === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`  peer requests observed: ${peer.requestCount()} (expect ~${ROWS} for a single fast-acking peer, 1 POST/row)`);

  await peer.close();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SECTION D — cross-key parallelism: does throughput collapse to serial with many distinct keys?
// ══════════════════════════════════════════════════════════════════════════════════════════════
async function sectionParallelism(): Promise<void> {
  console.log('\n=== SECTION D: per-key ordering vs. cross-key parallelism ===');
  const DELAY_MS = 300;
  const peer = await startStubPeer({ delayMs: DELAY_MS });
  const transport = new HttpPeerTransport([peer.url]);
  const drainer = createDrainer({ transport });

  clearOutbox();
  const KEYS = 60; // 1 row per key -> all mutually independent, all eligible in the same tick
  for (let i = 0; i < KEYS; i++) {
    outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i}` }), `user:u${i}`);
  }

  const start = performance.now();
  await drainer.runOnce(); // one tick must dispatch all KEYS rows concurrently to finish near DELAY_MS
  const elapsedMs = performance.now() - start;
  const remaining = unpublishedCount();

  const serialEstimateMs = KEYS * DELAY_MS;
  console.log(
    `  ${KEYS} distinct keys, 1 row each, stub peer delay=${DELAY_MS}ms/request. Single runOnce() tick took ${fmt(elapsedMs)} ms.`,
  );
  console.log(`  Fully-serial estimate would be ~${serialEstimateMs} ms; fully-parallel estimate would be ~${DELAY_MS}-${DELAY_MS + 150} ms.`);
  console.log(`  remaining unpublished after 1 tick: ${remaining} (expect 0 if all dispatched concurrently)`);
  console.log(
    `  VERDICT: ${elapsedMs < serialEstimateMs / 3 ? 'PARALLEL (cross-key fan-out confirmed)' : 'SUSPICIOUSLY SERIAL — investigate'}`,
  );

  await peer.close();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SECTION E — selectEligible / idx_outbox_eligible query-plan scaling check
// ══════════════════════════════════════════════════════════════════════════════════════════════
async function sectionQueryPlan(): Promise<void> {
  console.log('\n=== SECTION E: selectEligible query plan + cost at scale ===');
  clearOutbox();

  // Simulate a mature deployment: a large body of already-published (retained, pre-prune) rows
  // PLUS a large unpublished backlog, spread across many ordering keys, so the correlated
  // head-of-line subquery in outbox.repo.ts's selectEligibleStmt has real work to do.
  const PUBLISHED_ROWS = 60_000;
  const UNPUBLISHED_ROWS = 10_000;
  const KEYS = 500;
  console.log(`  seeding ${PUBLISHED_ROWS} published + ${UNPUBLISHED_ROWS} unpublished rows across ${KEYS} keys...`);

  const insertPublished = db.transaction((n: number) => {
    const stmt = db.prepare(
      `INSERT INTO event_outbox (ts, envelope, published_at, ordering_key) VALUES (?, ?, ?, ?)`,
    );
    for (let i = 0; i < n; i++) {
      const key = `user:pub${i % KEYS}`;
      stmt.run(new Date().toISOString(), envJson('admin.user.updated', { id: `pub${i % KEYS}` }), new Date().toISOString(), key);
    }
  });
  insertPublished(PUBLISHED_ROWS);

  const insertUnpublished = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) {
      const key = `user:u${i % KEYS}`;
      outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i % KEYS}` }), key);
    }
  });
  insertUnpublished(UNPUBLISHED_ROWS);

  const now = new Date().toISOString();

  // The exact SQL from outbox.repo.ts's selectEligibleStmt (copied verbatim for EXPLAIN QUERY PLAN;
  // better-sqlite3 does not expose .explain() on a prepared statement's plan directly, so we
  // reissue the identical text with EXPLAIN QUERY PLAN prefixed).
  const planRows = db
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT * FROM event_outbox o
       WHERE o.published_at IS NULL
         AND o.parked_at IS NULL
         AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= @now)
         AND (
           o.ordering_key = '__unkeyed__' OR o.ordering_key IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM event_outbox e
             WHERE e.ordering_key = o.ordering_key
               AND e.published_at IS NULL
               AND e.id < o.id
           )
         )
       ORDER BY o.id ASC
       LIMIT @batch`,
    )
    .all({ now, batch: 500 }) as Array<{ id: number; parent: number; notused: number; detail: string }>;

  console.log('  EXPLAIN QUERY PLAN for selectEligible (verbatim SQL from outbox.repo.ts):');
  for (const r of planRows) console.log(`    ${r.detail}`);

  const usesScan = planRows.some((r) => /SCAN event_outbox\b/i.test(r.detail) && !/idx_outbox_eligible/i.test(r.detail));
  const usesTempBTree = planRows.some((r) => /USE TEMP B-TREE/i.test(r.detail));
  console.log(`  Contains a table SCAN not covered by idx_outbox_eligible: ${usesScan ? 'YES (hotspot candidate)' : 'no'}`);
  console.log(`  Requires a temp B-tree (extra sort, e.g. for ORDER BY): ${usesTempBTree ? 'yes' : 'no'}`);

  // Timing: call the real repo method (not a reimplementation) N times and take percentiles.
  const N = 30;
  const timesMs: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    outboxRepo.selectEligible(now, 500);
    timesMs.push(performance.now() - t0);
  }
  const s = stats(timesMs);
  console.log(
    `  outboxRepo.selectEligible(now, 500) latency (ms) over ${N} calls at ${PUBLISHED_ROWS + UNPUBLISHED_ROWS} total rows / ` +
      `${UNPUBLISHED_ROWS} unpublished across ${KEYS} keys: median=${fmt(s.median)} p95=${fmt(s.p95)} max=${fmt(s.max)}`,
  );

  // Compare against a SMALL table (10 unpublished rows only, same shape) to see how cost scales
  // with table size vs. backlog size.
  clearOutbox();
  const insertSmall = db.transaction(() => {
    for (let i = 0; i < 10; i++) {
      outboxRepo.insert(new Date().toISOString(), envJson('admin.user.updated', { id: `u${i}` }), `user:u${i}`);
    }
  });
  insertSmall();
  const timesSmallMs: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    outboxRepo.selectEligible(new Date().toISOString(), 500);
    timesSmallMs.push(performance.now() - t0);
  }
  const sSmall = stats(timesSmallMs);
  console.log(
    `  outboxRepo.selectEligible(now, 500) latency (ms) at 10 total rows / 10 unpublished: ` +
      `median=${fmt(sSmall.median)} p95=${fmt(sSmall.p95)} max=${fmt(sSmall.max)}`,
  );
  console.log(
    `  Scale factor (large-table median / small-table median): ${fmt(s.median / Math.max(sSmall.median, 0.001))}x ` +
      `for a ${(PUBLISHED_ROWS + UNPUBLISHED_ROWS) / 10}x larger table`,
  );
}

async function main(): Promise<void> {
  console.log('F-004 outbox relay perf harness');
  console.log(`node ${process.version}, DB_PATH=${process.env['DB_PATH']}`);
  console.log(`cwd=${process.cwd()}`);

  try {
    await sectionThroughput();
    await sectionLatency();
    await sectionBackfill();
    await sectionParallelism();
    await sectionQueryPlan();
  } finally {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
