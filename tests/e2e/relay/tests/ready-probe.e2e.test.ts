// Journey 5: GET /ready degrades under backlog or lag and recovers once healthy again
// (REQ-F004-026, boundary is inclusive-`>=`-degraded / strictly-`<`-ready per rev-10).

import { afterEach, describe, expect, it } from 'vitest';
import { startStubPeer, type StubPeer } from '../fixtures/stubPeer.js';
import { OutboxTestDb, makeEnvelope } from '../fixtures/db.js';
import { spawnRelay, waitFor, type RelayHandle } from '../fixtures/relayProcess.js';
import { makeTmpDbPath } from '../fixtures/tmp.js';

let peer: StubPeer | undefined;
let relay: RelayHandle | undefined;
let cleanupDb: (() => void) | undefined;

afterEach(async () => {
  relay?.kill('SIGKILL');
  await relay?.exited;
  await peer?.close();
  cleanupDb?.();
  peer = undefined;
  relay = undefined;
  cleanupDb = undefined;
});

describe('relay: GET /ready degradation and recovery', () => {
  it('reports 503 backlog-over-threshold while backlog >= threshold, then 200 once drained', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('ready-backlog');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const BACKLOG_THRESHOLD = 5;
    const rowIds = Array.from({ length: BACKLOG_THRESHOLD * 2 }, (_, n) =>
      db.seed({ envelope: makeEnvelope('admin.user.created', { id: `u-ready-${n}` }), orderingKey: `user:u-ready-${n}` }),
    );

    peer = await startStubPeer();
    // Deliberately withhold every ack for a bounded window so the seeded backlog is GUARANTEED
    // still full (no row published) at the moment the test's first /ready check lands -- avoids a
    // race against how fast localhost delivery happens to be, without any sleep-based waiting on
    // the assertion itself (the delay lives in the peer response, not in the test's control flow).
    peer.setResponder(async () => {
      await new Promise((r) => setTimeout(r, 4_000));
      return 200;
    });

    relay = await spawnRelay({ dbPath, peerUrls: [peer.url], backlogThreshold: BACKLOG_THRESHOLD });
    await relay.waitUntilServing();

    const degraded = await relay.fetchReady();
    expect(degraded?.status).toBe(503);
    expect((degraded?.body as { reason?: string })?.reason).toBe('backlog-over-threshold');

    await waitFor(() => rowIds.every((id) => (db.row(id) as { published_at: string | null }).published_at !== null), {
      timeoutMs: 15_000,
      message: 'expected the seeded backlog to fully drain',
    });

    const healthy = await relay.waitForReadyStatus((s) => s === 200, 10_000);
    expect(healthy.body).toEqual({ ready: true });

    db.close();
  });

  it('reports 503 lag-over-threshold when the oldest unpublished row is older than the lag threshold, even with a tiny backlog', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('ready-lag');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    // A single row, timestamped far in the past, that the peer will never successfully ack (always
    // transient) -- it stays unpublished/non-parked, so its age is the relay lag from the moment the
    // process boots, deterministically (no need to wait out real time).
    const staleTs = new Date(Date.now() - 5 * 60_000).toISOString();
    db.seed({ envelope: makeEnvelope('admin.user.created', { id: 'u-stale' }), orderingKey: 'user:u-stale', ts: staleTs });

    peer = await startStubPeer();
    peer.setStatus(503); // always transient -- the row never leaves the backlog during the test

    relay = await spawnRelay({
      dbPath,
      peerUrls: [peer.url],
      backlogThreshold: 1000, // high, so only lag can trip degradation
      lagThresholdMs: 2_000, // far below the 5-minute-old seeded row's age
    });
    await relay.waitUntilServing();

    const degraded = await relay.waitForReadyStatus((s) => s === 503, 5_000);
    expect((degraded.body as { reason?: string }).reason).toBe('lag-over-threshold');

    db.close();
  });
});
