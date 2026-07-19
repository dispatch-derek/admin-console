// Journey 4: peer failure -> retry/park, with poison isolation.
//   - A transient (5xx) response is retried with backoff and eventually succeeds.
//   - A permanent (4xx, non-408/429) response parks the row immediately (never published, never
//     retried) per REQ-F004-047/051(d).
//   - Neither poisons delivery of rows on other keys.

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

describe('relay: peer failure classification (retry vs park) and poison isolation', () => {
  it('retries a transient 5xx with backoff and eventually delivers; parks a permanent 4xx immediately; unrelated keys are unaffected', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('failure-retry-park');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const transientRowId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-transient' }),
      orderingKey: 'user:u-transient',
    });
    const permanentRowId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-permanent' }),
      orderingKey: 'user:u-permanent',
    });
    const healthyRowId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-healthy' }),
      orderingKey: 'user:u-healthy',
    });

    const transientDeliveryId = db.deliveryId(transientRowId);
    const permanentDeliveryId = db.deliveryId(permanentRowId);

    peer = await startStubPeer();
    peer.setResponder((req) => {
      if (req.deliveryId === transientDeliveryId) {
        // Fail transiently exactly once, then succeed.
        const attempts = peer!.requestsFor(transientDeliveryId).length;
        return attempts <= 1 ? 503 : 200;
      }
      if (req.deliveryId === permanentDeliveryId) return 400; // permanent, per REQ-F004-055
      return 200; // the healthy, unrelated row
    });

    relay = await spawnRelay({ dbPath, peerUrls: [peer.url] });
    await relay.waitUntilServing();

    // Poison isolation: the healthy, independently-keyed row is delivered promptly regardless of
    // the other two rows' outcomes.
    await waitFor(() => (db.row(healthyRowId) as { published_at: string | null }).published_at !== null, {
      timeoutMs: 5_000,
      message: 'expected the healthy row to publish without being blocked by the poison rows',
    });

    // Permanent 4xx -> parked immediately, never published, never retried further.
    await waitFor(() => (db.row(permanentRowId) as { parked_at: string | null }).parked_at !== null, {
      timeoutMs: 5_000,
      message: 'expected the permanently-rejected row to be parked',
    });
    expect((db.row(permanentRowId) as { published_at: string | null }).published_at).toBeNull();
    expect(peer.requestsFor(permanentDeliveryId)).toHaveLength(1); // no retry on a permanent classification

    // Transient 5xx -> retried (backoff ~1s) and eventually published.
    await waitFor(() => (db.row(transientRowId) as { published_at: string | null }).published_at !== null, {
      timeoutMs: 10_000,
      message: 'expected the transiently-failed row to be retried and eventually published',
    });
    expect(peer.requestsFor(transientDeliveryId).length).toBeGreaterThanOrEqual(2);
    const transientRow = db.row(transientRowId) as { attempt_count: number; parked_at: string | null };
    expect(transientRow.attempt_count).toBeGreaterThanOrEqual(1);
    expect(transientRow.parked_at).toBeNull();

    // Give the loop a few more ticks: the parked row must stay parked (never force-published, never
    // re-delivered) even after the other rows have settled.
    await new Promise((r) => setTimeout(r, 2500));
    expect(peer.requestsFor(permanentDeliveryId)).toHaveLength(1);
    expect((db.row(permanentRowId) as { published_at: string | null }).published_at).toBeNull();

    db.close();
  });
});
