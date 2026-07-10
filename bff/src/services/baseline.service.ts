// F-002 baseline service (§6, §7). Owns the per-call chain for all five routes: baseline
// get/put/delete, status, preview (mints/stores the confirmToken), and the bounded-concurrency
// apply fan-out with per-workspace verify + events + audit. Reuses the parent workspace service's
// verified settings write for each fan-out write so verify-after-write (parent REQ-028), the
// admin.workspace.updated event, and its audit all come for free (design §4/§6).

import { engineAdapter as adapter } from '../engine/adapter.js';
import { reconcile } from '../identity/workspace-map.js';
import { workspaceMapRepo } from '../store/repositories/workspace-map.repo.js';
import { updateWorkspaceSettings } from './workspace.service.js';
import { baselineRepo } from '../store/repositories/baseline.repo.js';
import {
  compose,
  deriveRemainderOnFirstApply,
  classifyState,
  isBlank,
  isOperatorMode,
  resolveEffectiveMode,
  sha256Hex,
  type OperatorMode,
  type ResolvedMode,
} from '../baseline/compose.js';
import {
  mintSnapshot,
  validateToken,
  clearSnapshot,
  type SnapshotItem,
} from '../baseline/confirm-token.js';
import { emitAdminEvent } from '../events/emitter.js';
import { recordAudit } from '../audit/audit.js';
import { AppError } from '../server/errors.js';
import type { EngineWorkspace } from '../engine/engine-types.js';
import type {
  BaselineApplyResult,
  BaselineApplyResultItem,
  BaselinePreview,
  BaselinePreviewItem,
  BaselinePrompt,
  BaselineStatusView,
  BaselineWorkspaceStatus,
  BaselineSyncState,
  OverrideResolution,
} from '../types/product-types.js';

const CONCURRENCY = 8; // bounded fan-out concurrency (REQ-F002-058)

// --- Baseline CRUD (§6.1) ---

export function getBaseline(): BaselinePrompt {
  const row = baselineRepo.getBaseline();
  return { text: row.text, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export async function setBaseline(actorId: string, rawText: unknown): Promise<BaselinePrompt> {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    // Whitespace-only rejected (REQ-F002-018); clearing is DELETE-only (REQ-F002-046).
    throw new AppError(400, 'Baseline text is required (use DELETE to clear)');
  }
  const text = rawText.trim();
  const ts = new Date().toISOString();
  baselineRepo.setBaseline(text, actorId, ts);
  await emitAdminEvent(
    'admin.baseline_prompt.updated',
    actorId,
    { baseline: 'singleton' },
    true, // store-confirmed (deliberate deviation from parent REQ-029c, REQ-F002-035 M5)
    undefined,
    { contentRef: { length: text.length, hash: sha256Hex(text) }, cleared: false },
  );
  recordAudit({
    actor: actorId,
    action: 'baseline_prompt.update',
    outcome: 'success',
    target: { baseline: 'singleton' },
    detail: { cleared: false, length: text.length },
  });
  return getBaseline();
}

export async function clearBaseline(actorId: string): Promise<BaselinePrompt> {
  const ts = new Date().toISOString();
  baselineRepo.clearBaseline(actorId, ts);
  await emitAdminEvent(
    'admin.baseline_prompt.updated',
    actorId,
    { baseline: 'singleton' },
    true,
    undefined,
    { contentRef: null, cleared: true },
  );
  recordAudit({
    actor: actorId,
    action: 'baseline_prompt.update',
    outcome: 'success',
    target: { baseline: 'singleton' },
    detail: { cleared: true },
  });
  return getBaseline();
}

// --- Shared enumeration: live workspaces (product id + engine record), orphan-pruned ---

interface LiveWorkspace {
  productId: string;
  slug: string;
  displayName: string;
  livePrompt: string; // engine openAiPrompt (REQ-F002-010a: always a fresh engine read)
}

// A workspace counts as "applied by the console" only once F-002 has recorded an applied composed
// hash (REQ-F002-023 never-applied). An F-003-authored row that merely stamps composition_mode
// (REQ-F002-010d) carries no applied hash, so it is still never-applied and is treated as a
// first-apply for structural remainder capture (REQ-F002-012).
function hasApplied(
  state: { applied_composed_hash: string | null } | undefined,
): boolean {
  return state !== undefined && state.applied_composed_hash !== null;
}

// Enumerate the target set from the reconciled workspace map (REQ-F002-052). reconcile() only ever
// ADDS newly-seen engine workspaces to the map (never removes), and a workspace deleted through the
// product route is forgotten from the map + its state row dropped (REQ-F002-051). So the map is the
// authoritative membership: a fresh engine list that adds a workspace grows it (target-set staleness
// at apply, REQ-F002-047), while a workspace forgotten by a prior delete is absent. Live prompts for
// status/preview come from the current engine list by slug (parent REQ-030/031, fresh — REQ-F002-010a).
// When `freshLivePrompt` is true, each workspace's live prompt is read individually via the
// product per-workspace read (parent REQ-031, adapter.getWorkspace) — the fresh authoritative value
// the status/drift surface classifies against (REQ-F002-010a/024). When false, the batch list's
// openAiPrompt is used (the preview snapshot's live-prompt basis).
async function enumerateLiveWorkspaces(freshLivePrompt = false): Promise<LiveWorkspace[]> {
  const engineWorkspaces = await adapter.listWorkspaces();
  reconcile(engineWorkspaces);
  const bySlugPrompt = new Map<string, string>();
  for (const e of engineWorkspaces) bySlugPrompt.set(e.slug, e.openAiPrompt ?? '');

  const rows = workspaceMapRepo.list();
  // Fresh per-workspace live reads (REQ-F002-010a) are fanned out with the same bounded concurrency
  // as apply (REQ-F002-058) so GET /status does not serialize up to 200 engine round-trips.
  const freshPrompts = freshLivePrompt
    ? await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
        const fresh = await adapter.getWorkspace(row.engine_slug);
        return fresh?.openAiPrompt ?? '';
      })
    : null;

  return rows.map((row, i) => ({
    productId: row.product_id,
    slug: row.engine_slug,
    displayName: row.display_name ?? row.engine_slug,
    livePrompt: freshPrompts ? freshPrompts[i]! : (bySlugPrompt.get(row.engine_slug) ?? ''),
  }));
}

// --- Status (§6.4, REQ-F002-024) ---

export async function getStatus(): Promise<BaselineStatusView> {
  const baselineRow = baselineRepo.getBaseline();
  const B = baselineRow.text;
  const live = await enumerateLiveWorkspaces(true);

  const workspaces: BaselineWorkspaceStatus[] = [];
  const counts: Record<BaselineSyncState, number> = {
    synced: 0,
    stale: 0,
    overridden: 0,
    'never-applied': 0,
  };

  for (const ws of live) {
    const state = baselineRepo.getState(ws.productId);
    const syncState = classifyState({
      livePrompt: ws.livePrompt,
      baseline: B,
      hasStateRow: state !== undefined,
      remainder: state?.remainder ?? null,
      appliedComposedHash: state?.applied_composed_hash ?? null,
      storedCompositionMode: state?.composition_mode ?? null,
    });
    counts[syncState] += 1;
    workspaces.push({
      workspaceId: ws.productId,
      displayName: ws.displayName,
      syncState,
      hasWorkspaceRemainder: !!(state && state.remainder && state.remainder.length > 0),
    });
  }

  return {
    baseline: { text: B, updatedAt: baselineRow.updated_at, updatedBy: baselineRow.updated_by },
    workspaces,
    counts,
  };
}

// --- Preview (§6.2, REQ-F002-019/020) ---

// Compute the composed write for a workspace under a resolved mode + snapshot bookkeeping.
interface Resolved {
  item: BaselinePreviewItem;
  snapshot: SnapshotItem;
}

function buildPreviewItem(
  ws: LiveWorkspace,
  B: string | null,
  operatorMode: OperatorMode,
): Resolved {
  const state = baselineRepo.getState(ws.productId);
  const applied = hasApplied(state);
  const storedMode = state?.composition_mode ?? null;
  const resolvedMode: ResolvedMode = resolveEffectiveMode(operatorMode, storedMode);
  const P = ws.livePrompt;
  const currentPromptHash = sha256Hex(P);

  const syncState = classifyState({
    livePrompt: P,
    baseline: B,
    hasStateRow: state !== undefined,
    remainder: state?.remainder ?? null,
    appliedComposedHash: state?.applied_composed_hash ?? null,
    storedCompositionMode: storedMode,
  });

  const baseItem = {
    workspaceId: ws.productId,
    displayName: ws.displayName,
    syncState,
    resolvedMode,
    currentPrompt: P,
    currentPromptHash,
  };
  const snapBase = { workspaceId: ws.productId, resolvedMode, currentPromptHash };

  // Shared shape for every non-overridden, single-candidate branch below (fill-writable, overwrite,
  // baseline-only, prepend-non-overridden): they differ only in the composed value and the
  // remainder to store on a verified write.
  const writableResult = (composed: string, remainderToStore: string | null): Resolved => ({
    item: { ...baseItem, composedPrompt: composed, willChange: composed !== P },
    snapshot: {
      ...snapBase,
      willChange: composed !== P,
      overridden: false,
      writeTarget: composed,
      remainderToStore,
    },
  });

  // fill — decided against the LIVE prompt (REQ-F002-057). A non-empty prompt, or a null baseline,
  // means nothing is written; the item is skipped and carries no writeTarget.
  if (resolvedMode === 'fill') {
    const writable = isBlank(P) && B !== null && B !== '';
    if (!writable) {
      const message = !isBlank(P)
        ? 'Skipped: workspace already has a prompt (fill writes only empty workspaces).'
        : 'Skipped: no baseline defined to fill.';
      return {
        item: { ...baseItem, composedPrompt: null, willChange: false, message },
        snapshot: { ...snapBase, willChange: false, overridden: false },
      };
    }
    return writableResult(compose(B, '', 'fill'), ''); // = B (baseline alone)
  }

  // overwrite — destructive full replacement (REQ-F002-056). No preserve/discard candidates; the
  // stored remainder is emptied on a verified write.
  if (resolvedMode === 'overwrite') {
    return writableResult(compose(B, state?.remainder ?? null, 'overwrite'), '');
  }

  // baseline-only (stored inherit, REQ-F002-059) — always composed = B; the stored remainder is
  // retained (captured on first apply, kept thereafter), never emptied. Exempt from override
  // preserve/discard (REQ-F002-050/019): a single composedPrompt = B, no candidates.
  if (resolvedMode === 'baseline-only') {
    const remainderToStore = applied
      ? (state?.remainder ?? '')
      : deriveRemainderOnFirstApply(P);
    return writableResult(B ?? '', remainderToStore);
  }

  // prepend (REQ-F002-011/012). An overridden workspace that the console has ALREADY applied to
  // carries BOTH candidates (REQ-F002-019/025) and requires an explicit preserve/discard resolution
  // — there is a stored remainder to discard back to. A workspace with a row but no prior console
  // apply (e.g. an F-003 stamp, REQ-F002-010d) has no stored remainder to preserve/discard; it is a
  // first apply, so it falls through to the structural-capture recompose below.
  if (syncState === 'overridden' && applied) {
    const remainderIfPreserve = P; // treat the out-of-band live prompt as the new remainder
    const remainderIfDiscard = state?.remainder ?? '';
    const composedIfPreserve = compose(B, remainderIfPreserve, 'prepend');
    const composedIfDiscard = compose(B, remainderIfDiscard, 'prepend');
    return {
      item: {
        ...baseItem,
        composedPrompt: null,
        composedIfPreserve,
        composedIfDiscard,
        willChange: true,
      },
      snapshot: {
        ...snapBase,
        willChange: true,
        overridden: true,
        composedIfPreserve,
        remainderIfPreserve,
        composedIfDiscard,
        remainderIfDiscard,
      },
    };
  }

  // prepend, non-overridden: recompose from the stored remainder (re-apply) or derive it
  // structurally on first apply (REQ-F002-012).
  const remainder = applied ? (state?.remainder ?? '') : deriveRemainderOnFirstApply(P);
  return writableResult(compose(B, remainder, 'prepend'), remainder);
}

// Target set (REQ-F002-052): all live workspaces; when the baseline is cleared/never-defined,
// restrict to already-tracked workspaces (REQ-F002-046).
async function resolveTargetSet(B: string | null): Promise<LiveWorkspace[]> {
  const live = await enumerateLiveWorkspaces();
  if (B === null || B === '') {
    return live.filter((ws) => baselineRepo.getState(ws.productId) !== undefined);
  }
  return live;
}

// Preview (REQ-F002-019/020): dry run + the intentional confirmToken mint side-effect (REQ-F002-019 M6).
export async function runPreview(operatorModeRaw: unknown): Promise<BaselinePreview> {
  const operatorMode = operatorModeRaw === undefined ? 'prepend' : operatorModeRaw;
  if (!isOperatorMode(operatorMode)) {
    throw new AppError(400, 'Unknown mode');
  }
  const B = baselineRepo.getBaseline().text;
  const targets = await resolveTargetSet(B);

  const items: BaselinePreviewItem[] = [];
  const snapItems: SnapshotItem[] = [];
  let affected = 0;
  for (const ws of targets) {
    const { item, snapshot } = buildPreviewItem(ws, B, operatorMode);
    items.push(item);
    snapItems.push(snapshot);
    if (item.willChange) affected += 1;
  }

  const snap = mintSnapshot({
    operatorMode,
    baselineText: B,
    targetWorkspaceIds: targets.map((t) => t.productId),
    items: snapItems,
  });

  return {
    affectedCount: affected,
    unchangedCount: items.length - affected,
    items,
    confirmToken: snap.token,
    confirmationPhrase: snap.phrase,
  };
}

// --- Apply (§6.3, REQ-F002-021/022/047/058) ---

interface ApplyBody {
  confirmToken?: unknown;
  typedConfirmation?: unknown;
  mode?: unknown;
  overrides?: unknown;
}

export async function apply(actorId: string, body: ApplyBody): Promise<BaselineApplyResult> {
  // Validate operator mode first (absent/unknown → 400, REQ-F002-021/055).
  if (!isOperatorMode(body.mode)) {
    throw new AppError(400, 'A valid mode is required');
  }
  const mode: OperatorMode = body.mode;

  const B = baselineRepo.getBaseline().text;

  // Cleared/never-defined baseline with no tracked workspace → 400 "no baseline defined"
  // (REQ-F002-046). Checked up front so it wins regardless of token state.
  if (B === null || B === '') {
    const trackedExists = baselineRepo.listStates().length > 0;
    if (!trackedExists) {
      throw new AppError(400, 'No baseline defined');
    }
  }

  const targets = await resolveTargetSet(B);

  // Token validation (400 vs 409 per §4). currentTargetWorkspaceIds is the live membership now.
  const tokenResult = validateToken({
    token: body.confirmToken,
    mode,
    currentBaselineText: B,
    currentTargetWorkspaceIds: targets.map((t) => t.productId),
  });
  if (!tokenResult.ok) {
    throw new AppError(tokenResult.status, tokenResult.message);
  }
  const snapshot = tokenResult.snapshot;

  // typedConfirmation must equal the bound phrase (REQ-F002-048) → 409.
  if (body.typedConfirmation !== snapshot.phrase) {
    throw new AppError(409, 'The confirmation phrase does not match');
  }

  // overrides domain validation (REQ-F002-050).
  const overrides = parseOverrides(body.overrides);
  const snapByWs = new Map(snapshot.items.map((s) => [s.workspaceId, s]));
  if (mode === 'overwrite' || mode === 'fill') {
    if (overrides.size > 0) {
      throw new AppError(400, 'overrides are not permitted in this mode');
    }
  }
  for (const wsId of overrides.keys()) {
    const snap = snapByWs.get(wsId);
    if (!snap) {
      throw new AppError(409, 'overrides reference an unknown workspace');
    }
    if (snap.resolvedMode === 'baseline-only') {
      throw new AppError(400, 'overrides cannot name a baseline-only workspace');
    }
    if (!snap.overridden) {
      throw new AppError(409, 'overrides reference a non-overridden workspace');
    }
  }

  // Fan-out with bounded concurrency (REQ-F002-058). No whole-apply rejection past this point;
  // per-item outcomes only (REQ-F002-047/022a).
  const results = await fanOut(actorId, targets, mode, snapshot, overrides, snapByWs, B);

  const applied = results.filter((r) => r.outcome === 'applied');
  const failed = results.filter((r) => r.outcome === 'failed');
  const skipped = results.filter((r) => r.outcome === 'skipped');
  const diverged = results.filter((r) => r.outcome === 'diverged');

  const failedOrDiverged = [...failed, ...diverged].map((r) => r.workspaceId);

  await emitAdminEvent(
    'admin.baseline_prompt.applied',
    actorId,
    { baseline: 'singleton' },
    true,
    undefined,
    {
      appliedCount: applied.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      divergedCount: diverged.length,
      appliedBaselineHash: sha256Hex(B ?? ''),
      appliedWorkspaceIds: applied.map((r) => r.workspaceId),
      failedOrDivergedWorkspaceIds: failedOrDiverged,
    },
  );
  recordAudit({
    actor: actorId,
    action: 'baseline_prompt.apply',
    outcome: failed.length > 0 ? 'failure' : 'success',
    target: { baseline: 'singleton' },
    detail: {
      mode,
      appliedCount: applied.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      divergedCount: diverged.length,
      applied: applied.map((r) => r.workspaceId),
      failed: failed.map((r) => r.workspaceId),
      diverged: diverged.map((r) => r.workspaceId),
    },
  });

  // A consumed apply invalidates its token (single-slot snapshot). A follow-up apply must re-preview.
  clearSnapshot();

  return {
    appliedCount: applied.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    divergedCount: diverged.length,
    items: results,
  };
}

function parseOverrides(raw: unknown): Map<string, OverrideResolution> {
  const out = new Map<string, OverrideResolution>();
  if (raw === undefined || raw === null) return out;
  if (!Array.isArray(raw)) {
    throw new AppError(400, 'overrides must be an array');
  }
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new AppError(400, 'invalid overrides entry');
    }
    const { workspaceId, resolution } = entry as {
      workspaceId?: unknown;
      resolution?: unknown;
    };
    if (typeof workspaceId !== 'string') {
      throw new AppError(400, 'invalid overrides entry');
    }
    if (resolution !== 'preserve' && resolution !== 'discard') {
      throw new AppError(400, 'invalid overrides resolution');
    }
    out.set(workspaceId, resolution);
  }
  return out;
}

// Bounded-concurrency, order-preserving map: run `fn` over `items` with at most `limit` in flight
// (REQ-F002-058). Shared by the apply fan-out and the fresh-live status reads so neither serializes
// up to 200 engine round-trips.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!, idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Run write+verify for the target set with a fixed concurrency limit (batched, REQ-F002-058).
async function fanOut(
  actorId: string,
  targets: LiveWorkspace[],
  mode: OperatorMode,
  snapshot: { items: SnapshotItem[] },
  overrides: Map<string, OverrideResolution>,
  snapByWs: Map<string, SnapshotItem>,
  B: string | null,
): Promise<BaselineApplyResultItem[]> {
  return mapWithConcurrency(targets, CONCURRENCY, (ws) =>
    applyOne(actorId, ws, mode, snapByWs.get(ws.productId), overrides, B),
  );
}

async function applyOne(
  actorId: string,
  ws: LiveWorkspace,
  operatorMode: OperatorMode,
  snap: SnapshotItem | undefined,
  overrides: Map<string, OverrideResolution>,
  B: string | null,
): Promise<BaselineApplyResultItem> {
  const base = { workspaceId: ws.productId, displayName: ws.displayName };

  if (!snap) {
    // Not in the previewed snapshot (should not happen given token target-set binding) → skip.
    return { ...base, outcome: 'skipped', verified: false, message: 'Not in the previewed snapshot.' };
  }

  // Fresh live read (REQ-F002-047 divergence + REQ-F002-010a fresh-read posture).
  const engine = await adapter.getWorkspace(ws.slug);
  const freshLive = engine?.openAiPrompt ?? '';

  const state = baselineRepo.getState(ws.productId);

  // Mode-branch divergence (REQ-F002-047/059): recompute the resolved branch from the CURRENT
  // stored composition_mode; if it resolves to a DIFFERENT branch than the one previewed, the
  // previewed write no longer matches → diverged (compared in F-002's resolved-branch vocabulary).
  const currentResolved = resolveEffectiveMode(operatorMode, state?.composition_mode ?? null);
  if (currentResolved !== snap.resolvedMode) {
    return { ...base, outcome: 'diverged', verified: false, message: 'Composition mode changed since preview.' };
  }

  // Resolve the exact write bound at preview (REQ-F002-020 — never re-derived here).
  let writeTarget: string;
  let remainderToStore: string | null;
  if (snap.overridden) {
    const resolution = overrides.get(ws.productId);
    if (!resolution) {
      // An overridden prepend workspace with no preserve/discard resolution is not written; it is
      // skipped and the apply proceeds for the rest (REQ-F002-050).
      return { ...base, outcome: 'skipped', verified: false, message: 'Skipped: override not resolved.' };
    }
    if (resolution === 'preserve') {
      writeTarget = snap.composedIfPreserve ?? '';
      remainderToStore = snap.remainderIfPreserve ?? '';
    } else {
      writeTarget = snap.composedIfDiscard ?? '';
      remainderToStore = snap.remainderIfDiscard ?? '';
    }
  } else {
    if (!snap.willChange) {
      // No-op at preview (already synced, or a fill-skip): idempotent skip (REQ-F002-022b/057).
      return { ...base, outcome: 'skipped', verified: false, message: 'Skipped: already in sync.' };
    }
    writeTarget = snap.writeTarget ?? '';
    remainderToStore = snap.remainderToStore ?? null;
  }

  // Per-workspace live divergence (REQ-F002-047): the fresh live prompt no longer matches the
  // previewed snapshot AND is not already the value we intend to write. A fresh live equal to the
  // intended write is NOT divergent (the previewed write still lands byte-identically).
  if (sha256Hex(freshLive) !== snap.currentPromptHash && freshLive !== writeTarget) {
    return { ...base, outcome: 'diverged', verified: false, message: 'Live prompt changed since preview.' };
  }

  return writeAndTrack(actorId, ws, base, writeTarget, { remainder: remainderToStore, B });
}

async function writeAndTrack(
  actorId: string,
  ws: LiveWorkspace,
  base: { workspaceId: string; displayName: string },
  composed: string,
  track: { remainder: string | null; B: string | null },
): Promise<BaselineApplyResultItem> {
  try {
    await updateWorkspaceSettings(actorId, ws.productId, { systemPrompt: composed });
  } catch (err) {
    // Upstream failure or verify-after-write 409 → failed; prior engine prompt retained; no state
    // row update (REQ-F002-022). Surface the underlying message verbatim (REQ-F002-022a), matching
    // the sibling services (workspace/settings/user).
    return {
      ...base,
      outcome: 'failed',
      verified: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const now = new Date().toISOString();
  baselineRepo.upsertAppliedState({
    workspace_id: ws.productId,
    remainder: track.remainder,
    applied_composed_hash: sha256Hex(composed),
    applied_baseline_hash: sha256Hex(track.B ?? ''),
    applied_at: now,
  });
  return { ...base, outcome: 'applied', verified: true };
}

