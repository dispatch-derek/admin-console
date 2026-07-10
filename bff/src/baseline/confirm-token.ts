// F-002 danger-gate binding token (REQ-F002-020/047/048/055). Mints, stores, and validates the
// opaque binding `confirmToken` snapshot and the human `confirmationPhrase`. Two clearly separated
// artifacts (REQ-F002-048): the machine token binds the apply to the previewed snapshot; the human
// phrase is typed and submitted as `typedConfirmation`.
//
// One deployment == one customer == one singleton baseline (parent REQ-001/002), so at most one
// live preview snapshot matters: a newer preview supersedes the previous token (REQ-F002-047). We
// keep the single most-recently-minted snapshot in process memory; any earlier token is stale.

import { randomUUID } from 'node:crypto';
import type { OperatorMode, ResolvedMode } from './compose.js';

// One previewed per-workspace snapshot entry, bound by the token (REQ-F002-020). The write a
// workspace receives at apply is EXACTLY the one bound here at preview (REQ-F002-020); apply never
// re-derives composition from a fresh read — it only compares the fresh read for divergence.
export interface SnapshotItem {
  workspaceId: string;
  resolvedMode: ResolvedMode; // resolved effective branch (REQ-F002-059)
  currentPromptHash: string; // SHA-256 of the live prompt at preview (REQ-F002-047)
  willChange: boolean; // did the previewed composed value differ from the previewed live prompt
  overridden: boolean; // was this item overridden in the previewed snapshot (prepend override)
  // Non-overridden write: the exact composed value bound + the remainder to store on a verified
  // write (REQ-F002-020). Absent for an overridden prepend item (candidates below instead) and
  // for a fill-skipped item (willChange=false, nothing to write).
  writeTarget?: string;
  remainderToStore?: string | null;
  // Overridden prepend candidates + the remainder each resolution stores (REQ-F002-025/050).
  composedIfPreserve?: string;
  remainderIfPreserve?: string;
  composedIfDiscard?: string;
  remainderIfDiscard?: string | null;
}

export interface Snapshot {
  token: string;
  phrase: string;
  operatorMode: OperatorMode;
  baselineText: string | null; // baseline in effect at preview (staleness on change, REQ-F002-047)
  targetWorkspaceIds: string[]; // sorted membership (staleness on add/remove, REQ-F002-047)
  items: SnapshotItem[];
  mintedAt: number;
}

// Single-slot store: the latest minted snapshot per deployment. A fresh mint supersedes.
let current: Snapshot | null = null;

export interface MintInput {
  operatorMode: OperatorMode;
  baselineText: string | null;
  targetWorkspaceIds: string[];
  items: SnapshotItem[];
}

// A short, human-typeable confirmation phrase (REQ-F002-048). Not a secret; displayed at preview.
function makePhrase(): string {
  return `apply-baseline-${randomUUID().slice(0, 8)}`;
}

export function mintSnapshot(input: MintInput): Snapshot {
  const snap: Snapshot = {
    token: randomUUID(),
    phrase: makePhrase(),
    operatorMode: input.operatorMode,
    baselineText: input.baselineText,
    targetWorkspaceIds: [...input.targetWorkspaceIds].sort(),
    items: input.items,
    mintedAt: Date.now(),
  };
  current = snap;
  return snap;
}

export type TokenValidation =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; status: 400 | 409; message: string };

// Validate a presented token + mode against the current snapshot and live baseline/target set.
// Ordering matches §4/REQ-F002-021: absent/malformed token OR absent/unknown mode → 400; a
// well-formed but stale/superseded token (newer preview, baseline change, target-set change, or a
// mode differing from the token's) → 409.
export function validateToken(args: {
  token: unknown;
  mode: OperatorMode; // already validated as a known operator mode by the caller
  currentBaselineText: string | null;
  currentTargetWorkspaceIds: string[];
}): TokenValidation {
  if (typeof args.token !== 'string' || args.token.length === 0) {
    return { ok: false, status: 400, message: 'A confirmToken is required' };
  }
  if (!current || current.token !== args.token) {
    // Unknown or superseded token (a newer preview was minted, REQ-F002-047).
    return { ok: false, status: 409, message: 'This preview is stale; re-run the preview' };
  }
  const snap = current;
  if (snap.operatorMode !== args.mode) {
    return {
      ok: false,
      status: 409,
      message: 'The mode changed since preview; re-run the preview',
    };
  }
  if (snap.baselineText !== args.currentBaselineText) {
    return {
      ok: false,
      status: 409,
      message: 'The baseline changed since preview; re-run the preview',
    };
  }
  const sortedNow = [...args.currentTargetWorkspaceIds].sort();
  const sameMembership =
    sortedNow.length === snap.targetWorkspaceIds.length &&
    sortedNow.every((id, i) => id === snap.targetWorkspaceIds[i]);
  if (!sameMembership) {
    return {
      ok: false,
      status: 409,
      message: 'The set of workspaces changed since preview; re-run the preview',
    };
  }
  return { ok: true, snapshot: snap };
}

// Clear the stored snapshot (used after a consumed apply so a token cannot be replayed).
export function clearSnapshot(): void {
  current = null;
}
