// F-005 — effective-state resolution, provenance, orphan/new-feature handling, and the
// catalog-vs-store authority split. specs/F-005-per-customer-feature-toggle-console.md's own
// self-check note names these as the requirements "most at risk of divergent implementation"
// (REQ-F005-017/020/025/026), so — mirroring bff/test/routes/baseline-prompt.resolution.test.ts's
// rationale for splitting out F-002's own named highest-risk areas — they get a dedicated,
// example-dense file here rather than being folded into feature-toggles.routes.test.ts.
//
// Same harness + catalog-load-timing conventions as feature-toggles.routes.test.ts (manifest is
// always seeded BEFORE buildApp(); a catalog change is modeled as an explicit restart — see that
// file's header comment for the full rationale and the SPEC-AMBIGUITY note on the manifest env var
// name / JSON shape in feature-toggles.helpers.ts).

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

interface FeatureToggle {
  featureKey: string;
  displayName: string;
  description: string | null;
  category: string | null;
  defaultEnabled: boolean;
  enabled: boolean;
  hasOverride: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}
interface FeatureToggleListView {
  customerLabel: string;
  features: FeatureToggle[];
  counts: { enabled: number; disabled: number; total: number };
}

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  cookie: string;
  tmpDir: string;
  dbPath: string;
  mfaSecret: string;
}

let ctx: Ctx | undefined;

async function startApp(entries?: FeatureCatalogEntryFixture[]): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'feature-toggles-resolution-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';
  if (entries) seedManifest(entries);
  else unsetManifest();

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

  const c: Ctx = { app, db, cookie, tmpDir, dbPath, mfaSecret: secret };
  ctx = c;
  return c;
}

// Simulates a redeploy (see feature-toggles.routes.test.ts's `restart()` for the full rationale):
// closes the app, rewrites the manifest, rebuilds against the SAME db file, and REUSES the original
// session cookie rather than performing a second login+MFA round trip — a restart() always follows
// the initial startApp() login moments apart, too close for otplib's 30s TOTP window to roll over,
// and this app's MFA verification correctly rejects a replayed code (sec review H-1). The session
// cookie itself is a `SESSION_SECRET`-signed, stateless credential (same env var, unchanged across
// the restart), so reusing it against the rebuilt instance is both valid and the realistic
// production scenario (an operator's session surviving a BFF restart).
async function restart(c: Ctx, entries?: FeatureCatalogEntryFixture[]): Promise<Ctx> {
  await c.app.close();
  process.env['DB_PATH'] = c.dbPath;
  if (entries) seedManifest(entries);
  else unsetManifest();

  vi.resetModules();
  const { buildApp } = await import('../../src/index.js');
  const { db } = await import('../../src/store/db.js');
  const app = await buildApp();

  const next: Ctx = { ...c, app, db, cookie: c.cookie };
  ctx = next;
  return next;
}

async function get(c: Ctx, url: string) {
  return c.app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: c.cookie } });
}
async function put(c: Ctx, url: string, payload: unknown) {
  return c.app.inject({ method: 'PUT', url, cookies: { [SESSION_COOKIE]: c.cookie }, payload });
}
async function del(c: Ctx, url: string) {
  return c.app.inject({ method: 'DELETE', url, cookies: { [SESSION_COOKIE]: c.cookie } });
}

async function listView(c: Ctx): Promise<FeatureToggleListView> {
  return (await get(c, '/api/feature-toggles')).json() as FeatureToggleListView;
}

const FEATURE: FeatureCatalogEntryFixture = {
  featureKey: 'reporting.export',
  displayName: 'Reporting export',
  defaultEnabled: false,
};

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

// ---------------------------------------------------------------------------------------------
// REQ-F005-017 — deterministic effective-state resolution: effective = override ?? default
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-017 — effective-state resolution', () => {
  it('a feature with defaultEnabled=false and no override reports effective false', async () => {
    const c = await startApp([FEATURE]);
    const row = (await listView(c)).features[0]!;
    expect(row.enabled).toBe(false);
    expect(row.hasOverride).toBe(false);
  });

  it('setting an override true reports effective true', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    const row = (await listView(c)).features[0]!;
    expect(row.enabled).toBe(true);
    expect(row.hasOverride).toBe(true);
  });

  it('clearing the override reports effective false again (back to default)', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    await del(c, '/api/feature-toggles/reporting.export/override');
    const row = (await listView(c)).features[0]!;
    expect(row.enabled).toBe(false);
    expect(row.hasOverride).toBe(false);
  });

  it('REQ-F005-013 — changing the catalog default while an override exists does NOT change the effective value', async () => {
    let c = await startApp([FEATURE]); // defaultEnabled: false
    await put(c, '/api/feature-toggles/reporting.export', { enabled: false }); // explicit override, same as default
    // Redeploy: catalog default flips to true for the same key.
    c = await restart(c, [{ ...FEATURE, defaultEnabled: true }]);
    const row = (await listView(c)).features[0]!;
    expect(row.hasOverride).toBe(true);
    expect(row.enabled).toBe(false); // override (false) still wins over the new default (true)
  });

  it('REQ-F005-013 — changing the catalog default for a feature with NO override DOES change its effective state', async () => {
    let c = await startApp([FEATURE]); // defaultEnabled: false
    expect((await listView(c)).features[0]!.enabled).toBe(false);
    c = await restart(c, [{ ...FEATURE, defaultEnabled: true }]); // new default, no override ever set
    expect((await listView(c)).features[0]!.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-018/025 — orphan overrides
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-018/025 — orphan overrides are hidden, not deleted', () => {
  it('an override whose key matches no catalog entry (after a redeploy) is excluded from the active list', async () => {
    let c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    // Redeploy without this feature declared -> its override row becomes an orphan.
    c = await restart(c, [{ featureKey: 'other.feature', displayName: 'Other', defaultEnabled: false }]);
    const view = await listView(c);
    expect(view.features.map((f) => f.featureKey)).not.toContain('reporting.export');
  });

  it('the orphaned override row still exists in the store (retained, not deleted)', async () => {
    let c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    c = await restart(c, [{ featureKey: 'other.feature', displayName: 'Other', defaultEnabled: false }]);
    await listView(c); // trigger a read under the new catalog
    const row = c.db
      .prepare(`SELECT * FROM feature_toggle_state WHERE feature_key = ?`)
      .get('reporting.export');
    expect(row).toBeDefined();
  });

  it('a PUT targeting an orphaned (catalog-absent) key is rejected 404, same as any undeclared key (REQ-F005-008/030)', async () => {
    let c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    c = await restart(c, [{ featureKey: 'other.feature', displayName: 'Other', defaultEnabled: false }]);
    const res = await put(c, '/api/feature-toggles/reporting.export', { enabled: false });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-026 — newly-declared features
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-026 — newly-declared features', () => {
  it('a feature added to the catalog (after a redeploy) appears with hasOverride:false at its default', async () => {
    let c = await startApp([FEATURE]);
    expect((await listView(c)).features).toHaveLength(1);

    c = await restart(c, [FEATURE, { featureKey: 'new.feature', displayName: 'New', defaultEnabled: true }]);
    const view = await listView(c);
    const row = view.features.find((f) => f.featureKey === 'new.feature')!;
    expect(row.hasOverride).toBe(false);
    expect(row.enabled).toBe(true);
  });

  it('the console does NOT auto-create an override for a new feature; it gets one only after an explicit set', async () => {
    const c = await startApp([
      FEATURE,
      { featureKey: 'new.feature', displayName: 'New', defaultEnabled: true },
    ]);
    const row = c.db.prepare(`SELECT * FROM feature_toggle_state WHERE feature_key = ?`).get('new.feature');
    expect(row).toBeUndefined();
    await put(c, '/api/feature-toggles/new.feature', { enabled: false });
    const rowAfter = c.db
      .prepare(`SELECT * FROM feature_toggle_state WHERE feature_key = ?`)
      .get('new.feature');
    expect(rowAfter).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-016 — catalog shape, coercion, and read-only-to-the-console posture
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-016 — catalog shape & console cannot author it', () => {
  it('each catalog entry exposes featureKey/displayName/description/category/defaultEnabled', async () => {
    const c = await startApp([FEATURE]);
    const row = (await listView(c)).features[0]!;
    expect(row).toMatchObject({
      featureKey: 'reporting.export',
      displayName: 'Reporting export',
      defaultEnabled: false,
    });
    expect('description' in row).toBe(true);
    expect('category' in row).toBe(true);
  });

  it('an entry that omits defaultEnabled loads with defaultEnabled=false (coercion, REQ-F005-053 boundary)', async () => {
    const c = await startApp([{ featureKey: 'no.default', displayName: 'No default' }]);
    const row = (await listView(c)).features[0]!;
    expect(row.defaultEnabled).toBe(false);
    expect(row.enabled).toBe(false);
    expect(row.hasOverride).toBe(false);
  });

  it('there is no route to create or edit a catalog entry (REQ-F005-008) — POST is not a declared method', async () => {
    const c = await startApp([FEATURE]);
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/feature-toggles',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { featureKey: 'invented', displayName: 'Invented', defaultEnabled: true },
    });
    expect([404, 405]).toContain(res.statusCode);
  });
});
