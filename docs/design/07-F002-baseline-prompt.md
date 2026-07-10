# F-002 Customer-Wide Baseline System Prompt — Design

**Implementation Status:** Complete and verified. Implementation passes 711 BFF tests + 266 web tests; all review gates passed (spec rev 9, design review, implementation review, accessibility review).

Spec: `specs/F-002-customer-system-prompt.md` (Draft rev 9, final).
Parent conventions: `specs/admin-console.md` v1 rev 7; `docs/design/01–05`.

This design is deliberately thin: F-002 is one new store namespace, one repository, one
pure-function module, one service, one route file, and one web feature folder. It reuses the
established anti-corruption / verify-after-write / event / audit / DangerConfirm machinery
verbatim (parent REQ-021/026/027/028/029/093, §8). No new engine capability, no new custody
path, no new layer or abstraction is introduced — the fan-out is nothing more than a batched
loop over the existing `PATCH /api/workspaces/:id/settings` service call. State that as the
simplicity tradeoff: F-002 does NOT get its own adapter, its own bus, or a background worker;
apply is a synchronous bounded loop (Ruling B, REQ-F002-054/058).

The three highest-divergence-risk pieces (spec self-check §, rev 8) are pinned exactly in
§3 below: `compose`, the effective-mode resolver, and `classifyMode` classification. Two
mode notions — preview/apply `resolvedMode` and status `classifyMode` — are kept in separate
functions with separate call sites so they cannot be conflated (rev 8 CONTRADICTION fix,
REQ-F002-023).

---

## 1. Module decomposition

### 1.1 New BFF files

| File | Responsibility (one sentence) | Implements |
|---|---|---|
| `bff/src/store/db.ts` (edit) | Add `baseline_prompt` + `workspace_baseline_state` tables and the additive nullable `composition_mode` column to the idempotent migration. | REQ-F002-010/010a/010c/010d |
| `bff/src/store/repositories/baseline.repo.ts` (new) | Row-level reads/writes for the singleton baseline and per-workspace state; also the `admin.workspace.deleted` orphan cleanup delete. | REQ-F002-010/010c/010d/051 |
| `bff/src/baseline/compose.ts` (new) | Pure, side-effect-free composition + classification predicates: `compose`, `resolveEffectiveMode`, `classifyMode`, `effective`, `classifyState`, the `SENTINEL` constant, and SHA-256 hashing. | REQ-F002-011/012/013/023/056/057/059 |
| `bff/src/services/baseline.service.ts` (new) | Owns the per-call chain for all five routes: baseline get/put/delete, status, preview (mints/stores `confirmToken`), and the bounded-concurrency apply fan-out with per-workspace verify + events + audit. | REQ-F002-015/016/017/018/019/020/021/022/022a/024/025/026/027/035/036/046/047/050/052/058 |
| `bff/src/baseline/confirm-token.ts` (new) | Mints, stores, and validates the opaque binding `confirmToken` snapshot and the human `confirmationPhrase` (staleness + 400/409 rules). | REQ-F002-020/047/048/055 |
| `bff/src/routes/baseline.routes.ts` (new) | Thin Fastify handlers for the five §7.2 routes; parse product body, resolve actor, delegate to the service. | REQ-F002-028, §7.2 |
| `bff/src/types/product-types.ts` (edit) | Add the §7.1 product types (`BaselinePrompt`, `BaselineSyncState`, `BaselineWorkspaceStatus`, `BaselineStatusView`, `BaselinePreviewItem`, `BaselinePreview`, `BaselineApplyOutcome`, `BaselineApplyResultItem`, `BaselineApplyResult`). | REQ-F002-025 (parent), §7.1 |
| `bff/src/events/catalog.ts` (edit) | Add the two event names + payload types (`admin.baseline_prompt.updated`, `admin.baseline_prompt.applied`). | REQ-F002-035 |
| `bff/src/index.ts` (edit) | Register `baselineRoutes` in `buildApp()`. | REQ-F002-028 |

The `admin.workspace.deleted` orphan-cleanup subscription (REQ-F002-051) is wired where the
bus is consumed. Because the emitter/bus is on-box and F-002's state row is BFF-owned, the
cleanest, lowest-risk approach that fits the existing code is to have the baseline service
expose a `handleWorkspaceDeleted(workspaceId)` hook and have `workspace.service.deleteWorkspace`
(which already calls `forget(productId)` after a verified delete) also call the baseline
repo's `deleteState(productId)`. **This crosses a service boundary; flagged as an open
decision in §7 — the spec says "on `admin.workspace.deleted`" (a bus event), and the repo does
not currently have a bus subscriber. Pick one wiring at implementation time; do not do both.**

### 1.2 New web files (`web/src/features/baseline-prompt/`)

Per REQ-F002-029 this is the app's first above-workspaces settings surface. Follows
`docs/design/05-web-architecture.md` and reuses `DangerConfirm`, `ErrorBanner`,
`components/validation.ts`, `FieldValidation`/`aria-invalid` idioms.

| File | Responsibility | Implements |
|---|---|---|
| `BaselinePromptPage.tsx` | Section shell + top-level nav entry; hosts editor, status, preview→apply; renders the persistent native-default advisory. | REQ-F002-029/060 |
| `BaselineEditor.tsx` | Labeled textarea for the baseline; PUT/DELETE (clear); trimmed/non-empty validation. | REQ-F002-015/016/018/046 |
| `BaselineStatusList.tsx` | Drift/sync-state table; non-color-only encoding of the four states. | REQ-F002-024/033 |
| `BaselinePreviewApply.tsx` | Mode selector, preview/diff, per-override preserve/discard choice, `DangerConfirm` gate (typed phrase + binding token), synchronous result region with ARIA live announcement + per-workspace outcome list. | REQ-F002-019/030/031/032/034 |
| `web/src/api/client.ts` + `web/src/api/types.ts` (edit) | Add typed client functions and mirror the product types (product vocabulary only, parent REQ-021a). | REQ-F002-028 |

Web is engine-free: it references only product `/api/*` routes and product field names
(parent REQ-021a/037; REQ-F002-028/037).

---

## 2. Data model / migration plan

Migrations go into `bff/src/store/db.ts` `migrate()`, mirroring the existing idempotent
style: `CREATE TABLE IF NOT EXISTS` inside the single `db.exec` block, and the additive
`composition_mode` column added via the existing `PRAGMA table_info` guard loop (SQLite has no
`ADD COLUMN IF NOT EXISTS`).

### 2.1 `baseline_prompt` (singleton — REQ-F002-010)

```sql
CREATE TABLE IF NOT EXISTS baseline_prompt (
  id         TEXT PRIMARY KEY,   -- fixed singleton key, always the literal 'singleton'
  text       TEXT,               -- the baseline; NULL = never defined / cleared (REQ-F002-046)
  updated_at TEXT,               -- ISO-8601
  updated_by TEXT                -- staff id (parent REQ-029c actor)
);
```

Singleton enforcement: the repo always reads/writes `id = 'singleton'` and uses
`INSERT ... ON CONFLICT(id) DO UPDATE` (upsert). At-most-one logical baseline is guaranteed
by the fixed PK. Reading before any write returns "not defined" (no row → `text: null`).

### 2.2 `workspace_baseline_state` (one row per applied workspace — REQ-F002-010/010c/010d)

```sql
CREATE TABLE IF NOT EXISTS workspace_baseline_state (
  workspace_id         TEXT PRIMARY KEY,  -- opaque product handle (parent REQ-021b)
  remainder            TEXT,              -- stored workspace remainder; NULL/'' = none (F-002 + F-003 co-written)
  applied_composed_hash TEXT,            -- lowercase-hex SHA-256 of last-written composed prompt (REQ-F002-010c)
  applied_baseline_hash TEXT,            -- lowercase-hex SHA-256 of baseline at last apply (REQ-F002-010c)
  applied_at           TEXT              -- ISO-8601
  -- composition_mode added additively below (REQ-F002-010d) — F-003-owned, F-002 read-only
);
```

### 2.3 The shared `composition_mode` column (REQ-F002-010d — load-bearing)

Added via the additive `PRAGMA table_info` guard loop **with NO SQL default**:

```
['workspace_baseline_state', 'composition_mode', 'TEXT']   -- i.e. ADD COLUMN composition_mode TEXT
```

Contract F-002 must honor exactly (REQ-F002-010d/059):

- **`DEFAULT NULL`, never `DEFAULT 'append'`.** NULL is the real, distinguishable state
  "F-003 has not tracked this workspace." Every pre-existing row stays NULL after the ALTER →
  byte-identical to rev 3.
- F-002 is the **schema-definer** of this column (it lives on F-002's table) but **never
  writes, defaults, or normalizes it.** It only reads it null-safely.
- Allowed non-null values are exactly `'append' | 'inherit'` (F-003-written). `'override'` is
  invalid and never written by F-003. **F-002 defends against any unrecognized stored value by
  treating it as NULL** (REQ-F002-059 fallback; test (f)).
- Backward-compat rests on the NULL value, not on the column's absence. F-002 ships before
  F-003; the per-workspace honoring only engages once F-003 persists a non-null value.

Hashing (REQ-F002-010c): `applied_composed_hash`/`applied_baseline_hash` and every "by hash"
comparison (REQ-F002-023/047) use lowercase-hex **SHA-256** over the exact UTF-8 bytes. Live
in `compose.ts` as `sha256Hex(s: string): string`.

Persistence choices: reuse the existing `better-sqlite3` handle and WAL DB — no new store,
no new engine data. The engine remains authoritative for the live prompt; the console persists
only baseline + tracking (never a copy of the live prompt as authoritative, REQ-F002-010a).

### 2.4 Repository interface (`baseline.repo.ts`)

```ts
export interface BaselineRow { text: string | null; updated_at: string | null; updated_by: string | null; }
export interface WorkspaceStateRow {
  workspace_id: string;
  remainder: string | null;
  applied_composed_hash: string | null;
  applied_baseline_hash: string | null;
  applied_at: string | null;
  composition_mode: string | null;   // READ-ONLY for F-002 (REQ-F002-010d)
}

export const baselineRepo = {
  getBaseline(): BaselineRow;                                  // no row → { text:null, ... }
  setBaseline(text: string, updatedBy: string, ts: string): void;   // upsert id='singleton'
  clearBaseline(updatedBy: string, ts: string): void;         // set text=NULL (REQ-F002-046)
  getState(workspaceId: string): WorkspaceStateRow | undefined;
  listStates(): WorkspaceStateRow[];
  // upsert of ONLY F-002-owned columns; MUST NOT touch composition_mode (REQ-F002-010d)
  upsertAppliedState(row: Omit<WorkspaceStateRow, 'composition_mode'>): void;
  deleteState(workspaceId: string): void;                     // orphan cleanup (REQ-F002-051)
};
```

`upsertAppliedState` writes exactly `remainder`, `applied_composed_hash`,
`applied_baseline_hash`, `applied_at` (the F-002-owned columns) via an explicit column list;
it never names `composition_mode`, so an insert leaves it NULL and an update leaves it
untouched — satisfying "F-002 never writes/defaults/normalizes it" statically.

---

## 3. Interface contracts — the three divergence-prone pieces (pinned)

All live in `bff/src/baseline/compose.ts`, pure and unit-testable. Types reference the
spec's `'prepend' | 'overwrite' | 'fill'` operator mode and the resolved-branch vocabulary
`'prepend' | 'baseline-only' | 'overwrite' | 'fill'`.

```ts
export const SENTINEL: string;  // fixed BFF constant, the contract of record (REQ-F002-011).
// Illustrative value: "\n\n===== workspace-specific instructions (managed below the baseline) =====\n\n"

export type OperatorMode = 'prepend' | 'overwrite' | 'fill';
export type ResolvedMode = 'prepend' | 'baseline-only' | 'overwrite' | 'fill';
export type ClassifyMode = 'prepend' | 'baseline-only';   // status path: no operator mode
```

### 3.1 `compose` (REQ-F002-011 / 056 / 057) — byte-exact

`compose(B: string | null, R: string | null, mode: OperatorMode | 'prepend'): string`

Treat "empty/null" as: `B` is empty/null when `B == null || B === ''`; likewise `R`. (The
spec's "empty/blank" for `fill`'s live-prompt test is applied to the LIVE prompt `P`, not
here — see 3.4.)

- `mode = 'prepend'` (REQ-F002-011), full domain incl. cleared baseline:
  - `B` empty/null → returns `R ?? ''` (cleared baseline strips the segment + sentinel;
    empty when `R` also empty).
  - `B` non-empty, `R` empty/absent → returns `B`.
  - `B` non-empty, `R` non-empty → returns `B + SENTINEL + R` (byte-for-byte).
- `mode = 'overwrite'` (REQ-F002-056):
  - `B` non-empty → returns `B` (no sentinel, no `R`; prior prompt discarded on engine).
  - `B` empty/null → returns `R ?? ''` (same clear semantics as prepend).
- `mode = 'fill'` (REQ-F002-057) — note `fill` is decided against the live prompt `P` at the
  call site, not inside `compose`. When the service decides to write in `fill`, it calls
  `compose(B, '', 'fill')` which returns `B` (baseline alone) for non-empty `B`; a `fill`
  write is only issued when `P` is empty. When `B` empty/null, nothing is filled (service
  skips). For symmetry `compose(B, R, 'fill')` returns `B` when `B` non-empty else `R ?? ''`,
  but the service never passes a non-empty `R` in `fill`.

**`baseline-only`** is NOT a `compose` operator mode; it is realized as `compose(B, '', 'prepend')`
= `B` (the effective baseline-alone write with the stored remainder retained-but-suppressed,
REQ-F002-059). Do not empty the stored remainder for `baseline-only`.

### 3.2 First-apply remainder capture (REQ-F002-012) — `prepend` only

`deriveRemainderOnFirstApply(P: string | null): string` — structural, no stored state:

- `P` empty/blank → `''`.
- `P` contains `SENTINEL` → substring of `P` **after its first** `SENTINEL` occurrence (the
  pre-sentinel segment, a prior baseline, is discarded — prevents doubled baseline).
- `P` non-empty and no `SENTINEL` → `P` verbatim (operator-authored prompt preserved as
  remainder).

Re-apply (state row exists) recomposes from the stored remainder (REQ-F002-013), except when
resolving an override (REQ-F002-025 preserve → new remainder = current live prompt).

### 3.3 Effective-mode resolver (REQ-F002-059) — preview/apply path only

`resolveEffectiveMode(operatorMode: OperatorMode, storedCompositionMode: string | null): ResolvedMode`

```
storedCompositionMode === 'append'   → 'prepend'
storedCompositionMode === 'inherit'  → 'baseline-only'
otherwise (NULL, absent, OR any unrecognized value incl. 'override')
                                     → operatorMode   // the default (backward-compat / R4-5 fallback)
```

Result:
- A stored `append`/`inherit` workspace is composed non-destructively even when the operator
  selected `overwrite` (test (b)/(d)). A stored mode NEVER reaches the destructive `overwrite`
  branch (REQ-F002-056/059).
- A NULL / untracked / unrecognized-value row uses the operator mode as default → byte-identical
  to rev 3 (test (a)/(f)).

This `resolvedMode` is captured per-workspace into the `confirmToken` snapshot and returned on
`BaselinePreviewItem.resolvedMode`. It **folds in the operator mode for NULL rows** and lives
ONLY on `/preview` → `/apply`. It is NEVER used on the status surface.

### 3.4 Applying a resolved mode to one workspace (service, uses 3.1–3.3)

Given resolved mode `m`, baseline `B`, live prompt `P`, stored remainder `R`:
- `m = 'prepend'`: remainder = first-apply-derive(P) if no state row, else `R` (or current
  live prompt when the operator chose `preserve` on an overridden ws). Composed =
  `compose(B, remainder, 'prepend')`. Store remainder.
- `m = 'baseline-only'`: composed = `B` (`compose(B,'','prepend')`). Store remainder =
  **unchanged** (retained-but-suppressed). No preserve/discard machinery (REQ-F002-050/025).
- `m = 'overwrite'`: composed = `B` (`compose(B,R,'overwrite')`). On verified write, store
  remainder = `''` (REQ-F002-056).
- `m = 'fill'`: if `P` empty/blank → composed = `B`, store remainder = `''`; if `P` non-empty
  → **skipped** (no write), outcome `skipped` with message (REQ-F002-057). `B` empty/null →
  all skipped.

### 3.5 Classifier (REQ-F002-023) — status path only, uses `classifyMode` NOT `resolvedMode`

Two functions, no operator mode anywhere:

```ts
// classifyMode is derived ONLY from the stored composition_mode; NULL → 'prepend'.
classifyModeOf(storedCompositionMode: string | null): ClassifyMode
//   'inherit' → 'baseline-only'; 'append' → 'prepend'; NULL/absent/unrecognized → 'prepend'.

effective(B: string | null, remainder: string | null, cm: ClassifyMode): string
//   cm === 'baseline-only' → B ?? ''      (baseline alone, even if remainder non-empty)
//   cm === 'prepend'       → compose(B, remainder, 'prepend')
//   an empty remainder collapses every branch to (B ?? '').

classifyState(P, B, remainder, appliedComposedHash, storedCompositionMode): BaselineSyncState
```

`classifyState` — ordered, FIRST-MATCH-WINS (rev 8 precedence, REQ-F002-023):

1. `never-applied` — no `workspace_baseline_state` row.
2. `synced` — `P === effective(B, remainder, classifyMode)`.
3. `stale` — NOT synced AND `sha256Hex(P) === appliedComposedHash` (console last wrote exactly
   `P`; baseline changed since → needs re-sync). **This step precedes step 4.**
4. `overridden` — none of the above (edited out-of-band since last apply).

The precedence in step 3 is load-bearing: a row last written under operator `overwrite`/`fill`
(remainder `''`, `applied_composed_hash = hash(oldB)`) whose baseline changed to `newB`
classifies **`stale`** (`hash(P)==applied_composed_hash`), never `overridden`. A stored
`inherit`/`baseline-only` ws whose live `P == B` with a retained non-empty remainder is
`synced`, not `overridden`.

`BaselineWorkspaceStatus` carries **no** `resolvedMode` (undefined on the status surface). The
status route (`GET /api/baseline-prompt/status`) is a bare read with no `mode` parameter.

---

## 4. API layer plan (matches §7.2 exactly — 5 routes)

`bff/src/routes/baseline.routes.ts`, all under `/api`, all staff-session-guarded (parent
REQ-012, already enforced by the global session guard), error bodies `{ message }` (parent
REQ-097a). Thin handlers delegating to `baseline.service.ts`.

| Method / path | Req body | Resp | Store/engine | Mutates → event |
|---|---|---|---|---|
| `GET /api/baseline-prompt` | — | `BaselinePrompt` | store read | no (REQ-F002-015) |
| `PUT /api/baseline-prompt` | `{ text: string }` | `BaselinePrompt` | store write | yes (store) → `admin.baseline_prompt.updated` `cleared:false` (REQ-F002-016/035) |
| `DELETE /api/baseline-prompt` | — | `BaselinePrompt` | store write (`text`→NULL) | yes (store) → `admin.baseline_prompt.updated` `cleared:true` (REQ-F002-046/035) |
| `GET /api/baseline-prompt/status` | — | `BaselineStatusView` | ws list (parent REQ-030) + per-ws live read (parent REQ-031) + store | no (REQ-F002-024) |
| `GET /api/baseline-prompt/preview?mode=` | `mode` query (default `prepend`) | `BaselinePreview` | live reads (parent REQ-031); mints+stores `confirmToken`, NO engine write | no engine write; dry run + intentional token side-effect (REQ-F002-019) |
| `POST /api/baseline-prompt/apply` | `{ confirmToken, typedConfirmation, mode, overrides?: {workspaceId, resolution}[] }` | `200 BaselineApplyResult` | per-ws `PATCH /api/workspaces/:id/settings` (parent REQ-032) | yes → one `admin.workspace.updated` per applied ws + one `admin.baseline_prompt.applied` summary (REQ-F002-021/035) |

The route table in §7.2 lists five rows but names six paths (`GET`, `PUT`, `DELETE` all on
`/api/baseline-prompt`); the "5 routes" count is the five distinct path patterns
(`/api/baseline-prompt`, `.../status`, `.../preview`, `.../apply`). All six method+path handlers
are implemented.

Validation / status codes to pin:
- `PUT`: trimmed, whitespace-only rejected `400` (REQ-F002-018). Clearing is DELETE-only.
- `preview`: `mode` absent → default `prepend`; unknown mode → `400` (REQ-F002-055).
- `apply`: absent/malformed `confirmToken` OR absent/unknown `mode` → `400`; stale/superseded
  token (new preview minted, baseline changed, target-set changed, or `mode` ≠ token's mode) →
  `409`; `typedConfirmation` ≠ bound phrase → `409`; `overrides` naming a non-overridden ws →
  `409`; non-empty `overrides` in `overwrite`/`fill` mode, or naming a `baseline-only` ws →
  `400`. On any whole-apply rejection: zero engine writes (REQ-F002-021/047/048/050).
- Cleared baseline + no tracked workspace → apply `400` "no baseline defined"; preview returns
  empty items (REQ-F002-046).

### 4.1 §7.1 product-types additions (`product-types.ts`)

Add verbatim the nine types from §7.1: `BaselinePrompt`, `BaselineSyncState`,
`BaselineWorkspaceStatus`, `BaselineStatusView`, `BaselinePreviewItem`, `BaselinePreview`,
`BaselineApplyOutcome` (`'applied'|'failed'|'skipped'|'diverged'`), `BaselineApplyResultItem`,
`BaselineApplyResult`. No `BaselineApplyJob`, no `202/jobId`, no cursor fields (deleted,
REQ-F002-049). `BaselinePreviewItem.resolvedMode` is `'prepend'|'baseline-only'|'overwrite'|'fill'`
and is preview/apply-only; `BaselineWorkspaceStatus` carries no `resolvedMode` (§7.1 comment).

### 4.2 Event catalog additions (`catalog.ts`)

Add to `AdminEventName`: `'admin.baseline_prompt.updated'`, `'admin.baseline_prompt.applied'`.
Add payload types:

```ts
export interface BaselineUpdatedPayload { contentRef: { length: number; hash: string } | null; cleared: boolean; }
export interface BaselineAppliedPayload {
  appliedCount: number; failedCount: number; skippedCount: number; divergedCount: number;
  appliedBaselineHash: string;
  appliedWorkspaceIds: string[];        // disjoint from failedOrDivergedWorkspaceIds (REQ-F002-035/M9)
  failedOrDivergedWorkspaceIds: string[];
}
```

`admin.baseline_prompt.updated` is a store write, not an engine mutation: emit with
`verified: true` (store-confirmed, deliberate deviation from parent REQ-029c, REQ-F002-035 M5).
Each verified per-workspace fan-out write emits one ordinary `admin.workspace.updated` (parent
REQ-032) — reuse `workspace.service.updateWorkspaceSettings` so this event + its audit + its
verify all come for free.

---

## 5. Data flow (main scenarios, textual)

**Set baseline (`PUT`):** validate/trim → `baselineRepo.setBaseline` → emit
`admin.baseline_prompt.updated {cleared:false}` (verified:true) → audit → return `BaselinePrompt`.
Zero engine writes (REQ-F002-016).

**Status (`GET /status`):** list live workspaces (parent REQ-030); reconcile orphan state rows
(skip/omit deleted, REQ-F002-051); for each live ws, fresh engine read of `P` (parent REQ-031),
load state row, `classifyState(P, B, remainder, applied_composed_hash, composition_mode)`;
assemble `BaselineStatusView` with per-state counts. No `mode`, no `resolvedMode`,
no engine write.

**Preview (`GET /preview?mode=`):** validate `mode`; target set = all live workspaces (or
tracked-only when baseline cleared, REQ-F002-052/046); for each ws: fresh live read `P`,
`resolvedMode = resolveEffectiveMode(mode, composition_mode)`, compute
`currentPromptHash = sha256Hex(P)`, and the composed value(s) per resolved branch
(`baseline-only` → single `B`; `overwrite`/`fill` → single/skip; `prepend` non-overridden →
single; `prepend` overridden → both `composedIfPreserve`/`composedIfDiscard`). Mint
`confirmToken` binding {mode, target-set membership, baseline text, per-ws currentPromptHash,
per-ws resolvedMode, override candidates} + `confirmationPhrase`; store snapshot; return
`BaselinePreview`. Zero engine writes (the token mint is the sole, intentional side-effect,
REQ-F002-019 M6).

**Apply (`POST /apply`):** validate token (400 vs 409 per §4) + `typedConfirmation` + `mode` +
`overrides` domain. If all valid, run the bounded-concurrency fan-out over the target set
(REQ-F002-058): for each ws, fresh live read; **per-ws divergence check** —
`sha256Hex(P) !== snapshot.currentPromptHash` OR recomputed
`resolveEffectiveMode(mode, current composition_mode)` branch ≠ snapshot.resolvedMode branch →
outcome `diverged`, NO write (REQ-F002-047). Otherwise compute composed per §3.4, `PATCH`
via the existing workspace service (verify-after-write, parent REQ-028) → `applied`/`failed`;
`fill`/missing-override → `skipped`. On each verified write, `baselineRepo.upsertAppliedState`.
Emit one `admin.baseline_prompt.applied` summary + (via the reused workspace service) one
`admin.workspace.updated` per applied ws; audit per-workspace breakdown (REQ-F002-036). Return
`200 BaselineApplyResult` — never a uniform success when any failed/diverged (REQ-F002-022a).

**Bounded concurrency (REQ-F002-058):** the fan-out issues write+verify with a fixed
concurrency limit (batched, e.g. a small worker-pool over the ≤200 target set) so wall-clock
stays under p95 < 60 s while each write+verify still honors parent REQ-028 individually. No
job id, no polling, single blocking request. Escape valve (>200 ws or measured p95 > 60 s) is
a spec re-open, not a silent runtime fallback.

**Clear (`DELETE`):** set `text`→NULL; emit `admin.baseline_prompt.updated {cleared:true}`;
previously-synced workspaces become `stale`; stripping to remainder-alone happens only on the
next explicit apply (REQ-F002-046/053). Zero engine writes.

---

## 6. Key decisions (alternatives considered → why rejected)

- **Two separate mode functions (`resolveEffectiveMode` vs `classifyModeOf`) instead of one
  shared "mode" helper.** Alternative: a single mode resolver used by both preview and status.
  Rejected because rev 8 fixed a CONTRADICTION precisely here — `resolvedMode` folds in the
  operator apply mode (NULL row can be `overwrite`/`fill`); `classifyMode` never does (NULL row
  is always `prepend`). Sharing one function would re-introduce the exact bug the spec closed.
  They live in the same pure module but are distinct exported functions with distinct call
  sites (status route never imports `resolveEffectiveMode`).

- **Reuse `workspace.service.updateWorkspaceSettings` for each fan-out write** rather than a new
  baseline-specific engine call. Rejected the alternative (a dedicated baseline adapter path):
  it would duplicate verify-after-write + `admin.workspace.updated` + audit and risk drift from
  parent REQ-032. Reuse keeps the fan-out a thin loop and guarantees per-write parity with an
  ordinary settings save (REQ-F002-001/022).

- **Synchronous bounded apply (Ruling B).** Alternative async `202 {jobId}` + polling +
  cursor pagination was explicitly deleted (REQ-F002-049/054). We implement the synchronous
  model with in-request bounded concurrency; no worker, no job store, no new routes.

- **`composition_mode` added with no SQL default, read-only, unrecognized→NULL.** Alternatives:
  (a) `DEFAULT 'append'` — rejected, destroys the distinguishable "untracked" NULL state and
  breaks rev-3 backward compat (REQ-F002-010d/R4-1); (b) F-002 normalizes/validates the column —
  rejected, that is F-003's ownership; F-002 must never write it. Treating unrecognized values
  as NULL keeps F-002 safe even against an out-of-domain F-003 write (test (f)).

- **Singleton via fixed PK + upsert** rather than a one-row CHECK/trigger. Simplest thing that
  enforces "at most one logical baseline" with the existing better-sqlite3 style; no extra
  trigger machinery (contrast the audit_log append-only triggers, which are justified by an
  immutability requirement F-002 does not have).

- **Scale-appropriate simplicity.** No hexagonal layering, no repository interface abstraction
  beyond the existing `*.repo.ts` object style, no event sourcing. One service, one pure
  module, one repo — matched to a ≤200-workspace, single-tenant feature.

---

## 7. Risks & the parts most likely to need revision

- **Orphan-cleanup wiring (REQ-F002-051) is genuinely ambiguous in the spec vs. the codebase.**
  The spec says "on `admin.workspace.deleted` the console MUST delete the state row," but the
  existing bus has no consumer that owns BFF-store cleanup, and `workspace.service` already does
  post-delete cleanup inline (`forget(productId)`). Two viable wirings exist (a bus subscriber
  vs. an inline `baselineRepo.deleteState` call in `deleteWorkspace`); this design does NOT
  pick one — flagged for the implementer. Do not implement both (double-delete is harmless but
  the subscription plumbing is real work). **This is the one place I stopped rather than guess.**

- **Composition/classification predicates** (§3) are the spec-flagged highest-divergence risk;
  they are pinned here to byte-exact behavior + the spec's own test ids, but any implementer
  drift (e.g. treating `baseline-only` as a `compose` branch, or using `resolvedMode` on the
  status path) reintroduces a closed bug. Most likely to need a focused contract-test pass.

- **`SENTINEL` value** is a documented BFF constant and the contract of record; changing it
  after any deployment silently reclassifies every workspace (first-apply structural detection
  keys off it). Treat it as frozen once shipped.

- **Bounded-concurrency tuning** (REQ-F002-058): the concurrency limit is a performance knob,
  not a correctness one, but a too-high limit could overload the engine and a too-low one could
  blow the 60 s p95 bound. Likely to be tuned against the real per-write p95 (REQ-F002-039).

- **Divergence check comparison basis** (REQ-F002-047, R4-3): the mode-change divergence must
  compare **resolved F-002 branches**, not raw F-003 strings (`append`→`prepend` gaining an
  explicit `append` is NOT divergent). Easy to get subtly wrong; pinned in §5 apply flow.

---

## Sequencing / dependency notes

Strict build order (each depends on the prior):

1. **`db.ts` migration** (tables + additive `composition_mode` column). Nothing else can
   prepare statements until the tables exist (better-sqlite3 prepares eagerly and throws on a
   missing table — see the existing db.ts comment).
2. **`compose.ts`** (pure module) — no DB dependency; can be built and unit-tested in parallel
   with (1), but the service needs it.
3. **`baseline.repo.ts`** — depends on (1).
4. **product-types.ts + catalog.ts additions** — no runtime deps; needed by (5).
5. **`confirm-token.ts`** — depends on types; needed by (6).
6. **`baseline.service.ts`** — depends on (2)(3)(4)(5) + the existing `workspace.service`,
   `emitter`, `audit`.
7. **`baseline.routes.ts`** + register in `index.ts` — depends on (6).
8. **web feature folder** — depends on the product types (4) and the routes (7).

**Ships before F-003 exists.** The design assumes ONLY F-003's *schema contract* — the
nullable, no-default `composition_mode` column — never F-003's code:

- F-002 defines the column (it lives on F-002's table) but never writes/defaults/normalizes it.
- With the column all-NULL (F-003 unbuilt) F-002 behaves byte-identically to rev 3
  (`resolveEffectiveMode` and `classifyModeOf` both fall back to the operator/`prepend` path).
- No F-002 module imports any F-003 module. `resolveEffectiveMode`/`classifyModeOf` read the
  raw stored string and treat anything outside `{'append','inherit'}` (incl. NULL and a
  hypothetical stray `'override'`) as the NULL fallback, so an out-of-domain value cannot
  crash or mis-route F-002 even if F-003 later misbehaves.
- The additive `ADD COLUMN composition_mode TEXT` (no default) is safe to run whether or not
  F-003 later also references the column; F-003 will add its own read/write/validate logic on
  the same column without a further migration.
