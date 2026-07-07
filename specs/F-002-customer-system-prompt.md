# F-002: Customer-Wide Baseline System Prompt — Specification

Status: Draft rev 1 — for implementation and QA review
Feature brief (authoritative intent): `briefs/F-002-customer-system-prompt.md`
Parent spec (conventions, architecture, shared requirements): `specs/admin-console.md` (v1, rev 7)
Grounding references: `docs/anythingllm-surface.md` (engine surface), `docs/design/01-bff-architecture.md`,
`docs/design/02-product-api.md`, `docs/design/03-data-models.md`, `docs/design/05-web-architecture.md`.

This is an **additive** feature spec layered on `specs/admin-console.md`. It introduces a distinct
requirement-ID namespace, **`REQ-F002-###`**, so its IDs never collide with the parent spec's
`REQ-###` series. Section numbers (§1, §1.1, …) below are **local to this document**; downstream
tests cite the `REQ-F002-###` id (globally unique) plus the local §. Requirement IDs and section
numbers are **stable**: never renumber or reuse an id; append new ids or mark items **DEPRECATED**.

Where this spec reuses parent-spec machinery (the BFF anti-corruption layer REQ-021/026/027,
verify-after-write REQ-028, the `admin.*` event bus §14, the audit log REQ-093/093a, the
`DangerConfirm` typed-token pattern §8, and the no-partial-success stance REQ-098/098b), it cites the
parent `REQ-###` id rather than restating it.

---

## §1 Overview & Scope

### §1.1 Purpose
F-002 gives staff operators a **console-managed, customer-wide baseline system prompt**: a single
persona/tone/guardrail foundation, defined once in the console, that the console **fans out** to every
one of the customer's workspaces by writing each workspace's existing per-workspace system-prompt
field. It establishes the console's first **above-workspaces** settings scope.

- REQ-F002-001 — The console persists ONE baseline system prompt per deployment (one deployment ==
  one customer, parent REQ-001/002) in its own BFF-owned store, and applies it to workspaces by
  writing the product `systemPrompt` field via the existing per-workspace settings path
  (`PATCH /api/workspaces/:id/settings`, parent REQ-032; product `systemPrompt` → engine
  `openAiPrompt`, verified in `bff/src/engine/mappers.ts`). *Test:* defining a baseline and applying
  it results in each targeted workspace's engine `openAiPrompt` reflecting the composed prompt (§5),
  written through the BFF, never from the browser.

### §1.2 Enforcement altitude (honest, best-effort)
- REQ-F002-002 — Because the engine exposes exactly ONE prompt field per workspace and no native
  base+workspace layering (grounding `docs/anythingllm-surface.md`; confirmed single field in
  `mappers.ts` / `WorkspaceSettings.tsx`), F-002 enforcement is **best-effort, not tamper-proof**.
  The console CANNOT guarantee the baseline survives a later out-of-band edit (via this console's
  per-workspace editor, the customer app, or the native UI). The spec's guarantee is limited to:
  (a) deterministic composition on apply (§5), and (b) **detection and visible surfacing of drift**
  (§6.4) — NOT prevention. Any requirement implying prevention is out of scope (§2). *Test:* after a
  successful apply, a subsequent out-of-band edit of a workspace's prompt is not blocked by the
  console, and that workspace is subsequently reported as drifted/overridden (REQ-F002-024), not as
  synced.

### §1.3 Relationship to the parent spec
- REQ-F002-003 — F-002 introduces NO new engine capability and NO new custody path: every engine
  write it performs is a `PATCH /api/workspaces/:id/settings` (parent REQ-032) subject to the parent
  spec's custody boundary (parent REQ-021/021a/026/027), verify-after-write (parent REQ-028), error
  mapping (parent REQ-023/097), and audit (parent REQ-093). The baseline itself is console-owned data
  (§4), not engine data. *Test:* a static scan confirms no new engine `/v1/*` path or engine field
  name is introduced by F-002 code in `web/`; the fan-out issues only product `PATCH /api/workspaces/:id/settings`
  calls plus the console-store reads/writes of §7.

---

## §2 Out of Scope (Non-Goals)

Mirrors the brief's Out of Scope and the parent spec's custody boundary.

- REQ-F002-004 — The native AnythingLLM instance **Default System Prompt**
  (`/system/default-system-prompt`) and **Prompt Variables** (`/system/prompt-variables`) are session-
  auth-only and unreachable under the API-key custody model (grounding `docs/anythingllm-surface.md`
  "hard boundary at the API layer"; parent non-goal pattern REQ-117/120). F-002 MUST NOT read, write,
  or attempt to drive the native default; it is implemented purely as a console-managed baseline
  fanned out to per-workspace prompts. *Test:* no F-002 code path references
  `/system/default-system-prompt` or `/system/prompt-variables`.
- REQ-F002-005 — **True tamper-proof enforcement** of the baseline is a non-goal (REQ-F002-002); the
  engine's single prompt field cannot provide it.
- REQ-F002-006 — **Continuous / automatic enforcement** (a background job that re-pushes on drift, or
  an engine-side hook that auto-applies the baseline to newly created workspaces) is a non-goal for
  this revision. Application and re-sync are always explicit, operator-initiated actions (§6.3, §6.5).
  New-workspace inheritance is surfaced as pending drift for the operator to apply (§6.4), not
  auto-applied. (Deferred — REQ-F002-041.)
- REQ-F002-007 — Per-workspace system-prompt **editing** in its own right is unchanged and remains the
  parent spec's territory (parent REQ-032; F-003's per-workspace prompting is separate). F-002 only
  adds the baseline layer that composes into that same field.
- REQ-F002-008 — No change to the customer-facing chat UI or end-user experience beyond the prompt
  content the workspace already consumes.
- REQ-F002-009 — Cross-deployment / multi-customer baseline sharing is out of scope (one deployment ==
  one customer, parent REQ-110).

---

## §3 Definitions & Glossary

- **Baseline** — the console-managed customer-wide system-prompt text (a single string), stored in the
  BFF (§4). May be undefined (never set).
- **Workspace remainder** — the per-workspace-specific portion of a workspace's prompt that the
  console preserves as distinct from the baseline, so it can recompose the composed prompt when the
  baseline changes (§5).
- **Composed prompt** — the string the console actually writes to a workspace's `systemPrompt`
  (engine `openAiPrompt`): a deterministic function of the baseline and that workspace's remainder
  (§5, REQ-F002-011).
- **Boundary sentinel** — a fixed, console-owned marker string separating the baseline segment from
  the workspace-remainder segment inside a composed prompt (§5, REQ-F002-011). Defined by a BFF
  constant; stable across a deployment.
- **Fan-out / apply** — the operation that composes and writes the baseline into a set of target
  workspaces via per-workspace `PATCH /api/workspaces/:id/settings` (§6.3).
- **Sync state** — a per-workspace classification of how the workspace's live engine prompt relates to
  the current baseline: one of `synced`, `stale`, `overridden`, `never-applied` (§6.4,
  REQ-F002-023).
- **Affected count** — the number of workspaces whose composed prompt WOULD change if an apply ran
  now (the blast radius, §6.2).

---

## §4 Data Model (BFF-owned store)

The baseline and its per-workspace sync bookkeeping are the console's OWN data (boundary rule 3,
`docs/design/03-data-models.md`), persisted in the existing embedded SQLite store alongside
`workspace_map`, `audit_log`, and the outbox. The engine remains authoritative for the live workspace
prompt; the console persists only the baseline and the tracking state needed to recompose and detect
drift.

- REQ-F002-010 — The BFF store adds two tables (or equivalent), migrated in `store/db.ts`:
  - **`baseline_prompt`** (singleton — at most one row, since one deployment == one customer):
    `id` (fixed singleton key), `text` (TEXT, the baseline; NULL/absent = never defined),
    `updated_at` (TEXT ISO-8601), `updated_by` (TEXT staff id, parent REQ-029c actor).
  - **`workspace_baseline_state`** (one row per workspace the console has applied to):
    `workspace_id` (TEXT PK — the opaque product handle, parent REQ-021b), `remainder` (TEXT, the
    stored workspace remainder; empty/NULL = no per-workspace portion),
    `applied_composed_hash` (TEXT — hash of the composed prompt the console last wrote to that
    workspace), `applied_baseline_hash` (TEXT — hash of the baseline in effect at last apply),
    `applied_at` (TEXT ISO-8601).
  *Test:* migrations create both tables; `baseline_prompt` enforces at most one logical baseline;
  reading the baseline before any write returns "not defined".
- REQ-F002-010a — The store never persists a copy of the live workspace prompt as authoritative; the
  live prompt is always read from the engine via `GET /api/workspaces/:id` (parent REQ-031). The
  `workspace_baseline_state` row records only what the console last WROTE (hashes) and the remainder
  it manages. *Test:* drift status (§6.4) is computed against a fresh engine read, not against a
  cached prompt value.
- REQ-F002-010b — Secrets are not involved; the baseline is non-secret free text. It is nonetheless
  subject to the same log-hygiene discipline as other console data (no accidental credential logging,
  parent REQ-094) but is NOT redacted in events/audit (it is the very content being managed). *Test:*
  a baseline-update event/audit entry carries a content reference (see REQ-F002-030) and is not
  treated as a secret.

---

## §5 Composition Semantics (normative default: **prepend-with-boundary**)

The brief flags composition semantics as "the crux" (overwrite / prepend / fill-when-blank / other).
This spec selects **prepend-with-boundary** as the single normative composition mode for this
revision because it best satisfies the stated intent — the baseline is guaranteed present at the top
of every applied workspace's prompt WHILE preserving operator-authored per-workspace content — within
the engine's single-field constraint. Alternatives (overwrite; fill-when-blank; an operator-selectable
mode) are recorded in §11 as an assumption awaiting human ratification (REQ-F002-038).

- REQ-F002-011 — **Composition function.** For a baseline `B` (non-empty) and a workspace remainder
  `R`, the composed prompt is:
  - `compose(B, R) = B` when `R` is empty/absent;
  - `compose(B, R) = B + SENTINEL + R` otherwise,
  where `SENTINEL` is the fixed **boundary sentinel** — a stable, documented BFF constant (an
  illustrative value: `"\n\n===== workspace-specific instructions (managed below the baseline) =====\n\n"`).
  The exact sentinel bytes are defined by the BFF constant and are the contract of record. *Test:*
  with a non-empty remainder, the composed prompt equals baseline + sentinel + remainder byte-for-byte;
  with an empty remainder, it equals the baseline exactly.
- REQ-F002-012 — **First-apply remainder capture (preserve existing per-workspace prompts).** When the
  console applies to a workspace that has NO `workspace_baseline_state` row and whose current engine
  prompt `P` is:
  - empty/blank → the remainder is empty; composed = `B`;
  - non-empty and NOT already a console composition (does not equal `compose(currentBaseline, …)` for
    any stored state) → the console captures `P` verbatim as that workspace's remainder, so the
    operator-authored prompt is PRESERVED as the workspace-specific segment; composed =
    `compose(B, P)`.
  *Test:* applying to a workspace whose prompt is "Answer only in French." yields a composed prompt of
  baseline + sentinel + "Answer only in French.", and the stored remainder is "Answer only in French."
- REQ-F002-013 — **Recomposition on baseline change.** When the baseline changes and the operator
  re-syncs (§6.5), the console recomposes each tracked workspace as
  `compose(newBaseline, storedRemainder)` — the stored remainder is retained across baseline changes,
  so per-workspace content is not lost when only the baseline changes. *Test:* changing the baseline
  and re-syncing updates the baseline segment while leaving each workspace's remainder segment
  byte-identical.
- REQ-F002-014 — **No silent remainder mutation.** The console MUST NOT alter a stored remainder as a
  side effect of a baseline change or re-sync; the remainder changes only when (a) captured on first
  apply (REQ-F002-012), or (b) explicitly re-derived after an operator resolves an override
  (REQ-F002-025). *Test:* a baseline-only change followed by re-sync leaves every stored remainder
  unchanged.

---

## §6 Functional Requirements

### §6.1 Defining & persisting the baseline

- REQ-F002-015 — The console provides a console-level surface to VIEW the current baseline (its text,
  `updated_at`, `updated_by`, or a clear "not yet defined" state) via `GET /api/baseline-prompt`
  (§7). *Test:* before any baseline is set, the view reports "not defined"; after a set, it shows the
  stored text and metadata.
- REQ-F002-016 — The console lets an operator CREATE or REPLACE the baseline text via
  `PUT /api/baseline-prompt` (§7). This write persists to the console store ONLY; it performs NO
  engine write and does NOT change any workspace prompt on its own. *Test:* a `PUT /api/baseline-prompt`
  updates the stored baseline and issues zero `PATCH /api/workspaces/:id/settings` calls; no workspace
  prompt changes until an explicit apply (§6.3).
- REQ-F002-017 — Defining/replacing the baseline is a **staff-authenticated** action (parent
  REQ-012) and is audited (REQ-F002-030). Setting the baseline is NOT itself a §8-class dangerous
  operation (it writes no engine state); the danger gate applies to the APPLY (REQ-F002-021). *Test:*
  an unauthenticated `PUT /api/baseline-prompt` returns 401; a successful set produces one audit
  entry and no engine mutation.
- REQ-F002-018 — Baseline text validation: the baseline is free text with the same trimming/emptiness
  discipline as other product free-text (trimmed; a whitespace-only baseline is rejected client-side
  and by the BFF with 400, reusing parent REQ-096-style validation). Clearing the baseline (setting it
  to empty) is an explicit distinct action, not achievable by submitting whitespace. *Test:* a
  whitespace-only baseline is rejected with 400; a non-empty baseline is accepted.

### §6.2 Pre-write preview & affected count (blast-radius comprehension)

- REQ-F002-019 — Before any apply, the console MUST be able to produce a **dry-run preview** via
  `GET /api/baseline-prompt/preview` (§7) that, WITHOUT writing anything, returns for the target set:
  the **affected count** (workspaces whose composed prompt would change), the unchanged/no-op count,
  and a **per-workspace diff** pairing each workspace's current live engine prompt with the composed
  prompt that would be written. The preview reads live workspace prompts via the engine (parent
  REQ-031) through the BFF. *Test:* the preview endpoint issues zero engine writes; its affected count
  equals the number of workspaces whose `compose(...)` differs from their live prompt; each item
  carries current vs. proposed prompt text.
- REQ-F002-020 — The preview response carries a server-issued **`confirmToken`** that binds a
  subsequent apply to this previewed blast radius (REQ-F002-021). *Test:* a preview returns a
  non-empty `confirmToken`; an apply presenting a stale/absent token is rejected (REQ-F002-021).

### §6.3 Apply / fan-out & partial-failure

- REQ-F002-021 — The console applies the baseline via `POST /api/baseline-prompt/apply` (§7), which
  fans out per-workspace `PATCH /api/workspaces/:id/settings` writes (product `systemPrompt`, parent
  REQ-032) for exactly the workspaces whose composed prompt changes. Apply is a **§8-class dangerous
  operation** (parent REQ-080) gated by the `DangerConfirm` typed-token pattern (parent REQ-078c/081):
  the operator MUST type the exact confirmation token displayed with the preview, and the request MUST
  echo the `confirmToken` from REQ-F002-020; a mismatched, stale, or absent token is rejected (409/400)
  and NO fan-out occurs. *Test:* the fan-out is not issued until the typed token matches; an apply with
  a stale token performs zero engine writes and is rejected.
- REQ-F002-022 — **Per-workspace verify-after-write.** Each per-workspace write in the fan-out is
  individually verified using the parent verify-after-write contract (parent REQ-028: re-read the
  workspace, confirm `openAiPrompt` equals the composed value). A workspace counts as `applied` only
  when verified; a write that fails upstream or fails verification counts as `failed` and that
  workspace retains its prior engine prompt. On a verified apply, the console updates that workspace's
  `workspace_baseline_state` (`remainder`, `applied_composed_hash`, `applied_baseline_hash`,
  `applied_at`). *Test:* a fan-out where one workspace's PATCH is forced to fail marks that workspace
  `failed`, leaves its engine prompt unchanged, and does not update its state row, while other
  workspaces are `applied`.
- REQ-F002-022a — **No atomicity claim; partial-failure is explicit and legible (fan-out analog of
  parent REQ-098/098b).** The fan-out is a set of independent per-workspace writes and is NOT presented
  as an all-or-nothing transaction — the engine offers no cross-workspace transaction. The apply
  response enumerates a **per-workspace outcome list** (`applied` / `failed` / `skipped`) with counts.
  The UI MUST NOT show a single "all applied" success when any workspace `failed`; it surfaces the
  mixed result per workspace (echoing parent REQ-098b's per-item legibility) and identifies exactly
  which workspaces did not receive the baseline. *Test:* an apply that succeeds on 3 of 4 workspaces
  renders 3 applied and 1 failed with the failed workspace named — never a single uniform "all saved"
  banner.
- REQ-F002-022b — **Re-tryability.** Failed workspaces from a partial apply remain in their prior
  state and are eligible for a subsequent apply/re-sync targeting just the still-drifted set; a re-run
  is idempotent for already-synced workspaces (they are `skipped` no-ops). *Test:* re-running apply
  after a partial failure targets only the previously-failed (still-drifted) workspaces and skips the
  already-synced ones.

### §6.4 Drift & override visibility; new-workspace inheritance

- REQ-F002-023 — **Sync-state classification.** For each workspace the console computes a sync state
  from a fresh engine read of the live prompt `P`, the current baseline `B`, and the stored state
  (`remainder`, `applied_composed_hash`):
  - `never-applied` — no `workspace_baseline_state` row (the console has never applied here);
  - `synced` — `P == compose(B, remainder)`;
  - `stale` — `P` matches the last-applied composition (`hash(P) == applied_composed_hash`) but the
    baseline has since changed (so `compose(B, remainder) != P`) — needs re-sync (§6.5);
  - `overridden` — `P` matches neither (edited out-of-band since last apply).
  *Test:* a workspace with an out-of-band prompt edit reports `overridden`; a workspace unchanged
  since apply but whose baseline was edited afterward reports `stale`; an untouched, current one
  reports `synced`; a never-touched one reports `never-applied`.
- REQ-F002-024 — **Drift visibility surface.** The console exposes drift/override status across
  workspaces via `GET /api/baseline-prompt/status` (§7) and presents it so the operator can see, at a
  glance, which workspaces carry the current baseline versus diverge — so the "single source of truth"
  promise does not silently erode (ux_risk_read). Status MUST distinguish the four states of
  REQ-F002-023 and MUST NOT encode them by color alone (accessibility, REQ-F002-029). *Test:* the
  status view lists every workspace with its sync state; the four states are visually distinguishable
  without relying solely on color.
- REQ-F002-025 — **Resolving an override.** For an `overridden` workspace, the console MUST NOT
  silently clobber the out-of-band prompt on the next apply. Re-applying the baseline to an
  `overridden` workspace requires the operator to make a deliberate choice, surfaced in the preview
  diff (REQ-F002-019): either (a) treat the current out-of-band prompt as the new remainder
  (preserve it beneath the baseline), or (b) discard it and recompose from the stored remainder. The
  chosen action is reflected in the per-workspace preview item and confirmed under the apply danger
  gate (REQ-F002-021). *Test:* applying to an overridden workspace does not proceed without an
  explicit preserve-or-discard choice; choosing "preserve" makes the out-of-band text the new
  remainder.
- REQ-F002-026 — **New-workspace inheritance is surfaced, not automatic.** A workspace created after
  the baseline exists appears as `never-applied` in the status surface (REQ-F002-024) and is included
  in the next preview/apply target set. The console does NOT auto-write the baseline on workspace
  creation (no engine hook exists; REQ-F002-006). *Test:* creating a workspace after a baseline is set
  lists it as `never-applied`; it receives the baseline only after an explicit apply.

### §6.5 Re-sync on baseline change

- REQ-F002-027 — When the baseline changes (REQ-F002-016), all previously-synced workspaces become
  `stale` (REQ-F002-023). The console offers a **re-sync** that re-runs the fan-out
  (REQ-F002-021/022/022a) to recompose `compose(newBaseline, remainder)` for the target set, under the
  same preview + danger-gate + per-workspace-verify + partial-failure contract as a first apply.
  *Test:* after a baseline edit, previously-synced workspaces report `stale`; a re-sync returns them to
  `synced` with their remainders preserved (REQ-F002-013), reporting per-workspace outcomes.

---

## §7 API Surface

Product API, consistent with `docs/design/02-product-api.md` conventions: product vocabulary only, no
engine field names cross the boundary (parent REQ-021a); all routes require a staff session except
where the parent spec exempts them (parent REQ-012); error bodies are `{ message: string }` rendered
verbatim (parent REQ-097a). All routes are under `/api`.

### §7.1 Product types (excerpt — added to the shared `bff/src/types/product-types.ts`, parent REQ-025)

```ts
export interface BaselinePrompt {
  text: string | null;              // the baseline; null = never defined
  updatedAt: string | null;         // ISO-8601
  updatedBy: string | null;         // staff id (parent REQ-029c actor)
}

export type BaselineSyncState = 'synced' | 'stale' | 'overridden' | 'never-applied';

export interface BaselineWorkspaceStatus {
  workspaceId: string;              // opaque product handle (parent REQ-021b)
  displayName: string;
  syncState: BaselineSyncState;
  hasWorkspaceRemainder: boolean;   // whether a per-workspace segment is stored
}

export interface BaselineStatusView {
  baseline: BaselinePrompt;
  workspaces: BaselineWorkspaceStatus[];
  counts: Record<BaselineSyncState, number>;
}

export interface BaselinePreviewItem {
  workspaceId: string;
  displayName: string;
  currentPrompt: string | null;     // live engine prompt (for the diff)
  composedPrompt: string;           // what would be written
  willChange: boolean;
  overrideResolution?: 'preserve' | 'discard'; // required for overridden items (REQ-F002-025)
}

export interface BaselinePreview {
  affectedCount: number;            // workspaces whose composed prompt would change
  unchangedCount: number;
  items: BaselinePreviewItem[];
  confirmToken: string;             // typed-token binding preview → apply (REQ-F002-020/021)
}

export type BaselineApplyOutcome = 'applied' | 'failed' | 'skipped';

export interface BaselineApplyResultItem {
  workspaceId: string;
  displayName: string;
  outcome: BaselineApplyOutcome;
  verified: boolean;                // per-workspace verify-after-write (parent REQ-028)
  message?: string;                 // failure detail, rendered verbatim
}

export interface BaselineApplyResult {
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  items: BaselineApplyResultItem[]; // per-workspace legibility (REQ-F002-022a)
}
```

### §7.2 Routes

| Method / path | Req | Resp | Engine / store call(s) | Mutates → event |
|---|---|---|---|---|
| `GET /api/baseline-prompt` | — | `BaselinePrompt` | console store read | no (REQ-F002-015) |
| `PUT /api/baseline-prompt` | `{ text: string }` | `BaselinePrompt` | console store write | yes (console store) → `admin.baseline_prompt.updated` (REQ-F002-016/030) |
| `GET /api/baseline-prompt/status` | — | `BaselineStatusView` | `GET /v1/workspaces` + per-ws live prompt read + store | no (REQ-F002-024) |
| `GET /api/baseline-prompt/preview` | — | `BaselinePreview` | live prompt reads (parent REQ-031); no writes | no (REQ-F002-019) — dry run |
| `POST /api/baseline-prompt/apply` | `{ confirmToken: string, overrides?: {workspaceId, resolution}[] }` | `BaselineApplyResult` | per-ws `PATCH /api/workspaces/:id/settings` (parent REQ-032) | yes → one `admin.workspace.updated` per applied ws (parent REQ-032) + one `admin.baseline_prompt.applied` summary (REQ-F002-031) |

- REQ-F002-028 — Every route above is BFF-brokered (parent REQ-021/026/027): the browser calls only
  these product `/api/*` routes; the fan-out's engine writes are the existing
  `PATCH /api/workspaces/:id/settings` mapping (parent REQ-032), and the baseline data lives only in
  the BFF store. *Test:* a static scan finds no F-002 engine path/field name in `web/`; the apply
  route's engine traffic is exactly per-workspace workspace-update calls.

---

## §8 Web UI Requirements

The web surface follows `docs/design/05-web-architecture.md` conventions and reuses existing building
blocks (`DangerConfirm`, `ErrorBanner`, the list/detail layout, the "blank = inherit" idiom). A new
above-workspaces settings section/route hosts F-002 (the app's first non-workspace-scoped settings
home).

- REQ-F002-029 — **New console-level settings surface.** A dedicated settings section (e.g.
  `features/baseline-prompt/`) presents: the baseline editor (a labeled textarea matching the existing
  system-prompt field idiom), the drift/status list (REQ-F002-024), and the preview + apply flow. The
  baseline field follows the existing label/`aria-invalid` validation patterns
  (`components/FieldValidation.tsx`). *Test:* the baseline section is reachable from top-level
  navigation and is not bound to a single workspace.
- REQ-F002-030 — **Pre-write preview/diff is mandatory in the UI.** The operator MUST see the preview
  (affected count + per-workspace current-vs-composed diff, REQ-F002-019) BEFORE the apply confirm is
  enabled; the apply cannot be initiated without a preview having produced the `confirmToken`. *Test:*
  the apply control is inert until a preview has loaded; it submits the previewed `confirmToken`.
- REQ-F002-031 — **Danger/confirm gating echoes `DangerConfirm` (parent §8, REQ-078c/080/081).** The
  apply is gated by the typed-token confirmation dialog: it names the blast radius (the affected
  count), states the irreversible consequence (workspace prompts will be rewritten; the console is the
  only place the prior composed value is recorded, and engine writes have no native undo —
  REQ-F002-036), and requires typing the exact displayed token before the fan-out is issued. *Test:*
  the fan-out call fires only after the typed token matches the displayed token.
- REQ-F002-032 — **Partial-failure legibility (UI side of REQ-F002-022a).** After an apply the UI
  renders the per-workspace outcome list — applied / failed / skipped with counts — and never a single
  uniform success banner when any workspace failed; failed-workspace `message` values are rendered
  verbatim (parent REQ-097a). *Test:* a mixed-result apply renders per-workspace outcomes and names the
  failed workspaces.
- REQ-F002-033 — **Drift status is non-color-only and legible.** Sync states (REQ-F002-023) are
  encoded with text/iconography in addition to any color (WCAG non-color-only encoding). *Test:* sync
  states remain distinguishable in a grayscale/color-blind simulation.
- REQ-F002-034 — **Accessibility of the new async/bulk surfaces (mostly inherited; deltas made
  explicit, ux_risk_read).** The preview dialog, the confirm dialog, and the async apply-progress /
  result region require deliberate focus management (focus moves into the dialog on open, returns to
  the trigger on close) and status messaging announced to assistive technology via an ARIA live
  region — specifically async apply progress and the partial-failure result. *Test:* opening the
  confirm dialog moves focus into it; the apply result (including failures) is announced via a live
  region; keyboard-only operation completes a preview → confirm → result cycle.

---

## §9 Events & Audit

F-002 events use the parent spec's `admin.*` namespace and event-bus mechanism (`docs/design/03-data-models.md`,
parent §14). Two new event names are added; per-workspace engine writes reuse the existing
`admin.workspace.updated` event.

- REQ-F002-035 — **Event catalog additions.**
  - `admin.baseline_prompt.updated` — emitted after a `PUT /api/baseline-prompt` persists to the
    console store (REQ-F002-016). Payload: actor (parent REQ-029c), a content reference (e.g. baseline
    length and/or hash; the baseline is non-secret but the event need not carry the full text),
    `timestamp`. This is a console-store write, not an engine mutation, so it carries no engine
    verify (`verified` is not applicable / recorded as store-confirmed true).
  - `admin.baseline_prompt.applied` — emitted once after a fan-out completes (REQ-F002-021). Payload:
    actor, `appliedCount`, `failedCount`, `skippedCount`, the applied baseline hash, and the list of
    affected workspace `id`s, `timestamp`.
  - Each **verified** per-workspace write in the fan-out emits one `admin.workspace.updated` (parent
    REQ-032) exactly as an ordinary workspace-settings save does — no new per-workspace event is
    introduced.
  *Test:* setting the baseline emits one `admin.baseline_prompt.updated` and zero engine events;
  an apply that changes three workspaces emits three `admin.workspace.updated` plus one
  `admin.baseline_prompt.applied` whose counts sum correctly.
- REQ-F002-036 — **Audit.** Baseline definition/replacement and every apply/re-sync are recorded in
  the append-only audit log (parent REQ-093/093a) with actor, action, target (baseline singleton; for
  apply, the affected workspace `id`s and per-workspace outcome), timestamp, and outcome. A partial
  apply records the per-workspace applied/failed breakdown. *Test:* a baseline set produces one audit
  entry; a partial apply produces an audit entry capturing which workspaces succeeded and which failed.

---

## §10 Non-Functional Requirements

- REQ-F002-037 — **Custody boundary (inherited, restated for this feature).** The browser never calls
  the engine directly and never receives the API key; all baseline reads/writes and the fan-out go
  through the BFF, which injects the key server-side (parent REQ-013/021/021a/026). *Test:* no
  browser-originated request targets an engine URL for any F-002 flow; the API key never appears in a
  browser payload or bundle.
- REQ-F002-038 — **Reversibility caveat (honest).** Engine prompt writes have no native undo; once the
  fan-out writes a composed prompt, the prior engine value is not recoverable from the engine. The
  console's `workspace_baseline_state` (stored remainder + last-applied hashes) plus the captured
  remainder on first apply (REQ-F002-012) are the ONLY record of pre-apply per-workspace content, and
  only to the extent the console captured it. The apply confirmation (REQ-F002-031) MUST state this
  irreversibility. *Test:* the confirm dialog's copy states that the write is not natively undoable and
  that the console is the sole record of the prior workspace-specific content.
- REQ-F002-039 — **Fan-out performance & bounds.** Under the parent spec's nominal single-instance
  load (≤ 200 workspaces, parent REQ-100), a preview renders within p95 < 3000 ms and an apply
  completes (all per-workspace writes + verifies) within a bounded, progress-reported window; the UI
  streams or polls progress rather than blocking opaquely. Preview and apply MUST paginate/stream
  results rather than assume a small fixed count. *Test:* with 200 seeded workspaces, the preview
  renders under threshold and the apply reports incremental per-workspace progress.
- REQ-F002-040 — **Concurrency / staleness.** The preview reads live prompts immediately before
  presenting the diff, and the apply is bound to that preview via `confirmToken` (REQ-F002-020); if
  the live state has materially diverged from the previewed state at apply time (e.g. a workspace was
  edited out-of-band between preview and apply), the affected per-workspace write is reported as a
  divergence in the result rather than silently overwriting an unpreviewed change, consistent with the
  fresh-read-before-write posture (parent REQ-092/092a) and no-silent-clobber rule (REQ-F002-025).
  *Test:* editing a workspace out-of-band between preview and apply causes that workspace's apply item
  to surface the divergence rather than blindly overwrite.

---

## §11 Open Questions / Assumptions for Human Ruling

These are decisions the spec could not responsibly make alone; each has a recommended default that the
requirements above ADOPT provisionally, so implementation is not blocked, but each needs human
ratification. Where a default is adopted, the governing REQ is cited.

- REQ-F002-041 — **Composition semantics ratification (the crux).** This spec adopts
  **prepend-with-boundary** as the sole normative mode (§5, REQ-F002-011). Alternatives not
  implemented pending a ruling: (a) **overwrite** (baseline replaces the whole field — strongest
  presence guarantee, destroys per-workspace prompts); (b) **fill-when-blank** (write only where the
  workspace prompt is empty — non-destructive, weakest guarantee); (c) an **operator-selectable mode**
  per apply. *Ruling needed:* confirm prepend as default, or select an alternative / expose a mode
  selector.
- REQ-F002-042 — **Enforcement strength.** This spec adopts **explicit, operator-initiated apply and
  re-sync with drift detection** and NO continuous/automatic enforcement or auto-apply-on-create
  (REQ-F002-006/026). *Ruling needed:* is best-effort detection sufficient, or is
  continuous/scheduled re-sync (and/or auto-apply to new workspaces) required for GTM? Note: true
  tamper-resistance remains impossible via the single field regardless (REQ-F002-002).
- REQ-F002-043 — **Guardrail hardness.** The brief asks whether "guardrail" implies the baseline MUST
  survive workspace edits. This spec assumes **best-effort is acceptable** (REQ-F002-002/005). *Ruling
  needed:* if a hard, tamper-proof guarantee is actually required, F-002's whole approach changes
  (it cannot be met through the API-key-reachable single prompt field) and must be re-scoped.
- REQ-F002-044 — **Interaction with the native Default System Prompt.** A customer could set
  AnythingLLM's native instance-level default out-of-band; the console can neither read nor write it
  (REQ-F002-004). This spec assumes the two are independent and that the console's guarantee is scoped
  strictly to the per-workspace field it writes; the exact engine-level layering/precedence between a
  workspace `openAiPrompt` and the native default is NOT verified in the grounding. *Ruling needed:*
  confirm this is acceptable, and whether the UI should warn operators that a native default may exist
  invisibly beneath the managed baseline.
- REQ-F002-045 — **Scale.** The performance bounds (REQ-F002-039) assume the parent spec's ≤ 200
  workspaces per deployment. *Ruling needed:* confirm the typical/maximum workspaces-per-customer so
  the bulk-apply progress model and drift-visibility UI are sized correctly. If materially larger,
  streaming/batched apply and pagination become mandatory rather than advisory.

---

## §12 Traceability to the Brief

| Brief element | Addressed by |
|---|---|
| Problem: no console-managed customer-wide baseline | §1.1 REQ-F002-001 |
| Proposed Direction: console persists baseline, writes per-workspace via existing API | §4 REQ-F002-010, §6.1, §6.3; parent REQ-032 reuse |
| Open Q — composition semantics (the crux) | §5 (prepend default) + REQ-F002-041 |
| Open Q — enforcement strength / re-sync / auto-apply | §6.3–§6.5, REQ-F002-006/026/027 + REQ-F002-042 |
| Open Q — persistence & per-workspace sync/drift tracking | §4 REQ-F002-010, §6.4 REQ-F002-023 |
| Open Q — baseline-change propagation & partial-failure | §6.5 REQ-F002-027, §6.3 REQ-F002-022/022a |
| Open Q — conflict with native default | REQ-F002-004 + REQ-F002-044 |
| Open Q — scale | REQ-F002-039 + REQ-F002-045 |
| Open Q — guardrail tamper-resistance | REQ-F002-002/005 + REQ-F002-043 |
| Design (blast radius, preview/diff, affected count) | §6.2 REQ-F002-019/020, §8 REQ-F002-030 |
| Design (partial-failure legibility) | §6.3 REQ-F002-022a, §8 REQ-F002-032 |
| Design (drift/override visibility) | §6.4 REQ-F002-023/024/025 |
| Design (new-workspace inheritance) | §6.4 REQ-F002-026 |
| Design (accessibility: focus, live-region, non-color status) | §8 REQ-F002-033/034 |
| Design (DangerConfirm typed-token reuse) | §8 REQ-F002-031 (parent REQ-078c/080/081) |
| Out of Scope: native default, prompt variables, per-ws editing, chat UI, tamper-proof | §2 REQ-F002-004..009 |

---

### Self-check note (per analyst workflow step 5)
The composition function (§5), sync-state classification (REQ-F002-023), and partial-failure contract
(REQ-F002-022a) are the requirements most at risk of divergent implementation; each is pinned to an
exact predicate (byte-level compose, hash comparisons against stored state, per-workspace outcome
enumeration) and a concrete test so two implementers cannot both claim compliance with different
behavior. The one deliberately unresolved decision — composition mode — is isolated in §5 as a single
swappable function and flagged for ruling (REQ-F002-041), so a mode change is contained.
