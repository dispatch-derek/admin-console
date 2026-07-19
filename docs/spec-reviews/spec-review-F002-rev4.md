# Adversarial Spec Review — F-002 rev 4 (companion change for F-003 REQ-F003-042)

Spec reviewed: `specs/F-002-customer-system-prompt.md` (Draft **rev 4**)
Cross-referenced: `specs/F-003-workspace-system-prompt.md` (Draft rev 3), `docs/spec-reviews/spec-review-F002.md` (rev-1 review)
Reviewer posture: adversarial, read-only on the spec.

Scope: the **rev-4 delta only** — per-workspace `composition_mode` resolution in the fan-out.
New/changed reqs in scope: REQ-F002-059 (new), REQ-F002-010d (new), REQ-F002-055 (revised),
and ripple edits to REQ-F002-019 / -021 / -027 / -047. The already-ratified rev-3 machinery is
not re-reviewed except where rev-4 disturbs it. Prior rev-1 findings (B1–B7, M1–M9) were checked
and are NOT re-raised; all are resolved in rev 2/3.

Checks executed: 8/8 (misinterpretation attack, one-line-test, error-coverage sweep,
example-vs-prose, definition audit, boundary audit, non-goal probe, cross-reference).

---

## Verdict: **BLOCK (revise)**

Four blocking findings and one Major gap. The rev-4 change is coherent in the pre-F-003 window
(column absent), but it collides with F-003's own data model the moment F-003 ships, and it leaves
two new resolved states ("baseline-only" from stored `inherit`, and per-workspace mode-change
divergence) under-wired into the existing snapshot/preview/override machinery.

Findings: **Blocking 4 (CONTRADICTION 2 / AMBIGUOUS 1 / GAP 1) · Major 1 (GAP) · Notes 3.**

---

## Blocking findings

### R4-1 — [CONTRADICTION] REQ-F002-059 / REQ-F002-010d "no stored mode ⇒ operator default / identical to rev 3" vs F-003 REQ-F003-013 column default `'append'`
REQ-F002-059 and REQ-F002-010d both hinge the whole backward-compatibility story on the existence
of a "row with **no stored `composition_mode`**" state:

- REQ-F002-010d: "the column … may be absent (F-003 unbuilt) or **unset for a given row** … fall back
  to the operator-selected apply mode."
- REQ-F002-059: "a workspace **never touched by F-003** … the effective mode … **is** the
  operator-selected apply `mode` — behavior is **byte-for-byte identical to rev 3**. … the
  per-workspace honoring engages **only once F-003 persists modes on the shared row**."

But F-003 REQ-F003-013 defines the column as **`composition_mode` (TEXT … column default `'append'`)**
and states an "existing F-002 row … reads back with a **defined** `composition_mode`." A SQL
`ALTER TABLE ADD COLUMN composition_mode TEXT DEFAULT 'append'` populates **every pre-existing row**
with `'append'` (SQLite does not leave them NULL), and F-003 REQ-F003-013 further says the default
applies to "a row F-002's fan-out writes without an operator mode choice." Consequences:

1. **The fallback branch is essentially unreachable after F-003's migration.** There is no tracked
   row that is "unset"; every row reads `'append'`. So "a workspace never touched by F-003 ⇒ operator
   mode" describes a state that does not exist post-migration.
2. **F-002 cannot distinguish a column-default `'append'` from an operator-chosen `'append'`** — they
   are byte-identical in the column. So the requirement "un-stored ⇒ operator default" is not
   implementable/testable as written once the column exists.
3. **The "engages only once F-003 persists modes per save" framing is false.** F-003's migration
   persists `'append'` on **all** rows at once (column default), not lazily per editor save. Honoring
   engages en masse at migration time.

Concrete divergence (engine-visible, not merely internal): a workspace previously `prepend`-applied
with a **non-empty** stored remainder `R` (engine = `B + SENTINEL + R`). The operator then runs a
customer-wide apply selecting `overwrite`, intending to destroy per-workspace content.
- Rev 3 / pre-F-003: workspace resolves to operator `overwrite` → engine becomes `B` (R destroyed).
- Post-F-003 migration: the row now carries `composition_mode = 'append'` **by column default**, so
  REQ-F002-059 resolves it to `prepend` → engine stays `B + SENTINEL + R` (R preserved).

The operator's `overwrite` silently stops overwriting for workspaces they never deliberately
configured in F-003. Whether that safety is desirable is a human judgment — but the spec's own claim
that behavior "engages only once F-003 persists modes on the shared row" and that untouched-by-F-003
workspaces use the operator mode is contradicted by the sibling spec it depends on.

**Two implementations both claim compliance:** (A) treat any row whose `composition_mode` is present
as authoritative (F-003-013 literal) → overwrite is neutered for all default-`'append'` rows; (B)
treat column-default `'append'` as "no deliberate choice" and fall through to operator mode
(F-002-059 intent) → but B is unimplementable because the two are indistinguishable in the column.

**Fix / question for the human:** decide and pin the semantics of a column-default mode. Either
(a) F-003 must use a **nullable** `composition_mode` with NO SQL default (application writes a value
only on a deliberate editor save), so "unset for a given row" is a real, distinguishable state that
REQ-F002-059's fallback can key on — and F-003 REQ-F003-013's "column default `'append'`" must be
reconciled to match; or (b) accept that every tracked row is authoritative post-migration and
**delete** REQ-F002-059's "never touched by F-003 ⇒ operator mode / identical to rev 3" fallback
prose (keeping only the true-absence, column-not-present case), explicitly documenting the migration-
time semantic shift for pre-existing overwrite/fill-managed workspaces.

### R4-2 — [CONTRADICTION] REQ-F002-020 snapshot contents omit the per-workspace resolved mode that REQ-F002-047/-059 require for mode-change divergence
REQ-F002-059 states: "The **resolved effective mode per workspace** is captured into the previewed
snapshot bound by `confirmToken` (**REQ-F002-020**/047)," and REQ-F002-047 detects mode-change
divergence by checking that "the resolved effective mode **bound into the snapshot** no longer
matches the stored mode."

But REQ-F002-020 — the authoritative enumeration of what the token binds — lists only: "the `mode`
(REQ-F002-055) [the single operator mode], the target set, the baseline text, each workspace's
`currentPromptHash`, and, for overridden workspaces …, both resolution candidates." It was **not**
updated in rev 4 and does **not** include a per-workspace resolved effective mode. The `BaselinePreview`
/ `BaselinePreviewItem` types (§7.1) likewise carry `currentPromptHash` but **no** per-workspace
resolved-mode field.

An implementer following REQ-F002-020 builds a snapshot with no per-workspace mode, so the
REQ-F002-047 mode-change divergence check has nothing to compare against and cannot run — while
REQ-F002-059 asserts it is there. Clause conflicts with clause.

**Fix:** add "the **per-workspace resolved effective mode**" to REQ-F002-020's enumeration and to the
snapshot/`BaselinePreviewItem` type, so the mode-divergence detector of REQ-F002-047 has a defined
referent.

### R4-3 — [AMBIGUOUS] REQ-F002-047 mode-change divergence: comparison basis is undefined (and the literal reading diverges everything)
REQ-F002-047: "a change to a workspace's stored `composition_mode` … between preview and apply is
likewise per-workspace divergence — the **resolved effective mode bound into the snapshot no longer
matches the stored mode**." This compares an **F-002-vocabulary** value (the resolved branch:
`prepend` / baseline-only / `overwrite`) against an **F-003-vocabulary** value (`append` / `inherit`).
They are never lexically equal.

- **Reading A (raw stored value, preview vs apply):** diverge iff the row's stored `composition_mode`
  string at apply differs from its stored `composition_mode` string at preview. Then a workspace that
  had **no** stored mode at preview (resolved via operator default to `prepend`) and gains
  `composition_mode = 'append'` before apply — which *also* resolves to `prepend` — is treated
  **divergent** even though the write it would receive is byte-identical.
- **Reading B (resolved F-002 branch, preview vs apply):** diverge iff the resolved compose branch
  changes. The same append-added-while-operator-mode-was-prepend workspace resolves to `prepend` both
  times → **not** divergent, apply proceeds and writes `compose(B, R, 'prepend')`.
- **Literal reading of the text:** compare `prepend` (snapshot) to `append` (stored) → never equal →
  **every** workspace carrying any stored mode is `diverged`, which cannot be intended.

These produce different apply outcomes (a write vs a withheld `diverged`) for the same event. The
rev-4 test (e) only exercises the unambiguous `append→inherit` flip and does not disambiguate.

**Fix:** state the comparison in one vocabulary — e.g. "diverge iff the workspace's **resolved F-002
effective mode** computed from the *current* stored `composition_mode` (and the operator default)
differs from the resolved effective mode captured in the snapshot (R4-2)." Then define whether a
newly-appearing stored mode that maps to the same branch as the operator default is divergent or not.

### R4-4 — [GAP] Stored `inherit` ("baseline-only") is not reconciled with the overridden-workspace preserve/discard machinery (REQ-F002-019 / -025 / -050)
Rev 4 introduces a new resolved outcome — a workspace whose stored `composition_mode = 'inherit'`
resolves to **baseline-only** `compose(B, "", 'prepend')` with the remainder "retained but
suppressed" (REQ-F002-059). REQ-F002-019 folds this under the **`prepend`** preview branch
("`inherit`→baseline-only"). But the `prepend` branch's overridden-workspace handling assumes a
remainder-bearing composition:

- REQ-F002-019 `prepend` branch: for an `overridden` workspace, the item carries **both**
  `composedIfPreserve = compose(B, currentLivePrompt, 'prepend')` and
  `composedIfDiscard = compose(B, storedRemainder, 'prepend')`.
- REQ-F002-050: override resolution is "meaningful only in `prepend` mode"; an `overridden` target
  with **no** resolution in `overrides` is **`skipped`** (not written).

For a workspace resolved to **baseline-only** (stored `inherit`), the actual write is `B` regardless
of preserve/discard (the remainder is suppressed). Yet the spec does not say:

1. Whether the preview emits **both candidates** (which both misrepresent the real write `B`, breaking
   REQ-F002-019's "the composed prompt that would be written" fidelity) or a **single** `composedPrompt = B`.
2. Whether an `overridden`, stored-`inherit` workspace with **no** `overrides` entry is **`skipped`**
   per REQ-F002-050 — which would **contradict** `inherit` semantics (which must write `B` regardless
   of the out-of-band content) — or is written to `B`.

**Two implementations both claim compliance:** (A) treat baseline-only as a `prepend` workspace →
emit both candidates and `skip` it when no resolution is supplied; (B) treat baseline-only as a
distinct branch → single `composedPrompt = B`, no resolution required, always written. These produce
different preview payloads and different apply outcomes for the same workspace.

**Fix:** carve out the baseline-only (stored `inherit`) case explicitly in REQ-F002-019 and
REQ-F002-050: state that a baseline-only-resolved workspace carries a single `composedPrompt = B`,
requires **no** preserve/discard resolution, and is written to `B` even when `overridden` (its
out-of-band content being intentionally discarded by `inherit`, which is itself F-003's gated
decision per F-003 REQ-F003-025(a)).

---

## Major finding

### R4-5 — [GAP] No defined behavior for a stored `composition_mode` value outside `{null, 'append', 'inherit'}`
REQ-F002-059 maps only `'append'`→`prepend` and `'inherit'`→baseline-only, and rests its
destructive-mode safety claim on "F-003 dropped its `override` mode (REQ-F003-050), so a stored
`composition_mode` can NEVER select F-002's destructive `overwrite` branch." But F-002 **reads a
column it neither owns nor validates** (REQ-F002-010d: "F-002 does not define, default, or write
that column — it only reads it"). The spec does not define what F-002 does when it reads a non-null
value that is neither `'append'` nor `'inherit'` — e.g. a legacy `'override'` residue persisted by a
pre-ratification F-003 build (F-003 REQ-F003-050 drops the *value* but specifies no data migration to
purge existing `'override'` rows), or any corrupted value.

`compose(B, R, ...)` has no branch for an unrecognized mode string, and REQ-F002-059's null-safe
fallback is specified only for *absence*, not for *unrecognized presence*. The destructive-safety
guarantee ("stored mode can NEVER reach overwrite") is only sound if the read value is provably in
`{append, inherit}`, which F-002 does not enforce.

**Fix:** specify F-002's behavior for an unrecognized non-null stored `composition_mode`: either treat
it as absent and fall back to the operator mode, or reject the apply with a defined error. Add a test
that a row bearing an out-of-domain `composition_mode` (e.g. `'override'`) does not silently reach the
`overwrite` branch and has a defined resolution.

---

## Notes (non-blocking)

- **R4-N1 — "ownership" of `remainder`/hashes is looser than stated.** REQ-F002-010d says "F-002 owns
  the `remainder` … and the applied-hash bookkeeping." But F-003 REQ-F003-023 step (4) has the F-003
  editor also writing `remainder (= layer)`, `composition_mode`, and the applied hashes to the shared
  row. So `remainder`/hashes are written by **both** features (the single-model reconciliation of
  F-003 REQ-F003-003), and only `composition_mode` is F-003-exclusive-write. The word "owns" reads as
  "sole writer" but here means "column-definer / read-vs-write split." Consider clarifying to avoid an
  implementer assuming F-003 never touches `remainder`. Cross-spec ownership of `composition_mode`,
  the shared row, and the `append↔prepend` / `inherit↔baseline-only` mapping otherwise agree between
  F-002 REQ-F002-059/010d and F-003 REQ-F003-013/016/042.

- **R4-N2 — REQ-F002-013 (per-mode re-sync) not reconciled with per-workspace resolution.** Rev 4
  rippled REQ-F002-027 (re-sync honors stored mode) but not REQ-F002-013, which still reads "In
  `overwrite` mode re-sync writes `compose(newBaseline, R, 'overwrite') = newBaseline`" as if the
  operator mode applied uniformly. An implementer reading REQ-F002-013 in isolation could apply the
  operator `overwrite` uniformly at re-sync, contradicting REQ-F002-059. Add a per-workspace-resolution
  cross-reference to REQ-F002-013.

- **R4-N3 — `overwrite` danger-gate blast radius may overstate destruction.** REQ-F002-021/-031 fire
  the `overwrite` danger gate whenever the operator selects `overwrite`, but per REQ-F002-059 only
  **un-stored** workspaces actually resolve to `overwrite`; stored-`append`/`inherit` workspaces are
  written non-destructively. Ensure the danger dialog's "affected count" / destruction naming (§8
  REQ-F002-031, sourced from the REQ-F002-019 preview) counts only the workspaces that actually resolve
  to `overwrite`, not the whole target set — otherwise the blast-radius claim overstates the damage.
  This is likely already correct via the per-workspace preview, but REQ-F002-031's generic "workspace
  prompts will be rewritten" copy was not updated for rev 4.

---

## One-line tests for the new MUSTs (testability confirmation)

- REQ-F002-059 stored-mode authority: PASS — testable (rev-4 tests a–e), **except** the "no stored
  mode ⇒ operator default" clause, which is UNTESTABLE once F-003's column default populates every row
  (see R4-1) because default-`'append'` and deliberate-`'append'` are indistinguishable.
- REQ-F002-059 destructive safety: testable for values in `{append, inherit}`; UNDEFINED for other
  values (see R4-5).
- REQ-F002-047 mode-change divergence: NOT cleanly testable as written — the comparison basis is
  ambiguous (see R4-3) and the snapshot field it reads is undefined (see R4-2).
- REQ-F002-010d null-safe read: testable for the column-absent case; the "unset for a given row" case
  is not a reachable state under F-003's column default (see R4-1).

---

## Backward-compatibility verdict
"Identical to rev 3 when `composition_mode` absent" holds **only** for the true column-absent window
(F-003 not yet migrated). It does **not** hold across the F-003 migration boundary: F-003's column
default `'append'` retroactively assigns a stored mode to every previously-tracked row, so
overwrite/fill applies over non-empty-remainder rows change engine-visible behavior at migration time
(R4-1). The claim must be narrowed to the column-absent case or the migration model changed.
