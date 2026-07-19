# Adversarial Spec Review — F-002 rev 5 (verify R4 fixes + fresh pass on the four resolved modes)

Spec reviewed: `specs/F-002-customer-system-prompt.md` (Draft **rev 5**)
Cross-referenced: `specs/F-003-workspace-system-prompt.md` (Draft rev 4), `docs/spec-reviews/spec-review-F002-rev4.md` (rev-4 review)
Reviewer posture: adversarial, read-only on the spec.

Scope (two parts):
1. Verify each rev-4 finding (R4-1..R4-5, R4-N1..R4-N3) is actually resolved by rev 5.
2. Fresh adversarial pass on the rev-5 deltas — the four resolved modes
   (`prepend` / `baseline-only` / `overwrite` / `fill`), the destructive blast-radius counting
   (REQ-F002-031), and the NULL-untracked divergence/backward-compat wiring (REQ-F002-059).

Checks executed: 8/8 (misinterpretation attack, one-line-test, error-coverage sweep,
example-vs-prose, definition audit, boundary audit, non-goal probe, cross-reference).

---

## Verdict: **BLOCK (revise)**

The five rev-4 findings and three notes are **individually well-addressed for the machinery each named**
(data model, token binding, divergence basis, preview/override carve-out, out-of-domain defence). R4-1
and R4-3 in particular are cleanly and correctly resolved across both specs.

However, the rev-5 resolution of **R4-4** wired the new `baseline-only` write (write `B`, **retain** a
non-empty `remainder`) into preview / override / apply, but did **not** reconcile it with two pieces of
un-revised rev-3 machinery it now collides with: the sync-state classifier (REQ-F002-023) and the
destructive blast-radius count (REQ-F002-031). The result is a workspace that F-002 has just correctly
synced being reported `overridden`, and a class of real content destruction that the danger dialog does
not count. Two new blocking findings (R5-1, R5-2).

Findings: **Blocking 2 (CONTRADICTION 1 / GAP 1) · Notes 3.**

---

## Part 1 — Verification of rev-4 findings

### R4-1 — [CONTRADICTION: column-default collision] — **RESOLVED**
Rev-5 REQ-F002-010d now specifies `composition_mode` as **nullable TEXT `DEFAULT NULL`** (lines 161-167),
with NULL = "F-003 has not tracked this workspace" as the real, distinguishable backward-compat state, and
F-003 writing a non-null value **only** on a deliberate track/save, never as a migration default.
F-003 REQ-F003-013 (lines 161-171) matches exactly: `nullable TEXT, DEFAULT NULL`, "MUST NOT declare a SQL
column default", "NULL means 'F-003 has not tracked this workspace'", non-null written only on first
deliberate save. F-003 REQ-F003-044 (lines 636-651) confirms `append` is a **derivation outcome at track
time, NOT a SQL default**. Domains agree: F-002-010d allows non-null `∈ {'append','inherit'}`;
F-003-052 enforces `∈ {NULL,'append','inherit'}`. REQ-F002-059's backward-compat is now keyed on the NULL
(untracked) state, not on column absence (lines 251-256). The migration-boundary divergence the rev-4
review demonstrated no longer exists. Confirmed resolved on both sides.

### R4-2 — [CONTRADICTION: confirmToken omits per-workspace resolved mode] — **RESOLVED**
REQ-F002-020 (lines 459-462) now enumerates "**each workspace's resolved effective mode** (the
per-workspace branch actually previewed … resolved per REQ-F002-059; the referent for the mode-change
divergence check of REQ-F002-047)". The `BaselinePreviewItem.resolvedMode` field is added to §7.1
(lines 708-711). The REQ-F002-047 detector now has a defined snapshot referent. Resolved.
(See R5-3 for a residual `'fill'` enumeration gap in this same clause — non-blocking.)

### R4-3 — [AMBIGUOUS: mode-change comparison basis] — **RESOLVED**
REQ-F002-047 (lines 538-550) now pins the comparison to a **single vocabulary** — F-002's resolved
effective branch, not the raw F-003 string: at apply, recompute the resolved effective mode from the
*current* stored `composition_mode` + operator default and compare to the snapshot `resolvedMode`;
"Divergence is declared **iff the resolved branch differs**." The byte-identical same-branch case is
explicitly non-divergent, with a worked example (operator-default `prepend` row that gains explicit
`composition_mode='append'`, which also resolves to `prepend` → NOT divergent, line 546-549). This kills
both the "raw string" and the "literal never-equal" readings from R4-3. Resolved.

### R4-4 — [GAP: baseline-only vs preserve/discard machinery] — **RESOLVED FOR PREVIEW/OVERRIDE, but incomplete elsewhere**
The specific gap named in R4-4 (preview candidates + override skip contract) is resolved:
REQ-F002-019 (lines 431-439) gives `baseline-only` a single `composedPrompt = B`, no
preserve/discard candidates, no resolution required; REQ-F002-050 (lines 648-653) makes it explicitly
"outside this preserve/discard contract even when `overridden`", written `B`, never `skipped`, and rejects
`overrides` entries naming it (400). `BaselinePreviewItem.resolvedMode` carries `'baseline-only'` (§7.1).
That portion is clean.

**But** the rev-5 baseline-only write semantics ("write `B`, **retain** a non-empty `remainder`") are not
reconciled with two other requirements that were left unchanged — see **R5-1** (sync-state
classification, REQ-F002-023) and **R5-2** (destructive count, REQ-F002-031). R4-4 is therefore only
partially discharged.

### R4-5 — [GAP: out-of-domain stored composition_mode] — **RESOLVED (minor test gap)**
REQ-F002-010d (lines 172-174) now states F-002 "defends against an unrecognized stored value by treating
it as NULL", and F-003-052 (lines 214-227) enforces `∈ {NULL,'append','inherit'}` on every write and
normalizes an out-of-domain read to NULL. The destructive-safety precondition (a stored mode can never
select `overwrite`) is now backed. Defined and testable. Minor: the actual F-002-side rule lives in
REQ-F002-010d, but the cross-reference that carries the "resolves R4-5" tag points at REQ-F002-059, whose
own tests (a)-(e) contain no out-of-domain case (see R5-N1, non-blocking).

### R4-N1 (ownership wording) — **RESOLVED**
REQ-F002-010d (lines 152-159) now distinguishes "schema-definer + read/write split" from "sole writer"
and states `remainder`/hashes are **co-written** by F-003 REQ-F003-023 step 4.

### R4-N2 (REQ-F002-013 per-mode re-sync) — **RESOLVED**
REQ-F002-013 (lines 353-358) now states the mode named is the *effective* per-workspace mode of
REQ-F002-059, honoring stored `composition_mode` at re-sync.

### R4-N3 (blast-radius overstatement) — **ADDRESSED, but introduces the opposite defect**
REQ-F002-031 (lines 805-810) now sources the destructive count from the per-workspace preview and counts
only `resolvedMode == 'overwrite'`. This fixes the *overstatement* R4-N3 worried about, but the new
narrow definition now **understates** a different real destruction class — see **R5-2**.

---

## Part 2 — Fresh adversarial findings (rev-5 deltas)

### R5-1 — [CONTRADICTION] REQ-F002-023 vs REQ-F002-059 — a correctly-applied `baseline-only` workspace is classified `overridden`
REQ-F002-059 (lines 243-247) resolves a stored `composition_mode = 'inherit'` to **baseline-only**: the
fan-out writes effective `B` while the stored `remainder` is "**retained but suppressed, never emptied**".
REQ-F002-022 then records `applied_composed_hash = hash(B)` and leaves `remainder = R` (non-empty).

REQ-F002-023 (lines 605-609), **unchanged since rev 3**, classifies sync state with the **mode-blind**
predicate `synced ⇔ P == compose(B, remainder)`. For a baseline-only workspace with a non-empty retained
remainder `R`, the live prompt is `P = B` but `compose(B, R, 'prepend') = B + SENTINEL + R ≠ B`. Trace:
- `synced`? `B == B + SENTINEL + R` → **false**.
- `stale`? requires `hash(P) == applied_composed_hash` **AND baseline changed**; baseline unchanged → **false**.
- `overridden`? "matches neither" → **true**.

So immediately after a *successful, intended* baseline-only apply the workspace reports **`overridden`**,
and the operator is prompted to "resolve an override" (REQ-F002-025) for a workspace that is in fact
perfectly in sync. This directly contradicts REQ-F002-059's intent and F-003's own classifier
(REQ-F003-027, lines 399-407), which correctly uses `effective(B, L, rel)` (`= B` for `inherit`).

**Reachability (concrete):** an `append` workspace with layer `R` (non-empty `remainder`) whose operator
switches it to `inherit` via F-003 (REQ-F003-019/025a **retains** the stored layer) → `composition_mode =
'inherit'`, `remainder = R` non-empty. F-002's next fan-out writes `B`, retains `R`, and its own status
route (REQ-F002-024) then reports the workspace `overridden` forever. (Inherit workspaces derived from an
*empty* prompt have empty `R` and escape the bug, which is why it was not caught by the R4-4 preview
carve-out.)

**Fix:** make REQ-F002-023 mode-aware for tracked workspaces — classify against the same
`effective(B, remainder, resolvedMode)` the fan-out actually writes (i.e. `B` for `baseline-only`), or
explicitly defer tracked-workspace classification to F-003 REQ-F003-027. As written, the two clauses
conflict.

### R5-2 — [GAP] REQ-F002-031 destructive blast-radius undercounts baseline-only writes that destroy uncaptured live content
Rev-5 REQ-F002-031 (lines 805-810) defines the danger dialog's destructive count as **only** workspaces
whose `resolvedMode == 'overwrite'`. But REQ-F002-019 (lines 434-438) and REQ-F002-050 (lines 648-653)
have a `baseline-only` (stored `inherit`) workspace written `B` **"regardless"** — including when it is
`overridden`, "its out-of-band content being intentionally discarded." Discarding an `overridden`
workspace's uncaptured live content **is destruction**: F-003 itself classifies exactly this transition
as danger-gated (REQ-F003-025 case (a), lines 362-366 — "removing that segment from the engine … no
native undo").

Consequence: an operator running a customer-wide apply in **`prepend`** or **`fill`** mode (operator mode
≠ `overwrite`), over a target set containing `inherit`-tracked workspaces that have drifted `overridden`,
will silently wipe each one's out-of-band content while the danger dialog reports **destructiveCount = 0**
(no workspace resolves to `overwrite`). The blast-radius naming that REQ-F002-031 is supposed to guarantee
omits a destruction class F-002 actually performs.

This also sits in tension with REQ-F002-025 (lines 620-630): "For an `overridden` workspace, the console
MUST NOT silently clobber the out-of-band prompt on the next apply." REQ-F002-050's baseline-only
exemption explicitly clobbers it with no preserve/discard choice. The spec justifies this by "F-003's own
gated `inherit` decision", but that gate fired when `inherit` was *set*; out-of-band content that appears
**after** the inherit decision (e.g. a native-UI edit) is dropped at F-002 apply time with **no** fresh
gate and **no** inclusion in the destructive count.

**No specified behavior** for: how baseline-only-over-`overridden` destruction is surfaced/counted in the
§8 danger dialog. Two implementations both claim compliance with REQ-F002-031: (A) literal — count only
`overwrite`, so the operator is never warned N inherit workspaces lose content; (B) count baseline-only
drops of uncaptured content as destructive too — which violates 031's literal "only … `overwrite`" text.
Divergent danger-dialog behavior for the same apply.

**Fix:** extend the destructive count/naming (REQ-F002-031) to include baseline-only writes to
`overridden` (uncaptured-content) workspaces, mirroring F-003 REQ-F003-025 case (a)/(b); or state
explicitly that such drops are intentionally excluded from the blast-radius count and reconcile that with
REQ-F002-025's no-silent-clobber rule.

---

## Notes (non-blocking)

- **R5-3 — [GAP, non-blocking] `'fill'` omitted from the resolved-mode enumerations.**
  `BaselinePreviewItem.resolvedMode` is typed `'prepend' | 'baseline-only' | 'overwrite' | 'fill'`
  (§7.1 line 708) and REQ-F002-019 has a live `fill` branch. `'fill'` is reachable as a resolved mode
  (untracked/NULL workspace under an operator-selected `fill`). But REQ-F002-020 (line 461) enumerates the
  bound resolved mode as "prepend, baseline-only, or overwrite" and REQ-F002-059's snapshot-binding bullet
  (line 264) as "the `prepend` / `baseline-only` / `overwrite` branch" — both omit `'fill'`. The
  mode-change divergence referent (REQ-F002-047) for a fill-resolved workspace is thus underspecified in
  prose, though the type resolves it. Add `'fill'` to the two enumerations for consistency with the type
  and REQ-F002-019.

- **R5-4 — [CONTRADICTION, pre-existing / outside the rev-5 delta] async apply-job remnants persist after Ruling B.**
  REQ-F002-049 (lines 566-575) declares the `BaselineApplyJob` type, the `202 { jobId }` apply response,
  the `GET /api/baseline-prompt/apply/:jobId` polling route, and cursor pagination all **deleted**
  ("deleted from §7.1/§7.2; the cursor-pagination requirement … is withdrawn"). Yet §7.1 still defines
  `BaselineApplyJob` (lines 754-761) and `nextCursor` fields (lines 701, 731, 751), §7.2 still lists the
  `202 { jobId }` apply row and the `:jobId` polling route (lines 773-774), and REQ-F002-039 (lines
  880-887) still describes apply "as an async job (REQ-F002-049) whose UI polls progress" with
  cursor/nextCursor pagination. REQ-F002-035 (line 846) also still references "a fan-out **job**
  completes (REQ-F002-021/049)". This is a live self-contradiction (deleted-vs-present) that will confuse
  implementers. It is **pre-existing** (introduced by the rev-3 Ruling-B change, not by rev 5) and
  orthogonal to the rev-5 mode-resolution delta, so it does not by itself gate the rev-5 delta — but it is
  a genuine defect and should be cleaned up (delete the type/routes/fields per REQ-F002-049 and rewrite
  REQ-F002-039 for the synchronous bounded model of REQ-F002-058).

- **R5-N1 — [NOTE] R4-5 out-of-domain resolution lacks an F-002-side test.**
  The "treat unrecognized non-null value as NULL" rule lives in REQ-F002-010d, but REQ-F002-059 (the id
  tagged as resolving R4-5) restates neither the rule nor a test; its tests (a)-(e) never exercise an
  out-of-domain value. F-003-052 tests the write side. Add an F-002 fan-out test that a row bearing an
  out-of-domain `composition_mode` (e.g. `'override'`) resolves via the NULL fallback and never reaches
  the `overwrite` branch through the stored-mode path.

---

## One-line tests for the rev-5 MUSTs (testability confirmation)

- REQ-F002-059 stored-mode authority / NULL fallback: **PASS** — testable; the R4-1 untestability
  (default-`'append'` indistinguishable from chosen) is gone now that NULL is the backward-compat state.
- REQ-F002-047 mode-change divergence: **PASS** — "diverge iff resolved branch differs" with the
  same-branch worked example is a clean given/assert test.
- REQ-F002-010d nullable-NULL contract: **PASS** — migration leaves pre-existing rows NULL; testable.
- REQ-F002-023 for baseline-only workspaces: **FAIL** — the natural test ("apply `inherit` workspace,
  assert `synced`") fails against the written predicate (R5-1).
- REQ-F002-031 destructive count: **AMBIGUOUS** — "given a prepend-mode apply over an `overridden`
  inherit workspace, assert the destructive count" has no single answer (R5-2).

---

## Backward-compatibility verdict
The rev-5 NULL-untracked model makes "identical to rev 3 when F-003 has not tracked a workspace" a **real,
testable** claim across the F-003 migration boundary (the R4-1 defect is closed on both specs). Backward
compatibility for **untracked/`append`/`overwrite`/`fill`** workspaces holds. The regression is confined
to the **`inherit`→baseline-only** path with a non-empty retained remainder, which was newly wired in
rev 5 and collides with the un-revised REQ-F002-023 / REQ-F002-031 (R5-1, R5-2).

## Final verdict: **BLOCK (revise)** — two blocking findings (R5-1 CONTRADICTION, R5-2 GAP), both from
the `baseline-only` write not being reconciled with rev-3 sync-state classification and blast-radius
counting. R4-1/-2/-3/-5 and R4-N1/-N2 are confirmed resolved; R4-4 is only partially discharged.
