// routes/users.routes.ts + services/user.service.ts — §6.1–§6.4 Users, Invites, Membership
// end-to-end via buildApp() + app.inject() (mirrors test/routes/workspaces.routes.test.ts's
// conventions exactly: per-test tmp DB, vi.resetModules() for a fresh module graph, a genuine
// session cookie minted through the real login FSM). The engine adapter is mocked at the
// module boundary (vi.mock) so the BFF never calls a real AnythingLLM instance; adapter mock
// calls are asserted directly to pin down the exact engine request shape (REQ-042/043/046/
// 049). Emitted admin.* events are captured via the real (per-test) event_outbox table — the
// inproc bus writes there synchronously.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import type { EngineInvite, EngineUser, EngineWorkspace } from '../../src/engine/engine-types.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

// --- Mock the engine adapter module boundary (REQ-026/013): the BFF under test must NEVER
// reach a real AnythingLLM instance. Function references are declared outside the factory so
// they survive vi.resetModules() across tests in this file (same pattern as
// test/routes/workspaces.routes.test.ts). ---
const listWorkspaces = vi.fn();
const getWorkspace = vi.fn();
const createWorkspaceMock = vi.fn();
const updateWorkspaceMock = vi.fn();
const deleteWorkspaceMock = vi.fn();
const updateEmbeddingsMock = vi.fn();
const updatePinMock = vi.fn();
const listDocumentsMock = vi.fn();
const isMultiUserModeMock = vi.fn();
const listUsersMock = vi.fn();
const createUserMock = vi.fn();
const updateUserMock = vi.fn();
const deleteUserMock = vi.fn();
const listInvitesMock = vi.fn();
const createInviteMock = vi.fn();
const deleteInviteMock = vi.fn();
const listWorkspaceMembersMock = vi.fn();
const manageWorkspaceUsersMock = vi.fn();
const workspaceChatsMock = vi.fn();

vi.mock('../../src/engine/adapter.js', () => ({
  engineAdapter: {
    listWorkspaces,
    getWorkspace,
    createWorkspace: createWorkspaceMock,
    updateWorkspace: updateWorkspaceMock,
    deleteWorkspace: deleteWorkspaceMock,
    updateEmbeddings: updateEmbeddingsMock,
    updatePin: updatePinMock,
    listDocuments: listDocumentsMock,
    isMultiUserMode: isMultiUserModeMock,
    listUsers: listUsersMock,
    createUser: createUserMock,
    updateUser: updateUserMock,
    deleteUser: deleteUserMock,
    listInvites: listInvitesMock,
    createInvite: createInviteMock,
    deleteInvite: deleteInviteMock,
    listWorkspaceMembers: listWorkspaceMembersMock,
    manageWorkspaceUsers: manageWorkspaceUsersMock,
    workspaceChats: workspaceChatsMock,
    getSystem: vi.fn(),
    updateEnv: vi.fn(),
    envDump: vi.fn(),
    vectorCount: vi.fn(),
    ollamaTags: vi.fn(),
  },
}));

const ALL_MOCKS = [
  listWorkspaces,
  getWorkspace,
  createWorkspaceMock,
  updateWorkspaceMock,
  deleteWorkspaceMock,
  updateEmbeddingsMock,
  updatePinMock,
  listDocumentsMock,
  isMultiUserModeMock,
  listUsersMock,
  createUserMock,
  updateUserMock,
  deleteUserMock,
  listInvitesMock,
  createInviteMock,
  deleteInviteMock,
  listWorkspaceMembersMock,
  manageWorkspaceUsersMock,
  workspaceChatsMock,
];

// A fully-populated engine workspace fixture (grounding §3 shape, REQ-032 table). Copied from
// test/routes/workspaces.routes.test.ts for identical reconcile/seed behavior.
function baseEngineWorkspace(overrides: Partial<EngineWorkspace> = {}): EngineWorkspace {
  return {
    id: 1,
    name: 'Support KB',
    slug: 'support-kb',
    chatProvider: 'openai',
    chatModel: 'gpt-4',
    chatMode: 'chat',
    openAiTemp: 0.7,
    openAiHistory: 20,
    openAiPrompt: 'Prompt',
    similarityThreshold: 0.25,
    topN: 4,
    agentProvider: null,
    agentModel: null,
    queryRefusalResponse: null,
    vectorSearchMode: 'default',
    pfpFilename: null,
    documents: [],
    ...overrides,
  };
}

// A fully-populated engine user fixture (§6.2 grounding, REQ-041).
function engineUserFixture(overrides: Partial<EngineUser> = {}): EngineUser {
  return {
    id: 101,
    username: 'alice',
    role: 'default',
    suspended: 0,
    dailyMessageLimit: 50,
    ...overrides,
  };
}

// A fully-populated engine invite fixture (§6.3 grounding, REQ-045).
function engineInviteFixture(overrides: Partial<EngineInvite> = {}): EngineInvite {
  return {
    id: 10,
    code: 'ABC123',
    status: 'pending',
    claimedBy: null,
    workspaceIds: null,
    ...overrides,
  };
}

interface StoredEvent {
  event: string;
  actor: string;
  target: Record<string, unknown>;
  changes?: unknown;
  verified: boolean | Record<string, boolean>;
  timestamp: string;
}

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  workspaceMapRepo: typeof import('../../src/store/repositories/workspace-map.repo.js').workspaceMapRepo;
  cookie: string;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

async function freshApp(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'users-routes-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';

  vi.resetModules();
  for (const fn of ALL_MOCKS) fn.mockReset();
  listWorkspaces.mockResolvedValue([]);
  listDocumentsMock.mockResolvedValue([]);
  isMultiUserModeMock.mockResolvedValue(true);
  listUsersMock.mockResolvedValue([]);
  listInvitesMock.mockResolvedValue([]);
  listWorkspaceMembersMock.mockResolvedValue([]);

  const { buildApp } = await import('../../src/index.js');
  const { staffRepo } = await import('../../src/store/repositories/staff.repo.js');
  const { db } = await import('../../src/store/db.js');
  const { hashPassword, encryptSecret } = await import('../../src/auth/crypto.js');
  const { workspaceMapRepo } = await import('../../src/store/repositories/workspace-map.repo.js');

  const app = await buildApp();

  // Seed a fully-enrolled operator and drive the real login FSM to obtain a genuine signed
  // session cookie (matches test/routes/auth.routes.test.ts's seedEnrolledStaff pattern).
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

  return { app, db, workspaceMapRepo, cookie, tmpDir, dbPath };
}

// Reconciles a single engine workspace into the map (via GET /api/workspaces) and returns the
// minted opaque product id, so mutation tests can address it (identical to
// test/routes/workspaces.routes.test.ts's helper).
async function seedWorkspace(c: Ctx, engineWs: EngineWorkspace): Promise<string> {
  listWorkspaces.mockResolvedValueOnce([engineWs]);
  const res = await c.app.inject({
    method: 'GET',
    url: '/api/workspaces',
    cookies: { [SESSION_COOKIE]: c.cookie },
  });
  return (res.json() as Array<{ id: string }>)[0]!.id;
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
  outcome: 'success' | 'failure',
): Array<{ actor: string; action: string; outcome: string; target: string | null; detail: string | null }> {
  return c.db
    .prepare(`SELECT * FROM audit_log WHERE action = ? AND outcome = ?`)
    .all(action, outcome) as Array<{
    actor: string;
    action: string;
    outcome: string;
    target: string | null;
    detail: string | null;
  }>;
}

beforeEach(async () => {
  ctx = await freshApp();
});

afterEach(async () => {
  if (!ctx) return;
  await ctx.app.close();
  ctx.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = ctx.dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
  rmSync(ctx.tmpDir, { recursive: true, force: true });
  ctx = undefined;
});

describe('REQ-012/REQ-022 — every §6 user/invite/membership route requires a staff session', () => {
  const cases: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }> = [
    { method: 'GET', url: '/api/multi-user-status' },
    { method: 'GET', url: '/api/users' },
    { method: 'POST', url: '/api/users' },
    { method: 'PATCH', url: '/api/users/1' },
    { method: 'DELETE', url: '/api/users/1' },
    { method: 'GET', url: '/api/invites' },
    { method: 'POST', url: '/api/invites' },
    { method: 'DELETE', url: '/api/invites/1' },
    { method: 'GET', url: '/api/workspaces/some-id/members' },
    { method: 'POST', url: '/api/workspaces/some-id/members' },
  ];

  for (const { method, url } of cases) {
    it(`${method} ${url} → 401 with no session cookie`, async () => {
      const c = ctx!;
      const res = await c.app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe('GET /api/multi-user-status (REQ-040)', () => {
  it('returns { enabled: true } when the engine reports multi-user mode ON', async () => {
    const c = ctx!;
    isMultiUserModeMock.mockResolvedValue(true);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/multi-user-status',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true });
  });

  it('returns { enabled: false } when the engine reports multi-user mode OFF', async () => {
    const c = ctx!;
    isMultiUserModeMock.mockResolvedValue(false);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/multi-user-status',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });
});

describe('GET /api/users (REQ-041)', () => {
  it('returns one product-shaped row per engine user; no engine int suspended flag reaches the response', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValue([
      engineUserFixture({ id: 1, username: 'alice', role: 'default', suspended: 0, dailyMessageLimit: 10 }),
      engineUserFixture({ id: 2, username: 'bob', role: 'admin', suspended: 1, dailyMessageLimit: null }),
    ]);

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({ id: '1', username: 'alice', role: 'default', suspended: false, dailyMessageLimit: 10 });
    expect(body[1]).toEqual({ id: '2', username: 'bob', role: 'admin', suspended: true, dailyMessageLimit: null });
    expect(typeof body[0]!['suspended']).toBe('boolean');
    expect(typeof body[1]!['suspended']).toBe('boolean');

    // No engine int flag (raw 0/1 suspended) ever reaches the JSON.
    const raw = res.payload;
    expect(raw.includes('"suspended":0')).toBe(false);
    expect(raw.includes('"suspended":1')).toBe(false);
  });

  it('returns [] when the engine has no users', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValue([]);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /api/users (REQ-042)', () => {
  for (const role of ['default', 'admin', 'manager'] as const) {
    it(`role '${role}' → 201 with a verified create emitting one admin.user.created`, async () => {
      const c = ctx!;
      createUserMock.mockResolvedValue(engineUserFixture({ id: 55, username: 'newuser', role }));
      listUsersMock.mockResolvedValue([engineUserFixture({ id: 55, username: 'newuser', role })]);

      const res = await c.app.inject({
        method: 'POST',
        url: '/api/users',
        cookies: { [SESSION_COOKIE]: c.cookie },
        payload: { username: 'newuser', password: 'Sup3rSecret!', role },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ username: 'newuser', role });
      expect(createUserMock).toHaveBeenCalledWith({ username: 'newuser', password: 'Sup3rSecret!', role });
      expect(eventsNamed(c, 'admin.user.created')).toHaveLength(1);
    });
  }

  it('an invalid role → 400 and performs NO engine create call', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { username: 'x', password: 'Sup3rSecret!', role: 'owner' },
    });
    expect(res.statusCode).toBe(400);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('missing username → 400, no engine call', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { password: 'Sup3rSecret!', role: 'default' },
    });
    expect(res.statusCode).toBe(400);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('missing password → 400, no engine call', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { username: 'x', role: 'default' },
    });
    expect(res.statusCode).toBe(400);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('an unconfirmed create (re-read never shows the new user) returns non-success and emits no event', async () => {
    const c = ctx!;
    createUserMock.mockResolvedValue(engineUserFixture({ id: 55, username: 'ghost', role: 'default' }));
    listUsersMock.mockResolvedValue([]); // re-read never shows the new user
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { username: 'ghost', password: 'Sup3rSecret!', role: 'default' },
    });
    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.user.created')).toHaveLength(0);
  });
});

describe('PATCH /api/users/:id (REQ-043) — exact engine body + lifecycle events', () => {
  it('{suspended:true} calls adapter.updateUser(numericId, {suspended:1}) and emits BOTH admin.user.updated and admin.user.suspended', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValueOnce([engineUserFixture({ id: 1, suspended: 0 })]); // "before" read
    updateUserMock.mockResolvedValue(undefined);
    listUsersMock.mockResolvedValueOnce([engineUserFixture({ id: 1, suspended: 1 })]); // reread confirms

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { suspended: true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith(1, { suspended: 1 });
    expect(res.json().suspended).toBe(true);
    expect(eventsNamed(c, 'admin.user.updated')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.user.suspended')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.user.reactivated')).toHaveLength(0);
  });

  it('{suspended:false} on a currently-suspended user calls adapter.updateUser with {suspended:0} and emits admin.user.updated + admin.user.reactivated', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValueOnce([engineUserFixture({ id: 1, suspended: 1 })]); // "before" read
    updateUserMock.mockResolvedValue(undefined);
    listUsersMock.mockResolvedValueOnce([engineUserFixture({ id: 1, suspended: 0 })]); // reread confirms

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { suspended: false },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith(1, { suspended: 0 });
    expect(eventsNamed(c, 'admin.user.updated')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.user.reactivated')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.user.suspended')).toHaveLength(0);
  });

  it('a {role} -only change emits admin.user.updated and NO suspended/reactivated event', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValueOnce([engineUserFixture({ id: 1, role: 'default', suspended: 0 })]);
    updateUserMock.mockResolvedValue(undefined);
    listUsersMock.mockResolvedValueOnce([engineUserFixture({ id: 1, role: 'admin', suspended: 0 })]);

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith(1, { role: 'admin' });
    expect(eventsNamed(c, 'admin.user.updated')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.user.suspended')).toHaveLength(0);
    expect(eventsNamed(c, 'admin.user.reactivated')).toHaveLength(0);
  });

  it('a patch that does not actually flip the suspended state emits no lifecycle event', async () => {
    const c = ctx!;
    // Already suspended; patch also says suspended:true — no flip.
    listUsersMock.mockResolvedValue([engineUserFixture({ id: 1, suspended: 1 })]);
    updateUserMock.mockResolvedValue(undefined);

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { suspended: true },
    });

    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.user.updated')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.user.suspended')).toHaveLength(0);
    expect(eventsNamed(c, 'admin.user.reactivated')).toHaveLength(0);
  });

  it('an invalid role → 400, no engine call', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValue([engineUserFixture({ id: 1 })]);
    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(400);
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/users/:id — REQ-028 verify-after-write', () => {
  it('when the re-read does NOT reflect the change: 409, NO event, and a failure audit row', async () => {
    const c = ctx!;
    const unchanged = engineUserFixture({ id: 1, role: 'default', suspended: 0 });
    listUsersMock.mockResolvedValue([unchanged]); // both "before" and reread stay unchanged
    updateUserMock.mockResolvedValue(undefined);

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toEqual(expect.any(String));
    expect(eventsNamed(c, 'admin.user.updated')).toHaveLength(0);
    expect(auditRows(c, 'user.update', 'failure')).toHaveLength(1);
    expect(auditRows(c, 'user.update', 'success')).toHaveLength(0);
  });
});

describe('DELETE /api/users/:id (REQ-044)', () => {
  it('a re-read whose absent user IS the confirmed-success signal: 204, one admin.user.deleted, no 404 surfaced', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValueOnce([engineUserFixture({ id: 1 })]); // "before" — user exists
    deleteUserMock.mockResolvedValue(undefined);
    listUsersMock.mockResolvedValueOnce([]); // reread — 404/absent == confirmed delete

    const res = await c.app.inject({
      method: 'DELETE',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(204);
    expect(deleteUserMock).toHaveBeenCalledWith(1);
    expect(eventsNamed(c, 'admin.user.deleted')).toHaveLength(1);
    expect(auditRows(c, 'user.delete', 'success')).toHaveLength(1);
  });

  it('deleting a non-existent id → 404, no engine delete call', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValue([]); // no such user
    const res = await c.app.inject({
      method: 'DELETE',
      url: '/api/users/999',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('a non-integer id → 404, no engine read/delete call', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'DELETE',
      url: '/api/users/not-a-number',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(listUsersMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('an unconfirmed delete (user still present on reread) → 409, no delete event', async () => {
    const c = ctx!;
    listUsersMock.mockResolvedValue([engineUserFixture({ id: 1 })]); // still there both times
    deleteUserMock.mockResolvedValue(undefined);
    const res = await c.app.inject({
      method: 'DELETE',
      url: '/api/users/1',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.user.deleted')).toHaveLength(0);
  });
});

describe('GET /api/invites (REQ-045)', () => {
  it('returns invites with product workspace HANDLES resolved from the engine numeric workspace id', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' });
    const workspaceHandle = await seedWorkspace(c, engineWs);
    listWorkspaces.mockResolvedValue([engineWs]); // reconcile() inside listInvites finds the same slug
    listInvitesMock.mockResolvedValue([engineInviteFixture({ id: 10, code: 'ABC123', workspaceIds: '5' })]);

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/invites',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: '10', code: 'ABC123', status: 'pending', claimedBy: null, workspaceIds: [workspaceHandle] },
    ]);
    // No raw engine numeric workspace id leaks into the response.
    expect(res.payload.includes('"workspaceIds":["5"]')).toBe(false);
  });

  it('each invite row shows code and status', async () => {
    const c = ctx!;
    listWorkspaces.mockResolvedValue([]);
    listInvitesMock.mockResolvedValue([
      engineInviteFixture({ id: 1, code: 'AAA', status: 'pending' }),
      engineInviteFixture({ id: 2, code: 'BBB', status: 'claimed', claimedBy: 'user-2' }),
    ]);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/invites',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const body = res.json() as Array<{ code: string; status: string; claimedBy: string | null }>;
    expect(body.map((i) => i.code)).toEqual(['AAA', 'BBB']);
    expect(body.map((i) => i.status)).toEqual(['pending', 'claimed']);
    expect(body[1]!.claimedBy).toBe('user-2');
  });
});

describe('POST /api/invites (REQ-046)', () => {
  it('resolves two product workspace handles to engine numeric ids; a verified create emits one admin.invite.created', async () => {
    const c = ctx!;
    listWorkspaces.mockResolvedValue([
      baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' }),
      baseEngineWorkspace({ id: 6, slug: 'ws-b', name: 'Beta' }),
    ]);
    const listRes = await c.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const [idA, idB] = (listRes.json() as Array<{ id: string }>).map((w) => w.id);

    createInviteMock.mockResolvedValue(engineInviteFixture({ id: 20, code: 'XYZ999', workspaceIds: '5,6' }));
    listInvitesMock.mockResolvedValue([engineInviteFixture({ id: 20, code: 'XYZ999', workspaceIds: '5,6' })]);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/invites',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { workspaceIds: [idA, idB] },
    });

    expect(res.statusCode).toBe(201);
    expect(createInviteMock).toHaveBeenCalledWith([5, 6]);
    expect(res.json().workspaceIds).toEqual([idA, idB]);
    expect(eventsNamed(c, 'admin.invite.created')).toHaveLength(1);
  });

  it('an invite with no scoping (no workspaceIds) resolves an empty numeric id list', async () => {
    const c = ctx!;
    createInviteMock.mockResolvedValue(engineInviteFixture({ id: 21, code: 'NOSCOPE', workspaceIds: null }));
    listInvitesMock.mockResolvedValue([engineInviteFixture({ id: 21, code: 'NOSCOPE', workspaceIds: null })]);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/invites',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    expect(createInviteMock).toHaveBeenCalledWith([]);
    expect(res.json().workspaceIds).toEqual([]);
  });

  it('an unconfirmed create (re-read never shows the new invite) returns non-success and emits no event', async () => {
    const c = ctx!;
    createInviteMock.mockResolvedValue(engineInviteFixture({ id: 22, code: 'GHOST' }));
    listInvitesMock.mockResolvedValue([]); // re-read never shows it
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/invites',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.invite.created')).toHaveLength(0);
  });
});

describe('DELETE /api/invites/:id (REQ-047)', () => {
  it('a verified revoke emits one admin.invite.revoked', async () => {
    const c = ctx!;
    deleteInviteMock.mockResolvedValue(undefined);
    listInvitesMock.mockResolvedValue([]); // reread shows the invite gone

    const res = await c.app.inject({
      method: 'DELETE',
      url: '/api/invites/10',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(204);
    expect(deleteInviteMock).toHaveBeenCalledWith(10);
    expect(eventsNamed(c, 'admin.invite.revoked')).toHaveLength(1);
  });

  it('an unconfirmed revoke (invite still present on reread) → 409, no revoke event', async () => {
    const c = ctx!;
    deleteInviteMock.mockResolvedValue(undefined);
    listInvitesMock.mockResolvedValue([engineInviteFixture({ id: 10 })]); // still there
    const res = await c.app.inject({
      method: 'DELETE',
      url: '/api/invites/10',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.invite.revoked')).toHaveLength(0);
  });
});

describe('GET /api/workspaces/:id/members (REQ-048)', () => {
  it('resolves the opaque id to the engine numeric id and returns product Users', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' }));
    listWorkspaceMembersMock.mockResolvedValue([engineUserFixture({ id: 101, suspended: 1 })]);

    const res = await c.app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}/members`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(listWorkspaceMembersMock).toHaveBeenCalledWith(5);
    expect(res.json()).toEqual([
      { id: '101', username: 'alice', role: 'default', suspended: true, dailyMessageLimit: 50 },
    ]);
  });

  it('backfills a null numeric id via listWorkspaces before resolving members', async () => {
    const c = ctx!;
    const productId = 'members-backfill-handle';
    c.workspaceMapRepo.insert({
      product_id: productId,
      engine_slug: 'ws-null',
      engine_numeric_id: null,
      display_name: 'Null Numeric',
      created_at: new Date().toISOString(),
    });
    listWorkspaces.mockResolvedValue([baseEngineWorkspace({ id: 77, slug: 'ws-null', name: 'Null Numeric' })]);
    listWorkspaceMembersMock.mockResolvedValue([]);

    const res = await c.app.inject({
      method: 'GET',
      url: `/api/workspaces/${productId}/members`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(listWorkspaces).toHaveBeenCalled();
    expect(listWorkspaceMembersMock).toHaveBeenCalledWith(77);
    expect(c.workspaceMapRepo.findByProductId(productId)?.engine_numeric_id).toBe(77);
  });

  it('unknown workspace id → 404', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/workspaces/no-such-handle/members',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/workspaces/:id/members (REQ-049) — the normative membership endpoint', () => {
  it('reset:false with a userId ALREADY present adds nothing and emits NO event (verified no-op)', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' }));
    const user1 = engineUserFixture({ id: 101, username: 'alice' });
    listWorkspaceMembersMock.mockResolvedValueOnce([user1]); // before snapshot
    manageWorkspaceUsersMock.mockResolvedValue(undefined);
    listWorkspaceMembersMock.mockResolvedValueOnce([user1]); // reread — unchanged

    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/members`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { userIds: ['101'], reset: false },
    });

    expect(res.statusCode).toBe(200);
    expect(manageWorkspaceUsersMock).toHaveBeenCalledWith('ws-a', [101], false);
    expect(eventsNamed(c, 'admin.workspace_user.assigned')).toHaveLength(0);
    expect(eventsNamed(c, 'admin.workspace_user.unassigned')).toHaveLength(0);
  });

  it('reset:false with one NEW userId keeps existing members and emits EXACTLY ONE admin.workspace_user.assigned for the new user', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' }));
    const user1 = engineUserFixture({ id: 101, username: 'alice' });
    const user2 = engineUserFixture({ id: 102, username: 'bob' });
    listWorkspaceMembersMock.mockResolvedValueOnce([user1]); // before snapshot
    manageWorkspaceUsersMock.mockResolvedValue(undefined);
    listWorkspaceMembersMock.mockResolvedValueOnce([user1, user2]); // reread — user2 now present

    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/members`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { userIds: ['102'], reset: false },
    });

    expect(res.statusCode).toBe(200);
    // The engine write is the slug-keyed manage-users path — not the numeric workspace id.
    expect(manageWorkspaceUsersMock).toHaveBeenCalledWith('ws-a', [102], false);
    const assigned = eventsNamed(c, 'admin.workspace_user.assigned');
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.target).toMatchObject({ workspace: id, user: '102' });
    expect(eventsNamed(c, 'admin.workspace_user.unassigned')).toHaveLength(0);
    expect(res.json()).toEqual([
      { id: '101', username: 'alice', role: 'default', suspended: false, dailyMessageLimit: 50 },
      { id: '102', username: 'bob', role: 'default', suspended: false, dailyMessageLimit: 50 },
    ]);
  });

  it('reset:true replaces membership with the given set, emitting one event per ACTUAL add/remove computed against the pre-write snapshot', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' }));
    const user1 = engineUserFixture({ id: 101, username: 'alice' });
    const user2 = engineUserFixture({ id: 102, username: 'bob' });
    const user3 = engineUserFixture({ id: 103, username: 'carol' });
    listWorkspaceMembersMock.mockResolvedValueOnce([user1, user2]); // before snapshot: 101, 102
    manageWorkspaceUsersMock.mockResolvedValue(undefined);
    listWorkspaceMembersMock.mockResolvedValueOnce([user2, user3]); // after: 102 stays, 101 gone, 103 new

    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/members`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { userIds: ['102', '103'], reset: true },
    });

    expect(res.statusCode).toBe(200);
    expect(manageWorkspaceUsersMock).toHaveBeenCalledWith('ws-a', [102, 103], true);

    const assigned = eventsNamed(c, 'admin.workspace_user.assigned');
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.target).toMatchObject({ workspace: id, user: '103' });

    const unassigned = eventsNamed(c, 'admin.workspace_user.unassigned');
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0]!.target).toMatchObject({ workspace: id, user: '101' });

    // user2 (102) was in both before and after — no event for it either way.
    for (const ev of [...assigned, ...unassigned]) {
      expect(ev.target['user']).not.toBe('102');
    }
  });

  it('an unconfirmed membership write (reread does not match the intended set) → 409, no event', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' }));
    const user1 = engineUserFixture({ id: 101 });
    listWorkspaceMembersMock.mockResolvedValueOnce([user1]);
    manageWorkspaceUsersMock.mockResolvedValue(undefined);
    listWorkspaceMembersMock.mockResolvedValueOnce([user1]); // 102 never actually added

    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/members`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { userIds: ['102'], reset: false },
    });

    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.workspace_user.assigned')).toHaveLength(0);
  });

  it('missing userIds/reset → 400, no engine write', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 5, slug: 'ws-a', name: 'Alpha' }));
    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/members`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(manageWorkspaceUsersMock).not.toHaveBeenCalled();
  });
});
