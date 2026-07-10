// F-002 §6.3/§10 non-functional bounds observable at the route level:
//   - REQ-F002-058 — synchronous bounded apply MUST use batched/bounded CONCURRENCY, not a
//     strictly serial fan-out, so wall-clock stays within the time bound. Tested behaviorally by
//     observing overlapping in-flight PATCH calls, per the spec's own *Test* clause ("verified by
//     observing overlapping in-flight PATCHes") — NOT by running a full 200-workspace/60s load
//     test in the unit suite (see tests/TEST_PLAN.md "Design notes").
//   - REQ-F002-039 — generous smoke-level latency ceilings, not a real p95 measurement (which
//     needs load-test tooling and many samples). Flagged here so these are never mistaken for a
//     load-test guarantee.
//   - REQ-F002-049 — no async job id / 202 / polling route (covered densely in
//     baseline-prompt.routes.test.ts; a single confirming smoke assertion is included here for
//     completeness alongside the synchronous timing assertion it's paired with in the spec).
//
// Harness conventions match baseline-prompt.routes.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import type { InjectPayload, Response as LightMyRequestResponse } from 'light-my-request';
import type { EngineWorkspace } from '../../src/engine/engine-types.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

const listWorkspaces = vi.fn();
const getWorkspace = vi.fn();
const updateWorkspaceMock = vi.fn();

vi.mock('../../src/engine/adapter.js', () => ({
  engineAdapter: {
    listWorkspaces,
    getWorkspace,
    createWorkspace: vi.fn(),
    updateWorkspace: updateWorkspaceMock,
    deleteWorkspace: vi.fn(),
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

const ALL_MOCKS = [listWorkspaces, getWorkspace, updateWorkspaceMock];

function baseEngineWorkspace(overrides: Partial<EngineWorkspace> = {}): EngineWorkspace {
  return {
    id: 1,
    name: 'WS',
    slug: 'ws-a',
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

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  cookie: string;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

async function freshApp(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'baseline-perf-test-'));
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
async function post(c: Ctx, url: string, payload: InjectPayload): Promise<LightMyRequestResponse> {
  return c.app.inject({ method: 'POST', url, cookies: { [SESSION_COOKIE]: c.cookie }, payload });
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

describe('REQ-F002-058 — synchronous bounded apply uses batched/bounded CONCURRENCY, not strict serialization', () => {
  it('an apply over several seeded workspaces issues overlapping in-flight PATCH calls (not one-at-a-time)', async () => {
    const c = ctx!;
    const N = 8;
    const wss = Array.from({ length: N }, (_, i) =>
      baseEngineWorkspace({ id: i + 1, slug: `ws-${i + 1}`, openAiPrompt: '' }),
    );
    listWorkspaces.mockResolvedValueOnce(wss);
    await get(c, '/api/workspaces');
    await put(c, '/api/baseline-prompt', { text: 'B' });

    listWorkspaces.mockResolvedValue(wss);
    getWorkspace.mockImplementation(async (slug: string) => wss.find((w) => w.slug === slug)!);

    const p = await get(c, '/api/baseline-prompt/preview?mode=fill');
    expect(p.json().items).toHaveLength(N);

    // Each write artificially takes 50ms; if the fan-out were strictly serial, N writes would
    // take >= N * 50ms with NO overlap. A batched/concurrent fan-out overlaps invocations, which
    // we detect by recording [start, end] windows and checking for pairwise overlap.
    const windows: Array<[number, number]> = [];
    updateWorkspaceMock.mockImplementation(async () => {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 50));
      windows.push([start, Date.now()]);
    });
    getWorkspace.mockImplementation(async (slug: string) => ({
      ...wss.find((w) => w.slug === slug)!,
      openAiPrompt: 'B',
    }));

    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'fill',
    });
    expect(res.statusCode).toBe(200);
    expect(windows.length).toBe(N);

    const hasOverlap = windows.some(([startA, endA], i) =>
      windows.some(([startB], j) => j !== i && startB < endA && startB >= startA),
    );
    expect(hasOverlap).toBe(true);
  }, 15000);
});

describe('REQ-F002-039 — smoke-level latency ceilings (NOT a load test; see TEST_PLAN.md)', () => {
  it('preview responds well within a generous smoke budget for a small workspace set', async () => {
    const c = ctx!;
    const wss = Array.from({ length: 5 }, (_, i) =>
      baseEngineWorkspace({ id: i + 1, slug: `ws-${i + 1}`, openAiPrompt: '' }),
    );
    listWorkspaces.mockResolvedValueOnce(wss);
    await get(c, '/api/workspaces');
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue(wss);
    getWorkspace.mockImplementation(async (slug: string) => wss.find((w) => w.slug === slug)!);

    const start = Date.now();
    const res = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(200);
    // Smoke ceiling, deliberately an order of magnitude looser than the spec's p95<3000ms bound
    // (mocked engine calls are near-instant here; this only catches gross regressions/hangs).
    expect(elapsed).toBeLessThan(10000);
  });

  it('apply (write+verify per workspace) completes within a generous smoke budget', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: '' });
    listWorkspaces.mockResolvedValueOnce([ws]);
    await get(c, '/api/workspaces');
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });

    const start = Date.now();
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(10000);
  });

  it('apply is single-response synchronous, not job-based (REQ-F002-049, paired NFR)', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: '' });
    listWorkspaces.mockResolvedValueOnce([ws]);
    await get(c, '/api/workspaces');
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('appliedCount');
  });
});
