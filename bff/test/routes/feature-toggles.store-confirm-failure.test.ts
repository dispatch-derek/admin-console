// F-005 REQ-F005-021/030 — store-confirm-failure 500 path.
//
// GAP-CLOSING FILE (added during Phase 4 independent verification, 2026-07-12): the original F-005
// suite (feature-toggles.routes.test.ts / .events.test.ts) never actually forced the "a store write
// that cannot be confirmed" branch of REQ-F005-030 — every PUT/DELETE against a real (not mocked)
// SQLite store always confirms successfully, so that spec-mandated 500 path had ZERO coverage. This
// file closes that gap.
//
// Forcing a genuine SQLite write failure black-box (e.g. making the file read-only mid-test) is
// unreliable across platforms/CI; REQ-F005-021 itself specifies the confirm mechanism precisely — "the
// row is read back and equals the intended value" — so this mocks the repo module boundary
// (`bff/src/store/repositories/feature-toggle.repo.ts`, discovered by inspecting its exported surface
// now that an implementation exists — the same module-boundary-mocking convention every other
// bff/test/routes/*.routes.test.ts file already uses for the engine adapter) so that a read-back
// deliberately disagrees with what was just written, exercising the REAL route + REAL service's
// confirm-failure branch end-to-end. Only the HTTP/event/audit CONTRACT (REQ-F005-021/030/037/038) is
// asserted — no internal service/repo shape is asserted beyond the documented `featureToggleRepo`
// surface (`get`/`list`/`upsert`/`delete`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import { seedManifest } from './feature-toggles.helpers.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

// Always-fails-to-confirm repo double: `get` never reflects what `upsert`/`delete` just did, so the
// service's read-back check ("row read back and equals the intended value", REQ-F005-021) always
// disagrees — forcing the 500 branch on both PUT (confirmed row missing) and DELETE (confirmed row
// still present) without needing to touch a real SQLite file.
const getMock = vi.fn(() => undefined);
const listMock = vi.fn(() => []);
const upsertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('../../src/store/repositories/feature-toggle.repo.js', () => ({
  featureToggleRepo: {
    get: (...args: unknown[]) => getMock(...(args as [])),
    list: (...args: unknown[]) => listMock(...(args as [])),
    upsert: (...args: unknown[]) => upsertMock(...(args as [])),
    delete: (...args: unknown[]) => deleteMock(...(args as [])),
  },
}));

interface StoredEvent {
  event: string;
}

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  cookie: string;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

async function startApp(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'feature-toggles-confirm-fail-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';
  seedManifest([{ featureKey: 'billing.invoices', displayName: 'Invoice viewer', defaultEnabled: false }]);

  vi.resetModules();
  for (const fn of [getMock, listMock, upsertMock, deleteMock]) fn.mockClear();
  getMock.mockReturnValue(undefined);
  listMock.mockReturnValue([]);

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
  outcome: string,
): Array<{ target: string | null; detail: string | null }> {
  return c.db
    .prepare(`SELECT * FROM audit_log WHERE action = ? AND outcome = ?`)
    .all(action, outcome) as Array<{ target: string | null; detail: string | null }>;
}

beforeEach(async () => {
  ctx = await startApp();
});

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
  ctx = undefined;
});

describe('REQ-F005-021/030 — PUT store-confirm failure', () => {
  it('a PUT whose read-back never reflects the write returns 500 with the exact verbatim message', async () => {
    const c = ctx!;
    const res = await put(c, '/api/feature-toggles/billing.invoices', { enabled: true });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ message: 'could not confirm the change was saved' });
  });

  it('a PUT confirm-failure emits NO admin.feature_toggle.changed event (REQ-F005-037)', async () => {
    const c = ctx!;
    await put(c, '/api/feature-toggles/billing.invoices', { enabled: true });
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(0);
  });

  it('a PUT confirm-failure still records a FAILURE audit entry (REQ-F005-038)', async () => {
    const c = ctx!;
    await put(c, '/api/feature-toggles/billing.invoices', { enabled: true });
    const rows = auditRows(c, 'feature_toggle.set', 'failure');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Codebase-wide audit convention (REQ-F005-038 pins "target (featureKey)" but not a shape;
    // every other service's recordAudit() call stores target as a JSON object, e.g. auth.routes.ts's
    // `target: { username }`) — feature-toggle rows store `{"featureKey": "<key>"}`.
    expect(JSON.parse(rows[0]!.target ?? 'null')).toEqual({ featureKey: 'billing.invoices' });
  });
});

describe('REQ-F005-021/030 — DELETE store-confirm failure', () => {
  it('a DELETE .../override whose read-back still shows the row present returns 500 with the exact verbatim message', async () => {
    const c = ctx!;
    // Simulate: the override existed (so this is the "clear an existing override" branch, not the
    // idempotent-no-override-200 branch) but the post-delete read-back still finds a row.
    getMock.mockReturnValue({
      feature_key: 'billing.invoices',
      enabled: 1,
      updated_at: '2026-07-12T00:00:00.000Z',
      updated_by: 'staff-operator',
    });
    const res = await del(c, '/api/feature-toggles/billing.invoices/override');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ message: 'could not confirm the change was saved' });
  });

  it('a DELETE confirm-failure emits no event and records a failure audit entry', async () => {
    const c = ctx!;
    getMock.mockReturnValue({
      feature_key: 'billing.invoices',
      enabled: 1,
      updated_at: '2026-07-12T00:00:00.000Z',
      updated_by: 'staff-operator',
    });
    await del(c, '/api/feature-toggles/billing.invoices/override');
    expect(eventsNamed(c, 'admin.feature_toggle.changed')).toHaveLength(0);
    expect(auditRows(c, 'feature_toggle.clear', 'failure').length).toBeGreaterThanOrEqual(1);
  });
});
