// Phase 7 review-gate remediation journey 1: retention pruning is actually WIRED into the running
// relay loop (REQ-F004-019/035), not just implemented as a dormant `outboxRepo.pruneShipped`
// method. bff/src/relay/index.ts's main loop now calls it every `EVENT_BUS_PRUNE_EVERY_CYCLES`
// poll ticks using a cutoff of `now - EVENT_BUS_RETENTION_MS`. Both are env-overridable, so this
// test drives them small/fast (retention a few seconds, prune every cycle) rather than waiting out
// the 7-day/hourly production defaults.

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

describe('relay: retention pruning is wired into the running drain loop', () => {
  it('deletes published rows older than the retention window, and never touches fresh/unpublished/parked rows', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('retention-pruning');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const RETENTION_MS = 5_000; // generous margin over typical relay boot + first-tick latency

    // A published row well outside the retention window -- must be pruned.
    const oldPublishedId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-old' }),
      orderingKey: 'user:u-old',
      ts: new Date(Date.now() - 60_000).toISOString(),
      publishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    // A published row from "just now" -- inside the retention window, must survive.
    const freshPublishedId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-fresh' }),
      orderingKey: 'user:u-fresh',
      ts: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    });
    // An UNpublished row, deliberately timestamped even older than the pruned row -- pruning must
    // NEVER delete undelivered rows regardless of age (REQ-F004-019/035). Pinned with a far-future
    // next_attempt_at so the (unrelated, always-acking) stub peer never actually delivers it during
    // the test -- this journey is specifically about the PRUNE path skipping it, not about delivery.
    const unpublishedId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-unpublished' }),
      orderingKey: 'user:u-unpublished',
      ts: new Date(Date.now() - 120_000).toISOString(),
      nextAttemptAt: new Date(Date.now() + 3_600_000).toISOString(),
      // published_at left null
    });
    // A PARKED row, also old -- parked rows must never be pruned either.
    const parkedId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-parked' }),
      orderingKey: 'user:u-parked',
      ts: new Date(Date.now() - 120_000).toISOString(),
      parkedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    peer = await startStubPeer();
    peer.setStatus(200);

    relay = await spawnRelay({
      dbPath,
      peerUrls: [peer.url],
      retentionMs: RETENTION_MS,
      pruneEveryCycles: 1, // prune on every tick, starting with the very first one
    });
    await relay.waitUntilServing();

    // The old published row is deleted by a prune cycle.
    await waitFor(() => !db.rowExists(oldPublishedId), {
      timeoutMs: 15_000,
      message: 'expected the old published row to be pruned',
    });

    // Give a few more prune cycles to run, to prove the OTHER rows are not eventually swept too.
    await new Promise((r) => setTimeout(r, 2_500));

    expect(db.rowExists(freshPublishedId)).toBe(true);
    expect(db.rowExists(unpublishedId)).toBe(true);
    expect(db.rowExists(parkedId)).toBe(true);
    expect((db.row(unpublishedId) as { published_at: string | null }).published_at).toBeNull();
    expect((db.row(parkedId) as { parked_at: string | null }).parked_at).not.toBeNull();

    db.close();
  });
});
