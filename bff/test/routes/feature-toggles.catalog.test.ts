// F-005 — manifest load-failure posture (REQ-F005-053, human ruling RATIFIED 2026-07-12) and the
// defaultEnabled coercion boundary (REQ-F005-016). Split out from feature-toggles.routes.test.ts
// because REQ-F005-053 is itself a dedicated, previously-architect-flagged-conflict ruling with its
// own explicit *Test* clause naming four scenarios (unset / absent / malformed / entry-missing-
// defaultEnabled-only).
//
// SPEC-AMBIGUITY (see feature-toggles.helpers.ts header): the manifest env var name
// (`FEATURE_CATALOG_MANIFEST_PATH`) and JSON shape (`{ "features": FeatureCatalogEntry[] }`) are
// this suite's best-defensible assumption, not spec-pinned. If the implementation differs, only
// this file + feature-toggles.helpers.ts need to change; every other F-005 test operates purely on
// the HTTP contract.
//
// "Starts normally, readiness passes" is checked via the parent `GET /health` route (parent
// REQ-024, unauthenticated, `{ ok: true }`) — the only spec-established readiness signal.
// "Refuses to start" is checked by asserting buildApp() (or the import that triggers catalog load,
// whichever the implementation chooses — this test tolerates either, mirroring config.test.ts's own
// `await expect(loadConfig()).rejects.toThrow(...)` pattern for a load-time failure) rejects.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import {
  seedManifest,
  seedRawManifest,
  seedAbsentManifest,
  unsetManifest,
  FEATURE_CATALOG_MANIFEST_ENV,
  type FeatureCatalogEntryFixture,
} from './feature-toggles.helpers.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

interface FeatureToggleListView {
  customerLabel: string;
  features: Array<{ featureKey: string; defaultEnabled: boolean; enabled: boolean; hasOverride: boolean }>;
  counts: { enabled: number; disabled: number; total: number };
}

let cleanupTmpDir: string | undefined;
let cleanupDbPath: string | undefined;
let cleanupApp: FastifyInstance | undefined;

afterEach(async () => {
  if (cleanupApp) {
    await cleanupApp.close().catch(() => {});
    cleanupApp = undefined;
  }
  if (cleanupDbPath) {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = cleanupDbPath + suffix;
      if (existsSync(p)) rmSync(p);
    }
    cleanupDbPath = undefined;
  }
  if (cleanupTmpDir) {
    rmSync(cleanupTmpDir, { recursive: true, force: true });
    cleanupTmpDir = undefined;
  }
  unsetManifest();
});

function prepEnv(): void {
  const tmpDir = mkdtempSync(join(tmpdir(), 'feature-toggles-catalog-test-'));
  const dbPath = join(tmpDir, 'console.db');
  cleanupTmpDir = tmpDir;
  cleanupDbPath = dbPath;
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';
  vi.resetModules();
}

/** Attempts to build the app; resolves the built app on success. Callers assert on success/reject. */
async function attemptBuild(): Promise<FastifyInstance> {
  const { buildApp } = await import('../../src/index.js');
  const app = await buildApp();
  cleanupApp = app;
  return app;
}

async function health(app: FastifyInstance) {
  return app.inject({ method: 'GET', url: '/health' });
}

async function loginAndGetFeatures(app: FastifyInstance): Promise<FeatureToggleListView> {
  const { staffRepo } = await import('../../src/store/repositories/staff.repo.js');
  const { hashPassword, encryptSecret } = await import('../../src/auth/crypto.js');
  const secret = authenticator.generateSecret();
  staffRepo.insert({
    id: 'staff-operator',
    username: OPERATOR_USERNAME,
    password_hash: await hashPassword(OPERATOR_PASSWORD),
    totp_secret: encryptSecret(secret),
    mfa_enrolled: 1,
    disabled: 0,
    must_set_password: 0,
    created_at: new Date().toISOString(),
  });
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: OPERATOR_USERNAME, password: OPERATOR_PASSWORD },
  });
  const { challengeId } = loginRes.json();
  const mfaRes = await app.inject({
    method: 'POST',
    url: '/api/auth/mfa',
    payload: { challengeId, code: authenticator.generate(secret) },
  });
  const cookie = mfaRes.cookies.find((c: { name: string }) => c.name === SESSION_COOKIE)!.value;
  const res = await app.inject({
    method: 'GET',
    url: '/api/feature-toggles',
    cookies: { [SESSION_COOKIE]: cookie },
  });
  return res.json() as FeatureToggleListView;
}

// ---------------------------------------------------------------------------------------------
// REQ-F005-053(a) — absent manifest: empty catalog, start normally
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-053(a) — manifest path unset: empty catalog, normal start', () => {
  it('the BFF starts, readiness passes, and GET /api/feature-toggles returns features: []', async () => {
    prepEnv();
    unsetManifest();
    const app = await attemptBuild();
    const h = await health(app);
    expect(h.statusCode).toBe(200);
    expect(h.json()).toEqual({ ok: true });
    const view = await loginAndGetFeatures(app);
    expect(view.features).toEqual([]);
  });
});

describe('REQ-F005-053(a) — manifest path set but file absent: same empty-catalog result', () => {
  it('the BFF starts, readiness passes, and GET /api/feature-toggles returns features: []', async () => {
    prepEnv();
    seedAbsentManifest();
    const app = await attemptBuild();
    const h = await health(app);
    expect(h.statusCode).toBe(200);
    const view = await loginAndGetFeatures(app);
    expect(view.features).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-053(b) — present-but-broken manifest: refuse to start
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-053(b) — present-but-broken manifest: refuses to start', () => {
  it('malformed JSON syntax → build/startup rejects, naming the manifest path', async () => {
    prepEnv();
    const path = seedRawManifest('{ this is not valid JSON');
    // Whatever the exact wording, the spec requires the manifest PATH to be named in the error.
    let caught: unknown;
    try {
      await attemptBuild();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).toContain(path);
  });

  // NOTE: these use a manual try/catch (not vitest's `.rejects` matcher) — empirically, on this
  // harness, `.rejects.toThrow()` against a buildApp() call that (today, pre-implementation)
  // actually RESOLVES rather than rejects can surface an unrelated async timing artifact from a
  // still-open, never-closed app instance instead of a clean assertion failure. The manual
  // try/catch form gives the correct, clean RED signal ("expected undefined to be instance of
  // Error") when the feature isn't implemented yet, matching the "malformed JSON syntax" case above.

  it('schema-invalid — non-string featureKey → build/startup rejects', async () => {
    prepEnv();
    seedRawManifest(JSON.stringify({ features: [{ featureKey: 123, displayName: 'Bad', defaultEnabled: true }] }));
    let caught: unknown;
    try {
      await attemptBuild();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it('schema-invalid — duplicate featureKey → build/startup rejects', async () => {
    prepEnv();
    seedRawManifest(
      JSON.stringify({
        features: [
          { featureKey: 'dup', displayName: 'One', defaultEnabled: true },
          { featureKey: 'dup', displayName: 'Two', defaultEnabled: false },
        ],
      }),
    );
    let caught: unknown;
    try {
      await attemptBuild();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it('schema-invalid — wrong-typed field (defaultEnabled as a string, not a boolean) → build/startup rejects', async () => {
    prepEnv();
    seedRawManifest(
      JSON.stringify({ features: [{ featureKey: 'k', displayName: 'K', defaultEnabled: 'yes' }] }),
    );
    let caught: unknown;
    try {
      await attemptBuild();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it('does NOT silently fall back to an empty catalog on a broken manifest', async () => {
    prepEnv();
    seedRawManifest('not json at all');
    let started = false;
    try {
      await attemptBuild();
      started = true;
    } catch {
      started = false;
    }
    expect(started).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-053 boundary / REQ-F005-016 — coercion is NOT a validation failure
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-016/053 boundary — a missing defaultEnabled is coerced, not a startup failure', () => {
  it('a manifest entry whose ONLY defect is a missing defaultEnabled starts normally and loads defaultEnabled=false', async () => {
    prepEnv();
    seedManifest([{ featureKey: 'no.default', displayName: 'No default' } as FeatureCatalogEntryFixture]);
    const app = await attemptBuild();
    const h = await health(app);
    expect(h.statusCode).toBe(200);
    const view = await loginAndGetFeatures(app);
    expect(view.features).toHaveLength(1);
    expect(view.features[0]!.defaultEnabled).toBe(false);
    expect(view.features[0]!.enabled).toBe(false);
  });
});

describe('sanity — the manifest env var name this suite assumes', () => {
  it('is FEATURE_CATALOG_MANIFEST_PATH (see feature-toggles.helpers.ts SPEC-AMBIGUITY note)', () => {
    expect(FEATURE_CATALOG_MANIFEST_ENV).toBe('FEATURE_CATALOG_MANIFEST_PATH');
  });
});
