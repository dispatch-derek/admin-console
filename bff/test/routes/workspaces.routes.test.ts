// routes/workspaces.routes.ts — §5 Workspaces end-to-end via buildApp() + app.inject()
// (mirrors test/routes/auth.routes.test.ts's conventions exactly: per-test tmp DB,
// vi.resetModules() for a fresh module graph, session established through the real login
// FSM). The engine adapter is mocked at the module boundary (vi.mock) so the BFF never
// calls a real AnythingLLM instance; adapter mock calls are asserted directly to pin down
// the exact engine request shape (REQ-032/033/036). Emitted admin.* events are captured via
// the real (per-test) event_outbox table — the inproc bus writes there synchronously.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import type { EngineDocument, EngineWorkspace } from '../../src/engine/engine-types.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

// --- Mock the engine adapter module boundary (REQ-026/013): the BFF under test must NEVER
// reach a real AnythingLLM instance. Function references are declared outside the factory
// so they survive vi.resetModules() across tests in this file (same pattern as
// test/events/emitter.test.ts's outboxRepo mock). ---
const listWorkspaces = vi.fn();
const getWorkspace = vi.fn();
const createWorkspaceMock = vi.fn();
const updateWorkspaceMock = vi.fn();
const deleteWorkspaceMock = vi.fn();
const updateEmbeddingsMock = vi.fn();
const updatePinMock = vi.fn();
const listDocumentsMock = vi.fn();

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
    // Unused by workspace routes, but present so the mocked module satisfies the
    // EngineAdapter shape if anything ever introspects it.
    isMultiUserMode: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    listInvites: vi.fn(),
    createInvite: vi.fn(),
    deleteInvite: vi.fn(),
    listWorkspaceMembers: vi.fn(),
    manageWorkspaceUsers: vi.fn(),
    workspaceChats: vi.fn(),
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
];

// A fully-populated engine workspace fixture (grounding §3 shape, REQ-032 table).
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'workspaces-routes-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';

  vi.resetModules();
  for (const fn of ALL_MOCKS) fn.mockReset();
  listWorkspaces.mockResolvedValue([]);
  listDocumentsMock.mockResolvedValue([]);

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

// Reconciles a single engine workspace into the map (via GET /api/workspaces) and returns
// the minted opaque product id, so mutation tests can address it.
async function seedWorkspace(c: Ctx, engineWs: EngineWorkspace): Promise<string> {
  listWorkspaces.mockResolvedValueOnce([engineWs]);
  const res = await c.app.inject({
    method: 'GET',
    url: '/api/workspaces',
    cookies: { [SESSION_COOKIE]: c.cookie },
  });
  return (res.json() as Array<{ id: string }>)[0].id;
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

describe('REQ-012/REQ-022 — every workspace route requires a staff session', () => {
  const cases: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string }> = [
    { method: 'GET', url: '/api/workspaces' },
    { method: 'GET', url: '/api/documents' },
    { method: 'GET', url: '/api/workspaces/some-id' },
    { method: 'POST', url: '/api/workspaces' },
    { method: 'PATCH', url: '/api/workspaces/some-id/settings' },
    { method: 'DELETE', url: '/api/workspaces/some-id' },
    { method: 'PUT', url: '/api/workspaces/some-id/knowledge' },
    { method: 'POST', url: '/api/workspaces/some-id/knowledge/pin' },
  ];

  for (const { method, url } of cases) {
    it(`${method} ${url} → 401 with no session cookie`, async () => {
      const c = ctx!;
      const res = await c.app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe('GET /api/workspaces (REQ-030)', () => {
  it('returns one product-shaped row per engine workspace; no engine field names cross', async () => {
    const c = ctx!;
    listWorkspaces.mockResolvedValue([
      baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', chatProvider: 'openai', chatModel: 'gpt-4' }),
      baseEngineWorkspace({ id: 2, slug: 'ws-b', name: 'Beta', chatProvider: null, chatModel: null }),
    ]);

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ displayName: 'Alpha', llmProvider: 'openai', llmModel: 'gpt-4' });
    expect(typeof body[0]!['id']).toBe('string');
    expect((body[0]!['id'] as string).length).toBeGreaterThan(0);
    expect(body[1]).toMatchObject({ displayName: 'Beta', llmProvider: null, llmModel: null });

    const raw = res.payload;
    for (const engineField of [
      'slug',
      'chatProvider',
      'chatMode',
      'openAiTemp',
      'similarityThreshold',
      'topN',
      'vectorSearchMode',
      'pfpFilename',
    ]) {
      expect(raw.includes(`"${engineField}"`)).toBe(false);
    }
  });

  it('returns [] when the engine has no workspaces', async () => {
    const c = ctx!;
    listWorkspaces.mockResolvedValue([]);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('GET /api/workspaces/:id (REQ-031)', () => {
  it('loads full product settings mapped from the engine workspace', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiTemp: 0.9, topN: 6 });
    const id = await seedWorkspace(c, engineWs);

    getWorkspace.mockResolvedValue(engineWs);
    const res = await c.app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.temperature).toBe(0.9);
    expect(body.retrievalTopN).toBe(6);
    expect(getWorkspace).toHaveBeenCalledWith('ws-a');
  });

  it('unknown id → 404', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/workspaces/no-such-handle',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a known handle whose engine workspace is gone (adapter returns null) → 404', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' }));
    getWorkspace.mockResolvedValue(null);
    const res = await c.app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('REQ-034 read path: a workspace whose engine chatMode is "automatic" is returned as-is', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', chatMode: 'automatic' });
    const id = await seedWorkspace(c, engineWs);
    getWorkspace.mockResolvedValue(engineWs);

    const res = await c.app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.json().responseMode).toBe('automatic');
  });
});

describe('REQ-021a/022 — no engine field names ever reach the response JSON', () => {
  it('GET /api/workspaces/:id response body contains no engine field names', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' });
    const id = await seedWorkspace(c, engineWs);
    getWorkspace.mockResolvedValue(engineWs);

    const res = await c.app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const raw = res.payload;
    for (const engineField of [
      'chatProvider',
      'chatMode',
      'openAiTemp',
      'openAiHistory',
      'openAiPrompt',
      'similarityThreshold',
      'topN',
      'agentProvider',
      'agentModel',
      'queryRefusalResponse',
      'vectorSearchMode',
      'pfpFilename',
      'slug',
    ]) {
      expect(raw.includes(`"${engineField}"`)).toBe(false);
    }
  });
});

describe('PATCH /api/workspaces/:id/settings (REQ-032/033) — exact engine body', () => {
  it('a patch of only {temperature} calls adapter.updateWorkspace with EXACTLY { openAiTemp }', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiTemp: 0.2 });
    const id = await seedWorkspace(c, engineWs);

    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...engineWs, openAiTemp: 0.5 }); // re-read reflects the change

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { temperature: 0.5 },
    });

    expect(res.statusCode).toBe(200);
    expect(updateWorkspaceMock).toHaveBeenCalledTimes(1);
    const [slugArg, bodyArg] = updateWorkspaceMock.mock.calls[0]!;
    expect(slugArg).toBe('ws-a');
    expect(bodyArg).toEqual({ openAiTemp: 0.5 }); // exact — no other keys
    expect(res.json().temperature).toBe(0.5);
    expect(res.json()).not.toHaveProperty('openAiTemp');
  });

  it('a multi-field patch maps only the changed fields to their engine keys', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' });
    const id = await seedWorkspace(c, engineWs);

    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...engineWs, openAiPrompt: 'New prompt', topN: 9 });

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { systemPrompt: 'New prompt', retrievalTopN: 9 },
    });

    expect(res.statusCode).toBe(200);
    const [, bodyArg] = updateWorkspaceMock.mock.calls[0]!;
    expect(bodyArg).toEqual({ openAiPrompt: 'New prompt', topN: 9 });
  });

  it('an empty patch is rejected with 400 and performs no engine write', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' }));

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('a verified save emits exactly one admin.workspace.updated and one success audit row', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiTemp: 0.2 });
    const id = await seedWorkspace(c, engineWs);
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...engineWs, openAiTemp: 0.5 });

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { temperature: 0.5 },
    });

    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.workspace.updated')).toHaveLength(1);
    expect(auditRows(c, 'workspace.update', 'success')).toHaveLength(1);
  });
});

describe('PATCH /api/workspaces/:id/settings — REQ-034 responseMode constraint', () => {
  it('responseMode "automatic" is rejected with 400 and performs NO engine write', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' }));

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { responseMode: 'automatic' },
    });

    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('saving an unrelated field on a workspace whose chatMode is "automatic" does not include chatMode in the engine body', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', chatMode: 'automatic' });
    const id = await seedWorkspace(c, engineWs);
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...engineWs, openAiTemp: 1.0 });

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { temperature: 1.0 },
    });

    expect(res.statusCode).toBe(200);
    const [, bodyArg] = updateWorkspaceMock.mock.calls[0]!;
    expect(bodyArg).toEqual({ openAiTemp: 1.0 });
    expect(Object.prototype.hasOwnProperty.call(bodyArg, 'chatMode')).toBe(false);
  });
});

describe('PATCH /api/workspaces/:id/settings — REQ-036 null/inherit clears a nullable field', () => {
  it('{ llmModel: null } maps to engine body { chatModel: null } exactly', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', chatModel: 'gpt-4' });
    const id = await seedWorkspace(c, engineWs);
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...engineWs, chatModel: null });

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { llmModel: null },
    });

    expect(res.statusCode).toBe(200);
    const [, bodyArg] = updateWorkspaceMock.mock.calls[0]!;
    expect(bodyArg).toEqual({ chatModel: null });
    expect(res.json().llmModel).toBeNull();
  });
});

describe('PATCH /api/workspaces/:id/settings — REQ-028 verify-after-write', () => {
  it('when the re-read does NOT reflect the change: 409, NO event, and a failure audit row', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiTemp: 0.2 });
    const id = await seedWorkspace(c, engineWs);
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue(engineWs); // unchanged re-read — temp still 0.2

    const res = await c.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/settings`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { temperature: 0.5 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toEqual(expect.any(String));
    expect(eventsNamed(c, 'admin.workspace.updated')).toHaveLength(0);
    expect(auditRows(c, 'workspace.update', 'failure')).toHaveLength(1);
    expect(auditRows(c, 'workspace.update', 'success')).toHaveLength(0);
  });
});

describe('POST /api/workspaces (REQ-037)', () => {
  it('creates a workspace with {displayName} → 201 with a non-empty opaque id; emits one admin.workspace.created', async () => {
    const c = ctx!;
    const created = baseEngineWorkspace({ id: 9, slug: 'support-kb', name: 'Support KB' });
    createWorkspaceMock.mockResolvedValue(created);
    getWorkspace.mockResolvedValue(created); // re-read confirms the new workspace

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { displayName: 'Support KB' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.displayName).toBe('Support KB');
    expect(createWorkspaceMock).toHaveBeenCalledWith({ name: 'Support KB' });
    expect(eventsNamed(c, 'admin.workspace.created')).toHaveLength(1);

    // The map row got the numeric id directly from the create response (REQ-037 MIN-4).
    const row = c.workspaceMapRepo.findByProductId(body.id);
    expect(row?.engine_numeric_id).toBe(9);
  });

  it('a membership-style numeric-id resolution works immediately after create (resolveSlug via the mapped row)', async () => {
    const c = ctx!;
    const created = baseEngineWorkspace({ id: 9, slug: 'support-kb', name: 'Support KB' });
    createWorkspaceMock.mockResolvedValue(created);
    getWorkspace.mockResolvedValue(created);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { displayName: 'Support KB' },
    });
    const id = res.json().id as string;

    // A follow-up settings read resolves the SAME slug through our mapping layer.
    getWorkspace.mockResolvedValue(created);
    const followUp = await c.app.inject({
      method: 'GET',
      url: `/api/workspaces/${id}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(followUp.statusCode).toBe(200);
    expect(getWorkspace).toHaveBeenLastCalledWith('support-kb');
  });

  it('when the create response omits the numeric id, a follow-up listWorkspaces backfills it', async () => {
    const c = ctx!;
    const createdNoId = { ...baseEngineWorkspace({ slug: 'kb-2', name: 'KB 2' }) } as Partial<EngineWorkspace>;
    delete createdNoId.id;
    createWorkspaceMock.mockResolvedValue(createdNoId as EngineWorkspace);
    listWorkspaces.mockResolvedValue([baseEngineWorkspace({ id: 42, slug: 'kb-2', name: 'KB 2' })]);
    getWorkspace.mockResolvedValue(baseEngineWorkspace({ id: 42, slug: 'kb-2', name: 'KB 2' }));

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { displayName: 'KB 2' },
    });

    expect(res.statusCode).toBe(201);
    expect(listWorkspaces).toHaveBeenCalled(); // the MIN-4 follow-up lookup happened
    const row = c.workspaceMapRepo.findByProductId(res.json().id);
    expect(row?.engine_numeric_id).toBe(42);
  });

  it('an unconfirmed create (re-read does not show the new workspace) returns non-success and emits no event', async () => {
    const c = ctx!;
    const created = baseEngineWorkspace({ id: 9, slug: 'support-kb', name: 'Support KB' });
    createWorkspaceMock.mockResolvedValue(created);
    getWorkspace.mockResolvedValue(null); // re-read cannot find the new workspace

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { displayName: 'Support KB' },
    });

    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.workspace.created')).toHaveLength(0);
  });

  it('missing displayName → 400, no engine call', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(createWorkspaceMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/workspaces/:id (REQ-038)', () => {
  it('a re-read yielding null (404) is confirmed success: 204, one admin.workspace.deleted, handle removed, no 404 surfaced', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' });
    const id = await seedWorkspace(c, engineWs);
    deleteWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue(null); // 404 re-read == confirmed delete

    const res = await c.app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${id}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(204);
    expect(eventsNamed(c, 'admin.workspace.deleted')).toHaveLength(1);
    expect(c.workspaceMapRepo.findByProductId(id)).toBeUndefined();
    expect(auditRows(c, 'workspace.delete', 'success')).toHaveLength(1);
  });

  it('a re-read that still returns the workspace is unconfirmed: 409, no delete event, handle retained', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' });
    const id = await seedWorkspace(c, engineWs);
    deleteWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue(engineWs); // still there — not confirmed deleted

    const res = await c.app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${id}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.workspace.deleted')).toHaveLength(0);
    expect(c.workspaceMapRepo.findByProductId(id)).toBeDefined();
    expect(auditRows(c, 'workspace.delete', 'failure')).toHaveLength(1);
  });

  it('unknown id → 404 (no map row to resolve)', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'DELETE',
      url: '/api/workspaces/no-such-handle',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/workspaces/:id/knowledge (REQ-039 attach/detach)', () => {
  it('the attach picker is populated from GET /api/documents', async () => {
    const c = ctx!;
    listDocumentsMock.mockResolvedValue([{ id: 'd1', name: 'file1.txt', title: 'File One' }]);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/documents',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'd1', title: 'File One' }]);
  });

  it('attaching a doc re-reads workspace documents, confirms it is present, and emits admin.workspace.documents_changed', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({
      id: 1,
      slug: 'ws-a',
      name: 'Alpha',
      documents: [{ name: 'old.txt', docpath: 'old.txt' } as EngineDocument],
    });
    const id = await seedWorkspace(c, engineWs);
    updateEmbeddingsMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({
      ...engineWs,
      documents: [{ name: 'new.txt', docpath: 'new.txt' } as EngineDocument],
    });

    const res = await c.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${id}/knowledge`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { adds: ['new.txt'], deletes: ['old.txt'] },
    });

    expect(res.statusCode).toBe(200);
    expect(updateEmbeddingsMock).toHaveBeenCalledWith('ws-a', ['new.txt'], ['old.txt']);
    expect(eventsNamed(c, 'admin.workspace.documents_changed')).toHaveLength(1);
  });

  it('detaching triggers the dangerous-operation path: an unconfirmed removal (deleted doc still present) is a 409, no event', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({
      id: 1,
      slug: 'ws-a',
      name: 'Alpha',
      documents: [{ name: 'keep.txt', docpath: 'keep.txt' } as EngineDocument],
    });
    const id = await seedWorkspace(c, engineWs);
    updateEmbeddingsMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue(engineWs); // "keep.txt" is still present after the delete attempt

    const res = await c.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${id}/knowledge`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { adds: [], deletes: ['keep.txt'] },
    });

    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.workspace.documents_changed')).toHaveLength(0);
  });

  it('no adds and no deletes → 400, no engine write', async () => {
    const c = ctx!;
    const id = await seedWorkspace(c, baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha' }));
    const res = await c.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${id}/knowledge`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(updateEmbeddingsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/workspaces/:id/knowledge/pin (REQ-039 pin/unpin)', () => {
  it('pinned:true re-reads pin state and emits admin.workspace.knowledge_pinned', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({
      id: 1,
      slug: 'ws-a',
      name: 'Alpha',
      documents: [{ name: 'doc.txt', docpath: 'doc.txt', pinned: false } as EngineDocument],
    });
    const id = await seedWorkspace(c, engineWs);
    updatePinMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({
      ...engineWs,
      documents: [{ name: 'doc.txt', docpath: 'doc.txt', pinned: true } as EngineDocument],
    });

    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/knowledge/pin`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { docPath: 'doc.txt', pinned: true },
    });

    expect(res.statusCode).toBe(204);
    expect(updatePinMock).toHaveBeenCalledWith('ws-a', 'doc.txt', true);
    expect(eventsNamed(c, 'admin.workspace.knowledge_pinned')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.workspace.knowledge_unpinned')).toHaveLength(0);
  });

  it('pinned:false re-reads pin state and emits admin.workspace.knowledge_unpinned', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({
      id: 1,
      slug: 'ws-a',
      name: 'Alpha',
      documents: [{ name: 'doc.txt', docpath: 'doc.txt', pinned: true } as EngineDocument],
    });
    const id = await seedWorkspace(c, engineWs);
    updatePinMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({
      ...engineWs,
      documents: [{ name: 'doc.txt', docpath: 'doc.txt', pinned: false } as EngineDocument],
    });

    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/knowledge/pin`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { docPath: 'doc.txt', pinned: false },
    });

    expect(res.statusCode).toBe(204);
    expect(eventsNamed(c, 'admin.workspace.knowledge_unpinned')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.workspace.knowledge_pinned')).toHaveLength(0);
  });

  it('an unconfirmed pin change (re-read still shows the old state) is a 409, no event', async () => {
    const c = ctx!;
    const engineWs = baseEngineWorkspace({
      id: 1,
      slug: 'ws-a',
      name: 'Alpha',
      documents: [{ name: 'doc.txt', docpath: 'doc.txt', pinned: false } as EngineDocument],
    });
    const id = await seedWorkspace(c, engineWs);
    updatePinMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue(engineWs); // pin state never flipped

    const res = await c.app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/knowledge/pin`,
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { docPath: 'doc.txt', pinned: true },
    });

    expect(res.statusCode).toBe(409);
    expect(eventsNamed(c, 'admin.workspace.knowledge_pinned')).toHaveLength(0);
  });
});

describe('GET /api/documents (REQ-039 MI-5)', () => {
  it('returns the mapped document list from the engine document source', async () => {
    const c = ctx!;
    listDocumentsMock.mockResolvedValue([
      { id: 'd1', name: 'file1.txt', title: 'File One' },
      { name: 'file2.txt', docpath: 'sub/file2.txt' },
    ]);

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/documents',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 'd1', title: 'File One' },
      { id: 'sub/file2.txt', title: 'file2.txt' },
    ]);
  });
});
