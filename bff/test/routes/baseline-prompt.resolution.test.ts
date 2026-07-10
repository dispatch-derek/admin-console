// F-002 highest-risk areas named by the spec's own priority list:
//   1. REQ-F002-059 — per-workspace effective-mode resolution (stored composition_mode vs
//      operator-selected mode precedence; F-003's append/inherit mapping onto prepend/
//      baseline-only; NULL/backward-compat fallback; out-of-domain stored-value defense).
//   2. REQ-F002-023 — sync-state classification (classifyMode-only, NEVER resolvedMode; the
//      explicit first-match-wins precedence order; the worked stale-vs-overridden example).
//   3. REQ-F002-047 — token staleness vs per-workspace divergence, including the mode-change
//      divergence check compared in RESOLVED-BRANCH vocabulary, not the raw F-003 string.
//
// F-003 is unbuilt in this repo (companion spec), so these tests simulate its ONLY contractual
// surface with F-002 (REQ-F002-010d): writing a non-null `composition_mode` value directly onto
// the shared `workspace_baseline_state` row via raw SQL, exactly as F-003's editor-save path
// would (F-003 REQ-F003-023 step 4). F-002 code must only ever READ this column.
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'baseline-resolution-test-'));
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

async function seedWorkspaces(c: Ctx, wss: EngineWorkspace[]): Promise<Map<string, string>> {
  listWorkspaces.mockResolvedValueOnce(wss);
  const res = await get(c, '/api/workspaces');
  const body = res.json() as Array<{ id: string }>;
  const bySlug = new Map<string, string>();
  for (let i = 0; i < wss.length; i++) bySlug.set(wss[i]!.slug, body[i]!.id);
  return bySlug;
}

// Simulates F-003 writing a stored composition_mode onto the shared row (REQ-F002-010d). If no
// row exists yet for the workspace, one is created with an empty remainder (an F-003-tracked
// workspace that F-002 has not yet applied to — F-003 owns creating/writing this row itself; we
// model the row shape it would produce).
function stampCompositionMode(c: Ctx, workspaceId: string, mode: 'append' | 'inherit' | 'override' | null): void {
  const existing = c.db
    .prepare(`SELECT workspace_id FROM workspace_baseline_state WHERE workspace_id = ?`)
    .get(workspaceId);
  if (existing) {
    c.db
      .prepare(`UPDATE workspace_baseline_state SET composition_mode = ? WHERE workspace_id = ?`)
      .run(mode, workspaceId);
  } else {
    c.db
      .prepare(
        `INSERT INTO workspace_baseline_state
           (workspace_id, remainder, applied_composed_hash, applied_baseline_hash, applied_at, composition_mode)
         VALUES (?, NULL, NULL, NULL, NULL, ?)`,
      )
      .run(workspaceId, mode);
  }
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
// REQ-F002-059 — per-workspace effective-mode resolution, worked cases (a)-(f) from the spec.
// ---------------------------------------------------------------------------------------------

describe('REQ-F002-059 — per-workspace composition-mode resolution', () => {
  it('(a) with F-003 absent (no stored composition_mode anywhere) an apply behaves identically to rev 3: every workspace composed under the operator-selected mode', async () => {
    const c = ctx!;
    const ws1 = baseEngineWorkspace({ id: 1, slug: 'ws-1', openAiPrompt: 'x' });
    const ws2 = baseEngineWorkspace({ id: 2, slug: 'ws-2', openAiPrompt: 'y' });
    await seedWorkspaces(c, [ws1, ws2]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws1, ws2]);
    getWorkspace.mockImplementation(async (slug: string) => (slug === 'ws-1' ? ws1 : ws2));

    const res = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    const items = res.json().items as Array<{ resolvedMode: string; composedPrompt: string }>;
    for (const item of items) {
      expect(item.resolvedMode).toBe('overwrite');
      expect(item.composedPrompt).toBe('B');
    }
  });

  it('(b) a workspace whose stored composition_mode is "append" keeps its append/prepend composition after a customer-wide apply whose operator-selected mode was "overwrite"; engine value is compose(B, remainder, prepend), and the stored remainder is preserved (not emptied)', async () => {
    const c = ctx!;
    const trackedWs = baseEngineWorkspace({ id: 1, slug: 'ws-tracked', openAiPrompt: 'AppendRemainder' });
    const untouchedWs = baseEngineWorkspace({ id: 2, slug: 'ws-untouched', openAiPrompt: 'anything' });
    const idMap = await seedWorkspaces(c, [trackedWs, untouchedWs]);
    const trackedId = idMap.get('ws-tracked')!;

    stampCompositionMode(c, trackedId, 'append');
    await put(c, '/api/baseline-prompt', { text: 'CustomerWideBaseline' });

    listWorkspaces.mockResolvedValue([trackedWs, untouchedWs]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-tracked' ? trackedWs : untouchedWs,
    );

    const res = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    const items = res.json().items as Array<{
      workspaceId: string;
      resolvedMode: string;
      composedPrompt: string;
    }>;
    const trackedItem = items.find((i) => i.workspaceId === trackedId)!;
    expect(trackedItem.resolvedMode).toBe('prepend'); // NOT 'overwrite'
    expect(trackedItem.composedPrompt).not.toBe('CustomerWideBaseline'); // not destructively replaced
    expect(trackedItem.composedPrompt.startsWith('CustomerWideBaseline')).toBe(true);
    expect(trackedItem.composedPrompt.endsWith('AppendRemainder')).toBe(true);

    // Verify the write on apply.
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-tracked'
        ? { ...trackedWs, openAiPrompt: trackedItem.composedPrompt }
        : { ...untouchedWs, openAiPrompt: 'CustomerWideBaseline' },
    );
    const apply = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: res.json().confirmToken,
      typedConfirmation: res.json().confirmationPhrase,
      mode: 'overwrite',
    });
    expect(apply.statusCode).toBe(200);
    const writeCall = updateWorkspaceMock.mock.calls.find((call) => call[0] === 'ws-tracked')!;
    expect(writeCall[1]).toEqual({ openAiPrompt: trackedItem.composedPrompt });

    // Stored remainder preserved (not emptied) — a subsequent baseline change + re-sync should
    // still carry "AppendRemainder" as the suffix.
    await put(c, '/api/baseline-prompt', { text: 'NextBaseline' });
    listWorkspaces.mockResolvedValueOnce([
      { ...trackedWs, openAiPrompt: trackedItem.composedPrompt },
      { ...untouchedWs, openAiPrompt: 'CustomerWideBaseline' },
    ]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-tracked'
        ? { ...trackedWs, openAiPrompt: trackedItem.composedPrompt }
        : { ...untouchedWs, openAiPrompt: 'CustomerWideBaseline' },
    );
    const res2 = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    const trackedItem2 = (res2.json().items as Array<{ workspaceId: string; composedPrompt: string }>).find(
      (i) => i.workspaceId === trackedId,
    )!;
    expect(trackedItem2.composedPrompt.endsWith('AppendRemainder')).toBe(true);
  });

  it('(c) a never-touched-by-F-003 workspace in that same apply uses the operator-selected overwrite and is replaced by B', async () => {
    const c = ctx!;
    const trackedWs = baseEngineWorkspace({ id: 1, slug: 'ws-tracked', openAiPrompt: 'R' });
    const untouchedWs = baseEngineWorkspace({ id: 2, slug: 'ws-untouched', openAiPrompt: 'anything' });
    const idMap = await seedWorkspaces(c, [trackedWs, untouchedWs]);
    stampCompositionMode(c, idMap.get('ws-tracked')!, 'append');
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([trackedWs, untouchedWs]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-tracked' ? trackedWs : untouchedWs,
    );
    const res = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    const items = res.json().items as Array<{ workspaceId: string; resolvedMode: string; composedPrompt: string }>;
    const untouchedItem = items.find((i) => i.workspaceId === idMap.get('ws-untouched'))!;
    expect(untouchedItem.resolvedMode).toBe('overwrite');
    expect(untouchedItem.composedPrompt).toBe('B');
  });

  it('(d) a workspace with stored composition_mode = "inherit" receives effective B (baseline alone) with its stored remainder retained', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'PriorContent' });
    const idMap = await seedWorkspaces(c, [ws]);
    stampCompositionMode(c, idMap.get('ws-a')!, 'inherit');
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const res = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    const item = res.json().items[0];
    expect(item.resolvedMode).toBe('baseline-only');
    expect(item.composedPrompt).toBe('B');
    // No preserve/discard candidates on the baseline-only branch (REQ-F002-019/050).
    expect(item.composedIfPreserve).toBeUndefined();
    expect(item.composedIfDiscard).toBeUndefined();
  });

  it('(e) changing a workspace stored composition_mode after preview marks that workspace diverged with no write while the rest apply', async () => {
    const c = ctx!;
    const ws1 = baseEngineWorkspace({ id: 1, slug: 'ws-1', openAiPrompt: 'r1' });
    const ws2 = baseEngineWorkspace({ id: 2, slug: 'ws-2', openAiPrompt: 'r2' });
    const idMap = await seedWorkspaces(c, [ws1, ws2]);
    const id1 = idMap.get('ws-1')!;
    stampCompositionMode(c, id1, 'append'); // resolves to 'prepend'
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws1, ws2]);
    getWorkspace.mockImplementation(async (slug: string) => (slug === 'ws-1' ? ws1 : ws2));
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');

    // Out-of-band F-003 save changes ws-1's stored mode to 'inherit' -> resolves to
    // 'baseline-only', a DIFFERENT branch than the previewed 'prepend'.
    stampCompositionMode(c, id1, 'inherit');

    // ws-2 is untracked (no stored composition_mode), so it resolves to the operator-default
    // 'prepend' and, on this first apply, structurally captures its non-empty live prompt ('r2')
    // as its remainder (REQ-F002-012) — its correct write is compose('B', 'r2', 'prepend'), NOT
    // the bare baseline. The write+verify read-back must match that value (parent REQ-028,
    // REQ-F002-022 byte-exact verify-after-write — see the sibling REQ-F002-022 test) or ws-2
    // would be (incorrectly) reported 'failed' instead of 'applied'. Derive it from the preview's
    // own composedPrompt rather than hardcoding the sentinel.
    const ws2ComposedPrompt = (
      p.json().items as Array<{ workspaceId: string; composedPrompt: string | null }>
    ).find((i) => i.workspaceId === idMap.get('ws-2'))!.composedPrompt as string;

    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-1' ? ws1 : { ...ws2, openAiPrompt: ws2ComposedPrompt },
    );
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(200); // whole-apply token not invalidated
    const items = res.json().items as Array<{ workspaceId: string; outcome: string }>;
    expect(items.find((i) => i.workspaceId === id1)!.outcome).toBe('diverged');
    expect(items.find((i) => i.workspaceId === idMap.get('ws-2'))!.outcome).toBe('applied');
    expect(updateWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-2', expect.anything());
  });

  it('a stored-mode change that maps to the SAME resolved branch as the snapshot is NOT divergent — the write proceeds normally', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'R' });
    const idMap = await seedWorkspaces(c, [ws]);
    const id = idMap.get('ws-a')!;
    // Un-stored (NULL) -> resolves to operator default 'prepend' at preview time.
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    const previewedComposed = p.json().items[0].composedPrompt as string;

    // Out-of-band: an operator-default prepend row gains an explicit composition_mode='append',
    // which ALSO resolves to 'prepend' — same branch, same byte-identical write.
    stampCompositionMode(c, id, 'append');

    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: previewedComposed });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].outcome).toBe('applied'); // NOT diverged
    expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-a', { openAiPrompt: previewedComposed });
  });

  it('(f) a workspace bearing an out-of-domain stored composition_mode (e.g. "override") resolves via the NULL fallback to the operator-selected mode and never reaches the destructive overwrite branch through the stored-mode path', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'R' });
    const idMap = await seedWorkspaces(c, [ws]);
    stampCompositionMode(c, idMap.get('ws-a')!, 'override'); // F-003 would never write this
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);

    // Operator selects 'fill' as the default for un-stored/out-of-domain workspaces — since this
    // is out-of-domain, it must fall back to the operator mode, i.e. 'fill' here (NOT overwrite,
    // and specifically never selecting F-002's destructive overwrite branch via the stored value).
    const res = await get(c, '/api/baseline-prompt/preview?mode=fill');
    const item = res.json().items[0];
    expect(item.resolvedMode).toBe('fill');
    expect(item.resolvedMode).not.toBe('overwrite');
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F002-023 — sync-state classification (classifyMode-only; first-match-wins precedence).
// ---------------------------------------------------------------------------------------------

describe('REQ-F002-023 — sync-state classification precedence', () => {
  it('never-applied — no workspace_baseline_state row', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'anything' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValueOnce([ws]);
    getWorkspace.mockResolvedValue(ws);
    const res = await get(c, '/api/baseline-prompt/status');
    expect(res.json().workspaces[0].syncState).toBe('never-applied');
  });

  it('synced — an untouched, current workspace', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'B' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json().workspaces[0].syncState).toBe('synced');
  });

  it('overridden — out-of-band edit matching neither the current reconstruction nor the last-applied hash', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    // Out-of-band edit AFTER apply, to a value that is neither the current reconstruction (still
    // "B", baseline unchanged) NOR the last-applied hash's value ("B").
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'Something totally different' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Something totally different' });
    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json().workspaces[0].syncState).toBe('overridden');
  });

  it('stale — unchanged since apply but the baseline was edited afterward', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'OldB' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'OldB' });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    await put(c, '/api/baseline-prompt', { text: 'NewB' });
    // Live prompt UNCHANGED since apply — still exactly "OldB".
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'OldB' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'OldB' });
    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json().workspaces[0].syncState).toBe('stale');
  });

  it('worked example (rev 8): a workspace last written under operator overwrite/fill, unedited since, whose baseline then changes, reports STALE (hash(P) == applied_composed_hash), NOT overridden — precedence rule', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'anything to be overwritten' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'OldB' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    updateWorkspaceMock.mockResolvedValue(undefined);
    // Apply under operator OVERWRITE — this untracked (NULL composition_mode) row now carries an
    // EMPTY remainder and applied_composed_hash = hash("OldB").
    const p = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'OldB' });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'overwrite',
    });

    // Baseline changes OldB -> NewB. Live prompt is UNEDITED since apply (still exactly "OldB").
    await put(c, '/api/baseline-prompt', { text: 'NewB' });
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'OldB' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'OldB' });
    const status = await get(c, '/api/baseline-prompt/status');
    // classifyMode for a NULL row is 'prepend' -> effective(NewB, "", 'prepend') = NewB != "OldB",
    // so NOT synced. But hash(P) == hash("OldB") == applied_composed_hash, so step 3 fires first:
    // STALE, never overridden.
    expect(status.json().workspaces[0].syncState).toBe('stale');
  });

  it('a baseline-only/inherit workspace carrying a non-empty retained remainder whose live prompt equals B reports synced, not overridden', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'OriginalContent' });
    const idMap = await seedWorkspaces(c, [ws]);
    const id = idMap.get('ws-a')!;
    stampCompositionMode(c, id, 'inherit');
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    updateWorkspaceMock.mockResolvedValue(undefined);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    expect(p.json().items[0].composedPrompt).toBe('B');
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });

    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'B' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B' });
    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json().workspaces[0].syncState).toBe('synced');
    expect(status.json().workspaces[0].hasWorkspaceRemainder).toBe(true); // retained, not emptied
  });

  it('classification uses classifyMode only — the status surface has no operator mode and never consults resolvedMode (varying the operator would-be mode does not change the classification)', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'x' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValueOnce([ws]);
    getWorkspace.mockResolvedValue(ws);
    const status = await get(c, '/api/baseline-prompt/status');
    // The status route accepts no `mode` query param at all (bare read, REQ-F002-023/024); a
    // caller passing one must not change results.
    listWorkspaces.mockResolvedValueOnce([ws]);
    getWorkspace.mockResolvedValue(ws);
    const statusWithBogusMode = await get(c, '/api/baseline-prompt/status?mode=overwrite');
    expect(statusWithBogusMode.json().workspaces[0].syncState).toBe(status.json().workspaces[0].syncState);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F002-047 — token staleness vs per-workspace divergence (mode-independent per-item check).
// ---------------------------------------------------------------------------------------------

describe('REQ-F002-047 — divergence is mode-independent across prepend/overwrite/fill', () => {
  it('prepend: a changed live prompt since preview means the previewed replacement no longer matches reality -> diverged', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'original' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'changed out of band' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'prepend',
    });
    expect(res.json().items[0].outcome).toBe('diverged');
  });

  it('overwrite: a changed live prompt since preview means the previewed destruction no longer matches reality -> diverged', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'original' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'changed out of band' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'overwrite',
    });
    expect(res.json().items[0].outcome).toBe('diverged');
  });

  it('fill: a workspace previewed as empty-and-writable that is now non-empty -> diverged (not silently filled)', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: '' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await get(c, '/api/baseline-prompt/preview?mode=fill');
    expect(p.json().items[0].willChange).toBe(true);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'now has content' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'fill',
    });
    expect(res.json().items[0].outcome).toBe('diverged');
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('fill: a workspace previewed as non-empty-and-skipped stays skipped even if edited further out-of-band', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ id: 1, slug: 'ws-a', openAiPrompt: 'already has content' });
    await seedWorkspaces(c, [ws]);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    listWorkspaces.mockResolvedValue([ws]);
    getWorkspace.mockResolvedValue(ws);
    const p = await get(c, '/api/baseline-prompt/preview?mode=fill');
    expect(p.json().items[0].willChange).toBe(false);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'edited again, still non-empty' });
    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.json().confirmToken,
      typedConfirmation: p.json().confirmationPhrase,
      mode: 'fill',
    });
    expect(res.json().items[0].outcome).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F002-031 — destructive blast-radius count: union of resolvedMode=overwrite plus overridden
// baseline-only workspaces. This is the server-observable half of a UI danger-dialog requirement:
// the preview response supplies exactly the per-workspace data (`resolvedMode`, `syncState`) the
// dialog's blast-radius count must be computed FROM, so this suite pins that data is correct and
// leaves rendering the count itself to a UI-level check (see TEST_PLAN.md).
// ---------------------------------------------------------------------------------------------

describe('REQ-F002-031 — destructive blast-radius union (preview data feeding the danger dialog)', () => {
  function destructiveBlastRadius(
    items: Array<{ resolvedMode: string; syncState: string }>,
  ): number {
    // Mirrors the spec's stated union exactly: (a) resolvedMode === 'overwrite', plus
    // (b) resolvedMode === 'baseline-only' AND syncState === 'overridden'.
    return items.filter(
      (i) => i.resolvedMode === 'overwrite' || (i.resolvedMode === 'baseline-only' && i.syncState === 'overridden'),
    ).length;
  }

  it('counts every resolvedMode=overwrite workspace and every overridden baseline-only workspace, and nothing else', async () => {
    const c = ctx!;
    // ws-overwrite: untracked, operator selects overwrite -> resolvedMode overwrite (destructive).
    const wsOverwrite = baseEngineWorkspace({ id: 1, slug: 'ws-overwrite', openAiPrompt: 'content A' });
    // ws-append: stored append -> resolvedMode prepend, non-destructive even under operator overwrite.
    const wsAppend = baseEngineWorkspace({ id: 2, slug: 'ws-append', openAiPrompt: 'content B' });
    // ws-inherit-overridden: stored inherit, currently overridden -> resolvedMode baseline-only + overridden -> destructive.
    const wsInheritOverridden = baseEngineWorkspace({ id: 3, slug: 'ws-inherit-overridden', openAiPrompt: 'drifted content' });
    // ws-inherit-synced: stored inherit, currently synced (live == B already) -> baseline-only but NOT overridden -> not counted.
    const wsInheritSynced = baseEngineWorkspace({ id: 4, slug: 'ws-inherit-synced', openAiPrompt: 'B' });

    const idMap = await seedWorkspaces(c, [wsOverwrite, wsAppend, wsInheritOverridden, wsInheritSynced]);
    stampCompositionMode(c, idMap.get('ws-append')!, 'append');
    stampCompositionMode(c, idMap.get('ws-inherit-overridden')!, 'inherit');
    stampCompositionMode(c, idMap.get('ws-inherit-synced')!, 'inherit');

    await put(c, '/api/baseline-prompt', { text: 'B' });
    const allWs = [wsOverwrite, wsAppend, wsInheritOverridden, wsInheritSynced];
    listWorkspaces.mockResolvedValue(allWs);
    getWorkspace.mockImplementation(async (slug: string) => allWs.find((w) => w.slug === slug)!);

    const res = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    const items = res.json().items as Array<{
      workspaceId: string;
      resolvedMode: string;
      syncState: string;
    }>;

    const overwriteItem = items.find((i) => i.workspaceId === idMap.get('ws-overwrite'))!;
    const appendItem = items.find((i) => i.workspaceId === idMap.get('ws-append'))!;
    const inheritOverriddenItem = items.find((i) => i.workspaceId === idMap.get('ws-inherit-overridden'))!;
    const inheritSyncedItem = items.find((i) => i.workspaceId === idMap.get('ws-inherit-synced'))!;

    expect(overwriteItem.resolvedMode).toBe('overwrite');
    expect(appendItem.resolvedMode).toBe('prepend');
    expect(inheritOverriddenItem.resolvedMode).toBe('baseline-only');
    expect(inheritOverriddenItem.syncState).toBe('overridden');
    expect(inheritSyncedItem.resolvedMode).toBe('baseline-only');
    expect(inheritSyncedItem.syncState).not.toBe('overridden');

    // Exactly 2 destructive: ws-overwrite (resolvedMode overwrite) + ws-inherit-overridden
    // (baseline-only AND overridden). ws-append is explicitly excluded even though the OPERATOR
    // selected overwrite (per-workspace resolution wins). ws-inherit-synced is excluded (no live
    // content to discard).
    expect(destructiveBlastRadius(items)).toBe(2);
  });
});
