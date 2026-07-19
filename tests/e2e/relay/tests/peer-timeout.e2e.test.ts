// Phase 7 review-gate remediation journey 3 (security finding F1 / REQ-F004-055): a peer that
// accepts the TCP connection but never sends a response must not wedge a delivery -- and therefore
// its ordering key -- forever. HttpPeerTransport now bounds every peer request to
// EVENT_BUS_PEER_TIMEOUT_MS (default 10s; env-overridable), aborting and classifying the outcome
// transient on timeout so the row retries with backoff like any other transient failure. This test
// drives the timeout small so the bound is provable in a few seconds, and proves poison isolation:
// a sibling row on a DIFFERENT ordering key is not blocked by the hung one.

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

describe('relay: bounded per-peer request timeout (security F1)', () => {
  it('a hung peer response does not wedge the delivery forever, and does not block a sibling on a different key', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('peer-timeout');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const PEER_TIMEOUT_MS = 300; // far below the 10s default -- makes the bound provable quickly

    const hungRowId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-hung' }),
      orderingKey: 'user:u-hung',
    });
    const siblingRowId = db.seed({
      envelope: makeEnvelope('admin.user.created', { id: 'u-sibling' }),
      orderingKey: 'user:u-sibling', // an independent key -- must not be blocked by the hung one
    });
    const hungDeliveryId = db.deliveryId(hungRowId);
    const siblingDeliveryId = db.deliveryId(siblingRowId);

    peer = await startStubPeer();
    peer.hang(hungDeliveryId); // accepts the connection, never responds
    peer.setStatus(200); // everything else (the sibling) acks immediately

    relay = await spawnRelay({ dbPath, peerUrls: [peer.url], peerTimeoutMs: PEER_TIMEOUT_MS });
    await relay.waitUntilServing();

    // Poison isolation: the sibling on a different key is delivered promptly regardless of the hang.
    await waitFor(() => (db.row(siblingRowId) as { published_at: string | null }).published_at !== null, {
      timeoutMs: 5_000,
      message: 'expected the sibling row (different key) to publish without being blocked by the hung peer',
    });

    // Bounded, not indefinite: well within a couple of seconds (far less than the old 10s default),
    // the hung request must already have been aborted and recorded as a retryable transient
    // failure -- proof the delivery attempt did not hang for the process lifetime.
    await waitFor(
      () => {
        const row = db.row(hungRowId) as { attempt_count: number; next_attempt_at: string | null; published_at: string | null };
        return row.attempt_count >= 1 && row.next_attempt_at !== null;
      },
      {
        timeoutMs: 3_000,
        message: `expected the hung delivery to time out (~${PEER_TIMEOUT_MS}ms) and be recorded as a transient failure scheduled for retry, not hang indefinitely`,
      },
    );
    expect((db.row(hungRowId) as { published_at: string | null }).published_at).toBeNull();
    expect((db.row(hungRowId) as { parked_at: string | null }).parked_at).toBeNull(); // transient, not parked

    // Eventual delivery once the peer starts responding -- the bounded timeout is a retry trigger,
    // not a terminal failure.
    peer.clearHang(hungDeliveryId);
    peer.setStatus(200);

    await waitFor(() => (db.row(hungRowId) as { published_at: string | null }).published_at !== null, {
      timeoutMs: 10_000,
      message: 'expected the previously-hung row to eventually publish once the peer responds',
    });

    db.close();
  });
});
