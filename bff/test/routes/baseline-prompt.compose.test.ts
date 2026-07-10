// F-002 §5 Composition Semantics — dense, example-driven matrix for the spec's #1 named
// divergence risk (self-check note, spec line ~1098): the composition function across the three
// operator-selectable modes (prepend | overwrite | fill), the cleared-baseline domain, and the
// first-apply structural remainder capture / double-prepend guard.
//
// Exercised end-to-end through GET /api/baseline-prompt/preview (which returns composedPrompt /
// composedIfPreserve / composedIfDiscard per REQ-F002-019) and POST /api/baseline-prompt/apply
// (which writes compose(...) to the engine and records the resulting remainder/hashes), since no
// pure compose() module exists to import directly — this is the documented, spec-mandated
// external contract (REQ-F002-011/012/013/014/056/057).
//
// Harness conventions match baseline-prompt.routes.test.ts (itself mirroring
// bff/test/routes/workspaces.routes.test.ts).

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
  const tmpDir = mkdtempSync(join(tmpdir(), 'baseline-compose-test-'));
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

async function seedOne(c: Ctx, ws: EngineWorkspace): Promise<string> {
  listWorkspaces.mockResolvedValueOnce([ws]);
  const res = await get(c, '/api/workspaces');
  return (res.json() as Array<{ id: string }>)[0]!.id;
}

async function previewOne(c: Ctx, ws: EngineWorkspace, mode: 'prepend' | 'overwrite' | 'fill') {
  listWorkspaces.mockResolvedValueOnce([ws]);
  getWorkspace.mockResolvedValue(ws);
  const res = await get(c, `/api/baseline-prompt/preview?mode=${mode}`);
  return res.json();
}

async function applyOne(
  c: Ctx,
  ws: EngineWorkspace,
  mode: 'prepend' | 'overwrite' | 'fill',
  postApplyEngineState: EngineWorkspace,
) {
  const p = await previewOne(c, ws, mode);
  updateWorkspaceMock.mockResolvedValue(undefined);
  getWorkspace.mockResolvedValue(postApplyEngineState);
  const res = await post(c, '/api/baseline-prompt/apply', {
    confirmToken: p.confirmToken,
    typedConfirmation: p.confirmationPhrase,
    mode,
  });
  return { previewBody: p, applyRes: res };
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
// REQ-F002-011 — prepend composition function, including the cleared-baseline domain.
// ---------------------------------------------------------------------------------------------

describe('compose(B, R, "prepend") — REQ-F002-011', () => {
  it('with a non-empty baseline and remainder, composed = baseline + SENTINEL + remainder byte-for-byte', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Answer only in French.' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Be concise.' });
    const body = await previewOne(c, ws, 'prepend');
    const item = body.items[0];
    expect(item.composedPrompt.startsWith('Be concise.')).toBe(true);
    expect(item.composedPrompt.endsWith('Answer only in French.')).toBe(true);
    // Both baseline and remainder are present verbatim, joined by SOME fixed separator (the
    // sentinel) — the middle segment is neither empty nor a naive concatenation.
    expect(item.composedPrompt).not.toBe('Be concise.Answer only in French.');
    expect(item.composedPrompt.length).toBeGreaterThan(
      'Be concise.'.length + 'Answer only in French.'.length,
    );
  });

  it('with an empty remainder, composed equals the baseline exactly', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: '' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Be concise.' });
    const body = await previewOne(c, ws, 'prepend');
    expect(body.items[0].composedPrompt).toBe('Be concise.');
  });

  it('with a cleared (null) baseline, composed equals the remainder exactly', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Workspace-specific text' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Baseline' });

    // First apply tracks the workspace and captures "Workspace-specific text" as its remainder
    // (REQ-F002-012, structural capture — no sentinel present in the original prompt).
    const p1 = await previewOne(c, ws, 'prepend');
    const composedAfterApply = p1.items[0].composedPrompt as string;
    expect(composedAfterApply.endsWith('Workspace-specific text')).toBe(true);
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composedAfterApply });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.confirmToken,
      typedConfirmation: p1.confirmationPhrase,
      mode: 'prepend',
    });

    // Clear the baseline (console-store only, zero engine writes) — the engine still holds the
    // composed value from the apply above until the next explicit apply/re-sync (REQ-F002-046).
    await c.app.inject({
      method: 'DELETE',
      url: '/api/baseline-prompt',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    // Preview against the null baseline: per REQ-F002-011's clear branch, composed = stored
    // remainder alone = "Workspace-specific text" exactly (the baseline segment + sentinel are
    // removed), regardless of what the engine currently holds.
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: composedAfterApply }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composedAfterApply });
    const res = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].composedPrompt).toBe('Workspace-specific text');
  });

  it('cleared baseline with no remainder composes to the empty string (documented explicitly by REQ-F002-011)', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: '' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Baseline' });
    // First apply tracks the workspace with an empty remainder.
    await applyOne(c, ws, 'prepend', baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Baseline' }));

    await c.app.inject({
      method: 'DELETE',
      url: '/api/baseline-prompt',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'Baseline' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Baseline' });
    const res = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].composedPrompt).toBe(''); // remainder was empty -> clear -> ""
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F002-012 — first-apply structural remainder capture & double-prepend guard.
// ---------------------------------------------------------------------------------------------

describe('First-apply remainder capture & double-prepend guard — REQ-F002-012', () => {
  it('empty/blank live prompt -> remainder is empty; composed = compose(B, "", "prepend") = B', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: '   ' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Baseline' });
    const body = await previewOne(c, ws, 'prepend');
    expect(body.items[0].composedPrompt).toBe('Baseline');
  });

  it('a plain prompt with no sentinel is captured verbatim as the remainder: composed = baseline + sentinel + "Answer only in French."', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Answer only in French.' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Baseline' });
    const body = await previewOne(c, ws, 'prepend');
    const composed = body.items[0].composedPrompt as string;
    expect(composed.startsWith('Baseline')).toBe(true);
    expect(composed.endsWith('Answer only in French.')).toBe(true);

    // Apply it, then re-read stored remainder indirectly: re-sync with an unchanged baseline
    // must reproduce the identical composed value (remainder was captured, not lost).
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: body.confirmToken,
      typedConfirmation: body.confirmationPhrase,
      mode: 'prepend',
    });

    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: composed }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed });
    const status = await get(c, '/api/baseline-prompt/status');
    expect(status.json().workspaces[0].syncState).toBe('synced');
  });

  it('a prompt already composed as B_old + SENTINEL + Y yields composed = B_new + SENTINEL + Y (never a doubled baseline), with stored remainder Y', async () => {
    const c = ctx!;
    // Establish the REAL sentinel by doing one real first-apply cycle first.
    const seedWs = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Y-part' });
    await seedOne(c, seedWs);
    await put(c, '/api/baseline-prompt', { text: 'OldBaseline' });
    const firstPreview = await previewOne(c, seedWs, 'prepend');
    const composedOld = firstPreview.items[0].composedPrompt as string; // = OldBaseline + SENTINEL + Y-part
    expect(composedOld.startsWith('OldBaseline')).toBe(true);
    expect(composedOld.endsWith('Y-part')).toBe(true);

    // Apply it so the engine now holds the already-composed value.
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...seedWs, openAiPrompt: composedOld });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: firstPreview.confirmToken,
      typedConfirmation: firstPreview.confirmationPhrase,
      mode: 'prepend',
    });

    // Simulate "lost/rebuilt state row" (REQ-F002-012's own named scenario): wipe the console's
    // tracking row for this workspace so the NEXT apply is treated as a fresh first-apply against
    // an engine prompt that is ALREADY composed (contains SENTINEL).
    c.db.exec(`DELETE FROM workspace_baseline_state WHERE workspace_id IS NOT NULL`);

    await put(c, '/api/baseline-prompt', { text: 'NewBaseline' });
    listWorkspaces.mockResolvedValueOnce([{ ...seedWs, openAiPrompt: composedOld }]);
    getWorkspace.mockResolvedValue({ ...seedWs, openAiPrompt: composedOld });
    const secondPreview = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    const composedNew = secondPreview.json().items[0].composedPrompt as string;

    // Must start with the NEW baseline and end with "Y-part" — and must NOT contain the OLD
    // baseline text anywhere (that would indicate a doubled/undiscarded prior baseline segment).
    expect(composedNew.startsWith('NewBaseline')).toBe(true);
    expect(composedNew.endsWith('Y-part')).toBe(true);
    expect(composedNew.includes('OldBaseline')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F002-013 / REQ-F002-014 — recomposition on baseline change; no silent remainder mutation.
// ---------------------------------------------------------------------------------------------

describe('Recomposition on baseline change — REQ-F002-013/014', () => {
  it('changing the baseline and re-syncing in prepend mode updates the baseline segment while leaving the remainder segment byte-identical', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'MyRemainder' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'B1' });
    const p1 = await previewOne(c, ws, 'prepend');
    const composed1 = p1.items[0].composedPrompt as string;
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.confirmToken,
      typedConfirmation: p1.confirmationPhrase,
      mode: 'prepend',
    });

    await put(c, '/api/baseline-prompt', { text: 'B2' });
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: composed1 }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    const p2 = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    const composed2 = p2.json().items[0].composedPrompt as string;

    expect(composed2.startsWith('B2')).toBe(true);
    expect(composed2.endsWith('MyRemainder')).toBe(true);
    // The remainder segment (suffix) is unchanged between the two composed strings.
    expect(composed1.endsWith('MyRemainder')).toBe(true);
    const suffixLen = 'MyRemainder'.length;
    expect(composed2.slice(-suffixLen)).toBe(composed1.slice(-suffixLen));
  });

  it('a baseline-only change followed by re-sync leaves every stored remainder unchanged (no side-effect mutation)', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'StableRemainder' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'B1' });
    const p1 = await previewOne(c, ws, 'prepend');
    const composed1 = p1.items[0].composedPrompt as string;
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.confirmToken,
      typedConfirmation: p1.confirmationPhrase,
      mode: 'prepend',
    });

    // Track the actual last-applied composed value across iterations (not the B1-composed
    // `composed1` captured before the loop) so each iteration's live-prompt mock reflects what the
    // PRIOR iteration's apply actually verified as written. Feeding a stale value here makes
    // hash(P) != applied_composed_hash, which — per the REQ-F002-023 precedence rule — collapses
    // classification to `overridden` (composedPrompt == null) instead of the intended `stale`.
    let lastApplied = composed1;
    for (const nextBaseline of ['B2', 'B3']) {
      await put(c, '/api/baseline-prompt', { text: nextBaseline });
      listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: lastApplied }]);
      getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: lastApplied });
      const p = await get(c, '/api/baseline-prompt/preview?mode=prepend');
      const composed = p.json().items[0].composedPrompt as string;
      expect(composed.endsWith('StableRemainder')).toBe(true);
      getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed });
      await post(c, '/api/baseline-prompt/apply', {
        confirmToken: p.json().confirmToken,
        typedConfirmation: p.json().confirmationPhrase,
        mode: 'prepend',
      });
      lastApplied = composed;
    }
  });

  it('the same re-sync in overwrite mode writes the new baseline alone', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Whatever was here' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'B1' });
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B1' });
    const p1 = await previewOne(c, ws, 'overwrite');
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.confirmToken,
      typedConfirmation: p1.confirmationPhrase,
      mode: 'overwrite',
    });

    await put(c, '/api/baseline-prompt', { text: 'B2' });
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'B1' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'B1' });
    const p2 = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    expect(p2.json().items[0].composedPrompt).toBe('B2');
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F002-056 — overwrite mode.
// ---------------------------------------------------------------------------------------------

describe('compose(B, R, "overwrite") — REQ-F002-056', () => {
  it('with a non-empty baseline, composed equals the baseline exactly (no sentinel, no remainder) regardless of the prior prompt, and the stored remainder is emptied', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Some elaborate prior prompt that should be destroyed' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Overwritten baseline' });
    const p = await previewOne(c, ws, 'overwrite');
    expect(p.items[0].composedPrompt).toBe('Overwritten baseline');

    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Overwritten baseline' });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.confirmToken,
      typedConfirmation: p.confirmationPhrase,
      mode: 'overwrite',
    });
    const [, bodyArg] = updateWorkspaceMock.mock.calls[0]!;
    expect(bodyArg).toEqual({ openAiPrompt: 'Overwritten baseline' });

    // Remainder emptied: a follow-up prepend-mode preview (hypothetically) would show no
    // preserved remainder — verified indirectly via a re-sync in prepend mode producing the
    // baseline alone (empty stored remainder), not baseline+sentinel+anything.
    await put(c, '/api/baseline-prompt', { text: 'Next baseline' });
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: 'Overwritten baseline' }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: 'Overwritten baseline' });
    const p2 = await get(c, '/api/baseline-prompt/preview?mode=prepend');
    expect(p2.json().items[0].composedPrompt).toBe('Next baseline');
  });

  it('with a cleared (null) baseline, composed = R (clear-then-apply strips the field regardless of mode)', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Original remainder text' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'B' });
    // Track it first via prepend so a remainder is stored.
    const p1 = await previewOne(c, ws, 'prepend');
    const composed1 = p1.items[0].composedPrompt as string;
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.confirmToken,
      typedConfirmation: p1.confirmationPhrase,
      mode: 'prepend',
    });

    await c.app.inject({
      method: 'DELETE',
      url: '/api/baseline-prompt',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    listWorkspaces.mockResolvedValueOnce([{ ...ws, openAiPrompt: composed1 }]);
    getWorkspace.mockResolvedValue({ ...ws, openAiPrompt: composed1 });
    const p2 = await get(c, '/api/baseline-prompt/preview?mode=overwrite');
    expect(p2.json().items[0].composedPrompt).toBe('Original remainder text');
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F002-057 — fill mode.
// ---------------------------------------------------------------------------------------------

describe('compose(B, R, "fill") — REQ-F002-057', () => {
  it('a workspace with an empty prompt receives the baseline alone', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: '' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Fill baseline' });
    const p = await previewOne(c, ws, 'fill');
    expect(p.items[0].composedPrompt).toBe('Fill baseline');
    expect(p.items[0].willChange).toBe(true);
  });

  it('a workspace with any existing prompt is skipped and its engine prompt is unchanged', async () => {
    const c = ctx!;
    const ws = baseEngineWorkspace({ slug: 'ws-a', openAiPrompt: 'Already has content' });
    await seedOne(c, ws);
    await put(c, '/api/baseline-prompt', { text: 'Fill baseline' });
    const p = await previewOne(c, ws, 'fill');
    expect(p.items[0].willChange).toBe(false);

    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p.confirmToken,
      typedConfirmation: p.confirmationPhrase,
      mode: 'fill',
    });
    expect(res.json().items[0].outcome).toBe('skipped');
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('an apply whose baseline is null in fill mode writes nothing — every workspace is skipped', async () => {
    const c = ctx!;
    const ws1 = baseEngineWorkspace({ slug: 'ws-1', openAiPrompt: '' });
    const ws2 = baseEngineWorkspace({ id: 2, slug: 'ws-2', openAiPrompt: 'x' });
    // Track both via a real apply first so they're eligible for a cleared-baseline apply.
    listWorkspaces.mockResolvedValueOnce([ws1, ws2]);
    await get(c, '/api/workspaces');
    await put(c, '/api/baseline-prompt', { text: 'Temp' });
    listWorkspaces.mockResolvedValue([ws1, ws2]);
    getWorkspace.mockImplementation(async (slug: string) => (slug === 'ws-1' ? ws1 : ws2));
    const p1 = await get(c, '/api/baseline-prompt/preview?mode=fill');
    updateWorkspaceMock.mockResolvedValue(undefined);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-1' ? { ...ws1, openAiPrompt: 'Temp' } : ws2,
    );
    await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p1.json().confirmToken,
      typedConfirmation: p1.json().confirmationPhrase,
      mode: 'fill',
    });
    updateWorkspaceMock.mockClear();

    await c.app.inject({
      method: 'DELETE',
      url: '/api/baseline-prompt',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    listWorkspaces.mockResolvedValueOnce([{ ...ws1, openAiPrompt: 'Temp' }, ws2]);
    getWorkspace.mockImplementation(async (slug: string) =>
      slug === 'ws-1' ? { ...ws1, openAiPrompt: 'Temp' } : ws2,
    );
    const p2 = await get(c, '/api/baseline-prompt/preview?mode=fill');
    for (const item of p2.json().items) {
      expect(item.willChange).toBe(false);
    }

    const res = await post(c, '/api/baseline-prompt/apply', {
      confirmToken: p2.json().confirmToken,
      typedConfirmation: p2.json().confirmationPhrase,
      mode: 'fill',
    });
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
    for (const item of res.json().items) {
      expect(item.outcome).toBe('skipped');
    }
  });
});
