// Phase 7 review-gate remediation journey 2: GET /ready now surfaces a distinct
// `store-unwritable` reason (REQ-F004-011/044), via a real write probe against the store
// (`outboxRepo.isWritable()`), separate from the pre-existing backlog/lag reasons.
//
// Forcing a REAL, LIVE relay connection to fail its next write deterministically and instantly,
// without crashing the process at boot and without a multi-second SQLite busy-timeout stall, is
// awkward to do via OS file permissions here (see db.ts's `breakStoreWritability()` doc comment
// for why chmod-read-only doesn't fit this journey). The most reliable equivalent: from a SEPARATE
// connection to the same live DB file, drop the exact table the real write probe targets
// (`outbox_meta`) while the relay keeps running -- its next probe throws a genuine SQLite error
// ("no such table"), `isWritable()` catches it and returns false, and `/ready` must report 503
// `store-unwritable` specifically (not a generic/backlog/lag reason). Recreating the table proves
// recovery back to 200.

import { afterEach, describe, expect, it } from 'vitest';
import { OutboxTestDb } from '../fixtures/db.js';
import { spawnRelay, type RelayHandle } from '../fixtures/relayProcess.js';
import { makeTmpDbPath } from '../fixtures/tmp.js';

let relay: RelayHandle | undefined;
let cleanupDb: (() => void) | undefined;

afterEach(async () => {
  relay?.kill('SIGKILL');
  await relay?.exited;
  cleanupDb?.();
  relay = undefined;
  cleanupDb = undefined;
});

describe('relay: GET /ready surfaces store-unwritable distinctly from backlog/lag', () => {
  it('reports 503 store-unwritable when the store write-probe fails, and 200 once writable again', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('ready-store-writable');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);
    // No outbox rows seeded: backlog=0, lag=0, so those gates can never fire and the reason we
    // observe is unambiguously attributable to store-writability, not incidentally to backlog/lag.
    // The peer URL is never dialed (no rows to drain), so it need not even be a live server.

    relay = await spawnRelay({ dbPath, peerUrls: ['http://127.0.0.1:1'] });

    const healthy = await relay.waitForReadyStatus((s) => s === 200, 15_000);
    expect(healthy.body).toEqual({ ready: true });

    db.breakStoreWritability();

    const degraded = await relay.waitForReadyStatus((s) => s === 503, 10_000);
    expect((degraded.body as { reason?: string }).reason).toBe('store-unwritable');

    db.restoreOutboxMeta();

    const recovered = await relay.waitForReadyStatus((s) => s === 200, 10_000);
    expect(recovered.body).toEqual({ ready: true });

    db.close();
  });
});
