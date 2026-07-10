// F-002 §5 pure composition + classification predicates (REQ-F002-011/012/013/023/056/057/059).
// Side-effect-free: no DB, no engine, no I/O. The spec's #1 named divergence risk, pinned to
// byte-exact behavior. Two mode notions live here as DISTINCT functions with distinct call sites
// so they can never be conflated (rev 8 CONTRADICTION fix, REQ-F002-023):
//   - resolveEffectiveMode  → preview/apply path only; folds in the operator-selected apply mode.
//   - classifyModeOf        → status/classification path only; NO operator mode (NULL → 'prepend').

import { createHash } from 'node:crypto';

// The boundary sentinel: a fixed, console-owned marker separating the baseline segment from the
// workspace-remainder segment inside a composed prompt (REQ-F002-011). The EXACT bytes are the
// contract of record; treat as frozen once shipped (first-apply structural detection keys off it).
export const SENTINEL =
  '\n\n===== workspace-specific instructions (managed below the baseline) =====\n\n';

// Operator-selectable composition mode carried by preview/apply (REQ-F002-055).
export type OperatorMode = 'prepend' | 'overwrite' | 'fill';
// Per-workspace resolved effective branch (REQ-F002-059/020). 'baseline-only' = stored inherit.
export type ResolvedMode = 'prepend' | 'baseline-only' | 'overwrite' | 'fill';
// Status-path branch (REQ-F002-023): no operator mode; derived only from stored composition_mode.
export type ClassifyMode = 'prepend' | 'baseline-only';

export type BaselineSyncState = 'synced' | 'stale' | 'overridden' | 'never-applied';

const OPERATOR_MODES: readonly OperatorMode[] = ['prepend', 'overwrite', 'fill'];

export function isOperatorMode(v: unknown): v is OperatorMode {
  return typeof v === 'string' && (OPERATOR_MODES as readonly string[]).includes(v);
}

// lowercase-hex SHA-256 over the exact UTF-8 bytes (REQ-F002-010c). The single hashing path for
// every "by hash" comparison in F-002 (REQ-F002-023/047).
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function isEmpty(v: string | null | undefined): boolean {
  return v === null || v === undefined || v === '';
}

// A live-prompt "empty/blank" test used ONLY by fill mode against the live prompt P (REQ-F002-057).
export function isBlank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

// --- compose (REQ-F002-011 / 056 / 057) — byte-exact ---
// Note: 'baseline-only' is NOT a compose operator mode; it is realized as compose(B, '', 'prepend')
// = B by the caller (REQ-F002-059), which retains the stored remainder rather than emptying it.
export function compose(
  B: string | null,
  R: string | null,
  mode: OperatorMode,
): string {
  if (mode === 'overwrite') {
    if (isEmpty(B)) return R ?? ''; // cleared baseline → remainder alone (REQ-F002-056)
    return B as string; // baseline replaces the whole field; no sentinel, no R
  }
  if (mode === 'fill') {
    // The service only ever calls compose(..., 'fill') when it has decided to write (P empty), and
    // passes an empty R; for symmetry: non-empty B → B, else R.
    if (isEmpty(B)) return R ?? '';
    return B as string;
  }
  // prepend (REQ-F002-011), full domain incl. a cleared baseline.
  if (isEmpty(B)) return R ?? ''; // cleared baseline → remainder alone (empty when R empty)
  if (isEmpty(R)) return B as string; // non-empty B, empty R → baseline exactly
  return (B as string) + SENTINEL + (R as string); // both non-empty → B + SENTINEL + R
}

// First-apply structural remainder capture & double-prepend guard (REQ-F002-012; prepend only).
// Purely structural — does NOT depend on any stored state (there is none on a first apply).
export function deriveRemainderOnFirstApply(P: string | null): string {
  if (isBlank(P)) return '';
  const live = P as string;
  const idx = live.indexOf(SENTINEL);
  if (idx !== -1) {
    // P already carries a composition: remainder = substring AFTER the first SENTINEL; the
    // pre-sentinel segment (a prior baseline) is discarded → prevents a doubled baseline.
    return live.slice(idx + SENTINEL.length);
  }
  // Operator-authored prompt with no sentinel → captured verbatim as the workspace remainder.
  return live;
}

// --- Effective-mode resolver (REQ-F002-059) — preview/apply path only. Folds in the operator
// mode as the default for a NULL / untracked / unrecognized stored value (backward-compat + R4-5).
export function resolveEffectiveMode(
  operatorMode: OperatorMode,
  storedCompositionMode: string | null | undefined,
): ResolvedMode {
  if (storedCompositionMode === 'append') return 'prepend';
  if (storedCompositionMode === 'inherit') return 'baseline-only';
  // NULL, absent, OR any unrecognized value (incl. a stray 'override' F-003 never writes) →
  // the operator-selected mode as the default (REQ-F002-010d/059 fallback).
  return operatorMode;
}

// --- Classifier (REQ-F002-023) — status path only. Uses classifyMode, NEVER resolvedMode; a NULL
// (untracked) stored mode is always 'prepend' (no operator mode is folded in here).
export function classifyModeOf(storedCompositionMode: string | null | undefined): ClassifyMode {
  if (storedCompositionMode === 'inherit') return 'baseline-only';
  // 'append', NULL, absent, or any unrecognized value → 'prepend' (mode-agnostic reconstruction).
  return 'prepend';
}

// The current-baseline reconstruction the console's own fan-out records as in-sync for a workspace
// under its classifyMode (REQ-F002-023). An empty remainder collapses every branch to (B ?? '').
export function effective(
  B: string | null,
  remainder: string | null,
  cm: ClassifyMode,
): string {
  if (cm === 'baseline-only') return B ?? ''; // baseline alone, even if remainder non-empty
  return compose(B, remainder, 'prepend');
}

// Sync-state classification (REQ-F002-023): ordered, FIRST-MATCH-WINS.
//   1. never-applied — no state row (caller passes hasStateRow=false).
//   2. synced        — P === effective(B, remainder, classifyMode).
//   3. stale         — NOT synced AND sha256Hex(P) === applied_composed_hash (precedes overridden).
//   4. overridden    — none of the above.
export function classifyState(args: {
  livePrompt: string | null;
  baseline: string | null;
  hasStateRow: boolean;
  remainder: string | null;
  appliedComposedHash: string | null;
  storedCompositionMode: string | null;
}): BaselineSyncState {
  if (!args.hasStateRow) return 'never-applied';
  const P = args.livePrompt ?? '';
  const cm = classifyModeOf(args.storedCompositionMode);
  const reconstruction = effective(args.baseline, args.remainder, cm);
  if (P === reconstruction) return 'synced';
  if (args.appliedComposedHash !== null && sha256Hex(P) === args.appliedComposedHash) {
    return 'stale';
  }
  return 'overridden';
}
