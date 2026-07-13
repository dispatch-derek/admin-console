// F-005 §9 Events & Audit (REQ-F005-037/038, REQ-F005-052). Split out from
// feature-toggles.routes.test.ts because the event-vs-audit provenance distinction is one of the
// spec's own named review-resolution areas (rev 2 "event stream demoted to a partial record").
//
// Same harness + catalog-load-timing conventions as feature-toggles.routes.test.ts (manifest always
// seeded BEFORE buildApp()). Events are read back from the real event_outbox table, exactly as
// bff/test/routes/settings.routes.test.ts's `eventsNamed()` helper does — the in-proc bus writes
// there synchronously (EVENT_BUS_MODE default).
//
// REQ-F005-052 (event ordering key) is a cross-spec, F-004-OWNED mechanism: the spec's own
// resolution is "accept `__unkeyed__` for this revision; F-004 §3 is NOT extended now" — i.e. F-005
// adds NO ordering-key rule of its own. There is therefore no F-005-local ordering-key BEHAVIOR to
// assert beyond "an admin.feature_toggle.changed event is delivered at all" (covered below); the
// derivation function itself is F-004's own test surface (bff/test/events/*). Traced as
// F-004-OWNED / not independently re-tested here, per this agent's brief not to read bff/src.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import { seedManifest, unsetManifest, type FeatureCatalogEntryFixture } from './feature-toggles.helpers.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

interface StoredEvent {
  event: string;
  actor: string;
  target: Record<string, unknown>;
  changes?: { enabled: boolean; previous: boolean; hasOverride: boolean };
  verified: boolean;
  timestamp: string;
}

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  cookie: string;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

async function startApp(entries?: FeatureCatalogEntryFixture[]): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'feature-toggles-events-test-'));
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

  const c: Ctx = { app, db, cookie, tmpDir, dbPath };
  ctx = c;
  return c;
}

async function put(c: Ctx, url: string, payload: unknown) {
  return c.app.inject({ method: 'PUT', url, cookies: { [SESSION_COOKIE]: c.cookie }, payload });
}
async function del(c: Ctx, url: string) {
  return c.app.inject({ method: 'DELETE', url, cookies: { [SESSION_COOKIE]: c.cookie } });
}

function eventsNamed(c: Ctx, name: string): StoredEvent[] {
  const rows = c.db.prepare('SELECT envelope FROM event_outbox ORDER BY id ASC').all() as {
    envelope: string;
  }[];
  return rows.map((r) => JSON.parse(r.envelope) as StoredEvent).filter((e) => e.event === name);
}

function auditRows(
  c: Ctx,
  action: string,
): Array<{ actor: string; action: string; outcome: string; target: string | null; detail: string | null }> {
  return c.db.prepare(`SELECT * FROM audit_log WHERE action = ?`).all(action) as Array<{
    actor: string;
    action: string;
    outcome: string;
    target: string | null;
    detail: string | null;
  }>;
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
// REQ-F005-037 — admin.feature_toggle.changed: effective-delta only
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-037 — admin.feature_toggle.changed event emission', () => {
  it('toggling a feature from disabled to enabled emits exactly one event with changes.enabled=true/previous=false', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    const events = eventsNamed(c, 'admin.feature_toggle.changed');
    expect(events).toHaveLength(1);
    expect(events[0]!.changes).toMatchObject({ enabled: true, previous: false });
    expect(events[0]!.target).toMatchObject({ featureKey: 'reporting.export' });
    expect(events[0]!.verified).toBe(true);
  });

  it('an effective-state-unchanged PUT (creating an override equal to the default) emits ZERO events', async () => {
    const c = await startApp([FEATURE]); // defaultEnabled: false
    const res = await put(c, '/api/feature-toggles/reporting.export', { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(0);
  });

  it('a second PUT of the SAME value (idempotent re-write) emits zero additional events', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(1);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(1); // still just the one
  });

  it('clearing an override that differs from the default emits one event', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    await del(c, '/api/feature-toggles/reporting.export/override');
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(2); // set + clear, both deltas
  });

  it('clearing an override equal to the default emits NO change event (REQ-F005-023/037)', async () => {
    const c = await startApp([FEATURE]); // defaultEnabled: false
    await put(c, '/api/feature-toggles/reporting.export', { enabled: false }); // override == default
    await del(c, '/api/feature-toggles/reporting.export/override');
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(0);
  });

  it('a DELETE against a catalog-present feature with no override emits no event (idempotent-success, REQ-F005-023)', async () => {
    const c = await startApp([FEATURE]);
    await del(c, '/api/feature-toggles/reporting.export/override');
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(0);
  });

  it('a store-write that cannot be confirmed emits no event (REQ-F005-030, modeled via a request that fails validation before any write)', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', {}); // 400, no write attempted
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(0);
  });
});

describe('AdminEventName union (cross-spec, docs/design/03-data-models.md events/catalog.ts)', () => {
  it("bff/src/events/catalog.ts's AdminEventName union includes 'admin.feature_toggle.changed'", () => {
    // Static scan (test-time, not authoring-time) — mirrors web/src/leakage.test.ts's own pattern of
    // reading real source at test-run time to assert a textual contract. Path is relative to this
    // test file's own location so it works regardless of vitest's invocation cwd.
    const catalogPath = join(dirname(fileURLToPath(import.meta.url)), '../../src/events/catalog.ts');
    expect(existsSync(catalogPath)).toBe(true);
    const source = readFileSync(catalogPath, 'utf8');
    expect(source).toContain('admin.feature_toggle.changed');
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-038 — audit is the complete operator-action record (event bus is NOT)
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-038 — audit records every accepted set/clear, incl. effective-state-unchanged and no-override clears', () => {
  it('a toggle produces one audit entry naming the feature, actor, and new state', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: true });
    const rows = auditRows(c, 'feature_toggle.set');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.actor).toBe('staff-operator');
    // Codebase-wide audit convention (REQ-F005-038 pins "target (featureKey)" but not a shape;
    // every other service's recordAudit() call stores target as a JSON object, e.g. auth.routes.ts's
    // `target: { username }`) — feature-toggle rows store `{"featureKey": "<key>"}`.
    expect(JSON.parse(rows[0]!.target ?? 'null')).toEqual({ featureKey: 'reporting.export' });
  });

  it('a provenance-only transition (override set equal to the default) produces an audit entry but NO bus event', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', { enabled: false }); // == default
    expect(auditRows(c, 'feature_toggle.set').length).toBeGreaterThanOrEqual(1);
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(0);
  });

  it('a rejected write (validation failure) produces a failure audit entry', async () => {
    const c = await startApp([FEATURE]);
    await put(c, '/api/feature-toggles/reporting.export', {}); // 400
    const failureRows = c.db
      .prepare(`SELECT * FROM audit_log WHERE outcome = 'failure' AND target = ?`)
      .all(JSON.stringify({ featureKey: 'reporting.export' })) as Array<{ outcome: string }>;
    expect(failureRows.length).toBeGreaterThanOrEqual(1);
  });

  it('an idempotent-success no-override DELETE is audited as an accepted clear with no effective change', async () => {
    const c = await startApp([FEATURE]);
    const before = auditRows(c, 'feature_toggle.clear').length;
    await del(c, '/api/feature-toggles/reporting.export/override');
    const after = auditRows(c, 'feature_toggle.clear').length;
    expect(after).toBe(before + 1);
  });
});
