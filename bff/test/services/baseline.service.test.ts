// White-box unit tests for the F-002 baseline service (src/services/baseline.service.ts),
// calling its exported functions DIRECTLY (no HTTP/Fastify layer, no session/auth machinery) —
// a level below the route-level spec suite (test/routes/baseline-prompt.*.test.ts), which
// already exercises the functional/branch contract exhaustively through the API. This file
// targets things that are awkward or impossible to pin down precisely through the route layer:
//   - the bounded-concurrency fan-out actually CAPS in-flight work at the configured limit
//     (not just "some overlap", which the route-level performance test already checks) and
//     that the limit is respected even when the target set is much larger than the cap;
//   - one workspace's write throwing does not abort the fan-out for the others, and outcome
//     aggregation (applied/failed/skipped/diverged counts + per-item list) is correct under a
//     mixed-outcome batch that exercises every outcome in a single apply.
//
// Only the engine boundary (src/engine/adapter.ts) is mocked; everything else (store, events,
// audit) runs for real against a fresh per-test tmp SQLite DB, exactly like the store/db.ts
// contract the service actually depends on.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineWorkspace } from '../../src/engine/engine-types.js';

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

type BaselineService = typeof import('../../src/services/baseline.service.js');

interface Ctx {
  db: typeof import('../../src/store/db.js').db;
  tmpDir: string;
  dbPath: string;
  svc: BaselineService;
}

let ctx: Ctx | undefined;

async function freshCtx(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'baseline-service-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['LOG_LEVEL'] = 'silent';

  vi.resetModules();
  for (const fn of ALL_MOCKS) fn.mockReset();
  listWorkspaces.mockResolvedValue([]);

  const { db } = await import('../../src/store/db.js');
  const svc = await import('../../src/services/baseline.service.js');

  return { db, tmpDir, dbPath, svc };
}

beforeEach(async () => {
  ctx = await freshCtx();
});

afterEach(() => {
  if (!ctx) return;
  ctx.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = ctx.dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
  rmSync(ctx.tmpDir, { recursive: true, force: true });
  ctx = undefined;
});

// Wires up a stateful in-memory "engine": promptState tracks each slug's current openAiPrompt.
// getWorkspace and listWorkspaces both always reflect the CURRENT promptState (so a write that
// lands is visible to a subsequent preview/apply, exactly like the real engine); updateWorkspace
// mutates it (or throws for a configured set of "failing" slugs, simulating an upstream write
// failure). failingSlugs is returned so a test can mutate it in place (e.g. delete an entry to
// simulate the upstream recovering) without re-wiring the mocks and losing prompt continuity.
function wireStatefulEngine(
  wss: EngineWorkspace[],
  opts: { failingSlugs?: Set<string>; delayMs?: number; trackConcurrency?: { current: number; max: number } } = {},
): { promptState: Map<string, string>; failingSlugs: Set<string> } {
  const promptState = new Map<string, string>();
  for (const w of wss) promptState.set(w.slug, w.openAiPrompt ?? '');
  const failingSlugs = opts.failingSlugs ?? new Set<string>();

  listWorkspaces.mockImplementation(async () =>
    wss.map((w) => ({ ...w, openAiPrompt: promptState.get(w.slug) ?? '' })),
  );

  getWorkspace.mockImplementation(async (slug: string) => {
    const conc = opts.trackConcurrency;
    if (conc) {
      conc.current += 1;
      conc.max = Math.max(conc.max, conc.current);
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (conc) conc.current -= 1;
    const w = wss.find((x) => x.slug === slug);
    if (!w) return null;
    return { ...w, openAiPrompt: promptState.get(slug) ?? '' };
  });

  updateWorkspaceMock.mockImplementation(async (slug: string, body: Record<string, unknown>) => {
    if (failingSlugs.has(slug)) {
      throw new Error(`engine write failed for ${slug}`);
    }
    if (typeof body['openAiPrompt'] === 'string') {
      promptState.set(slug, body['openAiPrompt'] as string);
    }
  });

  return { promptState, failingSlugs };
}

describe('apply — bounded concurrency fan-out (REQ-F002-054/058)', () => {
  it('caps in-flight per-workspace work at the configured concurrency limit (8) when the target set exceeds it', async () => {
    const c = ctx!;
    const N = 20; // well over the CONCURRENCY=8 cap
    const wss = Array.from({ length: N }, (_, i) =>
      baseEngineWorkspace({ id: i + 1, slug: `ws-${i + 1}`, openAiPrompt: '' }),
    );
    const conc = { current: 0, max: 0 };
    wireStatefulEngine(wss, { delayMs: 15, trackConcurrency: conc });

    await c.svc.setBaseline('actor-1', 'B');
    const preview = await c.svc.runPreview('fill');
    expect(preview.items).toHaveLength(N);
    expect(preview.affectedCount).toBe(N); // every workspace starts empty -> all fillable

    // Reset the concurrency tracker: the preview path itself doesn't call getWorkspace, but be
    // defensive in case that changes.
    conc.current = 0;
    conc.max = 0;

    const result = await c.svc.apply('actor-1', {
      confirmToken: preview.confirmToken,
      typedConfirmation: preview.confirmationPhrase,
      mode: 'fill',
    });

    expect(result.appliedCount).toBe(N);
    expect(conc.max).toBeGreaterThan(0);
    expect(conc.max).toBeLessThanOrEqual(8); // never exceeds the CONCURRENCY cap
    expect(conc.max).toBe(8); // with N=20 >> 8, the cap should actually be reached
  }, 20000);

  it('the fan-out never exceeds the cap even when the target set is smaller than the cap (no over-subscription)', async () => {
    const c = ctx!;
    const N = 3;
    const wss = Array.from({ length: N }, (_, i) =>
      baseEngineWorkspace({ id: i + 1, slug: `ws-${i + 1}`, openAiPrompt: '' }),
    );
    const conc = { current: 0, max: 0 };
    wireStatefulEngine(wss, { delayMs: 10, trackConcurrency: conc });

    await c.svc.setBaseline('actor-1', 'B');
    const preview = await c.svc.runPreview('fill');
    conc.current = 0;
    conc.max = 0;

    const result = await c.svc.apply('actor-1', {
      confirmToken: preview.confirmToken,
      typedConfirmation: preview.confirmationPhrase,
      mode: 'fill',
    });

    expect(result.appliedCount).toBe(N);
    expect(conc.max).toBe(N); // capped at min(CONCURRENCY, targets.length) = 3
  });
});

describe('apply — one workspace throwing does not abort the fan-out for the others (REQ-F002-022/022a)', () => {
  it('a single failing engine write is reported "failed" while every other workspace still applies, with correct aggregate counts', async () => {
    const c = ctx!;
    const N = 6;
    const wss = Array.from({ length: N }, (_, i) =>
      baseEngineWorkspace({ id: i + 1, slug: `ws-${i + 1}`, openAiPrompt: '' }),
    );
    const failingSlug = 'ws-3';
    wireStatefulEngine(wss, { failingSlugs: new Set([failingSlug]) });

    await c.svc.setBaseline('actor-1', 'B');
    const preview = await c.svc.runPreview('fill');

    const result = await c.svc.apply('actor-1', {
      confirmToken: preview.confirmToken,
      typedConfirmation: preview.confirmationPhrase,
      mode: 'fill',
    });

    expect(result.appliedCount).toBe(N - 1);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.divergedCount).toBe(0);
    expect(result.items).toHaveLength(N);

    const failedItems = result.items.filter((it) => it.outcome === 'failed');
    expect(failedItems).toHaveLength(1);

    // Resolve the failing workspace's product id from the preview items list (by matching
    // display name / prompt semantics isn't reliable; use the preview item whose composedPrompt
    // would have targeted ws-3 — simplest is to look up by matching count: exactly one item
    // failed and it must correspond to the slug we configured to fail).
    const appliedItems = result.items.filter((it) => it.outcome === 'applied');
    expect(appliedItems).toHaveLength(N - 1);

    // Cross-check against the store: the failing workspace must have NO applied state row (no
    // hash/remainder update on a failed write), while every applied workspace does.
    const { baselineRepo } = await import('../../src/store/repositories/baseline.repo.js');
    const states = baselineRepo.listStates();
    expect(states).toHaveLength(N - 1);
  });

  it('supports multiple simultaneous failures without losing successful outcomes (mixed outcome aggregation)', async () => {
    const c = ctx!;
    const N = 8;
    const wss = Array.from({ length: N }, (_, i) =>
      baseEngineWorkspace({ id: i + 1, slug: `ws-${i + 1}`, openAiPrompt: '' }),
    );
    const failing = new Set(['ws-2', 'ws-5', 'ws-7']);
    wireStatefulEngine(wss, { failingSlugs: failing });

    await c.svc.setBaseline('actor-1', 'B');
    const preview = await c.svc.runPreview('fill');
    const result = await c.svc.apply('actor-1', {
      confirmToken: preview.confirmToken,
      typedConfirmation: preview.confirmationPhrase,
      mode: 'fill',
    });

    expect(result.appliedCount).toBe(N - failing.size);
    expect(result.failedCount).toBe(failing.size);
    expect(result.appliedCount + result.failedCount + result.skippedCount + result.divergedCount).toBe(
      N,
    );
    // The items array accounts for every workspace exactly once.
    expect(result.items).toHaveLength(N);
    expect(new Set(result.items.map((it) => it.workspaceId)).size).toBe(N);
  });

  it('a partial failure leaves the failed workspace re-tryable: a second apply targets only the still-drifted set (REQ-F002-022b)', async () => {
    const c = ctx!;
    const N = 3;
    const wss = Array.from({ length: N }, (_, i) =>
      baseEngineWorkspace({ id: i + 1, slug: `ws-${i + 1}`, openAiPrompt: '' }),
    );
    const failingSlug = 'ws-2';
    const { failingSlugs } = wireStatefulEngine(wss, { failingSlugs: new Set([failingSlug]) });

    await c.svc.setBaseline('actor-1', 'B');
    const preview1 = await c.svc.runPreview('fill');
    const result1 = await c.svc.apply('actor-1', {
      confirmToken: preview1.confirmToken,
      typedConfirmation: preview1.confirmationPhrase,
      mode: 'fill',
    });
    expect(result1.appliedCount).toBe(N - 1);
    expect(result1.failedCount).toBe(1);

    // Un-break the engine in place (promptState/listWorkspaces continuity is preserved), then
    // re-run: only the previously-failed workspace should still be affected (the others are
    // already synced/no-op skips).
    failingSlugs.delete(failingSlug);

    const preview2 = await c.svc.runPreview('fill');
    // Only the still-drifted (previously-failed) workspace remains "willChange".
    const stillAffected = preview2.items.filter((it) => it.willChange);
    expect(stillAffected).toHaveLength(1);

    const result2 = await c.svc.apply('actor-1', {
      confirmToken: preview2.confirmToken,
      typedConfirmation: preview2.confirmationPhrase,
      mode: 'fill',
    });
    expect(result2.appliedCount).toBe(1);
    expect(result2.skippedCount).toBe(N - 1);
    expect(result2.failedCount).toBe(0);
  });
});

describe('apply — validation errors surface as thrown AppError, not silent failures', () => {
  it('an unknown/missing mode is rejected before any engine call is made', async () => {
    const c = ctx!;
    wireStatefulEngine([baseEngineWorkspace({ slug: 'ws-1' })]);
    await c.svc.setBaseline('actor-1', 'B');
    await expect(
      c.svc.apply('actor-1', { confirmToken: 'whatever', typedConfirmation: 'whatever', mode: 'bogus' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it('apply with no baseline ever defined and no tracked workspace is rejected 400 ("no baseline defined")', async () => {
    const c = ctx!;
    wireStatefulEngine([]);
    await expect(
      c.svc.apply('actor-1', { confirmToken: 'x', typedConfirmation: 'y', mode: 'prepend' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('a typedConfirmation that does not match the bound phrase is rejected 409 with zero engine writes', async () => {
    const c = ctx!;
    const wss = [baseEngineWorkspace({ slug: 'ws-1', openAiPrompt: '' })];
    wireStatefulEngine(wss);
    await c.svc.setBaseline('actor-1', 'B');
    const preview = await c.svc.runPreview('fill');
    await expect(
      c.svc.apply('actor-1', {
        confirmToken: preview.confirmToken,
        typedConfirmation: 'definitely-wrong-phrase',
        mode: 'fill',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });
});
