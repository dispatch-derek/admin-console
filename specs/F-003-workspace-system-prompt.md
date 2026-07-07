# F-003: Set a Workspace-Level System Prompt — Specification

Status: Draft rev 3 — §9 open questions ratified by 2026-07-07 human rulings; for implementation and QA review
Feature brief (authoritative intent): `briefs/F-003-workspace-system-prompt.md`
Sibling spec (hard dependency; composition machinery this spec consumes): `specs/F-002-customer-system-prompt.md` (rev 4 — companion revision whose REQ-F002-055 honors the per-workspace `composition_mode`, per REQ-F003-042)
Parent spec (conventions, architecture, shared requirements): `specs/admin-console.md` (v1, rev 7)
Grounding references: `web/src/features/workspaces/WorkspaceSettings.tsx` (the existing per-workspace
prompt textarea), `bff/src/engine/mappers.ts` + `bff/src/engine/engine-types.ts` (single engine
`openAiPrompt` field; no native layering), `docs/anythingllm-surface.md` (engine surface),
`docs/design/02-product-api.md`, `docs/design/03-data-models.md`, `docs/design/05-web-architecture.md`.

This is an **additive** feature spec layered on `specs/admin-console.md` and **composed over**
`specs/F-002-customer-system-prompt.md`. It introduces a distinct requirement-ID namespace,
**`REQ-F003-###`**, so its IDs never collide with the parent spec's `REQ-###` series or the sibling
`REQ-F001-###`/`REQ-F002-###` series. Section numbers (§1, §1.1, …) below are **local to this
document**; downstream tests cite the `REQ-F003-###` id (globally unique) plus the local §.
Requirement IDs and section numbers are **stable**: never renumber or reuse an id; append new ids or
mark items **DEPRECATED**.

Where this spec reuses parent-spec machinery (the BFF anti-corruption layer REQ-021/026/027,
verify-after-write REQ-028, fresh-read-before-write REQ-092/092a, the `admin.*` event bus §14, the
audit log REQ-093/093a, the `DangerConfirm` typed-token pattern §8, and the no-partial-success stance
REQ-098/098b), it cites the parent `REQ-###` id rather than restating it. Where it reuses **F-002**
machinery (the baseline store, the boundary `SENTINEL`, the `compose(...)` function, the
`workspace_baseline_state` row + remainder, and sync-state classification), it cites the
`REQ-F002-###` id rather than restating it.

---

## §1 Overview & Scope

### §1.1 Purpose
F-003 promotes the per-workspace system prompt from a **lone opaque free-text field** (today
`web/src/features/workspaces/WorkspaceSettings.tsx` line ~348, "System prompt (blank = inherit)",
product `systemPrompt` → engine `openAiPrompt` via `bff/src/engine/mappers.ts` `WORKSPACE_FIELD_MAP`)
to a **first-class composition layer** over F-002's customer-wide baseline. The console stores, per
workspace, a **composition relationship** and a **workspace-layer** text, computes the **effective
prompt** console-side, and flattens it into the single engine `openAiPrompt` field via the existing
per-workspace settings path.

- REQ-F003-001 — For each workspace, the console persists a **composition relationship**
  (`inherit | append`, §5 — the `override` mode is dropped per the 2026-07-07 ruling, REQ-F003-050) and
  a **workspace layer** (the per-workspace-specific prompt text), computes the effective prompt as a deterministic function of the current baseline and that
  workspace's layer + relationship (§5), and writes it to the workspace's `systemPrompt` via the
  existing `PATCH /api/workspaces/:id/settings` path (parent REQ-032; `systemPrompt` → engine
  `openAiPrompt`, confirmed in `mappers.ts`). *Test:* saving a workspace layer + relationship results
  in that workspace's engine `openAiPrompt` equal, byte-for-byte, to the console-computed effective
  prompt (§5), written through the BFF, never from the browser.

### §1.2 Relationship to F-002 (hard dependency — may not be built yet)
- REQ-F003-002 — **F-002 is a HARD DEPENDENCY and MAY NOT BE BUILT YET.** F-003 **consumes** the
  customer-wide baseline; it does not define, store, apply, or fan out the baseline (that is F-002:
  `baseline_prompt` store REQ-F002-010, `GET /api/baseline-prompt` REQ-F002-015). F-003 **reuses**
  F-002's composition machinery: the boundary `SENTINEL` constant (REQ-F002-011), the
  `workspace_baseline_state` store and its **remainder** concept (REQ-F002-010), the SHA-256 hashing
  discipline (REQ-F002-010c), and sync-state classification (REQ-F002-023). F-003 MUST NOT be released
  before F-002's baseline store and baseline-read path exist and are ratified. *Test:* a
  dependency/static check confirms F-003 reads the baseline through F-002's baseline store/route and
  imports the F-002 `SENTINEL` constant; no F-003 module redefines the baseline store, the sentinel, or
  the `compose` function.
- REQ-F003-003 — **Single-model reconciliation (the crux, §5).** F-003's per-workspace **workspace
  layer** IS F-002's `workspace_baseline_state.remainder` (the same stored per-workspace segment);
  F-003 does **not** introduce a second, parallel per-workspace prompt store. F-003 only **adds** a
  per-workspace persistent **composition relationship** to that same row (§4). The effective-prompt
  function (§5, REQ-F003-015) MUST be **byte-identical** to F-002's `compose(...)` for the equivalent
  relationship, so that a workspace written by F-002's customer-wide fan-out and one written by
  F-003's per-workspace editor converge on the same engine value and neither silently clobbers the
  other's tracked state. F-003 supports only two modes and BOTH map byte-for-byte onto F-002's existing
  **prepend** branch (there is no F-003 analog of F-002's `overwrite` or `fill`): *Test:* for any
  `(baseline B, layer L)`, F-003 `effective(B, L, 'append')` equals F-002 `compose(B, L, 'prepend')`
  (REQ-F002-011) byte-for-byte, and F-003 `effective(B, L, 'inherit')` equals F-002
  `compose(B, "", 'prepend')` (REQ-F002-011, layer suppressed) byte-for-byte. F-003 defines NO mode that
  discards the baseline for a workspace; no workspace can fully override the customer baseline
  (REQ-F003-050).

### §1.3 Enforcement altitude (best-effort; inherited from F-002)
- REQ-F003-004 — Because the engine exposes exactly ONE prompt field per workspace and NO native
  base+workspace layering (grounding `engine-types.ts` `openAiPrompt`, `mappers.ts`; F-002
  REQ-F002-002), all F-003 layering is computed console-side and flattened into that single field.
  F-003's guarantee is limited to (a) deterministic composition on save (§5) and (b) detection and
  visible surfacing of drift (§6.5) — NOT prevention. Any requirement implying tamper-proof
  enforcement is out of scope (§2). *Test:* after a successful layer save, a later out-of-band edit of
  the workspace's prompt is not blocked by the console, and the workspace is subsequently reported as
  `overridden` (REQ-F002-023), not `synced`.

### §1.4 Relationship to the parent spec
- REQ-F003-005 — F-003 introduces NO new engine capability and NO new custody path: every engine write
  it performs is a `PATCH /api/workspaces/:id/settings` (parent REQ-032) subject to the parent custody
  boundary (parent REQ-021/021a/026/027), fresh-read-before-write (parent REQ-092/092a),
  verify-after-write (parent REQ-028), error mapping (parent REQ-097/097a), and audit (parent
  REQ-093/093a). The workspace layer + relationship are console-owned data (§4), not engine data.
  *Test:* a static scan confirms no new engine `/v1/*` path or engine field name is introduced by F-003
  code in `web/`; F-003's only engine traffic is per-workspace `PATCH /api/workspaces/:id/settings`
  plus the console-store reads/writes of §4/§7.

---

## §2 Out of Scope (Non-Goals)

Mirrors the brief's Out of Scope and the parent/F-002 custody boundary.

- REQ-F003-006 — The **customer-wide baseline** itself — defining, storing, applying, and fanning it
  out — is F-002. F-003 consumes the baseline as the layer it composes against; it does not create it.
- REQ-F003-007 — The native AnythingLLM instance **Default System Prompt**
  (`/system/default-system-prompt`) and **Prompt Variables** (`/system/prompt-variables`) are
  session-auth-only and unreachable under the API-key custody model (parent REQ-117/120; F-002
  REQ-F002-004). F-003 MUST NOT read, write, or attempt to drive them. *Test:* no F-003 code path
  references `/system/default-system-prompt` or `/system/prompt-variables`.
- REQ-F003-008 — No change to the customer-facing chat UI or end-user experience beyond the prompt
  content the workspace already consumes.
- REQ-F003-009 — Prompt **templating / variables / versioning** as a management surface is a separate,
  richer capability and is out of scope; F-003 is scoped to the composition layer only.
- REQ-F003-010 — **True tamper-proof enforcement** of either layer is a non-goal (REQ-F003-004); the
  engine's single prompt field cannot provide it.
- REQ-F003-011 — F-003 does NOT change F-002's **customer-wide apply/fan-out** flow; F-003 operates on
  **one workspace at a time** via the per-workspace editor. Bulk baseline application, blast-radius
  preview, and the multi-workspace danger gate remain F-002's territory (REQ-F002-019/021). The one
  reconciliation F-003 requires of F-002 — honoring a workspace's stored relationship during fan-out —
  is **RATIFIED and resolved** via the companion F-002 rev 4 revision (§9 REQ-F003-042), not silently
  changed here.
- REQ-F003-012 — Cross-deployment / multi-customer sharing of workspace layers is out of scope (one
  deployment == one customer, parent REQ-110).

---

## §3 Definitions & Glossary

- **Baseline** — the F-002 console-managed customer-wide system-prompt text (a single string); may be
  undefined/null (never set, or F-002 not yet configured). Read-only from F-003's perspective
  (REQ-F002-015). Denoted `B`.
- **Workspace layer** — the per-workspace-specific prompt text the console manages for a workspace;
  the same stored value as F-002's **remainder** (REQ-F002-010). Denoted `L`.
- **Composition relationship** — a per-workspace, **persistent** choice of how `L` combines with `B`:
  one of `inherit`, `append` (§5, REQ-F003-015). Denoted `rel`. (`override` was removed per the
  2026-07-07 ruling, REQ-F003-050; both remaining modes are baseline-forward.)
- **Effective prompt** — the string the console computes and writes to a workspace's `systemPrompt`
  (engine `openAiPrompt`): `effective(B, L, rel)` (§5). What the workspace's chats actually run with.
- **Boundary sentinel** — F-002's fixed console-owned marker separating the baseline segment from the
  workspace-layer segment inside a composed prompt (REQ-F002-011). Shared constant; F-003 does not
  redefine it.
- **Sync state** — F-002's per-workspace classification of the live engine prompt vs. the current
  composition: `synced | stale | overridden | never-applied` (REQ-F002-023). F-003 reuses the same four
  classes and the same predicate SHAPE, but **evaluates it against `effective(B, L, rel)`** for the
  workspace's stored `composition_mode` (REQ-F003-027) — an extension of F-002's `P == compose(B, R)`
  test parameterized by the new mode column, NOT a verbatim reuse (M3).
- **Drift** — a live engine prompt that no longer equals the console-computed effective prompt for the
  workspace's stored layer + relationship (`overridden`), typically from an out-of-band edit.

---

## §4 Data Model (BFF-owned store)

The workspace layer + relationship are the console's OWN data (boundary rule 3,
`docs/design/03-data-models.md`), persisted in the existing embedded SQLite store. The engine remains
authoritative for the live workspace prompt; the console persists only the tracking state needed to
recompose and detect drift. F-003 **extends F-002's `workspace_baseline_state`** rather than adding a
parallel table.

- REQ-F003-013 — The BFF store adds ONE column to F-002's `workspace_baseline_state` (REQ-F002-010),
  migrated in `store/db.ts`:
  - **`composition_mode`** (TEXT, one of `'inherit' | 'append'`; column default `'append'`, subject to
    REQ-F003-044) — the workspace's persistent composition relationship. (`override` is not a permitted
    value, REQ-F003-050.)
  - (Optional, for audit parity) `composition_mode_updated_at` (TEXT ISO-8601),
    `composition_mode_updated_by` (TEXT staff id, parent REQ-029c actor).
  The **workspace layer** reuses the existing `remainder` column (REQ-F002-010); F-003 adds NO second
  prompt column. **Default-vs-derivation (resolves review M4):** the column default `'append'` applies
  ONLY to a row created outside the editor path (e.g. a row F-002's fan-out writes without an operator
  mode choice, pending REQ-F003-042). The **persisted mode on a first save through the F-003 editor is
  the operator-confirmed value shown by the structural derivation (REQ-F003-014)**, not the column
  default — the two never race because the editor always writes an explicit `composition_mode`. *Test:*
  the migration adds `composition_mode` to `workspace_baseline_state` constrained to `inherit|append`;
  an existing F-002 row (with a stored remainder) reads back with a defined `composition_mode`; reading
  the layer returns the same `remainder` value F-002 stored; a first save through the editor persists
  the operator-confirmed derived mode, not `'append'`, when the derivation differs.
- REQ-F003-014 — **Relationship/layer derivation for an untracked workspace (mirrors F-002
  REQ-F002-012 structural test).** A workspace with NO `workspace_baseline_state` row has never been
  managed. The console derives an **initial view** (not a stored decision until the operator saves)
  purely structurally from the current live engine prompt `P`, WITHOUT depending on any stored state:
  - `P` empty/blank → `rel = 'inherit'`, layer empty (the workspace runs whatever governs it today —
    the baseline once applied, else nothing);
  - `P` **contains `SENTINEL`** → `rel = 'append'`, layer = substring of `P` **after** its first
    `SENTINEL` occurrence (P is already a console composition; the pre-`SENTINEL` segment is the prior
    baseline and is not part of the layer);
  - `P` non-empty and **no** `SENTINEL` → `rel = 'append'`, layer = `P` verbatim (a hand-authored prompt
    that today stands alone is **preserved as the workspace layer beneath the baseline**; with `override`
    dropped (REQ-F003-050) there is no mode that discards the baseline, so the standalone prompt folds
    under it via `append`). This mirrors F-002's first-apply prepend capture (REQ-F002-012). Note: an
    append save that would overwrite this still-uncaptured live content is destructive until the content
    is captured as the layer (REQ-F003-025 case (b)).
  The derivation is surfaced in the editor (§8) and only becomes stored state on save. *Test:* an
  untracked workspace whose live prompt is "Answer only in French." (no sentinel) opens as
  `rel = append`, layer = "Answer only in French." (baseline preserved above it); one whose prompt is
  `X + SENTINEL + Y` opens as `rel = append`, layer = `Y`; an empty one opens as `rel = inherit`,
  layer empty.
- REQ-F003-015a — *(ID note, resolves review M6: the `a` suffix is an intentional cross-section mirror
  of F-002 REQ-F002-010a — a §4 data-model rule — and does NOT refine the §5 composition requirement
  REQ-F003-015. The id is stable and not renumbered.)* The store NEVER persists a copy of the live
  workspace prompt as authoritative; the
  live prompt is always read fresh from the engine via `GET /api/workspaces/:id` (parent REQ-031).
  Drift/sync (§6.5) is computed against a fresh engine read, not a cached value (F-002 REQ-F002-010a).
  *Test:* changing a workspace's prompt out-of-band and reopening the editor reflects the new live
  value in the diff without any console write.

---

## §5 Composition Semantics (per-workspace, persistent: **inherit | append**)

The brief names composition semantics — shared with F-002 — as "the crux." F-002 models composition
as a **per-apply** mode chosen at the customer-baseline surface (`prepend | overwrite | fill`,
REQ-F002-055). F-003 models it as a **per-workspace, persistent** relationship chosen in the
workspace editor, restricted (per the 2026-07-07 ruling, REQ-F003-050) to two **baseline-forward**
modes: `inherit` and `append`. Both map byte-for-byte onto F-002's single **prepend** branch, so the
two axes reconcile without any new F-002 compose branch (REQ-F003-003). F-003 has NO analog of F-002's
`overwrite` or `fill`, and no workspace can discard the customer baseline. The cross-feature
reconciliation — that F-002's fan-out must honor each workspace's stored `composition_mode` rather than
forcing one per-apply mode — is **RATIFIED and resolved** via the companion F-002 rev 4 revision (§9
REQ-F003-042).

- REQ-F003-015 — **Effective-prompt function.** For baseline `B`, workspace layer `L`, and relationship
  `rel`, the console writes `effective(B, L, rel)` to the engine `openAiPrompt`:
  - `rel = 'inherit'` → `effective = B` (the baseline alone; the empty string when `B` is empty/null).
    The stored layer `L` is **retained in the store but not contributed to the engine value** — inherit
    suppresses the workspace contribution without discarding the stored layer. **An `inherit` save DOES
    issue an engine write** (it writes `B`, or the empty string, to `openAiPrompt`, resolving review M5:
    "not written" refers to `L` only, not to the engine call). Because that write replaces the live
    prompt, an `inherit` save that drops a non-empty workspace segment or overwrites uncaptured live
    content is destructive per REQ-F003-025.
  - `rel = 'append'` → `effective = compose(B, L, 'prepend')` per F-002 REQ-F002-011:
    `= L` when `B` empty/null; `= B` when `L` empty; `= B + SENTINEL + L` when both non-empty.
  *Test:* a truth table of `(B, L, rel)` yields these exact bytes: `('X', 'Y', inherit) = 'X'`;
  `('', 'Y', inherit) = ''`; `('X', 'Y', append) = 'X' + SENTINEL + 'Y'`; `('X', '', append) = 'X'`;
  `('', 'Y', append) = 'Y'`. (There is no `override` row: the mode is dropped, REQ-F003-050.)
- REQ-F003-016 — **Relationship↔F-002-mode mapping (reconciliation).** `append` ≡ F-002 `prepend`;
  `inherit` ≡ F-002 `compose(B, "", 'prepend')` with the layer suppressed rather than erased. BOTH F-003
  modes resolve to F-002's single **prepend** branch (REQ-F002-011); F-003 has no per-workspace analog
  of F-002's `overwrite` (dropped with `override`, REQ-F003-050) or `fill` (a bulk-apply-time heuristic,
  not a persistent per-workspace relationship). *Test:* applying F-002's fan-out in `prepend` to a
  workspace F-003 marks `append` produces the same engine value as saving that workspace via F-003;
  applying F-002 `prepend` with an empty remainder to a workspace F-003 marks `inherit` produces the
  same engine value (`B`) as an F-003 `inherit` save.
- REQ-F003-017 — **"Blank = inherit" reinterpreted (resolves the brief's stated confusion vector).**
  In the pre-F-003 field, a blank prompt meant "inherit the engine default." In the layered world a
  blank layer with `rel = inherit` (or `rel = append` and an empty layer) means **"run the customer
  baseline"** — NOT "inherit engine default." The relationship control makes this explicit and the UI
  label MUST be changed from "blank = inherit" accordingly (§8, REQ-F003-031). *Test:* with a baseline
  defined and `rel = inherit`, the effective prompt equals the baseline (not the empty string); with
  no baseline defined and `rel = inherit`, the effective prompt is empty (engine default).
- REQ-F003-018 — **Effective-prompt fidelity.** The effective prompt shown in the preview (§6.2) MUST
  equal, byte-for-byte, the value the console writes to the engine on save (§6.3) — the SAME compose
  function computes both, over the SAME baseline snapshot. The preview MUST NOT display an effective
  value the save would not produce. *Test:* for any `(B, L, rel)`, the previewed `effectivePrompt`
  equals the engine `openAiPrompt` read back after saving that same input.
- REQ-F003-019 — **No silent layer mutation (mirrors F-002 REQ-F002-014).** The stored layer `L`
  changes ONLY when (a) the operator edits the layer text, or (b) the operator explicitly resolves an
  out-of-band override by choosing "preserve" (REQ-F003-029). Switching relationship
  (`append`↔`inherit`) MUST NOT discard or alter the stored layer text, and a baseline
  change MUST NOT alter it. *Test:* switching a workspace from `append` to `inherit` and back leaves
  the stored layer byte-identical; changing the baseline leaves every stored layer unchanged.

---

## §6 Functional Requirements

### §6.1 Viewing the layered prompt

- REQ-F003-020 — The workspace editor exposes a VIEW of the layered prompt via
  `GET /api/workspaces/:id/prompt-layer` (§7) returning: the composition relationship, the workspace
  layer, the current baseline (read-only, from F-002 REQ-F002-015; or a clear "no baseline defined"
  state when F-002 is unconfigured/null), the computed effective prompt, and the sync state
  (REQ-F002-023). When no baseline exists, the effective prompt is derived from the layer alone and the
  view states that no baseline currently governs the workspace. *Test:* the view returns relationship +
  layer + baseline + effective + sync state; with the baseline null it reports "no baseline defined"
  and an effective prompt equal to the layer (or empty under `inherit`).

### §6.2 Editing & live preview (before write)

- REQ-F003-021 — The operator can change the relationship and edit the layer, and a **live-recomputing
  effective-prompt preview** updates as they type, WITHOUT any engine write. The preview computes
  `effective(B, L, rel)` (§5) against the currently loaded baseline snapshot. *Test:* changing the
  relationship or editing the layer updates the previewed effective prompt with zero engine writes.
- REQ-F003-022 — An **authoritative server preview** is available via
  `GET /api/workspaces/:id/prompt-layer/preview` (§7) carrying the pending `compositionMode` and
  `workspaceLayer`. It returns the effective prompt, the current live engine prompt (for the diff), the
  sync state, a `currentPromptHash` snapshot (SHA-256, REQ-F002-010c), and a `willChange` flag. When
  the pending save is **destructive** (REQ-F003-025), the preview also mints and returns a server-issued
  binding **`confirmToken`** (a nonce) bound to the snapshot — the workspace id, the pending
  relationship, the effective prompt, and `currentPromptHash` — plus a human-typeable
  `confirmationPhrase` (the two-artifact gate, parent §8; F-002 REQ-F002-048). Each call issues a fresh
  token. *Test:* the preview endpoint issues zero engine writes; for a non-destructive change it
  returns no `confirmToken`; for a destructive change it returns a `confirmToken` and a
  `confirmationPhrase`.

### §6.3 Saving (write + verify)

- REQ-F003-023 — The console persists the layer + relationship and applies the effective prompt via
  `PUT /api/workspaces/:id/prompt-layer` (§7), which (1) recomputes `effective(B, L, rel)` server-side,
  (2) writes it to the workspace `systemPrompt` via `PATCH /api/workspaces/:id/settings` (parent
  REQ-032), (3) verifies via verify-after-write (parent REQ-028: re-read, confirm `openAiPrompt` equals
  the effective value), and (4) on verified success persists `remainder` (= layer), `composition_mode`,
  and the applied hashes into `workspace_baseline_state` (REQ-F002-010/010c). Whether a save is
  **destructive** (and thus danger-gated) is defined solely by REQ-F003-025; REQ-F003-023 does NOT
  restate a shorter mode list but **defers to REQ-F003-025** (resolves review M1: `append` and `inherit`
  are usually but NOT always non-destructive). A non-destructive save requires NO danger gate. *Test:* a
  save the REQ-F003-025 predicate classifies non-destructive writes the effective prompt, verifies it,
  updates the store row, and needs no typed confirmation; a write that fails verification counts as
  failed and does not update the store row (REQ-F003-024b).
- REQ-F003-024 — **Fresh-read-before-write & per-workspace divergence (parent REQ-092/092a; mirrors
  F-002 REQ-F002-047; resolves review B3).** The no-write-on-divergence guard MUST run on EVERY save,
  destructive or not. To give it a referent on the common (non-destructive) path, **every**
  `PromptLayerSaveRequest` (§7.1) MUST carry the `currentPromptHash` returned by the preview
  (REQ-F003-022) — a required field, independent of the danger `confirmToken` (which is present only for
  destructive saves). Before composing and writing, the console re-reads the live prompt and compares
  its SHA-256 hash (REQ-F002-010c) to the request's `currentPromptHash`. On mismatch (the workspace was
  edited out-of-band between preview and save) the console MUST NOT write; it reports the save outcome
  **`diverged`** and surfaces the current live value so the operator can re-preview. A
  `PromptLayerSaveRequest` missing `currentPromptHash` is rejected **400**. *Test:* an append/inherit
  (non-destructive) save whose `currentPromptHash` no longer matches a freshly-read live prompt returns
  `diverged` with zero engine writes and NO danger token involved; a save request omitting
  `currentPromptHash` is rejected 400.
- REQ-F003-024b — **Verify-after-write & partial-failure legibility (parent REQ-028/098).** *(ID note,
  resolves review M6: there is intentionally no REQ-F003-024a; this `b`-suffixed id groups the
  verify/partial-failure rule with the divergence rule REQ-F003-024 and is stable — not renumbered.)* A
  save is
  reported `saved` only when the re-read confirms the effective value; an upstream failure or a failed
  verify is reported `failed` with the workspace retaining its prior engine prompt, and the store row is
  NOT updated. The UI MUST NOT show "saved" for a `failed`/`diverged` outcome (parent REQ-098/098a).
  *Test:* a forced PATCH failure reports `failed`, leaves the engine prompt unchanged, and leaves the
  store row unchanged.

### §6.4 Destructive save gating

- REQ-F003-025 — **Danger gate for destructive saves (`DangerConfirm`, parent REQ-078c/080/081;
  re-derived after dropping `override`, resolves review B2).** With `override` gone, no save discards the
  baseline; the residual destruction is **discarding workspace content the console cannot recover**. A
  save is **§8-class destructive** iff, evaluating the fresh live prompt `P` and the console's stored
  state, **either**:
  - **(a) `inherit`-drops-a-live-workspace-segment** — the target relationship is `inherit` AND the
    workspace currently runs a **non-empty workspace-specific segment** on the engine (its live effective
    prompt carries content beyond the bare baseline). An `inherit` save writes `B` (or empty), removing
    that segment from the engine (REQ-F003-015). The stored layer is retained (REQ-F003-019), but the
    engine has no native undo and live chats change immediately, so the transition is gated. OR
  - **(b) overwriting-uncaptured-content** — the save (append OR inherit) would replace a **non-empty
    live prompt whose exact bytes the console has NOT captured as recoverable stored state** — i.e. an
    `overridden` workspace (live prompt matches neither `effective(B, L, rel)` nor the last-applied
    hash), OR an untracked/never-captured non-empty prompt (REQ-F003-014's standalone case before its
    first save). **This case fires even when a now-stale stored layer exists** for the workspace (closing
    the B2 hole: a tracked `append`/`inherit` workspace that has drifted `overridden` is still gated,
    because its live content is uncaptured). The prior content is unrecoverable once overwritten
    (REQ-F003-037).

  No destructive discard may escape the gate: the preview predicate of REQ-F003-022 MUST mint a
  `confirmToken` for exactly the (a)/(b) cases above, and the save MUST reject any (a)/(b) save that
  arrives without one. A destructive save MUST carry (1) the binding `confirmToken` from the preview
  (REQ-F003-022) and (2) the `typedConfirmation` the operator typed, which the server validates against
  the phrase bound to that token. An absent/malformed `confirmToken` on a destructive save → **400**; a
  stale/superseded token (baseline changed, a newer preview minted, or the relationship differs from the
  one the token was minted under) → **409**; a `typedConfirmation` that does not match → **409**. On any
  of these, NO engine write occurs. *Test:* switching a workspace with a non-empty live segment to
  `inherit` (case a) does not write until a valid `confirmToken` + matching `typedConfirmation` are
  presented; saving over an `overridden` workspace whose live content is uncaptured (case b, any
  relationship) is likewise gated; a stale token or wrong phrase is rejected 409 with zero writes; an
  `append`/`inherit` save that neither (a) nor (b) classifies is accepted without a typed confirmation.
- REQ-F003-026 — **Danger dialog copy.** The confirmation dialog MUST name the consequence — for an
  `inherit` transition (case a), that the workspace's own instructions will stop running on the engine
  and it will run the customer baseline alone; for an uncaptured-overwrite (case b), that non-console-
  authored live content will be replaced and cannot be recovered from the engine — and MUST state
  irreversibility: the engine holds a single prompt field with no native undo, and the console's stored
  layer + last-applied hashes are the ONLY record of prior workspace-specific content (REQ-F003-037).
  *Test:* the dialog copy names the case-specific consequence (workspace-runs-baseline-alone for inherit;
  uncaptured-content-replaced for case b) and states the write is not natively undoable.

### §6.5 Drift, baseline changes & override resolution

- REQ-F003-027 — **Sync-state (F-002 classes, F-003-parameterized; resolves review M3).** Per-workspace
  sync state uses F-002's four classes (REQ-F002-023) but evaluates the predicate against
  `effective(B, L, rel)` for the workspace's stored `composition_mode` (an extension of F-002's
  mode-less `P == compose(B, R)`, not a verbatim reuse): `never-applied` (no row), `synced`
  (`P == effective(B, L, rel)`), `stale` (`P` matches the last-applied composition hash but the baseline
  has since changed so `effective(B, L, rel) != P`), `overridden` (`P` matches neither). *Test:* an
  untouched, current workspace reports `synced`; one edited out-of-band reports `overridden`; one
  unchanged since save but whose baseline changed afterward reports `stale`; the `synced` check for an
  `inherit` workspace uses `effective = B`, not `compose(B, storedRemainder)`.
- REQ-F003-028 — **Baseline change propagation.** When the baseline changes (F-002 REQ-F002-016/046),
  BOTH `append` and `inherit` workspaces become `stale` — each depends on `B` (`append` → `B + SENTINEL
  + L` or `B`; `inherit` → `B`), so their effective prompt now differs from the live value. (With
  `override` dropped, REQ-F003-050, there is no baseline-independent workspace mode.) The console offers
  re-composition for a `stale` workspace through the same editor/save (recompute `effective(newB, L,
  rel)`), preserving the stored layer (REQ-F003-019). *Test:* after a baseline edit, an `append`
  workspace reports `stale` and a re-save returns it to `synced` with its layer byte-identical; an
  `inherit` workspace likewise reports `stale` and re-saving writes the new baseline `B`.
- REQ-F003-029 — **Resolving an out-of-band override (mirrors F-002 REQ-F002-025).** For an
  `overridden` workspace the console MUST NOT silently clobber the out-of-band prompt on the next save.
  The editor surfaces the divergence and requires the operator to choose: (a) **preserve** — adopt the
  current live prompt as the new stored layer (the explicit layer re-derivation permitted by
  REQ-F003-019), or (b) **discard** — recompose from the stored layer. Because the live prompt of an
  `overridden` workspace is uncaptured content, **any** resolution save falls under REQ-F003-025 case (b)
  regardless of the stored relationship (this is the concrete closure of review B2 — a tracked
  `append`/`inherit` workspace that has drifted is gated, not silently overwritten): the preview mints a
  `confirmToken`, the chosen resolution is bound to that token (REQ-F003-022), and the save is confirmed
  under the danger gate (REQ-F003-025). *Test:* saving over an `overridden` `append` workspace does not
  proceed without an explicit preserve/discard choice AND a valid `confirmToken` + `typedConfirmation`;
  "preserve" makes the out-of-band text the new stored layer; "discard" recomposes from the stored layer
  only after the gate passes.

---

## §7 API Surface

Product API, consistent with `docs/design/02-product-api.md`: product vocabulary only, no engine field
names cross the boundary (parent REQ-021a); all routes require a staff session (parent REQ-012); error
bodies are `{ message: string }` rendered verbatim (parent REQ-097a). All routes are under `/api`.

### §7.1 Product types (excerpt — added to `bff/src/types/product-types.ts`, parent REQ-025)

```ts
export type CompositionRelationship = 'inherit' | 'append'; // 'override' dropped, REQ-F003-050

export interface WorkspacePromptLayer {
  workspaceId: string;                 // opaque product handle (parent REQ-021b)
  displayName: string;
  compositionMode: CompositionRelationship;
  workspaceLayer: string;              // the per-workspace layer text (== F-002 remainder)
  baseline: string | null;            // current F-002 baseline, read-only; null = none defined
  effectivePrompt: string;            // effective(B, L, rel) — what runs (REQ-F003-015)
  currentPrompt: string | null;       // live engine prompt (for the diff)
  syncState: BaselineSyncState;       // reused from F-002 §7.1 (REQ-F002-023)
}

export interface PromptLayerPreview {
  effectivePrompt: string;            // authoritative effective(B, L, rel)
  currentPrompt: string | null;       // live engine prompt (for the diff)
  currentPromptHash: string;          // snapshot hash bound by confirmToken (REQ-F003-024)
  syncState: BaselineSyncState;
  willChange: boolean;                // effective differs from live
  requiresConfirmation: boolean;      // destructive per REQ-F003-025
  confirmToken?: string;              // present iff requiresConfirmation (REQ-F003-022)
  confirmationPhrase?: string;        // human-typeable danger phrase to display + type
}

export type PromptLayerSaveOutcome = 'saved' | 'diverged' | 'failed';
// 'diverged' = live prompt changed out-of-band since preview; not written (REQ-F003-024)

export interface PromptLayerSaveResult {
  outcome: PromptLayerSaveOutcome;
  verified: boolean;                  // verify-after-write (parent REQ-028)
  effectivePrompt: string;            // the value written (on 'saved')
  message?: string;                   // failure / divergence detail, rendered verbatim
}

export interface PromptLayerSaveRequest {
  compositionMode: CompositionRelationship;
  workspaceLayer: string;
  currentPromptHash: string;          // REQUIRED on every save (destructive or not); the
                                      // preview snapshot hash the divergence guard compares
                                      // against a fresh read (REQ-F003-024; missing → 400)
  overrideResolution?: 'preserve' | 'discard'; // NOT a composition mode: the preserve/discard
                                      // choice for a drifted (overridden sync-state) workspace
                                      // (REQ-F003-029). Any such resolution is a destructive save.
  confirmToken?: string;              // required for a destructive save (REQ-F003-025)
  typedConfirmation?: string;         // required for a destructive save (REQ-F003-025)
}
```

### §7.2 Routes

| Method / path | Req | Resp | Engine / store call(s) | Mutates → event |
|---|---|---|---|---|
| `GET /api/workspaces/:id/prompt-layer` | — | `WorkspacePromptLayer` | live prompt read (parent REQ-031) + baseline read (REQ-F002-015) + store | no (REQ-F003-020) |
| `GET /api/workspaces/:id/prompt-layer/preview` | `?compositionMode&workspaceLayer` | `PromptLayerPreview` | live prompt read (parent REQ-031); mints `confirmToken` when destructive; no engine write | no engine write — dry run (REQ-F003-022) |
| `PUT /api/workspaces/:id/prompt-layer` | `PromptLayerSaveRequest` | `PromptLayerSaveResult` | fresh-read (parent REQ-092) + `PATCH /api/workspaces/:id/settings` (parent REQ-032) + verify (parent REQ-028) + store write | yes → `admin.workspace.updated` (parent REQ-032) + `admin.workspace.prompt_layer.updated` (REQ-F003-040) |

- REQ-F003-030 — Every route above is BFF-brokered (parent REQ-021/026/027): the browser calls only
  these product `/api/*` routes; the engine write is exactly the existing per-workspace
  `PATCH /api/workspaces/:id/settings`; the layer + relationship live only in the BFF store; the
  baseline is read via F-002's baseline route. *Test:* a static scan finds no F-003 engine path/field
  name in `web/`; the save route's engine traffic is exactly one workspace-settings write (plus its
  verify re-read) per save.

---

## §8 Web UI, Non-Functional, Events & Audit

The web surface follows `docs/design/05-web-architecture.md` and extends the existing workspace detail
editor (`web/src/features/workspaces/WorkspaceSettings.tsx`) — no new top-level route.

### §8.1 Web UI

- REQ-F003-031 — **Replace the lone textarea with a composition sub-region.** The current "System
  prompt (blank = inherit)" textarea (WorkspaceSettings.tsx line ~348) is replaced by a cluster: (1) a
  **composition-relationship selector** (`inherit | append`; `override` dropped, REQ-F003-050), (2) the **workspace-layer**
  textarea (reusing the existing `systemPrompt` textarea idiom + `aria-invalid`/field-error patterns),
  and (3) a **read-only, live-recomputing effective-prompt preview** (REQ-F003-021). The obsolete
  "blank = inherit" label is replaced with wording consistent with REQ-F003-017 (e.g. relationship
  labels + a note that `inherit` runs the customer baseline). The workspace-layer field is no longer
  written directly to `systemPrompt`; the editor calls the §7 prompt-layer routes. *Test:* the editor
  renders the three widgets in place of the old textarea and submits via the prompt-layer routes, not a
  raw `systemPrompt` PATCH.
- REQ-F003-051 — **Native-default invisibility warning (RATIFIED 2026-07-07 addition to REQ-F003-045).**
  The composition sub-region MUST display a persistent, non-dismissable-by-default **warning** that an
  unreadable native AnythingLLM **Default System Prompt** may exist invisibly **beneath** the managed
  layer: the API-key custody model cannot read `/system/default-system-prompt` (parent REQ-117/120; F-002
  REQ-F002-044), so the effective-prompt preview (REQ-F003-021/032) reflects only the console-managed
  composition and cannot account for any native default the engine may prepend at runtime. The warning
  MUST be programmatically associated with the effective-prompt preview region (visible to assistive
  technology, not color-only) so operators do not read the preview as the guaranteed full runtime prompt.
  *Test:* the composition sub-region renders a warning naming the possibly-invisible native Default System
  Prompt and stating the console cannot read it; the warning is exposed to assistive technology and
  associated with the effective-prompt preview; it is present regardless of composition relationship or
  whether a baseline is defined.
- REQ-F003-032 — **Effective-prompt preview semantics.** The preview is a read-only region with correct
  non-editable semantics for assistive technology (it MUST NOT be exposed as an editable textbox). It
  recomputes live as the operator edits (REQ-F003-021). Announcement-on-recompute is a deliberate
  choice: this spec adopts a **debounced polite live region** (announce the settled effective prompt,
  not each keystroke), subject to REQ-F003-047. *Test:* the preview is exposed to AT as read-only; a
  settled edit is announced once via a polite live region, not per keystroke.
- REQ-F003-033 — **Relationship selector accessibility.** The selector (post-F-001 DS `Select`/radio)
  MUST be fully keyboard-operable and MUST NOT convey the selected relationship by color alone (WCAG
  non-color-only). *Test:* the relationship can be selected via keyboard only; the current selection is
  distinguishable in a grayscale/color-blind simulation.
- REQ-F003-034 — **Destructive-save danger dialog (parent §8; F-002 REQ-F002-034 style).** The destructive-save
  confirmation dialog manages focus (focus moves into the dialog on open, returns to the trigger on
  close) and requires typing the exact `confirmationPhrase` before the save is issued. *Test:* opening
  the dialog moves focus into it; the save fires only after the typed phrase matches and a valid
  `confirmToken` is present; keyboard-only operation completes the preview → confirm → result cycle.
- REQ-F003-035 — **Outcome legibility (UI side of REQ-F003-024/024b).** After a save the UI renders the
  outcome distinctly: `saved`, `diverged` (with the current live value surfaced for re-preview), or
  `failed` (with the verbatim `message`, parent REQ-097a) — never "saved" for a non-`saved` outcome.
  *Test:* a `diverged`/`failed` save renders a state distinct from success and names the reason.

### §8.2 Non-Functional Requirements

- REQ-F003-036 — **Custody boundary (inherited).** The browser never calls the engine directly and
  never receives the API key; all reads, previews, and saves go through the BFF (parent
  REQ-013/021/021a/026). *Test:* no browser-originated request targets an engine URL for any F-003 flow;
  the API key never appears in a browser payload or bundle.
- REQ-F003-037 — **Reversibility caveat (honest).** Engine prompt writes have no native undo; once a
  save writes the effective prompt, the prior engine value is not recoverable from the engine. The
  console's stored layer + last-applied hashes are the only record of prior workspace-specific content,
  and only to the extent the console captured it (REQ-F003-014). *Test:* the confirm dialog copy states
  the write is not natively undoable and that the console store is the sole record of prior content.
- REQ-F003-038 — **Performance.** Under the parent nominal load (parent REQ-100), the prompt-layer view
  and preview render within **p95 < 1500 ms**; a single save (write + verify, parent REQ-028) completes
  within **p95 < 1500 ms** (aligned with F-002 REQ-F002-039 per-write bound). Because F-003 acts on one
  workspace at a time, no bulk/async apply model is required. *Test:* view/preview render under 1500 ms
  p95; a single save completes under 1500 ms p95.
- REQ-F003-039 — **Preview/save compose parity.** The client-side live preview (REQ-F003-021) and the
  server-side compose used at save (REQ-F003-018) MUST implement the SAME `effective(...)` semantics
  (§5), guarded so the two cannot diverge (shared logic and/or a contract test asserting equality on a
  fixed input matrix). *Test:* a contract test over a `(B, L, rel)` matrix shows client preview and
  server-computed effective prompt are byte-identical.

### §8.3 Events & Audit

- REQ-F003-040 — **Event catalog addition.** Each verified save emits the existing
  `admin.workspace.updated` (parent REQ-032, for the settings write) PLUS a new
  `admin.workspace.prompt_layer.updated`. Payload: actor (parent REQ-029c), `workspaceId`,
  `compositionMode`, a content reference for the layer (length and/or hash — non-secret free text), the
  effective-prompt hash, `verified`, `timestamp`. A `diverged`/`failed` save emits no
  `prompt_layer.updated` success event. *Test:* a verified append save emits one
  `admin.workspace.updated` and one `admin.workspace.prompt_layer.updated`; a `diverged` save emits
  neither success event.
- REQ-F003-041 — **Audit.** Every prompt-layer save — and especially every destructive save (the
  REQ-F003-025 (a)/(b) cases: an `inherit` drop of a live segment, or an uncaptured-content overwrite) —
  is recorded in the append-only audit log (parent REQ-093/093a) with actor, action, target workspace,
  `compositionMode`, `verified`, and outcome (`saved`/`diverged`/`failed`). *Test:* a save produces one
  audit entry capturing the workspace, relationship, and outcome; a destructive save is auditable as a
  dangerous operation (parent REQ-088).

---

## §9 Open Questions / Assumptions — RATIFIED (2026-07-07)

Every item below has been **ratified by the 2026-07-07 human rulings**; there are no open questions
remaining in this spec. Each ruling is recorded against its stable id (ids are never deleted or
renumbered). The rulings overwhelmingly **confirm the provisional defaults** the requirements above
already adopted; the few concrete changes they introduce have been folded into the governing
requirements (cited per item). REQ-F003-050 (drop `override`) was ratified in an earlier 2026-07-07
ruling and is recorded here so its many in-text citations resolve.

- REQ-F003-050 — **RATIFIED (2026-07-07 ruling): drop the `override` composition mode.** The
  composition relationship is restricted to two **baseline-forward** modes, `inherit | append` (§5,
  REQ-F003-015); the previously-considered `override` mode (workspace layer replaces the baseline,
  discarding it for that workspace) is **removed** and is NOT a permitted `composition_mode` value
  (REQ-F003-013). No F-003 mode discards the customer baseline. This closes review B1 (the false
  `override ≡ overwrite` byte-equivalence): with no `override` mode there is no baseline-discarding
  branch to reconcile against F-002, and both surviving modes map byte-for-byte onto F-002's single
  `prepend` branch (REQ-F003-003/016). A consequence (review B2): a composition *mode* is no longer a
  destructive trigger; destructiveness is re-derived around dropping a live segment / overwriting
  uncaptured content in REQ-F003-025. This item is settled and needs no further ruling. *Test:* no
  F-003 type, store column, UI control, truth table, or default admits an `override` value.
- REQ-F003-042 — **RATIFIED (2026-07-07): the per-workspace stored relationship is AUTHORITATIVE.**
  F-002 chooses composition as a **per-apply** mode at the baseline surface; F-003 stores a
  **per-workspace, persistent** relationship. F-003's per-workspace relationship maps byte-for-byte onto
  F-002's compose branches (REQ-F003-003/015/016), and the ruling confirms the **per-workspace stored
  `composition_mode` is authoritative**: F-002's fan-out consults each workspace's stored
  `composition_mode` and honors it, rather than overwriting it with a single per-apply mode. This
  reconciliation is **RESOLVED (not merely proposed)** and is being implemented via a companion **F-002
  revision to rev 4**: F-002 REQ-F002-055 now honors the per-workspace stored mode, defaulting to the
  operator-selected apply mode only when no per-workspace mode is stored for a workspace. The hard
  dependency on F-002 (REQ-F003-002) stands. *Test:* F-002 rev 4's fan-out over a set of workspaces
  writes each one's engine value using that workspace's stored `composition_mode`; a workspace with a
  stored mode is not forced to the operator's per-apply mode; a workspace with no stored mode falls back
  to the operator-selected apply mode.
- REQ-F003-043 — **RATIFIED (2026-07-07): reuse `remainder`; baseline change marks `stale`, no
  auto-rewrite.** F-002's `remainder` is confirmed as the **single workspace-layer store** (no separate
  F-003 layer column; REQ-F003-003/013). A baseline change leaves `append`/`inherit` layers **intact**
  and marks the workspace **`stale`** for recompose-on-next-save (REQ-F003-019/028) — the console does
  NOT auto-rewrite the engine value on a baseline change. *Test:* the store exposes exactly one
  per-workspace layer column (`remainder`); after a baseline change an `append`/`inherit` workspace is
  `stale` with its stored layer byte-identical and no engine write issued until an explicit re-save.
- REQ-F003-044 — **RATIFIED (2026-07-07): `append` column default; standalone prompt folds BENEATH the
  baseline.** The stored-column default `append` for newly-tracked workspaces (rows created outside the
  editor path; REQ-F003-013) is confirmed, as is the structural derivation of REQ-F003-014 (empty →
  `inherit`; sentinel-bearing → `append`; standalone → `append`). A pre-F-003 hand-authored **standalone**
  prompt folds **BENEATH** the baseline via `append` — this is the ratified desired behavior (rather than
  leaving it baseline-free). With `override` dropped (REQ-F003-050) there is no mode that preserves a
  standalone prompt *above* the baseline; such a prompt is dropped only via an explicit, gated `inherit`
  save (REQ-F003-025(a)). *Test:* a newly-tracked workspace row defaults to `append`; an untracked
  workspace whose live standalone prompt is captured on first save composes as `B + SENTINEL + L` (layer
  beneath the baseline), not as the standalone prompt alone.
- REQ-F003-045 — **RATIFIED (2026-07-07): adopt `inherit = run the customer baseline`; ADD a
  native-default warning.** The wording `inherit = run the customer baseline` and the mandated relabeling
  (REQ-F003-017/031) are confirmed. **ADDITIONALLY**, the ruling requires the UI to **warn** that an
  unreadable native engine **Default System Prompt** may exist invisibly beneath the managed layer — the
  console cannot read it (cf. F-002 REQ-F002-044). This warning is now a concrete, testable UI
  requirement, **REQ-F003-051** (§8.1), not merely a note here. *Test:* see REQ-F003-051.
- REQ-F003-046 — **RATIFIED (2026-07-07): DangerConfirm gates exactly the two residual destructive
  cases.** With `override` gone (REQ-F003-050) no composition *mode* is destructive; DangerConfirm gating
  applies to exactly the two residual destructive cases of REQ-F003-025: **(a)** an `inherit` save that
  drops a **non-empty live workspace segment**, and **(b)** any save (`append` or `inherit`) that would
  **overwrite uncaptured/drifted live content the console did not author**. The ruling confirms both: an
  `append`/`inherit` save overwriting a pre-existing non-empty prompt the console never captured IS gated
  as case (b); and a switch to `inherit` — which RETAINS the stored layer and can recompose it later
  (REQ-F003-019/028), so a **recoverable** `inherit` (stored layer retained) is **NOT gated** — is gated
  only when it drops a live segment (case a), not merely because the layer stops contributing. *Test:*
  see REQ-F003-025.
- REQ-F003-047 — **RATIFIED (2026-07-07): debounced polite live-region announcement.** Server-
  authoritative fidelity (REQ-F003-018), client/server compose parity (REQ-F003-039), and a **debounced
  polite live-region announcement** of the effective-prompt preview recompute (REQ-F003-032) are all
  confirmed (over the silent-preview and explicit-"recompute"-affordance alternatives). *Test:* see
  REQ-F003-032.
- REQ-F003-048 — **RATIFIED (2026-07-07): F-002 is a HARD prerequisite; no degraded null-baseline
  mode.** F-002 is confirmed a **hard prerequisite** (REQ-F003-002): F-003 ships after (or with) F-002
  and there is **no degraded, permanently-null-baseline F-003 mode**. F-003 cannot compute an effective
  prompt against a baseline that does not exist. *Test:* see REQ-F003-002.
- REQ-F003-049 — **RATIFIED (2026-07-07): no separate F-003 scale bound; defer to F-002
  REQ-F002-045.** F-003 acts one workspace at a time, so it inherits no bulk-apply sizing risk; the only
  scale-sensitive surface is the drift/status list it shares with F-002. The ruling confirms **no
  separate F-003 scale bound is required**; the workspaces-per-customer figure defers to F-002
  REQ-F002-045. *Test:* see F-002 REQ-F002-045.

---

## §10 Traceability to the Brief

| Brief element | Addressed by |
|---|---|
| Problem: workspace prompt is a lone opaque field with no composition model | §1.1 REQ-F003-001, §8.1 REQ-F003-031 |
| Proposed Direction: promote to first-class layer over the F-002 baseline | §1.1 REQ-F003-001, §5 REQ-F003-015 |
| Crux: composition semantics shared with F-002; reconcile with baseline/sentinel/remainder | §1.2 REQ-F003-002/003, §5 REQ-F003-015/016 + REQ-F003-042 (ratified 2026-07-07) |
| Ruling (ratified 2026-07-07) — composition model / relationships (append / inherit; override dropped) | §5 REQ-F003-015 + REQ-F003-050 + REQ-F003-042 |
| Ruling (ratified 2026-07-07) — remainder bookkeeping; layer fate on baseline change | §4 REQ-F003-013, §5 REQ-F003-019, §6.5 REQ-F003-028 + REQ-F003-043 |
| Ruling (ratified 2026-07-07) — "blank = inherit" reinterpreted + native-default warning | §5 REQ-F003-017, §8.1 REQ-F003-031/051 + REQ-F003-045 |
| Ruling (ratified 2026-07-07) — destructive-save (drop-segment / uncaptured-content overwrite) / DangerConfirm gating | §6.4 REQ-F003-025/026, §8.1 REQ-F003-034 + REQ-F003-046 |
| Ruling (ratified 2026-07-07) — effective-prompt preview fidelity & live recompute | §5 REQ-F003-018, §6.2 REQ-F003-021, §8.2 REQ-F003-039 + REQ-F003-047 |
| Ruling (ratified 2026-07-07) — sequencing with F-002 (hard prerequisite) | §1.2 REQ-F003-002 + REQ-F003-048 |
| Ruling (ratified 2026-07-07) — scale (workspaces per customer) | §8.2 REQ-F003-038 + REQ-F003-049 |
| Surface the effective composed prompt | §6.1 REQ-F003-020, §6.2 REQ-F003-021, §8.1 REQ-F003-031/032 |
| Reversibility: single engine field, no undo | §8.2 REQ-F003-037, §6.4 REQ-F003-026 |
| Drift / override visibility & resolution (reuse F-002) | §6.5 REQ-F003-027/028/029 |
| Grounding: existing textarea, systemPrompt → openAiPrompt, no native layering | §1.1 REQ-F003-001, §1.3 REQ-F003-004, §8.1 REQ-F003-031 |
| Scope: frontend + BFF composition/storage; no engine or chat-UI change | §1.4 REQ-F003-005, §2 REQ-F003-008/011 |
| Out of scope: baseline itself, native default/variables, templating/versioning, tamper-proof | §2 REQ-F003-006..012 |
| Custody boundary / BFF-brokered writes | §1.4 REQ-F003-005, §7.2 REQ-F003-030, §8.2 REQ-F003-036 |
| Accessibility: read-only preview semantics, keyboard, non-color, focus | §8.1 REQ-F003-032/033/034 |

---

### Self-check note (per analyst workflow step 5)
The requirements most at risk of divergent implementation are the effective-prompt function (§5,
REQ-F003-015), the client/server preview parity (REQ-F003-018/039), and the destructive-save predicate
(REQ-F003-025). Each is pinned to an exact predicate and a concrete test — a byte-level `effective(B,
L, rel)` truth table, a byte-equality contract test between preview and saved engine value, and an
enumerated definition of what makes a save destructive — so two implementers cannot both claim
compliance with different behavior. **As of rev 3, §9 is fully ruled: every open question
(REQ-F003-042..049) is RATIFIED by the 2026-07-07 human rulings and no open questions remain.** The
cross-feature reconciliation with F-002's per-apply mode (REQ-F003-042) — previously the one genuinely
unresolved decision — is now **resolved**: the per-workspace stored `composition_mode` is authoritative
and F-002's fan-out honors it via the companion **F-002 rev 4** revision (REQ-F002-055). It remains
isolated behind the byte-for-byte mapping of REQ-F003-003/016, so F-003's own compose semantics are
unchanged and only F-002's fan-out precedence was affected. F-002 being a hard dependency that may not
yet exist is stated explicitly (REQ-F003-002) and ratified as a hard-prerequisite sequencing ruling
(REQ-F003-048, no degraded null-baseline mode) rather than assumed away.
