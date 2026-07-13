// F-005 §10 REQ-F005-040 — performance: list render + single toggle write-then-read round trip,
// each p95 < 1500 ms, seeded with a catalog of ≤500 declared features and ≤500 override rows (the
// spec's own sizing N, resolving its review NOTE). Split out from feature-toggles.routes.test.ts,
// mirroring bff/test/routes/baseline-prompt.performance.test.ts's own split rationale.
//
// Per that file's documented precedent, this is a generous SMOKE-level latency assertion against a
// real (not mocked) in-process SQLite store — not a load-test / statistically-rigorous p95
// measurement (which needs dedicated load-test tooling and many samples). The assertion threshold is
// intentionally loose relative to the spec's 1500 ms bound so this stays fast and non-flaky in CI
// while still catching a genuinely pathological (e.g. O(n^2) or N+1-query) implementation.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import { seedManifest, unsetManifest, type FeatureCatalogEntryFixture } from './feature-toggles.helpers.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';
const N = 500;
const BOUND_MS = 1500;

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  cookie: string;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

function seededEntries(count: number): FeatureCatalogEntryFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    featureKey: `feature.${i}`,
    displayName: `Feature ${i}`,
    description: i % 2 === 0 ? `Description for feature ${i}` : null,
    category: i % 3 === 0 ? 'category-a' : null,
    defaultEnabled: i % 2 === 0,
  }));
}

async function startApp(entries: FeatureCatalogEntryFixture[]): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'feature-toggles-perf-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';
  seedManifest(entries);

  vi.resetModules();
  const { buildApp } = await import('../../src/index.js');
  const { staffRepo } = await import('../../src/store/repositories/staff.repo.js');
  const { db } = await import('../../src/store/db.js');
  const { hashPassword, encryptSecret } = await import('../../src/auth/crypto.js');

  const app = await buildApp();

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

  const c: Ctx = { app, db, cookie, tmpDir, dbPath };
  ctx = c;
  return c;
}

async function get(c: Ctx, url: string) {
  return c.app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: c.cookie } });
}
async function put(c: Ctx, url: string, payload: unknown) {
  return c.app.inject({ method: 'PUT', url, cookies: { [SESSION_COOKIE]: c.cookie }, payload });
}

afterEach(async () => {
  if (!ctx) return;
  const c = ctx;
  await c.app.close();
  c.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = c.dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
  rmSync(c.tmpDir, { recursive: true, force: true });
  unsetManifest();
  ctx = undefined;
});

describe('REQ-F005-040 — performance (N=500 features / ≤500 overrides, smoke-level)', () => {
  it(`GET /api/feature-toggles over ${N} seeded features renders within a generous bound (< ${BOUND_MS}ms)`, async () => {
    const c = await startApp(seededEntries(N));
    // Seed N override rows too (every feature explicitly overridden), the spec's own perf ceiling.
    for (let i = 0; i < N; i++) {
      await put(c, `/api/feature-toggles/feature.${i}`, { enabled: i % 2 === 1 });
    }
    const start = Date.now();
    const res = await get(c, '/api/feature-toggles');
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(200);
    const body = res.json() as { features: unknown[] };
    expect(body.features).toHaveLength(N);
    expect(elapsed).toBeLessThan(BOUND_MS);
  }, 30_000);

  it('a single toggle write-then-read round trip completes within the bound', async () => {
    const c = await startApp(seededEntries(N));
    const start = Date.now();
    const putRes = await put(c, '/api/feature-toggles/feature.42', { enabled: true });
    const getRes = await get(c, '/api/feature-toggles');
    const elapsed = Date.now() - start;
    expect(putRes.statusCode).toBe(200);
    const body = getRes.json() as { features: Array<{ featureKey: string; enabled: boolean }> };
    expect(body.features.find((f) => f.featureKey === 'feature.42')?.enabled).toBe(true);
    expect(elapsed).toBeLessThan(BOUND_MS);
  }, 30_000);
});
