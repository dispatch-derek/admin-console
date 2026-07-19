// Regression test for a real cross-process wiring defect this E2E suite found: bff/src/relay/
// config.ts's header comment states the design intent explicitly --
//   "The relay is a SEPARATE supervised process ... it deliberately does NOT import the BFF's
//    config.ts -- that module `requireEnv`s ANYTHINGLLM_*, SESSION_SECRET, and SECRETS_ENC_KEY at
//    load, engine/auth secrets the relay never uses and must not crash on. This config requires
//    only the DB path + the EVENT_BUS_* family."
// -- but `bff/src/relay/index.ts` -> drainer.ts -> `store/repositories/outbox.repo.ts` ->
// `store/db.ts` transitively imported the BFF's MAIN config (not relay/config.ts), which
// `requireEnv`/`requireSecret`s ANYTHINGLLM_BASE_URL/ANYTHINGLLM_API_KEY/SESSION_SECRET (>=32
// chars)/SECRETS_ENC_KEY (>=32 chars) at import time and threw immediately without them -- exactly
// the BFF-only secrets relay/config.ts documents the relay must never need. Only discoverable by
// launching the real relay/index.ts entrypoint as a separate process, which is what this suite
// does (no unit/spec-level test imports across that process boundary).
//
// FIXED via bff/src/store/db-path.ts: a secret-free DB-path resolver now shared by both
// store/db.ts and relay/config.ts, so store/db.ts no longer drags in the BFF's secret-requiring
// config.ts. This test asserts the fix directly: the relay boots and serves a healthy /ready with
// ONLY DB_PATH + EVENT_BUS_* set -- none of the four BFF-only secrets present in its environment
// at all (spawnRelay actively strips them; see BFF_ONLY_SECRET_ENV_VARS in fixtures/
// relayProcess.ts) -- and it genuinely reaches 200 (not just "some response"), proving the whole
// relay chain (config -> transport -> drainer -> store) is usable end-to-end without them.

import { afterEach, describe, expect, it } from 'vitest';
import { startStubPeer, type StubPeer } from '../fixtures/stubPeer.js';
import { spawnRelay, type RelayHandle } from '../fixtures/relayProcess.js';
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

describe('relay boot config (REQ-F004-033/045: relay-scoped env only, no BFF secrets)', () => {
  it('boots and serves a healthy GET /ready using ONLY DB_PATH + EVENT_BUS_* -- no BFF secrets present', async () => {
    const { dbPath, cleanup } = makeTmpDbPath('boot-config');
    cleanupDb = cleanup;

    peer = await startStubPeer();
    peer.setStatus(200);

    relay = await spawnRelay({ dbPath, peerUrls: [peer.url] });

    // Boots (no early exit from a missing-env throw) and serves a genuinely healthy readiness
    // check -- an empty, reachable backlog against a real acking peer -- entirely without
    // ANYTHINGLLM_BASE_URL/ANYTHINGLLM_API_KEY/SESSION_SECRET/SECRETS_ENC_KEY.
    const healthy = await relay.waitForReadyStatus((s) => s === 200, 10_000);
    expect(healthy.body).toEqual({ ready: true });
    expect(relay.hasExited()).toBe(false);
  });
});
