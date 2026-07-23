// F-010: shared-secret credential on the outbound peer POST (specs/F-010-deliver-admin-events-to-
// customer-web-app.md, REQ-F010-024). Drives the stub-peer acceptance journeys the spec's Q2
// ruling deferred to this in-repo suite (the real-cwa integration verification is a separate
// runbook deployment-validation step, REQ-F010-016(e), not an automated test here):
//
//   (a)         correct credential configured -> stub sees the 3 app-level headers incl. the
//               credential -> 2xx -> row published.
//   (b-wrong)   a set-but-INCORRECT credential (either NODE_ENV) -> stub 401 -> deliver() rejects
//               permanent -> immediate park, no backoff retries.
//   (b-missing) NODE_ENV != production, credential unset, peer configured -> relay boots soft,
//               POSTs WITHOUT the credential header -> stub 401 -> immediate permanent park.
//   (production, missing credential) -> the relay REFUSES TO BOOT naming the credential var; this
//               arm is asserted as a boot refusal, NOT a 401 park (unreachable in prod by design,
//               REQ-F010-017).

import { afterEach, describe, expect, it } from 'vitest';
import { startStubPeer, type StubPeer } from '../fixtures/stubPeer.js';
import { OutboxTestDb, makeEnvelope } from '../fixtures/db.js';
import { spawnRelay, waitFor, type RelayHandle } from '../fixtures/relayProcess.js';
import { makeTmpDbPath } from '../fixtures/tmp.js';

const AUTH_HEADER = 'x-event-ingest-secret'; // wire name is X-Event-Ingest-Secret; Node lowercases on receipt

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

describe('relay: F-010 shared-secret credential (REQ-F010-024)', () => {
  it('REQ-F010-024(a): correct credential -> the 3 application-level headers are present, stub 2xx-acks, row publishes', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('cred-happy');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const envelope = makeEnvelope('admin.user.created', { id: 'u-cred-happy' });
    const rowId = db.seed({ envelope, orderingKey: 'user:u-cred-happy' });
    const deliveryId = db.deliveryId(rowId);

    const CORRECT_SECRET = 'e2e-correct-secret-DO-NOT-REUSE';
    peer = await startStubPeer();
    peer.requireAuthToken(AUTH_HEADER, CORRECT_SECRET);

    relay = await spawnRelay({
      dbPath,
      peerUrls: [peer.url],
      extraEnv: { EVENT_BUS_PEER_AUTH_TOKEN: CORRECT_SECRET },
    });
    await relay.waitUntilServing();

    await waitFor(() => (db.row(rowId) as { published_at: string | null }).published_at !== null, {
      timeoutMs: 10_000,
      message: 'expected the row to publish once the correctly-credentialed peer 2xx-acks',
    });

    const received = peer.requestsFor(deliveryId);
    expect(received).toHaveLength(1);
    const req = received[0]!;
    expect(req.rawBody).toBe(envelope); // byte-for-byte, unchanged by F-010 (REQ-F010-012)
    // Presence of the three application-level headers (REQ-F010-005) -- NOT a literal total header
    // count; the fetch client also attaches Host/Content-Length/Accept-Encoding/Connection etc.
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-event-delivery-id']).toBe(deliveryId);
    expect(req.headers[AUTH_HEADER]).toBe(CORRECT_SECRET);

    db.close();
  });

  it('REQ-F010-024(b-wrong): a set-but-incorrect credential -> stub 401 -> immediate permanent park (no backoff retries)', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('cred-wrong');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const envelope = makeEnvelope('admin.user.created', { id: 'u-cred-wrong' });
    const rowId = db.seed({ envelope, orderingKey: 'user:u-cred-wrong' });
    const deliveryId = db.deliveryId(rowId);

    peer = await startStubPeer();
    peer.requireAuthToken(AUTH_HEADER, 'the-secret-the-stub-expects');

    relay = await spawnRelay({
      dbPath,
      peerUrls: [peer.url],
      // Set but WRONG -- boots fine in either NODE_ENV (REQ-F010-024(b-wrong) runs in the e2e
      // default environment per the spec's own framing).
      extraEnv: { EVENT_BUS_PEER_AUTH_TOKEN: 'a-different-configured-secret' },
    });
    await relay.waitUntilServing();

    // Permanent park happens on the FIRST attempt with no backoff wait, so a short timeout here is
    // itself part of the assertion (a transient/backoff path would take >= 1s per backoff.ts).
    await waitFor(() => (db.row(rowId) as { parked_at: string | null }).parked_at !== null, {
      timeoutMs: 3_000,
      message: 'expected the wrong-credential delivery to park immediately (permanent, no backoff)',
    });

    const row = db.row(rowId) as { published_at: string | null; attempt_count: number; parked_at: string | null };
    expect(row.published_at).toBeNull();
    expect(row.attempt_count).toBe(0); // permanent park never goes through the backoff/attempt path
    expect(peer.requestsFor(deliveryId)).toHaveLength(1); // no retry on a permanent classification

    // Stays parked -- never force-published, never re-delivered -- even after further drain ticks.
    await new Promise((r) => setTimeout(r, 2000));
    expect(peer.requestsFor(deliveryId)).toHaveLength(1);
    expect((db.row(rowId) as { published_at: string | null }).published_at).toBeNull();

    db.close();
  });

  it('REQ-F010-024(b-missing): NODE_ENV != production, credential unset -> boots soft, POSTs without the credential header -> stub 401 -> immediate permanent park', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('cred-missing-dev');
    cleanupDb = cleanup;
    const db = new OutboxTestDb(dbPath);

    const envelope = makeEnvelope('admin.user.created', { id: 'u-cred-missing-dev' });
    const rowId = db.seed({ envelope, orderingKey: 'user:u-cred-missing-dev' });
    const deliveryId = db.deliveryId(rowId);

    peer = await startStubPeer();
    peer.requireAuthToken(AUTH_HEADER, 'a-secret-that-will-never-arrive');

    relay = await spawnRelay({
      dbPath,
      peerUrls: [peer.url],
      nodeEnv: 'development', // != production -- REQ-F010-017 boot-soft posture
      extraEnv: { EVENT_BUS_PEER_AUTH_TOKEN: undefined }, // absent, not merely empty
    });

    // Boots (does not exit early from a config-time throw) despite the peer requiring a credential.
    await relay.waitUntilServing();
    expect(relay.hasExited()).toBe(false);

    await waitFor(() => (db.row(rowId) as { parked_at: string | null }).parked_at !== null, {
      timeoutMs: 3_000,
      message: 'expected the credential-less delivery to park immediately (permanent, no backoff)',
    });

    const received = peer.requestsFor(deliveryId);
    expect(received).toHaveLength(1);
    // The credential header is entirely ABSENT (not sent empty) -- REQ-F010-005's 2-header dev
    // path, distinct from the 3-header when-configured path exercised by the happy-path test above.
    expect(received[0]!.headers[AUTH_HEADER]).toBeUndefined();
    expect(received[0]!.headers['content-type']).toBe('application/json');
    expect(received[0]!.headers['x-event-delivery-id']).toBe(deliveryId);

    const row = db.row(rowId) as { published_at: string | null; attempt_count: number };
    expect(row.published_at).toBeNull();
    expect(row.attempt_count).toBe(0);

    db.close();
  });

  it('REQ-F010-017/024: NODE_ENV=production, peer configured + credential absent -> the relay REFUSES TO BOOT naming EVENT_BUS_PEER_AUTH_TOKEN (not a 401 park)', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('cred-missing-prod');
    cleanupDb = cleanup;

    peer = await startStubPeer(); // never expected to receive a request -- boot never reaches main()

    relay = await spawnRelay({
      dbPath,
      peerUrls: [peer.url],
      nodeEnv: 'production',
      extraEnv: { EVENT_BUS_PEER_AUTH_TOKEN: undefined },
    });

    const { code, signal } = await relay.exited; // config.ts throws synchronously at import time
    expect(signal).toBeNull();
    expect(code).not.toBe(0);
    expect(relay.stderr).toContain('EVENT_BUS_PEER_AUTH_TOKEN');
    // The credential value itself must never appear in a boot error (REQ-F010-011) -- there is none
    // configured in this arm, so this also guards against a future regression that echoes env dumps.
    expect(relay.stderr).not.toContain('a-different-configured-secret');

    // Never reached the point of POSTing anything (production boot refusal happens before main()).
    expect(peer.requests).toHaveLength(0);
  });
});
