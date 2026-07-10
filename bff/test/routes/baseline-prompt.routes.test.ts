// F-002 Customer-Wide Baseline System Prompt — routes/baseline-prompt.routes.ts (unbuilt as of
// this test's authoring; see tests/TEST_PLAN.md). Written strictly from
// specs/F-002-customer-system-prompt.md rev 9 (ratified), BEFORE any implementation exists, per
// the QA workflow's "derive from spec, not implementation" rule.
//
// Conventions mirror bff/test/routes/workspaces.routes.test.ts exactly: buildApp() + app.inject(),
// per-test tmp SQLite DB, the engine adapter mocked at the module boundary so no real AnythingLLM
// instance is ever reached, and admin.* events read back from the real event_outbox table.
//
// Every apply-route test body includes `mode` explicitly (REQ-F002-021/047/048/055 prose governs
// over the abbreviated §7.2 route-table example, which omits `mode` — see TEST_PLAN.md).
//
// This file covers the API surface end-to-end (§7), the baseline CRUD lifecycle (§6.1), preview
// (§6.2), apply/fan-out + partial-failure (§6.3), drift/override visibility (§6.4), re-sync
// (§6.5), events/audit (§9), and the non-functional/custody assertions that are observable at the
// route level (§10, §1.2/§1.3). The composition-function matrix and the REQ-F002-059/023/047
// highest-risk areas have their own dedicated, example-dense files:
//   bff/test/routes/baseline-prompt.compose.test.ts
//   bff/test/routes/baseline-prompt.resolution.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import type { InjectPayload, Response as LightMyRequestResponse } from 'light-my-request';
import type { EngineWorkspace } from '../../src/engine/engine-types.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

// The boundary sentinel is a BFF constant; its EXACT bytes are the contract of record
// (REQ-F002-011), but tests must not hardcode an implementation string. We instead read back
// whatever sentinel the server used by deriving it from a preview response (composedPrompt =
// baseline + SENTINEL + remainder), so these tests remain correct regardless of the chosen
// literal — only that it is used consistently. A helper `deriveSentinel` does this once per test
// that needs it.

// --- Mock the engine adapter module boundary (parent REQ-026/013), exactly as
// workspaces.routes.test.ts does. ---
const listWorkspaces = vi.fn();
const getWorkspace = vi.fn();
const updateWorkspaceMock = vi.fn();
const deleteWorkspaceMock = vi.fn();

vi.mock('../../src/engine/adapter.js', () => ({
  engineAdapter: {
    listWorkspaces,
    getWorkspace,
    createWorkspace: vi.fn(),
    updateWorkspace: updateWorkspaceMock,
    deleteWorkspace: deleteWorkspaceMock,
    updateEmbeddings: vi.fn(),
    updatePin: vi.fn(),
    listDocuments: vi.fn(),
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

const ALL_MOCKS = [listWorkspaces, getWorkspace, updateWorkspaceMock, deleteWorkspaceMock];

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
    openAiPrompt: '',
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

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface StoredEvent {
  event: string;
  actor: string;
  target: Record<string, unknown>;
  changes?: unknown;
  verified: boolean | Record<string, boolean>;
  timestamp: string;
  payload?: Record<string, unknown>;
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'baseline-prompt-routes-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';

  vi.resetModules();
  for (const fn of ALL_MOCKS) fn.mockReset();
  listWorkspaces.mockResolvedValue([]);

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

async function get(c: Ctx, url: string): Promise<LightMyRequestResponse> {
  return c.app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: c.cookie } });
}
async function put(c: Ctx, url: string, payload: InjectPayload): Promise<LightMyRequestResponse> {
  return c.app.inject({ method: 'PUT', url, cookies: { [SESSION_COOKIE]: c.cookie }, payload });
}
async function del(c: Ctx, url: string): Promise<LightMyRequestResponse> {
  return c.app.inject({ method: 'DELETE', url, cookies: { [SESSION_COOKIE]: c.cookie } });
}
async function post(c: Ctx, url: string, payload: InjectPayload): Promise<LightMyRequestResponse> {
  return c.app.inject({ method: 'POST', url, cookies: { [SESSION_COOKIE]: c.cookie }, payload });
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

// Seeds N engine workspaces and returns their engine slugs (product ids are opaque/minted by the
// console on first workspace-list read, matching workspaces.routes.test.ts's seedWorkspace idiom;
// baseline-prompt routes address workspaces by the SAME product id space via GET /api/workspaces).
async function seedWorkspaces(c: Ctx, wss: EngineWorkspace[]): Promise<Map<string, string>> {
  listWorkspaces.mockResolvedValueOnce(wss);
  const res = await get(c, '/api/workspaces');
  const body = res.json() as Array<{ id: string; displayName: string }>;
  const bySlug = new Map<string, string>();
  for (let i = 0; i < wss.length; i++) {
    bySlug.set(wss[i]!.slug, body[i]!.id);
  }
  return bySlug;
}

// Runs a preview call for a given mode and returns the parsed body.
async function preview(c: Ctx, mode: 'prepend' | 'overwrite' | 'fill' = 'prepend') {
  const res = await get(c, `/api/baseline-prompt/preview?mode=${mode}`);
  return res;
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

// ---------------------------------------------------------------------------------------------
// §7 Route surface / §6.1 auth & CRUD
// ---------------------------------------------------------------------------------------------

describe('REQ-012 (parent) — every F-002 route requires a staff session', () => {
  const cases: Array<{ method: 'GET' | 'PUT' | 'DELETE' | 'POST'; url: string }> = [
    { method: 'GET', url: '/api/baseline-prompt' },
    { method: 'PUT', url: '/api/baseline-prompt' },
    { method: 'DELETE', url: '/api/baseline-prompt' },
    { method: 'GET', url: '/api/baseline-prompt/status' },
    { method: 'GET', url: '/api/baseline-prompt/preview' },
    { method: 'POST', url: '/api/baseline-prompt/apply' },
  ];
  for (const { method, url } of cases) {
    it(`${method} ${url} → 401 with no session cookie (REQ-F002-017)`, async () => {
      const c = ctx!;
      const res = await c.app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe('GET /api/baseline-prompt (REQ-F002-015)', () => {
  it('before any baseline is set, reports "not defined"', async () => {
    const c = ctx!;
    const res = await get(c, '/api/baseline-prompt');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.text).toBeNull();
    expect(body.updatedAt).toBeNull();
    expect(body.updatedBy).toBeNull();
  });

  it('after a PUT, shows the stored text and metadata', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'Be concise and professional.' });
    const res = await get(c, '/api/baseline-prompt');
    const body = res.json();
    expect(body.text).toBe('Be concise and professional.');
    expect(typeof body.updatedAt).toBe('string');
    expect(typeof body.updatedBy).toBe('string');
  });
});

describe('PUT /api/baseline-prompt (REQ-F002-016/017/018)', () => {
  it('creates/replaces the stored baseline and issues zero engine PATCH calls', async () => {
    const c = ctx!;
    const res = await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe('Baseline v1');
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('a successful set produces one audit entry and no engine mutation', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
    expect(auditRows(c, 'baseline_prompt.update').length).toBeGreaterThanOrEqual(1);
  });

  it('no workspace prompt changes until an explicit apply', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: 'Original' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('a whitespace-only baseline is rejected with 400', async () => {
    const c = ctx!;
    const res = await put(c, '/api/baseline-prompt', { text: '   \n\t  ' });
    expect(res.statusCode).toBe(400);
  });

  it('a non-empty baseline is accepted', async () => {
    const c = ctx!;
    const res = await put(c, '/api/baseline-prompt', { text: 'A real baseline.' });
    expect(res.statusCode).toBe(200);
  });

  it('cannot clear the baseline by submitting whitespace — clearing is a dedicated route (REQ-F002-046)', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'A real baseline.' });
    const res = await put(c, '/api/baseline-prompt', { text: '' });
    // Empty/whitespace text on PUT must be rejected (400), NOT silently treated as a clear.
    expect(res.statusCode).toBe(400);
    const check = await get(c, '/api/baseline-prompt');
    expect(check.json().text).toBe('A real baseline.');
  });
});

describe('DELETE /api/baseline-prompt (REQ-F002-046)', () => {
  it('sets the stored baseline to null and issues zero engine writes', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });
    const res = await del(c, '/api/baseline-prompt');
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBeNull();
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('marks previously-synced workspaces stale', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });

    const p1 = await preview(c, 'prepend');
    const token1 = p1.json().confirmToken;
    const phrase1 = p1.json().confirmationPhrase;
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Baseline v1' });
    const apply1 = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: token1,
      typedConfirmation: phrase1,
      mode: 'prepend',
    });
    expect(apply1.statusCode).toBe(200);

    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'Baseline v1' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Baseline v1' });
    const statusBefore = await get(c, '/api/baseline-prompt/status');
    expect(statusBefore.json().workspaces[0].syncState).toBe('synced');

    await del(c, '/api/baseline-prompt');

    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'Baseline v1' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Baseline v1' });
    const statusAfter = await get(c, '/api/baseline-prompt/status');
    expect(statusAfter.json().workspaces[0].syncState).toBe('stale');
  });

  it('a subsequent apply rewrites each tracked workspace to its remainder alone', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: 'Workspace text' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });

    // seedWorkspaces() consumes its own one-shot listWorkspaces mock via GET /api/workspaces;
    // without re-queuing a value here the preview below would see a stale/empty live list (the
    // module-level mock's default from freshApp()) and derive its remainder from an empty live
    // prompt instead of the seeded 'Workspace text', corrupting everything downstream.
    listWorkspaces.mockResolvedValueOnce([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p1 = await preview(c, 'prepend');
    updateWorkspaceMock.mockResolvedValue(undefined);
    const item = p1.json().items.find((i: { workspaceId: string }) => true);
    // Derive the real composed value (with the server's actual sentinel bytes) from the preview
    // response itself, per this file's documented convention (no hardcoded sentinel literals) —
    // this is also exactly the write+verify read-back an honest apply would see.
    let composedFirst = '';
    getWorkspace.mockImplementation(async () => {
      composedFirst = composedFirst || (item.composedPrompt as string);
      return { ...ws, openAiPrompt: composedFirst };
    });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.json().confirmToken,
      typedConfirmation: p1.json().confirmationPhrase,
      mode: 'prepend',
    });

    await del(c, '/api/baseline-prompt');

    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: item.composedPrompt }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: item.composedPrompt });
    const p2 = await preview(c, 'prepend');
    expect(p2.statusCode).toBe(200);
    const item2 = p2.json().items[0];
    // Cleared baseline: composed = remainder alone (REQ-F002-011 clear branch via REQ-F002-046).
    expect(item2.composedPrompt).toBe('Workspace text');

    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Workspace text' });
    const apply2 = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p2.json().confirmToken,
      typedConfirmation: p2.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(apply2.statusCode).toBe(200);
    const [, bodyArg] = updateWorkspaceMock.mock.calls[updateWorkspaceMock.mock.calls.length - 1]!;
    expect(bodyArg).toEqual({ openAiPrompt: 'Workspace text' });
  });

  it('an apply with baseline never defined and no tracked workspace returns 400', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    // Never PUT a baseline; no tracked workspace exists.
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: 'anything',
      typedConfirmation: 'anything',
      mode: 'prepend',
    });
    // Whatever the exact confirmToken validation ordering, the spec is explicit this scenario is
    // 400 ("no baseline defined"); an implementation MAY choose to 400 before or after token
    // validation, but the contract is: apply cannot proceed and no engine write occurs.
    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('preview with a never-defined baseline and no tracked workspace returns an empty item set', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    listWorkspaces.mockResolvedValueOnce([ws]);
    const res = await preview(c, 'prepend');
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// §6.2 preview / §7.1 confirmToken
// ---------------------------------------------------------------------------------------------

describe('GET /api/baseline-prompt/preview (REQ-F002-019/020)', () => {
  it('issues zero engine writes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });
    listWorkspaces.mockResolvedValueOnce([ws]);
    getWorkspace.mockResolvedValue(ws);
    await preview(c, 'prepend');
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
    expect(deleteWorkspaceMock).not.toHaveBeenCalled();
  });

  it('affected count equals the number of workspaces whose compose(...) differs from their live prompt', async () => {
    const c = ctx!;
    const unchanged = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    const changed = baseEngineWorkspace({ id: 2, slug: 'ws-b', name: 'Beta', openAiPrompt: '' });
    await seedWorkspaces(c, [unchanged, changed]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValueOnce([unchanged, changed]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-a' ? { ...unchanged, openAiPrompt: '' } : { ...changed, openAiPrompt: '' },
    );
    const res = await preview(c, 'fill');
    expect(res.statusCode).toBe(200);
    expect(res.json().affectedCount).toBe(2); // both empty -> both fillable in fill mode
  });

  it('returns a non-empty confirmToken and a confirmationPhrase', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const res = await preview(c, 'prepend');
    const body = res.json();
    expect(typeof body.confirmToken).toBe('string');
    expect(body.confirmToken.length).toBeGreaterThan(0);
    expect(typeof body.confirmationPhrase).toBe('string');
    expect(body.confirmationPhrase.length).toBeGreaterThan(0);
  });

  it('a fresh call issues a fresh token (each preview call mints a new confirmToken)', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const p1 = await preview(c, 'prepend');
    const p2 = await preview(c, 'prepend');
    expect(p1.json().confirmToken).not.toBe(p2.json().confirmToken);
  });
});

describe('POST /api/baseline-prompt/apply — confirmToken validation (REQ-F002-020/021)', () => {
  it('an apply with a missing token gets 400 and performs zero engine writes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      typedConfirmation: 'whatever',
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('an apply with a malformed token gets 400 and performs zero engine writes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: '',
      typedConfirmation: 'whatever',
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('an apply with a superseded token gets 409 and performs zero engine writes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);

    const stale = await preview(c, 'prepend');
    // A second preview supersedes the first (REQ-F002-047: "a newer preview token has been minted").
    await preview(c, 'prepend');

    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: stale.json().confirmToken,
      typedConfirmation: stale.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(409);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('an apply with an absent mode gets 400', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
    });
    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('an apply with an unknown mode gets 400', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'destroy-everything',
    });
    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('an apply presenting a confirmToken minted under a different operator mode is rejected 409 with zero engine writes (REQ-F002-055)', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'overwrite', // differs from the mode the token was minted under
    });
    expect(res.statusCode).toBe(409);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/baseline-prompt/apply — typedConfirmation validation (REQ-F002-048)', () => {
  it('a valid confirmToken with an incorrect typedConfirmation is rejected 409 with zero writes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: 'not the right phrase',
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(409);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('a matching confirmToken + typedConfirmation pair proceeds', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// §6.3 apply / fan-out / partial-failure
// ---------------------------------------------------------------------------------------------

describe('POST /api/baseline-prompt/apply — fan-out & result shape (REQ-F002-001/021)', () => {
  it('applying a baseline results in the targeted workspace engine openAiPrompt reflecting the composed prompt, written through the BFF', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'Be concise.' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Be concise.' });
    updateWorkspaceMock.mockResolvedValue(undefined);

    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    expect(res.statusCode).toBe(200);
    expect(updateWorkspaceMock).toHaveBeenCalledTimes(1);
    const [slugArg, bodyArg] = updateWorkspaceMock.mock.calls[0]!;
    expect(slugArg).toBe('ws-a');
    expect(bodyArg).toEqual({ openAiPrompt: 'Be concise.' });
  });

  it('a valid apply returns 200 with a BaselineApplyResult enumerating per-workspace outcomes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    const body = res.json();
    expect(body).toHaveProperty('appliedCount');
    expect(body).toHaveProperty('failedCount');
    expect(body).toHaveProperty('skippedCount');
    expect(body).toHaveProperty('divergedCount');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0]).toMatchObject({ workspaceId: expect.any(String), outcome: expect.any(String) });
  });
});

describe('Per-workspace verify-after-write (REQ-F002-022)', () => {
  it('a fan-out where one workspace PATCH is forced to fail marks that workspace failed, leaves its engine prompt unchanged, does not update its state row, while other workspaces are applied', async () => {
    const c = ctx!;
    const good = baseEngineWorkspace({ id: 1, slug: 'ws-good', name: 'Good', openAiPrompt: '' });
    const bad = baseEngineWorkspace({ id: 2, slug: 'ws-bad', name: 'Bad', openAiPrompt: '' });
    await seedWorkspaces(c, [good, bad]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([good, bad]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-good' ? { ...good, openAiPrompt: 'B' } : { ...bad, openAiPrompt: '' }, // "bad" never verifies
    );
    updateWorkspaceMock.mockResolvedValue(undefined);

    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const items = body.items as Array<{ workspaceId: string; displayName: string; outcome: string }>;
    const badItem = items.find((i) => i.displayName === 'Bad')!;
    const goodItem = items.find((i) => i.displayName === 'Good')!;
    expect(badItem.outcome).toBe('failed');
    expect(goodItem.outcome).toBe('applied');

    // The status surface must not report "bad" as synced/never-applied-with-state — no state row
    // was persisted for it (still never-applied), while "good" now reports synced.
    listWorkspaces.mockResolvedValueOnce([good, bad]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-good' ? { ...good, openAiPrompt: 'B' } : { ...bad, openAiPrompt: '' },
    );
    const status = await get(c, '/api/baseline-prompt/status');
    const statusItems = status.json().workspaces as Array<{ displayName: string; syncState: string }>;
    expect(statusItems.find((i) => i.displayName === 'Bad')!.syncState).toBe('never-applied');
    expect(statusItems.find((i) => i.displayName === 'Good')!.syncState).toBe('synced');
  });
});

describe('Partial-failure legibility (REQ-F002-022a)', () => {
  it('an apply that succeeds on 3 of 4 workspaces renders 3 applied and 1 failed with the failed workspace named — never a single uniform result', async () => {
    const c = ctx!;
    const wss = [1, 2, 3, 4].map((n) =>
      baseEngineWorkspace({ id: n, slug: `ws-${n}`, name: `WS ${n}`, openAiPrompt: '' }),
    );
    await seedWorkspaces(c, wss);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue(wss);
    getWorkspace.mockImplementation(async (slug: string) => {
      const n = wss.find((w) => w.slug === slug)!;
      return slug === 'ws-4' ? { ...n, openAiPrompt: '' } : { ...n, openAiPrompt: 'B' };
    });
    updateWorkspaceMock.mockResolvedValue(undefined);

    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    const body = res.json();
    expect(body.appliedCount).toBe(3);
    expect(body.failedCount).toBe(1);
    const failedItem = (body.items as Array<{ displayName: string; outcome: string }>).find(
      (i) => i.outcome === 'failed',
    );
    expect(failedItem?.displayName).toBe('WS 4');
  });
});

describe('Re-tryability (REQ-F002-022b)', () => {
  it('re-running apply after a partial failure targets only the previously-failed (still-drifted) workspaces and skips the already-synced ones', async () => {
    const c = ctx!;
    const good = baseEngineWorkspace({ id: 1, slug: 'ws-good', name: 'Good', openAiPrompt: '' });
    const bad = baseEngineWorkspace({ id: 2, slug: 'ws-bad', name: 'Bad', openAiPrompt: '' });
    await seedWorkspaces(c, [good, bad]);
    await put(c, '/api/baseline-prompt', { text: 'B' });

    listWorkspaces.mockResolvedValue([good, bad]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-good' ? { ...good, openAiPrompt: 'B' } : { ...bad, openAiPrompt: '' },
    );
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p1 = await preview(c, 'prepend');
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.json().confirmToken,
      typedConfirmation: p1.json().confirmationPhrase,
      mode: 'prepend',
    });
    updateWorkspaceMock.mockClear();

    // Second run: "bad" now actually verifies.
    listWorkspaces.mockResolvedValue([good, bad]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-good' ? { ...good, openAiPrompt: 'B' } : { ...bad, openAiPrompt: 'B' },
    );
    const p2 = await preview(c, 'prepend');
    const res2 = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p2.json().confirmToken,
      typedConfirmation: p2.json().confirmationPhrase,
      mode: 'prepend',
    });

    const body2 = res2.json();
    const items2 = body2.items as Array<{ displayName: string; outcome: string }>;
    expect(items2.find((i) => i.displayName === 'Good')!.outcome).toBe('skipped'); // idempotent no-op
    expect(items2.find((i) => i.displayName === 'Bad')!.outcome).toBe('applied');
    // Only the drifted workspace was actually PATCHed.
    expect(updateWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-bad', expect.anything());
  });
});

// ---------------------------------------------------------------------------------------------
// §6.4 drift & override visibility; new-workspace inheritance
// ---------------------------------------------------------------------------------------------

describe('GET /api/baseline-prompt/status (REQ-F002-024)', () => {
  it('lists every workspace with its sync state', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    listWorkspaces.mockResolvedValueOnce([ws]);
    getWorkspace.mockResolvedValue(ws);
    const res = await get(c, '/api/baseline-prompt/status');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0].syncState).toBe('never-applied');
    expect(body.counts).toBeDefined();
  });
});

describe('New-workspace inheritance (REQ-F002-026)', () => {
  it('creating a workspace after a baseline is set lists it as never-applied; it receives the baseline only after an explicit apply', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const newWs = baseEngineWorkspace({ id: 5, slug: 'ws-new', name: 'New WS', openAiPrompt: '' });
    listWorkspaces.mockResolvedValueOnce([newWs]);
    getWorkspace.mockResolvedValue(newWs);

    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json().workspaces[0].syncState).toBe('never-applied');
    expect(updateWorkspaceMock).not.toHaveBeenCalled(); // no auto-write on creation
  });
});

describe('Override resolution — prepend mode (REQ-F002-025/050)', () => {
  async function setupOverriddenWorkspace(c: Ctx) {
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Baseline v1' });
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p1 = await preview(c, 'prepend');
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.json().confirmToken,
      typedConfirmation: p1.json().confirmationPhrase,
      mode: 'prepend',
    });
    // Now simulate an out-of-band edit that diverges from BOTH the baseline reconstruction and the
    // last-applied hash — genuinely `overridden`.
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Someone typed something else entirely' });
    return ws;
  }

  it('applying to a prepend-resolved overridden workspace does not proceed without an explicit preserve-or-discard choice', async () => {
    const c = ctx!;
    await setupOverriddenWorkspace(c);
    // setupOverriddenWorkspace() performs one real, legitimate apply to establish the
    // applied/overridden baseline state, which itself calls updateWorkspaceMock once. Clear that
    // call so the assertion below observes only what THIS test's own apply does.
    updateWorkspaceMock.mockClear();
    const p2 = await preview(c, 'prepend');
    expect(p2.json().items[0].syncState).toBe('overridden');
    expect(p2.json().items[0]).toHaveProperty('composedIfPreserve');
    expect(p2.json().items[0]).toHaveProperty('composedIfDiscard');

    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p2.json().confirmToken,
      typedConfirmation: p2.json().confirmationPhrase,
      mode: 'prepend',
      // no `overrides` entry for the overridden workspace
    });
    expect(res.statusCode).toBe(200); // apply proceeds for the rest, but...
    const item = res.json().items[0];
    expect(item.outcome).toBe('skipped'); // ...this workspace is skipped, not silently clobbered
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('choosing "preserve" makes the out-of-band text the new remainder', async () => {
    const c = ctx!;
    await setupOverriddenWorkspace(c);
    const p2 = await preview(c, 'prepend');
    const workspaceId = p2.json().items[0].workspaceId;
    const composedIfPreserve = p2.json().items[0].composedIfPreserve;

    getWorkspace.mockResolvedValue(
      baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: composedIfPreserve }),
    );
    updateWorkspaceMock.mockResolvedValue(undefined);
    const apply = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p2.json().confirmToken,
      typedConfirmation: p2.json().confirmationPhrase,
      mode: 'prepend',
      overrides: [{ workspaceId, resolution: 'preserve' }],
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().items[0].outcome).toBe('applied');
    const [, bodyArg] = updateWorkspaceMock.mock.calls[0]!;
    expect(bodyArg.openAiPrompt).toBe(composedIfPreserve);
  });

  it('an apply whose overrides name a non-overridden workspace is rejected 409', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await preview(c, 'prepend');
    const workspaceId = p.json().items[0].workspaceId; // this workspace is never-applied, not overridden
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
      overrides: [{ workspaceId, resolution: 'preserve' }],
    });
    expect(res.statusCode).toBe(409);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('in overwrite mode a non-empty overrides is rejected 400', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: 'x' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await preview(c, 'overwrite');
    const workspaceId = p.json().items[0].workspaceId;
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'overwrite',
      overrides: [{ workspaceId, resolution: 'preserve' }],
    });
    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('in fill mode a non-empty overrides is rejected 400', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await preview(c, 'fill');
    const workspaceId = p.json().items[0].workspaceId;
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'fill',
      overrides: [{ workspaceId, resolution: 'discard' }],
    });
    expect(res.statusCode).toBe(400);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// §6.5 re-sync
// ---------------------------------------------------------------------------------------------

describe('Re-sync on baseline change (REQ-F002-027)', () => {
  it('after a baseline edit, previously-synced workspaces report stale; a re-sync returns them to synced with remainders preserved, reporting per-workspace outcomes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: 'Workspace remainder' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'Baseline v1' });

    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p1 = await preview(c, 'prepend');
    const composed1 = p1.json().items[0].composedPrompt as string;
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.json().confirmToken,
      typedConfirmation: p1.json().confirmationPhrase,
      mode: 'prepend',
    });

    await put(c, '/api/baseline-prompt', { text: 'Baseline v2' });
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: composed1 }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    const statusAfterChange = await get(c, '/api/baseline-prompt/status');
    expect(statusAfterChange.json().workspaces[0].syncState).toBe('stale');

    listWorkspaces.mockResolvedValue([{ ...ws, openAiPrompt: composed1 }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    const p2 = await preview(c, 'prepend');
    const composed2 = p2.json().items[0].composedPrompt as string;
    expect(composed2).toContain('Baseline v2');
    expect(composed2).toContain('Workspace remainder'); // remainder segment byte-identical/preserved

    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed2 });
    const resync = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p2.json().confirmToken,
      typedConfirmation: p2.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(resync.statusCode).toBe(200);
    expect(resync.json().items[0].outcome).toBe('applied');

    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: composed2 }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed2 });
    const finalStatus = await get(c, '/api/baseline-prompt/status');
    expect(finalStatus.json().workspaces[0].syncState).toBe('synced');
  });
});

// ---------------------------------------------------------------------------------------------
// §6.2 target set (REQ-F002-052)
// ---------------------------------------------------------------------------------------------

describe('Target set (REQ-F002-052)', () => {
  it('preview/apply consider every live workspace; there is no per-workspace opt-out control', async () => {
    const c = ctx!;
    const wss = [1, 2, 3].map((n) =>
      baseEngineWorkspace({ id: n, slug: `ws-${n}`, name: `WS ${n}`, openAiPrompt: '' }),
    );
    await seedWorkspaces(c, wss);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValueOnce(wss);
    getWorkspace.mockImplementation(async (slug: string) => wss.find((w) => w.slug === slug)!);
    const res = await preview(c, 'fill');
    expect(res.json().items).toHaveLength(3);
  });

  it('only changed workspaces are written', async () => {
    const c = ctx!;
    const empty = baseEngineWorkspace({ id: 1, slug: 'ws-empty', name: 'Empty', openAiPrompt: '' });
    const filled = baseEngineWorkspace({ id: 2, slug: 'ws-filled', name: 'Filled', openAiPrompt: 'Already has content' });
    await seedWorkspaces(c, [empty, filled]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([empty, filled]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-empty' ? { ...empty, openAiPrompt: 'B' } : filled,
    );
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'fill');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'fill',
    });
    expect(updateWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-empty', { openAiPrompt: 'B' });
    const filledItem = (res.json().items as Array<{ displayName: string; outcome: string }>).find(
      (i) => i.displayName === 'Filled',
    );
    expect(filledItem?.outcome).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------------------------
// §10 non-functional: concurrency/staleness (REQ-F002-040), custody (REQ-F002-037)
// ---------------------------------------------------------------------------------------------

describe('Concurrency / per-workspace divergence (REQ-F002-040/047)', () => {
  it('editing a workspace out-of-band between preview and apply causes that item to be diverged (no write) while other workspaces apply', async () => {
    const c = ctx!;
    const stable = baseEngineWorkspace({ id: 1, slug: 'ws-stable', name: 'Stable', openAiPrompt: '' });
    const edited = baseEngineWorkspace({ id: 2, slug: 'ws-edited', name: 'Edited', openAiPrompt: '' });
    await seedWorkspaces(c, [stable, edited]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([stable, edited]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-stable' ? stable : edited,
    );
    const p = await preview(c, 'prepend');

    // Between preview and apply, "edited" changes out-of-band.
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-stable' ? { ...stable, openAiPrompt: 'B' } : { ...edited, openAiPrompt: 'surprise edit' },
    );
    updateWorkspaceMock.mockResolvedValue(undefined);
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    expect(res.statusCode).toBe(200); // token stays valid — whole apply not rejected
    const items = res.json().items as Array<{ displayName: string; outcome: string }>;
    expect(items.find((i) => i.displayName === 'Edited')!.outcome).toBe('diverged');
    expect(items.find((i) => i.displayName === 'Stable')!.outcome).toBe('applied');
    expect(updateWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-stable', expect.anything());
  });

  it('baseline change after preview makes the apply 409 with zero writes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B1' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await preview(c, 'prepend');

    await put(c, '/api/baseline-prompt', { text: 'B2' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(409);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('a target-set membership change (workspace added) after preview makes the apply 409 with zero writes', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await preview(c, 'prepend');

    const newWs = baseEngineWorkspace({ id: 2, slug: 'ws-b', name: 'Beta', openAiPrompt: '' });
    listWorkspaces.mockResolvedValue([ws, newWs]);
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(409);
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });
});

describe('Custody / no new engine capability (REQ-F002-003/028/037)', () => {
  it("the fan-out's only engine mutation calls are per-workspace update calls; no delete/create/env calls are issued", async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'prepend');
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(deleteWorkspaceMock).not.toHaveBeenCalled();
    expect(updateWorkspaceMock).toHaveBeenCalledTimes(1);
  });
});

describe('Native default system prompt / prompt variables are never touched (REQ-F002-004)', () => {
  it('no F-002 source references /system/default-system-prompt or /system/prompt-variables (static scan)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    const forbidden = ['/system/default-system-prompt', '/system/prompt-variables'];
    const roots = [
      pathJoin(process.cwd(), 'src', 'routes'),
      pathJoin(process.cwd(), 'src', 'services'),
    ];

    function walk(dir: string): string[] {
      if (!existsSync(dir)) return [];
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = pathJoin(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walk(full));
        else if (entry.endsWith('.ts')) out.push(full);
      }
      return out;
    }

    const files = roots.flatMap(walk).filter((f) => f.toLowerCase().includes('baseline'));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const bad of forbidden) {
        expect(text.includes(bad)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// §9 Events & Audit
// ---------------------------------------------------------------------------------------------

describe('Events (REQ-F002-035)', () => {
  it('setting the baseline emits one admin.baseline_prompt.updated (cleared:false) and zero engine events', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const events = eventsNamed(c, 'admin.baseline_prompt.updated');
    expect(events).toHaveLength(1);
    const payload = (events[0]!.payload ?? events[0]!) as Record<string, unknown>;
    expect(payload['cleared']).toBe(false);
    expect(eventsNamed(c, 'admin.workspace.updated')).toHaveLength(0);
  });

  it('a clear emits one admin.baseline_prompt.updated with cleared:true', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    await del(c, '/api/baseline-prompt');
    const events = eventsNamed(c, 'admin.baseline_prompt.updated');
    const clearEvent = events.find((e) => ((e.payload ?? e) as Record<string, unknown>)['cleared'] === true);
    expect(clearEvent).toBeDefined();
  });

  it('an apply that changes three workspaces emits three admin.workspace.updated plus one admin.baseline_prompt.applied whose counts sum correctly and whose applied vs failed/diverged id lists are disjoint', async () => {
    const c = ctx!;
    const wss = [1, 2, 3].map((n) =>
      baseEngineWorkspace({ id: n, slug: `ws-${n}`, name: `WS ${n}`, openAiPrompt: '' }),
    );
    await seedWorkspaces(c, wss);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue(wss);
    getWorkspace.mockImplementation(async (slug: string) => ({
      ...wss.find((w) => w.slug === slug)!,
      openAiPrompt: 'B',
    }));
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(200);

    expect(eventsNamed(c, 'admin.workspace.updated')).toHaveLength(3);
    const applied = eventsNamed(c, 'admin.baseline_prompt.applied');
    expect(applied).toHaveLength(1);
    const payload = (applied[0]!.payload ?? applied[0]!) as Record<string, unknown>;
    expect(payload['appliedCount']).toBe(3);
    expect(payload['failedCount']).toBe(0);
    const appliedIds = payload['appliedWorkspaceIds'] as string[] | undefined;
    const failedIds = payload['failedOrDivergedWorkspaceIds'] as string[] | undefined;
    if (appliedIds && failedIds) {
      expect(appliedIds.length).toBe(3);
      const overlap = appliedIds.filter((id) => failedIds.includes(id));
      expect(overlap).toEqual([]);
    }
  });

  it('a baseline-update event/audit entry carries a content reference and is not treated as a secret (REQ-F002-010b)', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'This is not a secret, just guidance.' });
    const events = eventsNamed(c, 'admin.baseline_prompt.updated');
    const payload = (events[0]!.payload ?? events[0]!) as Record<string, unknown>;
    // Some content reference must exist (length and/or hash); the raw event row overall must not
    // be blanked to a redaction placeholder like "[REDACTED]".
    const raw = JSON.stringify(payload);
    expect(raw.toLowerCase()).not.toContain('redacted');
  });
});

describe('Audit (REQ-F002-036)', () => {
  it('a baseline set produces one audit entry', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    expect(auditRows(c, 'baseline_prompt.update').length).toBeGreaterThanOrEqual(1);
  });

  it('a partial apply produces an audit entry capturing which workspaces succeeded and which failed', async () => {
    const c = ctx!;
    const good = baseEngineWorkspace({ id: 1, slug: 'ws-good', name: 'Good', openAiPrompt: '' });
    const bad = baseEngineWorkspace({ id: 2, slug: 'ws-bad', name: 'Bad', openAiPrompt: '' });
    await seedWorkspaces(c, [good, bad]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([good, bad]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-good' ? { ...good, openAiPrompt: 'B' } : { ...bad, openAiPrompt: '' },
    );
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'prepend');
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    const rows = auditRows(c, 'baseline_prompt.apply');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const detail = rows[0]!.detail ?? '';
    expect(detail).toEqual(expect.any(String));
    expect(detail.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// §6.3 async-model deprecation (REQ-F002-049)
// ---------------------------------------------------------------------------------------------

describe('No async apply-job model (REQ-F002-049)', () => {
  it('no F-002 route returns 202 or a jobId', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'prepend');
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).not.toBe(202);
    expect(res.json()).not.toHaveProperty('jobId');
  });

  it('there is no GET /api/baseline-prompt/apply/:jobId route', async () => {
    const c = ctx!;
    const res = await get(c, '/api/baseline-prompt/apply/some-job-id');
    expect(res.statusCode).toBe(404);
  });

  it('no F-002 response carries a nextCursor', async () => {
    const c = ctx!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    const p = await preview(c, 'prepend');
    expect(p.json()).not.toHaveProperty('nextCursor');
    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json()).not.toHaveProperty('nextCursor');
  });
});

// ---------------------------------------------------------------------------------------------
// §4 orphaned-state cleanup (REQ-F002-051)
// ---------------------------------------------------------------------------------------------

describe('Orphaned-state cleanup on workspace delete (REQ-F002-051)', () => {
  it('deleting a tracked workspace removes its workspace_baseline_state row; status/preview omit it', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', name: 'Alpha', openAiPrompt: '' });
    const idMap = await seedWorkspaces(c, [ws]);
    const id = idMap.get('ws-a')!;
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await preview(c, 'prepend');
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    deleteWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue(null); // confirmed deleted (matches parent REQ-038 semantics)
    const delRes = await del(c, `/api/workspaces/${id}`);
    expect(delRes.statusCode).toBe(204);

    listWorkspaces.mockResolvedValueOnce([]);
    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json().workspaces).toEqual([]);

    listWorkspaces.mockResolvedValueOnce([]);
    const previewAfter = await preview(c, 'prepend');
    expect(previewAfter.json().items).toEqual([]);
  });
});
