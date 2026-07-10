# F-002: Customer-Wide Baseline System Prompt — Specification

Status: Draft rev 9 — records a human ruling on REQ-F002-044 (native Default System Prompt interaction);
adds a UI warning requirement (REQ-F002-060); NOT a review-fix round;
for implementation and QA review
(rev 8 baseline: resolves two BLOCKING findings from adversarial review of rev 7, round 1 of ≤2)
(rev 7 baseline: resolves spec-review `docs/spec-review-F002-rev6.md`)
(rev 4 baseline: companion change for F-003 ruling REQ-F003-042 — fan-out honors per-workspace composition_mode)
(rev 3 baseline: revised against `docs/spec-review-F002.md` and four human rulings A–D on REQ-F002-041/042/043/053/054)
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
  console, and that workspace is subsequently reported as `overridden` (REQ-F002-023, the sync-state
  classification predicate), not as `synced`.

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
  auto-applied. (Deferred — REQ-F002-042.)
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
  a baseline-update event/audit entry carries a content reference (see REQ-F002-035) and is not
  treated as a secret.
- REQ-F002-010c — **Hash algorithm (resolves review M1).** `applied_composed_hash` and
  `applied_baseline_hash` are lowercase-hex **SHA-256** digests computed over the exact UTF-8 byte
  sequence of, respectively, the composed prompt the console last wrote to that workspace and the
  baseline text in effect at that apply. The same algorithm is used wherever this spec compares "by
  hash" (REQ-F002-023, REQ-F002-047). *Test:* two applies that write byte-identical composed prompts
  record identical `applied_composed_hash` values; a one-byte change produces a different digest.
- REQ-F002-010d — **Shared store; the `composition_mode` column (REVISED rev 5 — nullable-NULL
  contract, resolves review R4-1/R4-N1/R4-5).** The `workspace_baseline_state` row is **shared** across
  F-002 and F-003. The two features split the row by **read/write role**, not by exclusive ownership of
  every value:
  - F-002 is the **schema-definer** of `remainder` and the applied-hash bookkeeping
    (`applied_composed_hash`, `applied_baseline_hash`, `applied_at`) (REQ-F002-010) and **writes** them
    on every verified fan-out apply (REQ-F002-022). F-003's per-workspace editor **also writes**
    `remainder` and the applied hashes on its own saves (F-003 REQ-F003-023 step 4, the single-model
    reconciliation of F-003 REQ-F003-003) — so these are **co-written**, not F-002-exclusive. "Owns"
    here means schema-definer plus a defined read/write split, NOT sole writer (resolves review R4-N1).
  - **`composition_mode` is schema-defined and written by F-003**, and **read-only for F-002**. Per the
    shared data-model contract with F-003 (revised in parallel to match), the column is:
    - **nullable TEXT, `DEFAULT NULL`** — NOT `DEFAULT 'append'`. A NULL (or absent) value is the real,
      distinguishable state **"F-003 has not tracked this workspace."** F-003 writes a non-null value
      **only** when it tracks/derives a workspace (on the first editor save or explicit track), **never**
      as a blanket migration default. An `ALTER TABLE ADD COLUMN composition_mode TEXT` (no SQL default)
      therefore leaves every pre-existing F-002 row **NULL**, and those rows keep resolving to the
      operator-selected apply mode (REQ-F002-059) — byte-identical to rev 3.
    - Allowed non-null values are **exactly `'append' | 'inherit'`** (F-003 REQ-F003-013/016).
      `'override'` is **not** valid (F-003 dropped it, REQ-F003-050), so a stored value can never select
      F-002's destructive `overwrite` branch (REQ-F002-059).
  - F-002 **never** writes, defines a default for, or normalizes `composition_mode`; it only **reads**
    it null-safely to resolve the effective per-workspace mode during the fan-out (REQ-F002-059). F-003
    owns validating/normalizing the column (rejecting or coercing out-of-domain values); F-002 defends
    against an unrecognized stored value by treating it as NULL (REQ-F002-059, resolves review R4-5).
  *Test:* F-002 code never issues a write that sets, defaults, or normalizes `composition_mode`; the
  fan-out's read of the column is null-safe; a row whose `composition_mode` is NULL (or a column absent
  because F-003 is unbuilt) behaves exactly as rev 3 (REQ-F002-059 test (a)).
- REQ-F002-051 — **Orphaned-state cleanup (resolves review M4).** Status and preview enumerate live
  workspaces via the product list route (parent REQ-030); a `workspace_baseline_state` row whose
  `workspace_id` no longer resolves to a live workspace is an orphan. On `admin.workspace.deleted`
  (parent event bus §14) the console MUST delete the corresponding `workspace_baseline_state` row, and
  status/preview MUST NOT emit rows for workspaces the engine no longer lists. *Test:* deleting a
  tracked workspace removes its state row; a workspace list that omits a previously-tracked id yields a
  status/preview that omits it too.

---

## §5 Composition Semantics (operator-selectable mode: **prepend | overwrite | fill**)

The brief flags composition semantics as "the crux" (overwrite / prepend / fill-when-blank / other).
Per **human Ruling A** (REQ-F002-041, RATIFIED), composition is **operator-selectable per apply**: the
operator picks one of three modes — `prepend` (baseline above preserved per-workspace content),
`overwrite` (baseline replaces the whole field, destructive to per-workspace prompts), or `fill`
(write the baseline only where the workspace prompt is empty, non-destructive). The chosen `mode` is a
first-class parameter of preview and apply, is part of the confirmed snapshot bound by `confirmToken`
(REQ-F002-055/047), and threads through composition (§5), preview (§6.2), drift (§6.4), the API (§7),
and the UI (§8). `prepend` remains the recommended default; `overwrite` is a §8 danger-class operation
because it destroys per-workspace prompts (REQ-F002-056, §8 REQ-F002-031).

**Rev 4/5 refinement (companion to F-003 ruling REQ-F003-042):** the operator-selected per-apply `mode`
is no longer applied *uniformly* to every workspace. Per the 2026-07-07 human ruling on sibling spec
F-003 (REQ-F003-042), the **per-workspace, persistent `composition_mode`** stored on the shared
`workspace_baseline_state` row (schema-defined and written by F-003, read-only for F-002,
REQ-F002-010d/REQ-F003-013) is **authoritative** for a workspace that **has a non-null value**; the
operator-selected apply `mode` becomes the **default** applied only to workspaces whose stored
`composition_mode` is **NULL/absent** (F-003 has not tracked them). Backward compatibility rests on the
**NULL (untracked)** state, not on the column being absent (rev 5, resolves review R4-1): F-002 is
byte-identical to rev 3 for every workspace F-003 has not tracked (mode NULL), and a workspace's
F-003-tracked mode governs a customer-wide apply the moment F-003 tracks it. The resolution rule is
specified in **REQ-F002-059**.

- REQ-F002-055 — **Operator-selectable composition mode (Ruling A machinery; REVISED rev 4 — now the
  DEFAULT mode, not the uniform mode, per F-003 ruling REQ-F003-042).** Preview and apply
  carry a `mode: 'prepend' | 'overwrite' | 'fill'` parameter (§7.1). **[Rev 3 behavior, now scoped:]**
  the mode selects which branch of the composition function (REQ-F002-011/056/057) is evaluated,
  how the remainder is captured, and how drift is classified (REQ-F002-047/040). **[Rev 4 revision:]**
  the operator-selected `mode` is no longer applied *uniformly* across the fan-out — it is the
  **default** applied only to workspaces that have **no stored per-workspace `composition_mode`**; a
  workspace that has a stored per-workspace mode (owned by F-003, REQ-F002-010d/REQ-F003-013) uses
  **that** mode instead. The per-workspace resolution, its mapping from F-003's `inherit | append`
  onto F-002's compose branches, and its backward-compatible fallback are specified in
  **REQ-F002-059** (which this id now defers to). The default presented in the UI is still `prepend`.
  The chosen operator `mode` is included in the previewed snapshot the `confirmToken` binds
  (REQ-F002-020/048/050); changing the operator `mode` after a preview invalidates a stale
  `confirmToken` exactly as a baseline or target-set change does (→ 409, REQ-F002-047). An apply body
  with an absent or unrecognized operator `mode` is rejected **400**. *Test:* a preview and its apply
  must agree on the operator `mode`; an apply presenting a `confirmToken` minted under a different
  operator `mode` is rejected 409 with zero engine writes; an apply with a missing/unknown operator
  `mode` is rejected 400; a workspace carrying a stored per-workspace mode is composed under THAT mode,
  not the operator `mode` (REQ-F002-059).
- REQ-F002-059 — **Per-workspace composition-mode resolution in the fan-out (rev 4; companion to F-003
  ruling REQ-F003-042, 2026-07-07).** The human ruling on sibling spec F-003 (REQ-F003-042) made the
  **per-workspace, persistent `composition_mode` authoritative** over F-002's single per-apply mode.
  Accordingly, the fan-out (REQ-F002-021), the preview (REQ-F002-019), and re-sync (REQ-F002-027)
  resolve an **effective per-workspace mode** for every workspace in the target set (REQ-F002-052),
  rather than applying one operator-selected mode uniformly:
  - **Effective mode** for a workspace = the workspace's **stored `composition_mode`** when one is
    present on its `workspace_baseline_state` row (the column F-003 adds and owns,
    REQ-F002-010d/REQ-F003-013), ELSE the **operator-selected apply `mode`** (REQ-F002-055) as the
    **default**.
  - **F-003's two modes map onto F-002's non-destructive compose branches** (REQ-F003-016): a stored
    `composition_mode = 'append'` resolves to F-002 `prepend` (`compose(B, remainder, 'prepend')`); a
    stored `composition_mode = 'inherit'` resolves to **baseline-only** (`compose(B, "", 'prepend')`,
    i.e. effective `B`, with the stored `remainder` **retained but suppressed**, never emptied). F-003
    **dropped its `override` mode** (REQ-F003-050), so a stored `composition_mode` can **NEVER** select
    F-002's destructive `overwrite` branch (REQ-F002-056): a workspace's own stored mode only ever
    yields a non-destructive `prepend`/baseline-only write, and its stored `remainder` is preserved.
  - **Backward compatibility / honest sequencing (F-003 may be unbuilt).** When the shared store has
    **no `composition_mode` column at all** (F-003 not yet built, REQ-F002-010d) OR a given workspace's
    row has **no stored `composition_mode`** (a workspace never touched by F-003, or a `never-applied`
    workspace with no row at all), the effective mode for that workspace **is** the operator-selected
    apply `mode` — behavior is **byte-for-byte identical to rev 3**. This backward-compat state is the
    **NULL (untracked) mode**, a real and distinguishable value (REQ-F002-010d, resolves review R4-1),
    not merely the column being absent. F-002 therefore ships **before** F-003 with no behavior change
    whatsoever; the per-workspace honoring engages for a given workspace only once F-003 persists a
    **non-null** `composition_mode` on its shared row. This change is fully backward-compatible.
  - **The operator-selected `mode` remains a real, bound parameter** (REQ-F002-055): it is the default
    for un-stored workspaces, it is still carried in the request and bound into the `confirmToken`
    snapshot (REQ-F002-020/047), and selecting `overwrite` (a §8-destructive selection, §8
    REQ-F002-031) still governs every un-stored workspace and still triggers the danger gate. It no
    longer *overrides* a workspace that carries its own stored mode.
  - **Snapshot binding & mode-change divergence.** The **resolved effective mode per workspace** (the
    `prepend` / `baseline-only` / `overwrite` / `fill` branch) is captured into the previewed snapshot as
    `BaselinePreviewItem.resolvedMode`, bound by `confirmToken` (REQ-F002-020/047), so the write a
    workspace receives is exactly the one previewed. (`resolvedMode` here folds in the operator-selected
    apply `mode` for NULL rows and lives only on this preview/apply path; it is a **different notion**
    from the status-path `classifyMode` of REQ-F002-023, which carries no operator mode — do not conflate
    them.) A stored-`composition_mode` change (via an
    out-of-band F-003 save) between preview and apply is per-workspace **divergence only when it changes
    the resolved branch** (compared in F-002 vocabulary, not the raw F-003 string — REQ-F002-047,
    resolves review R4-3): such a workspace's write is withheld and it is reported **`diverged`** while
    the apply proceeds for the rest (no whole-apply rejection). A mode change that resolves to the same
    branch (a byte-identical write) is not divergent.
  *Test:* (a) with F-003 absent (no `composition_mode` column) an apply behaves identically to rev 3 —
  every workspace is composed under the operator-selected `mode`. (b) **A workspace whose stored
  `composition_mode` is `append` keeps its `append`/`prepend` composition after a customer-wide apply
  whose operator-selected mode was `overwrite`** — its engine value is `compose(B, remainder,
  'prepend')` (baseline + sentinel + remainder), NOT the destructive `B`-alone overwrite, and its
  stored `remainder` is preserved (not emptied). (c) A never-touched-by-F-003 workspace in that same
  apply uses the operator-selected `overwrite` and is replaced by `B`. (d) A workspace with stored
  `composition_mode = 'inherit'` receives effective `B` (baseline alone) with its stored `remainder`
  retained. (e) Changing a workspace's stored `composition_mode` after preview marks that workspace
  `diverged` with no write while the rest apply. (f) **A workspace bearing an out-of-domain stored
  `composition_mode` (e.g. `'override'`, a value F-003 REQ-F003-052 would never write) resolves via the
  NULL fallback (REQ-F002-010d) to the operator-selected mode and never reaches the destructive
  `overwrite` branch through the stored-mode path** (resolves review R4-5/R5-N1).
- REQ-F002-011 — **Composition function (`prepend` mode; the recommended default).** For a baseline
  `B`, a workspace remainder `R`, and `mode = 'prepend'`, the composed prompt is defined over the full
  domain including a cleared/undefined baseline (resolves review B2):
  - `compose(B, R, 'prepend') = R` when `B` is empty/null (a **cleared** baseline, REQ-F002-046) — the
    baseline segment and the sentinel are removed and the workspace is restored to its remainder alone
    (which is the empty string when `R` is also empty/null);
  - `compose(B, R, 'prepend') = B` when `B` is non-empty and `R` is empty/absent;
  - `compose(B, R, 'prepend') = B + SENTINEL + R` when both `B` and `R` are non-empty,
  where `SENTINEL` is the fixed **boundary sentinel** — a stable, documented BFF constant (an
  illustrative value: `"\n\n===== workspace-specific instructions (managed below the baseline) =====\n\n"`).
  The exact sentinel bytes are defined by the BFF constant and are the contract of record. *Test:*
  in `prepend` mode with a non-empty baseline and remainder, the composed prompt equals baseline +
  sentinel + remainder byte-for-byte; with an empty remainder it equals the baseline exactly; with a
  cleared (null) baseline it equals the remainder exactly (the empty string when there is no remainder).
- REQ-F002-056 — **Composition function (`overwrite` mode; destructive).** For `mode = 'overwrite'`
  the baseline **replaces the entire** per-workspace prompt field:
  - `compose(B, R, 'overwrite') = B` when `B` is non-empty — the remainder `R` is NOT concatenated and
    NO sentinel is written; the workspace's prior prompt (whatever it was) is discarded on the engine;
  - `compose(B, R, 'overwrite') = R` (the cleared-baseline branch) when `B` is empty/null, identical to
    the clear semantics of REQ-F002-011/046 — restoring the workspace to its stored remainder alone
    (empty when none), so a clear-then-apply strips the field regardless of mode.
  Because it discards per-workspace content on the engine, an apply in `overwrite` mode is a
  **§8-class dangerous operation** with its own blast-radius/affected-count preview and typed
  confirmation (§8 REQ-F002-031). On a verified `overwrite` apply the stored `remainder` for that
  workspace is set to empty (there is no preserved per-workspace segment), and `applied_composed_hash`/
  `applied_baseline_hash` record `B`. *Test:* in `overwrite` mode with a non-empty baseline, the
  composed prompt equals the baseline exactly (no sentinel, no remainder) regardless of the workspace's
  prior prompt, and the stored remainder is emptied.
- REQ-F002-057 — **Composition function (`fill` mode; non-destructive).** For `mode = 'fill'` the
  baseline is written **only where the workspace prompt is currently empty**:
  - a workspace whose current live engine prompt `P` is empty/blank is written
    `compose(B, "", 'fill') = B` (baseline alone) when `B` is non-empty;
  - a workspace whose current live engine prompt `P` is **non-empty** is **skipped** — no write, no
    change — and reported `skipped` (REQ-F002-022b/050) with an explanatory `message`;
  - when `B` is empty/null there is nothing to fill: every workspace is `skipped` (an apply whose
    baseline is null in `fill` mode writes nothing).
  On a verified `fill` write the stored `remainder` is empty (the field held nothing before) and the
  hashes record `B`. `fill` never overwrites operator-authored content, so it needs neither
  double-prepend detection nor override preserve/discard resolution. *Test:* in `fill` mode a workspace
  with an empty prompt receives the baseline alone; a workspace with any existing prompt is skipped
  and its engine prompt is unchanged.
- REQ-F002-012 — **First-apply remainder capture & double-prepend guard (`prepend` mode only,
  resolves review B7).** Double-prepend detection is **relevant only to `prepend` mode**; in
  `overwrite` mode the field is replaced with `B` (REQ-F002-056, no detection needed) and in `fill`
  mode a non-empty field is skipped (REQ-F002-057, never re-composed). When the console applies in
  `prepend` mode to a workspace that has NO `workspace_baseline_state` row (**first apply**), it derives
  the remainder from the current engine prompt `P` by a purely **structural** test that does NOT depend
  on any stored state (there is none on first apply):
  - `P` empty/blank → remainder is empty; composed = `compose(B, "", 'prepend')`;
  - `P` **contains the boundary `SENTINEL`** (i.e., `P` is already a console composition — from a prior
    or lost/rebuilt state row, a re-onboard, or a prompt already carrying the baseline+sentinel, and
    possibly carrying a now-stale baseline segment) → the remainder is the substring of `P` **after its
    first `SENTINEL` occurrence**; the segment before the first `SENTINEL` (a prior baseline) is
    discarded; composed = `compose(B, remainder, 'prepend')`. This concretely prevents a doubled
    baseline (`B + SENTINEL + B + SENTINEL + R`);
  - `P` non-empty and does NOT contain `SENTINEL` → `P` is captured verbatim as the remainder, so the
    operator-authored prompt is PRESERVED as the workspace-specific segment; composed =
    `compose(B, P, 'prepend')`.
  On a **re-apply** in `prepend` mode (a `workspace_baseline_state` row exists) the console recomposes
  from the stored remainder (REQ-F002-013) rather than re-deriving structurally, except when resolving
  an override (REQ-F002-025). Because `SENTINEL` is a distinctive documented constant, treating an
  operator prompt that happens to embed it as already-composed is an accepted, low-probability risk and
  is always visible in the preview diff (REQ-F002-019) before any write. *Test:* applying in `prepend`
  mode to a workspace whose prompt is "Answer only in French." (no sentinel) yields composed = baseline
  + sentinel + "Answer only in French." with stored remainder "Answer only in French."; applying in
  `prepend` mode to a workspace whose prompt is already `X + SENTINEL + Y` yields composed =
  `B + SENTINEL + Y` (never a doubled baseline) with stored remainder `Y`.
- REQ-F002-013 — **Recomposition on baseline change (`prepend`/`overwrite`).** When the baseline
  changes and the operator re-syncs (§6.5) in `prepend` mode, the console recomposes each tracked
  workspace as `compose(newBaseline, storedRemainder, 'prepend')` — the stored remainder is retained
  across baseline changes, so per-workspace content is not lost when only the baseline changes. In
  `overwrite` mode re-sync writes `compose(newBaseline, R, 'overwrite') = newBaseline` (the stored
  remainder is already empty per REQ-F002-056). In `fill` mode a re-sync writes only still-empty
  workspaces and skips the rest (REQ-F002-057). **Per-workspace resolution applies here too (rev 5,
  resolves review R4-N2):** the mode named in this requirement is the *effective* per-workspace mode of
  REQ-F002-059, not a uniform operator mode — a re-sync honors each workspace's stored `composition_mode`
  when present (an `append`/`inherit` workspace re-syncs under `prepend`/`baseline-only` even when the
  operator selected `overwrite`), falling back to the operator mode only for un-stored workspaces.
  *Test:* changing the baseline and re-syncing in
  `prepend` mode updates the baseline segment while leaving each workspace's remainder segment
  byte-identical; the same re-sync in `overwrite` mode writes the new baseline alone.
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
  REQ-012) and is audited (REQ-F002-036). Setting the baseline is NOT itself a §8-class dangerous
  operation (it writes no engine state); the danger gate applies to the APPLY (REQ-F002-021). *Test:*
  an unauthenticated `PUT /api/baseline-prompt` returns 401; a successful set produces one audit
  entry and no engine mutation.
- REQ-F002-018 — Baseline text validation: the baseline is free text with the same trimming/emptiness
  discipline as other product free-text (trimmed; a whitespace-only baseline is rejected client-side
  and by the BFF with 400, reusing parent REQ-096-style validation). Clearing the baseline is an
  explicit distinct action with its own route and semantics (REQ-F002-046), NOT achievable by
  submitting whitespace to `PUT /api/baseline-prompt`. *Test:* a whitespace-only baseline is rejected
  with 400; a non-empty baseline is accepted; clearing is performed only via the dedicated clear route
  (REQ-F002-046).
- REQ-F002-046 — **Clearing the baseline (resolves review B2).** The console provides an explicit clear
  action via `DELETE /api/baseline-prompt` (§7). Clearing sets `baseline_prompt.text` to NULL in the
  console store ONLY; like `PUT` (REQ-F002-016) it performs NO engine write and changes NO workspace
  prompt on its own. After a clear, `compose(null, R) = R` (REQ-F002-011), so previously-`synced`
  workspaces become **`stale`** (the baseline changed — REQ-F002-023) and are restored to their
  remainder alone (baseline segment + sentinel stripped) only when the operator runs the next explicit
  apply/re-sync (REQ-F002-021) — consistent with the no-auto-enforcement stance (REQ-F002-006).
  Clearing is staff-authenticated (parent REQ-012), audited (REQ-F002-036), and emits
  `admin.baseline_prompt.updated` with a `cleared` marker (REQ-F002-035). Preview/apply are permitted
  while the baseline is null **only** to strip it from already-tracked workspaces (target set = tracked
  workspaces, REQ-F002-052); if the baseline was never defined and no workspace is tracked, apply is
  rejected **400** ("no baseline defined") and preview returns an empty item set. The clear's effect on
  applied workspaces is a load-bearing choice surfaced for human ruling (REQ-F002-053). *Test:*
  `DELETE /api/baseline-prompt` sets the stored baseline to null, issues zero engine writes, and marks
  previously-`synced` workspaces `stale`; a subsequent apply rewrites each tracked workspace to its
  remainder alone; an apply with no baseline ever defined and no tracked workspace returns 400.

### §6.2 Pre-write preview & affected count (blast-radius comprehension)

- REQ-F002-019 — Before any apply, the console MUST be able to produce a **dry-run preview** via
  `GET /api/baseline-prompt/preview` (§7) **for a specified `mode`** (REQ-F002-055; the preview query
  carries `mode`, default `prepend`) that, WITHOUT writing any workspace prompt, returns for the target
  set (REQ-F002-052): the **affected count** (workspaces whose composed prompt would change under the
  effective mode), the unchanged/no-op count, and a **per-workspace diff** pairing each workspace's
  current live engine prompt with the composed prompt that would be written. **Per rev 4
  (REQ-F002-059), the mode is resolved PER WORKSPACE**: a workspace with a stored `composition_mode`
  (REQ-F002-010d) is previewed under THAT mode (F-003 `append`→`prepend`, `inherit`→baseline-only); a
  workspace with no stored mode is previewed under the operator-selected `mode` (REQ-F002-055) below.
  The resolved effective mode per workspace is bound into the `confirmToken` snapshot (REQ-F002-020).
  The mode-specific preview semantics below describe each resolved branch:
  - **`prepend`** — for a non-`overridden` workspace the item carries a single
    `composedPrompt = compose(B, R, 'prepend')`; for an `overridden` workspace (REQ-F002-023) the
    composed prompt depends on the operator's not-yet-made preserve/discard choice, so the item instead
    carries BOTH candidates — `composedIfPreserve = compose(B, currentLivePrompt, 'prepend')` and
    `composedIfDiscard = compose(B, storedRemainder, 'prepend')` (REQ-F002-025/050) — resolving the
    ordering paradox without a per-choice re-fetch.
  - **`baseline-only`** (a workspace whose stored `composition_mode = 'inherit'`, REQ-F002-059;
    resolves review R4-4) — the item carries a **single** `composedPrompt = B` (baseline alone; the
    stored `remainder` is retained-but-suppressed, never emptied) and `resolvedMode = 'baseline-only'`.
    This branch is **exempt from the override preserve/discard machinery**: even when the workspace is
    `overridden`, it carries **no** `composedIfPreserve`/`composedIfDiscard` candidates and requires
    **no** `overrides` resolution — the write is `B` regardless, its out-of-band content being
    intentionally discarded by F-003's own gated `inherit` decision (F-003 REQ-F003-025(a)). The diff
    still shows current-live-vs-`B` so the operator sees what `inherit` drops. It is NOT `skipped` for
    lack of a resolution (contrast REQ-F002-050).
  - **`overwrite`** — every non-empty-diff item carries a single `composedPrompt = B` and its diff
    shows the **full replacement**: the current live prompt (what will be **destroyed**) versus `B`.
    There are no preserve/discard candidates (the field is replaced, not composed); the preview
    surfaces the destruction so the danger dialog can name the blast radius (§8 REQ-F002-031).
  - **`fill`** — each item is marked **written** (current prompt empty → `composedPrompt = B`,
    `willChange = true`) or **skipped** (current prompt non-empty → no `composedPrompt`,
    `willChange = false`, with a skip `message`); the affected count is the number of empty workspaces
    that would be filled.
  The preview reads live workspace prompts via the engine (parent REQ-031) through the BFF. Although a
  `GET`, this route has an **intentional server side effect** (resolves review M6): it mints and stores
  the `confirmToken` (REQ-F002-020) bound to the read snapshot **including the chosen `mode`**
  (REQ-F002-055); each call issues a fresh token. *Test:* the preview endpoint issues zero engine
  writes; its affected count equals the number of workspaces whose `compose(..., mode)` differs from
  their live prompt; in `prepend` mode overridden items carry both preserve/discard candidates; in
  `overwrite` mode items show current-vs-`B` with a destruction indicator; in `fill` mode non-empty
  workspaces are marked skipped.
- REQ-F002-020 — The preview response carries a server-issued, opaque **binding `confirmToken`** (a
  nonce) that binds a subsequent apply to this previewed snapshot — the operator-selected **`mode`**
  (REQ-F002-055), the target set, the baseline text, each workspace's `currentPromptHash`, **each
  workspace's resolved effective mode** (the per-workspace branch actually previewed — `prepend`,
  `baseline-only`, `overwrite`, or `fill` — resolved per REQ-F002-059; the referent for the mode-change
  divergence check of REQ-F002-047, resolves review R4-2 — this preview/apply-bound `resolvedMode` folds
  in the operator-selected `mode` and is **distinct from** the status-path `classifyMode` of
  REQ-F002-023, which has no operator mode; the two MUST NOT be conflated), and, for overridden workspaces
  (only meaningful in the `prepend` branch), both resolution candidates (REQ-F002-021/047/050). It is distinct
  from the human-typed danger phrase (REQ-F002-048); the
  response also carries the human-typeable `confirmationPhrase` to display for typing. An apply
  presenting an **absent or malformed** token is rejected **400**; a **well-formed but
  stale/superseded** token is rejected **409** (staleness defined in REQ-F002-047). *Test:* a preview
  returns a non-empty `confirmToken` and a `confirmationPhrase`; an apply with a missing token gets 400
  and one with a superseded token gets 409, both with zero engine writes.
- REQ-F002-052 — **Target set (resolves review M3).** The "target set" for preview/apply/re-sync is
  **all live workspaces the console can enumerate** (parent REQ-030); the **effective writes** are only
  those whose composed prompt differs from their live prompt (all others are `skipped` no-ops,
  REQ-F002-022b). When the baseline is cleared (null), the target set is restricted to already-tracked
  workspaces (REQ-F002-046). This revision provides **no** mechanism for an operator to include/exclude
  individual workspaces from an apply; the set is derived, not hand-picked. *Test:* preview/apply
  consider every live workspace; only changed workspaces are written; there is no per-workspace opt-out
  control.

### §6.3 Apply / fan-out & partial-failure

- REQ-F002-021 — The console applies the baseline via `POST /api/baseline-prompt/apply` (§7), which
  fans out per-workspace `PATCH /api/workspaces/:id/settings` writes (product `systemPrompt`, parent
  REQ-032) for exactly the workspaces whose composed prompt changes under that workspace's **effective
  mode** (resolved per REQ-F002-059: the stored `composition_mode` when present, else the operator-
  selected `mode` of REQ-F002-055) within the target set (REQ-F002-052). Apply is a **§8-class dangerous operation**
  (parent REQ-080) gated by the `DangerConfirm` typed-token pattern (parent REQ-078c/081) using the
  **two distinct artifacts** of REQ-F002-048: the request MUST carry (a) the opaque binding
  `confirmToken` from REQ-F002-020, (b) the `typedConfirmation` the operator typed, and (c) the `mode`
  (REQ-F002-055). The server validates ALL: an absent/malformed `confirmToken` or an absent/unknown
  `mode` → **400**; a stale/superseded `confirmToken` (including a `mode` differing from the one the
  token was minted under) → **409** (REQ-F002-047); a `typedConfirmation` that does not equal the phrase
  bound to that token → **409**. On any of these the whole apply is rejected and NO fan-out occurs (zero
  engine writes). Whole-apply rejection is driven ONLY by token validity, not by per-workspace live
  divergence, which is handled per item (REQ-F002-047). Apply executes **synchronously** (Ruling B,
  REQ-F002-054): the route performs the bounded, batched fan-out (REQ-F002-058) and returns
  **`200 BaselineApplyResult`** directly (applied / failed / skipped / diverged id lists and counts) —
  there is no job id and no polling. *Test:* the fan-out is not issued until a valid `confirmToken`, a
  matching `typedConfirmation`, and a valid `mode` are presented; an apply with a stale token (or a
  `mode` mismatch against the token) performs zero engine writes and is rejected 409; a valid apply
  returns `200` with a `BaselineApplyResult` enumerating per-workspace outcomes.
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
  response enumerates a **per-workspace outcome list** (`applied` / `failed` / `skipped` / `diverged`,
  REQ-F002-047) with counts.
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
- REQ-F002-047 — **Token staleness vs. per-workspace divergence (resolves review B4, M2; mode-aware
  per Ruling A).** A `confirmToken` is **stale/superseded** (→ 409, whole apply rejected, zero writes)
  iff, since it was issued: a newer preview token has been minted, OR the baseline text changed, OR the
  target-set membership changed (a workspace was added/deleted), OR the apply's `mode` differs from the
  `mode` the token was minted under (REQ-F002-055). An **absent or malformed** token, or an
  absent/unknown `mode`, → 400. Token staleness is NOT triggered by an out-of-band edit to an individual
  workspace's live prompt. Instead, such **per-workspace divergence** is detected at write time by
  comparing the workspace's live prompt hash (SHA-256, REQ-F002-010c) against the `currentPromptHash`
  captured in the previewed snapshot: on mismatch the console MUST NOT write that workspace and reports
  it with the outcome **`diverged`** (a value added to `BaselineApplyOutcome`, §7.1) — the apply
  PROCEEDS for the non-diverged workspaces. This divergence check is **mode-independent** (it protects
  the previewed diff in all three modes): in `prepend`/`overwrite` a changed live prompt means the
  previewed replacement/destruction no longer matches reality → `diverged`; in `fill` a workspace
  previewed as empty-and-writable that is now non-empty → `diverged` (not silently filled), while a
  workspace previewed as non-empty-and-skipped stays `skipped`. **Per rev 4/5 (REQ-F002-059; comparison
  basis pinned per review R4-3):** a change to a workspace's stored `composition_mode` (an out-of-band
  F-003 save) between preview and apply is likewise per-workspace divergence, detected in a **single
  vocabulary** — F-002's resolved effective branch, NOT the raw F-003 mode string. At apply the console
  recomputes the workspace's **resolved effective mode** (REQ-F002-059) from its *current* stored
  `composition_mode` and the operator default, and compares it to the **`resolvedMode`** captured in the
  snapshot (REQ-F002-020). Divergence is declared **iff the resolved branch differs** (e.g.
  `prepend`→`baseline-only`, or `baseline-only`→`prepend`); the workspace is then reported `diverged`
  (no write) and the apply proceeds for the rest. A stored-mode change that maps to the **same** resolved
  branch as the snapshot (e.g. an operator-default `prepend` row that gains an explicit
  `composition_mode = 'append'`, which also resolves to `prepend`) is **NOT** divergent — the write is
  byte-identical to the previewed one, so it proceeds normally. This never invalidates the whole-apply
  token. This reconciles REQ-F002-021
  (whole-apply token rejection) with REQ-F002-040 (per-item divergence). *Test:* changing the baseline
  OR the `mode` after preview makes the apply 409 with zero writes; editing a single workspace
  out-of-band after preview leaves the token valid, marks that workspace's item `diverged` with no
  write, and applies the rest.
- REQ-F002-048 — **Two confirmation artifacts, not one (resolves review B3).** The danger gate uses two
  clearly separated values, both server-issued at preview and both server-validated at apply: (1) the
  opaque binding **`confirmToken`** (a nonce, machine value, NOT typed by a human) that binds the apply
  to the previewed snapshot (REQ-F002-020/047); and (2) the human-typeable **`confirmationPhrase`**
  that the preview displays, the operator types, and the client submits as **`typedConfirmation`**. The
  server validates that `typedConfirmation` equals the phrase bound to the presented `confirmToken`;
  the client-side typed check is NOT authoritative on its own. The `mode` (REQ-F002-055) is a third,
  machine-supplied apply parameter bound into the same snapshot as the token (a `mode` mismatch against
  the token is a 409 staleness, REQ-F002-047); it is not a human-typed artifact. *Test:* an apply that echoes a valid
  `confirmToken` but an incorrect `typedConfirmation` is rejected 409 with zero writes; only a matching
  pair proceeds.
- REQ-F002-049 — **DEPRECATED (superseded by Ruling B, REQ-F002-054/058).** The asynchronous apply-job
  model this id defined (`POST /api/baseline-prompt/apply` returning `202 { jobId }`, the polling route
  `GET /api/baseline-prompt/apply/:jobId`, the `BaselineApplyJob` type, per-workspace progress polling,
  and opaque `cursor`/`nextCursor` pagination of result/status/preview item lists) is **removed**. Human
  Ruling B ratified a **synchronous bounded apply** (REQ-F002-054): apply returns `200 BaselineApplyResult`
  directly. The job route, the polling route, and the `BaselineApplyJob` type are deleted from §7.1/§7.2;
  the cursor-pagination requirement on preview/status/result is withdrawn (REQ-F002-058 bounds the result
  set to the workspace-count ceiling instead). This id is retained (not renumbered) so downstream
  references resolve; new work MUST cite REQ-F002-058. *Test:* no F-002 route returns `202` or a `jobId`;
  there is no `GET /api/baseline-prompt/apply/:jobId`; no F-002 response carries a `nextCursor`.
- REQ-F002-058 — **Synchronous bounded apply: workspace-count ceiling & time bound (Ruling B
  machinery; load-bearing).** Apply (REQ-F002-021) runs synchronously within a single request/response
  and returns `200 BaselineApplyResult`. Synchronous execution is **safe only within an explicit
  envelope**, and the choice's correctness depends on the real maximum workspaces per customer
  (REQ-F002-045, now gating):
  - **Workspace-count ceiling:** synchronous apply is specified for deployments of **≤ 200 workspaces**
    (the parent nominal, parent REQ-100).
  - **Total apply time bound:** a full apply over the ceiling MUST complete within **p95 < 60 s**
    wall-clock end-to-end (request receipt to `200` response).
  - Because a strictly sequential fan-out of 200 × (write + verify) at the per-write bound (p95 < 1500 ms,
    REQ-F002-039) would be ~300 s and blow the 60 s bound, the fan-out **MUST issue the per-workspace
    write+verify operations with bounded concurrency (batched)**, not serially, so wall-clock stays
    within the time bound while each individual write+verify still honors parent REQ-028.
  - **Escape valve:** a deployment whose confirmed maximum workspaces (REQ-F002-045) **exceeds 200**, OR
    whose measured full-apply p95 **exceeds 60 s**, MUST either (a) **chunk** the apply — the operator
    applies to drifted subsets across multiple synchronous calls (each within the envelope), leveraging
    the re-tryability of REQ-F002-022b — or (b) trigger a **re-evaluation** of the synchronous-vs-async
    decision (re-opening REQ-F002-054), which is a spec change, not a silent runtime fallback.
  This makes confirming the real max-workspaces-per-customer (REQ-F002-045) a **correctness gate** on the
  synchronous choice, not merely a sizing hint. *Test:* an apply over 200 seeded workspaces completes and
  returns `200 BaselineApplyResult` within the 60 s p95 bound using batched concurrent writes (verified by
  observing overlapping in-flight PATCHes); a deployment configured above the ceiling surfaces the
  chunk-or-re-evaluate requirement rather than silently issuing an unbounded synchronous request.

### §6.4 Drift & override visibility; new-workspace inheritance

- REQ-F002-023 — **Sync-state classification (mode-aware; resolves review R5-1).** For each workspace the
  console computes a sync state from a fresh engine read of the live prompt `P`, the current baseline `B`,
  and the stored state (`remainder`, `applied_composed_hash`, `composition_mode`). Classification compares
  `P` against the workspace's stored-mode **resolved effective composition** — the value the console's own
  fan-out records as in-sync for that workspace (REQ-F002-059) — via `effective(B, remainder, classifyMode)`,
  **NOT** the mode-blind `compose(B, remainder)`:
  - `effective(B, remainder, 'baseline-only') = B` (a stored `inherit` workspace: baseline alone, even
    when a non-empty `remainder` is retained-but-suppressed);
  - `effective(B, remainder, 'prepend') = compose(B, remainder, 'prepend')`;
  - an empty `remainder` collapses every branch to `B`.
  `classifyMode` is derived **only from the stored `composition_mode`** — `inherit`→`baseline-only`,
  `append`→`prepend` — and a **NULL** (untracked) stored mode is classified as `prepend`. This is a
  *mode-agnostic reconstruction*, not the operator-selected apply mode: a NULL row last written under an
  operator `overwrite`/`fill` carries an **empty** `remainder`, so `effective(B, "", 'prepend') = B`
  equals exactly what that destructive/fill apply wrote — the classification is therefore outcome-correct
  without needing to know which operator mode last touched an untracked row. (A workspace's own stored
  mode never selects `overwrite`, REQ-F002-056.)

  **`classifyMode` is the ONLY mode notion in this requirement (rev 8, resolves review CONTRADICTION on
  `resolvedMode`).** Every state predicate below is defined solely in terms of `classifyMode` — the
  mode reconstructed from the stored `composition_mode` (NULL→`prepend`) — and NEVER in terms of
  `resolvedMode`. `resolvedMode` and `classifyMode` are **distinct notions for distinct routes** and
  MUST NOT be conflated:
  - `resolvedMode` (REQ-F002-059/020, `BaselinePreviewItem.resolvedMode` §7.1) is a **preview/apply-only**
    per-workspace branch that **folds in the operator-selected apply `mode`** (REQ-F002-055) as the
    default for untracked (NULL) rows. It exists only on the write path (`GET /preview` →
    `POST /apply`), is bound by `confirmToken`, and is the referent of the mode-change divergence check
    (REQ-F002-047). For a NULL-mode workspace it can be any of `prepend`/`overwrite`/`fill` depending on
    the operator's current selection.
  - `classifyMode` is a **status/classification-only** per-workspace branch that has **no operator mode
    at all** — a NULL row is always `prepend`, never the operator's `overwrite`/`fill`. Classification
    (this requirement) and the status surface (`GET /api/baseline-prompt/status`, REQ-F002-024) are a
    **bare read with no `mode` parameter**; there is no operator selection to fold in, so `resolvedMode`
    is **undefined on the status surface** and is never used here. Two implementers must both compute
    `synced`/`stale`/`overridden` from `classifyMode` only.

  **States (evaluated in the stated precedence order, rev 8):** classification is deterministic for every
  `(P, B, remainder, applied_composed_hash, composition_mode)` tuple; the predicates below are checked
  **top-to-bottom and the FIRST match wins**:
  1. `never-applied` — no `workspace_baseline_state` row (the console has never applied here).
  2. `synced` — `P == effective(B, remainder, classifyMode)` (the live prompt equals the current-baseline
     reconstruction under the stored mode).
  3. `stale` — NOT `synced` AND `hash(P) == applied_composed_hash` (the live prompt still byte-equals the
     composed value the console last wrote, but the current-baseline reconstruction differs because the
     baseline changed since apply, so `effective(B, remainder, classifyMode) != P`) — needs re-sync (§6.5).
  4. `overridden` — none of the above (the live prompt matches neither the current reconstruction nor the
     last-applied composition; edited out-of-band since last apply).

  **Precedence rule (rev 8, resolves review AMBIGUOUS `stale` vs `overridden`).** The `stale` hash-match
  check (step 3) takes precedence over the `overridden` "matches neither" fallback (step 4): when a
  workspace is not `synced` but `hash(P) == applied_composed_hash`, it is classified **`stale`**, never
  `overridden`. Concretely, for the reviewer's worked example — a workspace last written under operator
  `overwrite`/`fill` (so `applied_composed_hash = hash(oldB)`, `remainder` empty), unedited since, whose
  baseline then changes from `oldB` to `newB`: `classifyMode = 'prepend'` (NULL row) yields
  `effective(newB, "", 'prepend') = newB`, and `P = oldB != newB`, so it is **not** `synced`; but
  `hash(P) = hash(oldB) = applied_composed_hash`, so step 3 fires and it is **`stale`**, not `overridden`.
  This is intentional: the console last wrote exactly `P`, so re-sync (§6.5) will correctly recompose it
  to `newB` and the operator is not asked to resolve a false "override." The residual risk the reviewer
  named — an out-of-band edit that coincidentally restores the prompt to the exact last-applied bytes —
  is accepted and low-probability (it byte-collides with `applied_composed_hash`); such a workspace is
  reported `stale` and its next re-sync recomposes it, which is the correct outcome regardless of whether
  the coincidental value arrived by console write or by hand.

  This matches F-003's own classifier (REQ-F003-027, which uses `effective(B, L, rel)`), so a workspace the
  console has just correctly synced under `inherit`/`baseline-only` — live `P = B` while a non-empty
  `remainder = R` is retained-but-suppressed — is reported **`synced`**, not `overridden`.
  *Test:* a workspace with an out-of-band prompt edit (matching neither reconstruction nor last-applied
  hash) reports `overridden`; a workspace unchanged
  since apply but whose baseline was edited afterward reports `stale`; an untouched, current one
  reports `synced`; a never-touched one reports `never-applied`; **a `baseline-only`/`inherit` workspace
  carrying a non-empty retained remainder whose live prompt equals `B` reports `synced`, not `overridden`**;
  **a workspace last written under operator `overwrite` (or `fill`), unedited since, whose baseline then
  changes, reports `stale` (its `hash(P) == applied_composed_hash`), NOT `overridden`** — the `stale`
  hash-match takes precedence over the `overridden` fallback; **classification uses `classifyMode` only —
  the status surface (REQ-F002-024) has no operator `mode` and never consults `resolvedMode`.**
- REQ-F002-024 — **Drift visibility surface.** The console exposes drift/override status across
  workspaces via `GET /api/baseline-prompt/status` (§7) and presents it so the operator can see, at a
  glance, which workspaces carry the current baseline versus diverge — so the "single source of truth"
  promise does not silently erode (ux_risk_read). Status MUST distinguish the four states of
  REQ-F002-023 and MUST NOT encode them by color alone (accessibility, REQ-F002-033). *Test:* the
  status view lists every workspace with its sync state; the four states are visually distinguishable
  without relying solely on color.
- REQ-F002-025 — **Resolving an override (`prepend`-resolved workspaces; baseline-only is gated
  differently — resolves review R6-1).** For an `overridden` workspace whose resolved effective mode is
  `prepend`, the console MUST NOT silently clobber the out-of-band prompt on the next apply. Re-applying
  the baseline to such a workspace requires the operator to make a deliberate choice, surfaced in the
  preview diff as two candidates (REQ-F002-019): either (a) **preserve** — treat the current out-of-band
  prompt as the new remainder (beneath the baseline), or (b) **discard** — recompose from the stored
  remainder. On a preserve resolution the out-of-band prompt becomes the stored remainder (the explicit
  remainder re-derivation permitted by REQ-F002-014). The chosen action is reflected in the
  per-workspace preview item and confirmed under the apply danger gate (REQ-F002-021); resolutions are
  bound to the `confirmToken` and their absence is defined by REQ-F002-050. **A `baseline-only` (stored
  `inherit`) `overridden` workspace is deliberately EXEMPT from this two-candidate choice** (REQ-F002-050/019):
  it carries no preserve/discard candidates and is written `B` regardless — its no-silent-clobber guarantee
  is met **not** by a per-workspace choice but by surfacing its content discard in the §8 **destructive
  blast-radius count and danger gate** (REQ-F002-031(b)), so the operator still confirms the destruction
  before it happens. *Test:* applying to a `prepend`-resolved overridden workspace does not proceed without
  an explicit preserve-or-discard choice, and choosing "preserve" makes the out-of-band text the new
  remainder; applying to a `baseline-only`/`inherit` overridden workspace requires **no** per-workspace
  resolution (an `overrides` entry naming it is 400, REQ-F002-050) yet still counts it in the destructive
  blast radius (REQ-F002-031) so the danger gate names the discard.
- REQ-F002-026 — **New-workspace inheritance is surfaced, not automatic.** A workspace created after
  the baseline exists appears as `never-applied` in the status surface (REQ-F002-024) and is included
  in the next preview/apply target set. The console does NOT auto-write the baseline on workspace
  creation (no engine hook exists; REQ-F002-006). *Test:* creating a workspace after a baseline is set
  lists it as `never-applied`; it receives the baseline only after an explicit apply.
- REQ-F002-050 — **Override-resolution binding & missing resolutions (resolves review B6;
  `prepend`-mode only per Ruling A).** Override preserve/discard resolution is **meaningful only in
  `prepend` mode**: `overwrite` replaces the field unconditionally (there is no per-workspace content to
  preserve) and `fill` skips any non-empty workspace (REQ-F002-056/057), so in those modes `overrides`
  MUST be empty and any non-empty `overrides` is rejected **400**. In `prepend` mode the apply body
  carries `overrides: { workspaceId, resolution: 'preserve' | 'discard' }[]`. The binding `confirmToken`
  (REQ-F002-020) is computed over the previewed snapshot INCLUDING the `mode` and both resolution
  candidates for every overridden workspace, so the two prompts an operator may pick between are exactly
  the ones the preview showed — a resolution cannot introduce an unpreviewed write. The server MUST
  reject (**409**) an apply whose `overrides` reference a workspace that was NOT `overridden` in the
  previewed snapshot. An `overridden` workspace in the target set that has **no** resolution in
  `overrides` is NOT written — it is reported `skipped` with an explanatory `message` — and the apply
  PROCEEDS for the rest (no whole-apply rejection). **Baseline-only exemption (stored `inherit`,
  REQ-F002-059; resolves review R4-4):** a workspace whose resolved effective mode is `baseline-only`
  is **outside** this preserve/discard contract even when `overridden` — it carries no resolution
  candidates, requires no `overrides` entry, and is written `B` (never `skipped` for a missing
  resolution). An `overrides` entry naming a `baseline-only` workspace is rejected **400** (there is no
  choice to resolve), consistent with the `overwrite`/`fill` rejection above. *Test:* in `prepend` mode an apply omitting a
  resolution for an overridden target skips just that workspace and applies the others; an apply whose
  `overrides` name a non-overridden workspace is rejected 409; in `overwrite`/`fill` mode a non-empty
  `overrides` is rejected 400.

### §6.5 Re-sync on baseline change

- REQ-F002-027 — When the baseline changes (REQ-F002-016), all previously-synced workspaces become
  `stale` (REQ-F002-023). The console offers a **re-sync** that re-runs the fan-out
  (REQ-F002-021/022/022a) to recompose `compose(newBaseline, remainder)` for the target set, under the
  same preview + danger-gate + per-workspace-verify + partial-failure contract as a first apply. Per
  rev 4 (REQ-F002-059), because re-sync re-runs the fan-out of REQ-F002-021, it likewise honors each
  workspace's stored `composition_mode` when present (falling back to the operator-selected mode
  otherwise).
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
  syncState: BaselineSyncState;
  resolvedMode: 'prepend' | 'baseline-only' | 'overwrite' | 'fill';
                                    // per-workspace resolved effective branch, bound by confirmToken
                                    // (REQ-F002-059/020); referent of the mode-change divergence check
                                    // (REQ-F002-047). 'baseline-only' = stored inherit (REQ-F002-059).
                                    // PREVIEW/APPLY-ONLY: folds in the operator-selected apply mode for
                                    // NULL rows. This is NOT the status-path classifyMode (REQ-F002-023),
                                    // which has no operator mode; BaselineWorkspaceStatus carries no
                                    // resolvedMode — the status surface classifies via classifyMode only.
  currentPrompt: string | null;     // live engine prompt (for the diff)
  currentPromptHash: string;        // snapshot hash bound by confirmToken (REQ-F002-047)
  composedPrompt: string | null;    // single candidate; for 'baseline-only' this is B (REQ-F002-019);
                                    // null only for an overridden prepend item (candidates below)
  // For an OVERRIDDEN item resolved to the 'prepend' branch the composed value depends on the
  // operator's choice, so BOTH candidates are supplied instead of composedPrompt (REQ-F002-019/025/050).
  // A 'baseline-only' (stored inherit) item never carries candidates — it is always composedPrompt = B
  // regardless of override state, and requires no preserve/discard resolution (REQ-F002-019/050).
  composedIfPreserve?: string;      // compose(B, currentLivePrompt)
  composedIfDiscard?: string;       // compose(B, storedRemainder)
  willChange: boolean;
}

export interface BaselinePreview {
  affectedCount: number;            // workspaces whose composed prompt would change
  unchangedCount: number;
  items: BaselinePreviewItem[];
  confirmToken: string;             // opaque binding nonce, machine value (REQ-F002-020/048)
  confirmationPhrase: string;       // human-typeable danger phrase to display + type (REQ-F002-048)
}

export type BaselineApplyOutcome = 'applied' | 'failed' | 'skipped' | 'diverged';
// 'diverged' = live prompt changed out-of-band since the previewed snapshot; not written (REQ-F002-047)

export interface BaselineApplyResultItem {
  workspaceId: string;
  displayName: string;
  outcome: BaselineApplyOutcome;
  verified: boolean;                // per-workspace verify-after-write (parent REQ-028)
  message?: string;                 // failure / diverge / skip detail, rendered verbatim
}

export interface BaselineApplyResult {
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  divergedCount: number;            // (REQ-F002-047)
  items: BaselineApplyResultItem[]; // per-workspace legibility (REQ-F002-022a)
}
// Apply is SYNCHRONOUS (Ruling B, REQ-F002-054/058): POST /apply returns 200 BaselineApplyResult
// directly, bounded by the workspace-count ceiling (REQ-F002-058). There is no async job type, no
// 202 { jobId } response, no polling route, and no cursor pagination (all deleted per REQ-F002-049).
```

### §7.2 Routes

| Method / path | Req | Resp | Engine / store call(s) | Mutates → event |
|---|---|---|---|---|
| `GET /api/baseline-prompt` | — | `BaselinePrompt` | console store read | no (REQ-F002-015) |
| `PUT /api/baseline-prompt` | `{ text: string }` | `BaselinePrompt` | console store write | yes (console store) → `admin.baseline_prompt.updated` (REQ-F002-016/035) |
| `DELETE /api/baseline-prompt` | — | `BaselinePrompt` | console store write (`text` → null) | yes (console store) → `admin.baseline_prompt.updated` `cleared` (REQ-F002-046/035) |
| `GET /api/baseline-prompt/status` | — | `BaselineStatusView` | product workspace list (parent REQ-030) + per-ws live prompt read + store | no (REQ-F002-024) |
| `GET /api/baseline-prompt/preview` | — | `BaselinePreview` | live prompt reads (parent REQ-031); no engine writes (mints `confirmToken`, REQ-F002-019) | no engine write (REQ-F002-019) — dry run |
| `POST /api/baseline-prompt/apply` | `{ confirmToken, typedConfirmation, overrides?: {workspaceId, resolution}[] }` | `200 BaselineApplyResult` (synchronous, REQ-F002-054/058) | per-ws `PATCH /api/workspaces/:id/settings` (parent REQ-032) | yes → one `admin.workspace.updated` per applied ws (parent REQ-032) + one `admin.baseline_prompt.applied` summary (REQ-F002-035) |

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
  REQ-F002-038). **Destructive blast radius (rev 5, resolves reviews R4-N3 + R5-2):** the dialog's "will be
  destroyed / rewritten" naming and destructive count are sourced from the per-workspace preview
  (REQ-F002-019) — **NOT** the whole target set — and enumerate exactly the workspaces whose apply
  **discards live content with no preserve/discard choice**:
  (a) every workspace whose `resolvedMode` is `overwrite` (the field is fully replaced by `B`); and
  (b) every **`baseline-only`** (stored `inherit`) workspace that is currently `overridden` — its
  uncaptured out-of-band content is discarded by the `B`-only write (REQ-F002-050) with no
  preserve/discard gate, the same destruction F-003 danger-gates at `inherit`-set time
  (F-003 REQ-F003-025(a)). Surfacing (b) here is what keeps the baseline-only exemption of REQ-F002-050
  consistent with the no-silent-clobber rule of REQ-F002-025.
  A stored `append`/`prepend` workspace is written non-destructively (its remainder is preserved) and is
  **NOT** counted even under an operator `overwrite` selection (per-workspace resolution, REQ-F002-059); a
  `baseline-only` workspace that is already `synced`/`never-applied` has no live content to discard and is
  **NOT** counted. The count is over this union, not the whole target set. It requires typing the exact displayed `confirmationPhrase` (REQ-F002-048) before the
  fan-out is issued; the client submits it as `typedConfirmation` alongside the binding `confirmToken`.
  *Test:* the fan-out call fires only after the typed `confirmationPhrase` matches and a valid
  `confirmToken` is present; an apply (in any operator mode) over a target set containing an `overridden`
  `baseline-only`/`inherit` workspace counts that workspace in the destructive blast radius, while the
  same workspace when `synced` is not counted.
- REQ-F002-032 — **Partial-failure legibility (UI side of REQ-F002-022a).** After an apply the UI
  renders the per-workspace outcome list — applied / failed / skipped / diverged (REQ-F002-047) with
  counts — and never a single uniform success banner when any workspace failed or diverged; failed-workspace `message` values are rendered
  verbatim (parent REQ-097a). *Test:* a mixed-result apply renders per-workspace outcomes and names the
  failed workspaces.
- REQ-F002-033 — **Drift status is non-color-only and legible.** Sync states (REQ-F002-023) are
  encoded with text/iconography in addition to any color (WCAG non-color-only encoding). *Test:* sync
  states remain distinguishable in a grayscale/color-blind simulation.
- REQ-F002-034 — **Accessibility of the new bulk surfaces (mostly inherited; deltas made
  explicit, ux_risk_read; async wording removed per Ruling B — resolves review R6-2).** The preview
  dialog, the confirm dialog, and the (synchronous, REQ-F002-039/058) apply **result** region require
  deliberate focus management (focus moves into the dialog on open, returns to the trigger on close) and
  status messaging announced to assistive technology via an ARIA live region — specifically the
  apply **result** and the partial-failure breakdown (there is no async progress stream to announce: apply
  is a single blocking request returning `200 BaselineApplyResult`, so the announcement is the completed
  result, not incremental `processed`/`total` progress). *Test:* opening the confirm dialog moves focus
  into it; the apply result (including failures) is announced via a live region; keyboard-only operation
  completes a preview → confirm → result cycle.
- REQ-F002-060 — **Native Default System Prompt advisory (human ruling on REQ-F002-044, 2026-07-09).**
  The console-level baseline settings surface (REQ-F002-029) MUST display a **persistent, always-present**
  advisory (e.g. a static informational banner/callout on the baseline section — not a one-time or
  permanently-dismissible toast; exact UX mechanics deferred to UX design, but the notice MUST be visible
  whenever the baseline surface is shown) stating that AnythingLLM's native **instance-level Default
  System Prompt** is a **separate, console-unreachable** setting (REQ-F002-004) that may **also** affect
  what a workspace's assistant sees, and that the managed baseline here **does not account for it** — so a
  native default may exist invisibly beneath the managed baseline. The advisory is informational only; it
  gates no action and adds no engine read/write (the native default remains unreachable, REQ-F002-004).
  *Test:* the baseline settings surface (REQ-F002-029) renders the native-default advisory persistently
  whenever it is shown (it is not gone after a page reload or a dismissal), and the advisory text names
  the native instance-level Default System Prompt as a separate, console-unreachable setting the managed
  baseline does not account for.

---

## §9 Events & Audit

F-002 events use the parent spec's `admin.*` namespace and event-bus mechanism (`docs/design/03-data-models.md`,
parent §14). Two new event names are added; per-workspace engine writes reuse the existing
`admin.workspace.updated` event.

- REQ-F002-035 — **Event catalog additions.**
  - `admin.baseline_prompt.updated` — emitted after a `PUT /api/baseline-prompt` (REQ-F002-016) OR a
    `DELETE /api/baseline-prompt` clear (REQ-F002-046) persists to the console store. Payload: actor
    (parent REQ-029c), a content reference (e.g. baseline length and/or hash; the baseline is non-secret
    but the event need not carry the full text), a `cleared: boolean` marker, `timestamp`. This is a
    console-store write, not an engine mutation, so it carries no engine verify; per an explicit,
    deliberate deviation from parent REQ-029c (resolves review M5), `verified` is recorded as
    store-confirmed `true`.
  - `admin.baseline_prompt.applied` — emitted once after a synchronous fan-out apply completes (REQ-F002-021/058).
    Payload: actor, `appliedCount`, `failedCount`, `skippedCount`, `divergedCount`, the applied
    baseline hash, and — distinctly (resolves review M9) — the list of **applied** workspace `id`s and
    the list of **failed/diverged** workspace `id`s (so the audit breakdown in REQ-F002-036 lines up),
    `timestamp`.
  - Each **verified** per-workspace write in the fan-out emits one `admin.workspace.updated` (parent
    REQ-032) exactly as an ordinary workspace-settings save does — no new per-workspace event is
    introduced.
  *Test:* setting the baseline emits one `admin.baseline_prompt.updated` (`cleared:false`) and zero
  engine events; a clear emits one with `cleared:true`; an apply that changes three workspaces emits
  three `admin.workspace.updated` plus one `admin.baseline_prompt.applied` whose counts sum correctly
  and whose applied vs. failed/diverged id lists are disjoint.
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
  load (≤ 200 workspaces, parent REQ-100), a preview renders within **p95 < 3000 ms** and each
  per-workspace write + verify (parent REQ-028) completes within **p95 < 1500 ms**. Apply runs
  **synchronously** within a single request/response (Ruling B, REQ-F002-054/058) — returning
  `200 BaselineApplyResult` directly, bounded by the workspace-count ceiling and the p95 < 60 s total
  time bound of REQ-F002-058, using batched bounded-concurrency writes — NOT an async job with progress
  polling (the `202 { jobId }` / `:jobId` polling / `cursor`/`nextCursor` model is deleted, REQ-F002-049).
  Preview, status, and the apply result are returned whole (bounded by the ≤ 200 ceiling, REQ-F002-058),
  not paginated. *Test:* with 200 seeded workspaces, the preview renders under 3000 ms p95, each
  per-workspace write+verify under 1500 ms p95, and the apply returns a single `200 BaselineApplyResult`
  within the 60 s p95 bound (no `202`, no `jobId`, no `nextCursor`).
- REQ-F002-040 — **Concurrency / staleness.** The preview reads live prompts immediately before
  presenting the diff and captures each workspace's `currentPromptHash` into the snapshot bound by
  `confirmToken` (REQ-F002-020/047). Token-level staleness (baseline change, new preview, target-set
  change) rejects the whole apply (409, REQ-F002-021); an individual workspace edited out-of-band
  between preview and apply does NOT reject the apply — its write is withheld and it is reported with
  the **`diverged`** outcome (REQ-F002-047) rather than silently overwriting an unpreviewed change,
  consistent with the fresh-read-before-write posture (parent REQ-092/092a) and no-silent-clobber rule
  (REQ-F002-025). *Test:* editing a workspace out-of-band between preview and apply causes that
  workspace's apply item to be `diverged` (no write) while other workspaces apply.

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
- REQ-F002-044 — **Interaction with the native Default System Prompt. RESOLVED — human ruling
  (2026-07-09): proceed with the independence assumption AND add a UI warning.** A customer could set
  AnythingLLM's native instance-level default out-of-band; the console can neither read nor write it
  (REQ-F002-004). This spec assumes the two are independent and that the console's guarantee is scoped
  strictly to the per-workspace field it writes; the exact engine-level layering/precedence between a
  workspace `openAiPrompt` and the native default is NOT verified in the grounding. **The human ruled
  this independence assumption acceptable** (the console's guarantee remains scoped to the per-workspace
  field it writes, per REQ-F002-004's custody boundary; the unverified engine-level layering is accepted
  as out of the console's reach). **The ruling additionally requires a UI warning** that a native
  instance-level default may exist invisibly beneath the managed baseline — specified as **REQ-F002-060**
  (§8). This item is now resolved; no further ruling is needed.
- REQ-F002-045 — **Scale (now a correctness gate on the synchronous model, REQ-F002-058).** The
  performance bounds (REQ-F002-039) assume the parent spec's ≤ 200 workspaces per deployment. *Ruling
  needed:* confirm the typical/maximum workspaces-per-customer so the synchronous bounded apply
  (REQ-F002-058) and drift-visibility UI are sized correctly. If materially larger than the ≤ 200 ceiling,
  the chunk-or-re-evaluate escape valve of REQ-F002-058 engages (a spec change), rather than a silent
  runtime fallback.
- REQ-F002-053 — **Clear-baseline effect on applied workspaces (load-bearing; from review B2).** This
  spec adopts a **non-destructive** default: clearing (REQ-F002-046) is a console-store-only action
  that leaves already-applied workspace prompts untouched on the engine and marks them `stale`; the
  baseline segment is stripped from a workspace only when the operator runs the next explicit apply,
  which rewrites it to its remainder alone (REQ-F002-011/046). *Recommended option:* keep the
  non-destructive, apply-to-strip default (consistent with the no-auto-enforcement stance,
  REQ-F002-006). *Ruling needed:* confirm, or require that a clear immediately fan-out-strips the
  baseline from all tracked workspaces (which would make clear itself a §8-class dangerous operation).
- REQ-F002-054 — **Apply execution model: async job vs synchronous (load-bearing; from review B5).
  RESOLVED — Ruling B: synchronous bounded apply.** The review raised whether apply should be an
  asynchronous job (`202 { jobId }` + progress polling) because a fan-out of up to ~200 workspaces ×
  (write + verify) can approach a single request window. **Human Ruling B chose the synchronous bounded
  model:** deployments are bounded at ≤ 200 workspaces (parent REQ-100), so apply runs synchronously and
  returns `200 BaselineApplyResult` directly within an explicit envelope (REQ-F002-058: workspace-count
  ceiling, p95 < 60 s total time bound, batched bounded-concurrency writes, chunk/re-evaluate escape
  valve). Consequently the async `BaselineApplyJob` type, the `202 { jobId }` response, the `:jobId`
  polling route, and cursor/`nextCursor` pagination are all **deleted** (REQ-F002-049). New work MUST
  cite REQ-F002-058.

---

## §12 Traceability to the Brief

| Brief element | Addressed by |
|---|---|
| Problem: no console-managed customer-wide baseline | §1.1 REQ-F002-001 |
| Proposed Direction: console persists baseline, writes per-workspace via existing API | §4 REQ-F002-010, §6.1, §6.3; parent REQ-032 reuse |
| Open Q — composition semantics (the crux) | §5 (prepend default) + REQ-F002-041 |
| Cross-feature: fan-out honors per-workspace `composition_mode` (F-003 ruling REQ-F003-042) | §5 REQ-F002-055 (revised) + REQ-F002-059, §4 REQ-F002-010d, §6.2 REQ-F002-019, §6.3 REQ-F002-021/047, §6.5 REQ-F002-027 |
| Open Q — enforcement strength / re-sync / auto-apply | §6.3–§6.5, REQ-F002-006/026/027 + REQ-F002-042 |
| Open Q — persistence & per-workspace sync/drift tracking | §4 REQ-F002-010, §6.4 REQ-F002-023 |
| Open Q — baseline-change propagation & partial-failure | §6.5 REQ-F002-027, §6.3 REQ-F002-022/022a |
| Open Q — conflict with native default (RESOLVED: independence assumption + UI warning) | REQ-F002-004 + REQ-F002-044 (ruling) + §8 REQ-F002-060 (UI advisory) |
| Native Default System Prompt advisory (UI warning per REQ-F002-044 ruling) | §8 REQ-F002-060 (on REQ-F002-029 surface) |
| Open Q — scale | REQ-F002-039 + REQ-F002-045 |
| Cleared/undefined baseline behavior | §5 REQ-F002-011, §6.1 REQ-F002-046 + REQ-F002-053 |
| Apply execution model (synchronous bounded, Ruling B) | §6.3 REQ-F002-058 (REQ-F002-049 deleted the async model), §10 REQ-F002-039 + §11 REQ-F002-054 |
| Concurrency: per-workspace divergence (`diverged`) | §6.3 REQ-F002-047, §10 REQ-F002-040 |
| Two-artifact danger gate (binding token vs typed phrase) | §6.3 REQ-F002-048, §8 REQ-F002-031 |
| Override preserve/discard binding | §6.4 REQ-F002-025/050, §6.2 REQ-F002-019 |
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

Rev 2 additionally pins the domain of the divergence-prone decisions the review flagged: the
cleared-baseline domain of `compose` (REQ-F002-011/046), the two-artifact danger gate
(REQ-F002-048), token-staleness vs. per-workspace `diverged` divergence (REQ-F002-047), the async
apply job (REQ-F002-049), override-resolution binding and missing-resolution handling (REQ-F002-050),
and structural first-apply double-prepend detection (REQ-F002-012) — each to an exact predicate and
test. All internal `REQ-F002-###` cross-references were re-audited and corrected so the "downstream
tests cite the id" contract holds.

Rev 9 (records human ruling on REQ-F002-044, 2026-07-09; NOT a review-fix round) records the human
ruling on the one remaining open question that bears on behavior — the interaction with AnythingLLM's
native instance-level **Default System Prompt** (REQ-F002-044). The human ruled: **proceed with the
independence assumption** the spec already adopts (the console's managed baseline and the native
instance-level default are treated as independent; the console's guarantee stays scoped strictly to the
per-workspace field it writes, per REQ-F002-004's custody boundary), **AND add a UI warning** that a
native instance-level default may exist invisibly beneath the managed baseline. REQ-F002-044's §11 entry
is updated to record the ruling (independence assumption confirmed; UI warning now required) and to cite
the new requirement. One new requirement, **REQ-F002-060**, is appended in §8 requiring the console-level
baseline settings surface (REQ-F002-029) to display a persistent, always-present advisory that the native
Default System Prompt is a separate, console-unreachable setting the managed baseline does not account
for. The traceability table (§12) gains a row for it. No existing REQ id was renumbered, reused, deleted,
or marked DEPRECATED; no normative behavior of any other requirement changed.

Rev 8 (resolves two BLOCKING findings from an adversarial review of rev 7, 2026-07-09; round 1 of ≤2)
fixes REQ-F002-023's sync-state classifier, which the reviewer showed was self-contradictory and
non-deterministic. (1) **CONTRADICTION — `resolvedMode` vs `classifyMode`.** The state definitions
(`synced`/`stale`) had been written against `resolvedMode`, but the surrounding prose reconstructs the
effective value from `classifyMode` (derived only from the stored `composition_mode`, NULL→`prepend`),
and `resolvedMode` — which folds in the operator-selected apply `mode` — exists **only** on the
preview/apply path, not on the bare `GET /api/baseline-prompt/status` surface (REQ-F002-024), where it is
undefined. Rev 8 rewrites every REQ-F002-023 state predicate to use **`classifyMode` exclusively**, adds
an explicit statement that classification/status carries **no operator mode** and never consults
`resolvedMode`, and pins the two as distinct notions for distinct routes (status/classification vs.
preview/apply) so they cannot be conflated again. Cross-references were added — non-normatively — to
REQ-F002-020's `confirmToken` snapshot description, REQ-F002-059's snapshot-binding bullet, and the §7.1
`BaselinePreviewItem.resolvedMode` type comment — clarifying that `resolvedMode` is preview/apply-only and
distinct from `classifyMode`, without changing their normative behavior. (2) **AMBIGUOUS — `stale` vs
`overridden` precedence.** The `stale` hash-match and the `overridden` "matches neither" checks had no
stated evaluation order, so a workspace last written under operator `overwrite`/`fill` (whose
`applied_composed_hash = hash(oldB)`) whose baseline then changes could be claimed as either. Rev 8 makes
the four states an **ordered, first-match-wins** list and states an explicit precedence rule: the `stale`
hash-match (step 3) takes precedence over the `overridden` fallback (step 4). The reviewer's worked
example is resolved **explicitly as `stale`** (with a stated reason: the console last wrote exactly `P`,
so re-sync recomposes it correctly; the coincidental-restore residual risk is named and accepted), and
the REQ-F002-023 test list is extended to cover this exact case plus the `classifyMode`-only status
assertion. No normative behavior of REQ-F002-020/047/059 changed; only clarifying cross-references were
added. No REQ ids were renumbered, deleted, or newly created; no item was marked DEPRECATED — the fix was
achievable by tightening REQ-F002-023 in place and adding cross-references. The rev-7 NOTE about
status-line bookkeeping was not touched (left no worse).

Rev 7 (resolves spec-review `docs/spec-review-F002-rev6.md`, 2026-07-08) closes two narrow reconciliation
gaps the rev-6 edits left: (R6-1) REQ-F002-025's mandatory two-candidate preserve/discard choice is now
**scoped to `prepend`-resolved** overridden workspaces, with `baseline-only` overridden workspaces
explicitly exempt — their no-silent-clobber guarantee is met by the §8 destructive blast-radius count and
danger gate (REQ-F002-031(b)) rather than a per-workspace choice, removing the contradiction with the
REQ-F002-050/019 exemption; and (R6-2) the last async remnant — REQ-F002-034's "async apply-progress"
accessibility surface — is rewritten for the synchronous result region (no progress stream to announce).
Notes: REQ-F002-023's NULL-row phrasing is tightened to a *mode-agnostic reconstruction* (`classifyMode`
from the stored mode only, NULL→prepend, outcome-correct because untracked destructive/fill rows carry an
empty remainder) (R6-N1); and REQ-F002-045's stale "bulk-apply progress model" wording is updated to the
synchronous bounded model + escape valve (R6-N2). No REQ ids were renumbered or deleted.

Rev 6 (resolves spec-review `docs/spec-review-F002-rev5.md`, 2026-07-08) reconciles the rev-5
`baseline-only` write with two rev-3 requirements it collided with: (R5-1) the sync-state classifier
(REQ-F002-023) is made **mode-aware** — it compares the live prompt against `effective(B, remainder,
resolvedMode)` (`= B` for a stored-`inherit`/`baseline-only` workspace), matching F-003's own classifier
(REQ-F003-027), so a workspace just correctly synced under `inherit` with a retained non-empty remainder
reports `synced`, not `overridden`; and (R5-2) the §8 destructive blast-radius count (REQ-F002-031) is
widened to also count `baseline-only` writes to `overridden` workspaces (uncaptured content is discarded
with no preserve/discard gate), reconciling REQ-F002-050's exemption with REQ-F002-025's no-silent-clobber
rule. Notes folded in: `'fill'` added to the two resolved-mode enumerations (R5-3); an F-002-side
out-of-domain `composition_mode` test added (R5-N1); and the async apply-job remnants REQ-F002-049
already declared deleted (the `BaselineApplyJob` type, `202 { jobId }` response, `:jobId` polling route,
and `nextCursor` pagination) are actually removed from §7.1/§7.2 and REQ-F002-035/039, with REQ-F002-054
marked RESOLVED to Ruling B's synchronous bounded model (R5-4). No REQ ids were renumbered or deleted.

Rev 4 (companion change for F-003 ruling REQ-F003-042, 2026-07-07) makes the fan-out honor each
workspace's stored per-workspace `composition_mode` rather than blanket-applying one operator-selected
mode. The divergence-prone decision here is the **per-workspace mode resolution and its ordering vs.
the operator default**; it is pinned to an exact rule in REQ-F002-059 (stored mode when present, else
operator-selected mode as default; F-003 `append`→`prepend`, `inherit`→baseline-only; `override`
dropped so the destructive `overwrite` branch is never reached via a stored mode) with concrete tests,
including the load-bearing case that a workspace with stored mode `append` KEEPS `append`/`prepend`
composition after a customer-wide apply that selected `overwrite`. The change is **backward-compatible
and F-002 can ship before F-003**: when the shared `composition_mode` column is absent (F-003 unbuilt)
or unset for a row, behavior is byte-for-byte identical to rev 3 (REQ-F002-010d/059). F-002 only READS
the shared column; F-003 retains ownership of defining, defaulting, and writing it (REQ-F002-010d,
F-003 REQ-F003-013/043). This spec does not renumber or delete any rev-3 id: REQ-F002-055 is revised
in place with an inline rev-4 marker and defers to the new REQ-F002-059.
