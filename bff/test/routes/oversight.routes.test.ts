// routes/oversight.routes.ts + services/oversight.service.ts — §6.6 Oversight (REQ-051) via
// buildApp() + app.inject(). Mirrors test/routes/workspaces.routes.test.ts's conventions
// exactly: per-test tmp DB, vi.resetModules() for a fresh module graph, a genuine session
// cookie minted through the real login FSM, and the engine adapter mocked at the module
// boundary. This is a read-only route: no verify-after-write, no admin.* event.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import type { EngineChatPage, EngineWorkspace } from '../../src/engine/engine-types.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

const listWorkspaces = vi.fn();
const getWorkspace = vi.fn();
const createWorkspaceMock = vi.fn();
const updateWorkspaceMock = vi.fn();
const deleteWorkspaceMock = vi.fn();
const updateEmbeddingsMock = vi.fn();
const updatePinMock = vi.fn();
const listDocumentsMock = vi.fn();
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
  workspaceChatsMock,
];

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
}

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  cookie: string;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

async function freshApp(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'oversight-routes-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';

  vi.resetModules();
  for (const fn of ALL_MOCKS) fn.mockReset();
  listWorkspaces.mockResolvedValue([]);
  listDocumentsMock.mockResolvedValue([]);
  workspaceChatsMock.mockResolvedValue({ chats: [], hasPages: false });

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

  return { app, db, cookie, tmpDir, dbPath };
}

async function seedWorkspace(c: Ctx, engineWs: EngineWorkspace): Promise<string> {
  listWorkspaces.mockResolvedValueOnce([engineWs]);
  const res = await c.app.inject({
    method: 'GET',
    url: '/api/workspaces',
    cookies: { [SESSION_COOKIE]: c.cookie },
  });
  return (res.json() as Array<{ id: string }>)[0]!.id;
}

function allEvents(c: Ctx): StoredEvent[] {
  const rows = c.db.prepare('SELECT envelope FROM event_outbox ORDER BY id ASC').all() as {
    envelope: string;
  }[];
  return rows.map((r) => JSON.parse(r.envelope) as StoredEvent);
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

describe('REQ-012/REQ-022 — the oversight route requires a staff session', () => {
  it('GET /api/oversight/chats → 401 with no session cookie', async () => {
    const c = ctx!;
    const res = await c.app.inject({ method: 'GET', url: '/api/oversight/chats' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/oversight/chats (REQ-051)', () => {
  it('issues the adapter.workspaceChats call and returns the product {chats, hasMore} page', async () => {
    const c = ctx!;
    const chats = [{ id: 1, message: 'hi' }, { id: 2, message: 'there' }];
    workspaceChatsMock.mockResolvedValue({ chats, hasPages: true } as EngineChatPage);

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/oversight/chats',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(workspaceChatsMock).toHaveBeenCalledTimes(1);
    expect(res.json()).toEqual({ chats, hasMore: true });
  });

  it('is read-only: no admin.* event is emitted', async () => {
    const c = ctx!;
    workspaceChatsMock.mockResolvedValue({ chats: [], hasPages: false } as EngineChatPage);

    const before = allEvents(c).length;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/oversight/chats',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(allEvents(c)).toHaveLength(before);
  });

  it('a ?workspace=<handle> query param resolves the handle to the engine numeric id passed as workspaceId', async () => {
    const c = ctx!;
    const handle = await seedWorkspace(c, baseEngineWorkspace({ id: 42, slug: 'ws-a', name: 'Alpha' }));
    workspaceChatsMock.mockResolvedValue({ chats: [], hasPages: false } as EngineChatPage);

    const res = await c.app.inject({
      method: 'GET',
      url: `/api/oversight/chats?workspace=${handle}`,
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(workspaceChatsMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 42 }));
  });

  it('an unknown workspace handle in ?workspace= → 404, no engine chat call', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/oversight/chats?workspace=no-such-handle',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(workspaceChatsMock).not.toHaveBeenCalled();
  });

  it('passes limit/offset query params through to the engine query', async () => {
    const c = ctx!;
    workspaceChatsMock.mockResolvedValue({ chats: [], hasPages: false } as EngineChatPage);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/oversight/chats?limit=10&offset=5',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(workspaceChatsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 5 }));
  });
});

describe('REQ-051/§11 — chat EXPORT is a non-goal; no export-chats route is exposed', () => {
  it('no product route for exporting chats exists (404 with a valid session)', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/oversight/chats/export',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('no product route for /api/system/export-chats exists (404 with a valid session)', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/system/export-chats',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
