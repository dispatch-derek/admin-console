# Adversarial Spec Review — F-002 rev 6 (verify R5 fixes + fresh pass)

Spec reviewed: `specs/F-002-customer-system-prompt.md` (Draft **rev 6**)
Cross-referenced: `specs/F-003-workspace-system-prompt.md` (Draft rev 4), `docs/spec-reviews/spec-review-F002-rev5.md`
Reviewer posture: adversarial, read-only on the spec.
Checks executed: 8/8 (misinterpretation attack, one-line-test, error-coverage sweep, example-vs-prose,
definition audit, boundary audit, non-goal probe, cross-reference).

---

## Verdict: **BLOCK (revise)**

The two rev-5 blocking findings are **substantively** addressed: the sync-state classifier is now
mode-aware and agrees with F-003 (R5-1 resolved, clean), and the destructive blast-radius count is
widened and now well-defined (R5-2's undercount closed). The notes (R5-3, R5-N1) are resolved.

However, **two residual clause-level contradictions survive** — both are un-swept remnants of exactly
the two reconciliations rev 6 claimed to complete:

- **R6-1** — REQ-F002-025 (unchanged) still universally demands a per-workspace two-candidate
  preserve/discard choice for *every* overridden workspace; REQ-F002-050/019 exempt baseline-only.
  The rev-6 count (REQ-F002-031) reconciles the *no-silent-clobber* half but not the
  *deliberate-two-candidate-choice* half. Direct test-level conflict.
- **R6-2** — the R5-4 async sweep missed REQ-F002-034, which still requires an "async apply-progress"
  region and announcing "async apply progress" — contradicting the now-synchronous model
  (REQ-F002-039/049). The rev-6 self-check (lines 1027-1029) claims the remnants were removed from
  §7.1/§7.2 and 035/039 but omits 034, where they persist.

Findings: **Blocking 1 (CONTRADICTION) · Major 1 · Notes 2.**

---

## Part 1 — Verification of rev-5 findings

### R5-1 — [CONTRADICTION: mode-blind classifier reported a synced inherit workspace as overridden] — **RESOLVED**
REQ-F002-023 (lines 605-628) is now mode-aware. It classifies against
`effective(B, remainder, resolvedMode)` — **not** the mode-blind `compose(B, remainder)` — with:
- `effective(B, remainder, 'baseline-only') = B` (line 610-611);
- `effective(B, remainder, 'prepend') = compose(B, remainder, 'prepend')` (line 613);
- empty-remainder collapse to `B` (line 614);
- NULL stored mode resolves to `prepend`, never `overwrite` (lines 615-616).

Domain check — the only resolvedModes a *classified* workspace can carry are `prepend` (stored
`append`/`NULL`) and `baseline-only` (stored `inherit`); both are defined. A `never-applied` workspace
has no row and short-circuits before `effective()`. A NULL workspace that was last applied under the
operator's `overwrite`/`fill` mode has an **empty** stored remainder (REQ-F002-056/057 empty it), so the
empty-remainder collapse yields `effective = B` — matching the live value — so forcing NULL→prepend in
the classifier is outcome-correct for overwrite/fill-applied rows too. `effective()` is therefore
complete for every reachable case, including cleared `B` (baseline-only → empty; such rows report
`stale` via the hash branch, consistent with REQ-F002-046).

Agreement with F-003: REQ-F003-027 (F-003 lines 399-407) uses the identical predicate shape
`synced ⇔ P == effective(B, L, rel)`, `stale`, `overridden` (matches neither), with `effective = B` for
`inherit` (F-003 lines 70-71). The two classifiers now agree. The R5-1 test (line 627-628) —
"a baseline-only/inherit workspace carrying a non-empty retained remainder whose live prompt equals `B`
reports `synced`" — passes against the written predicate. **Confirmed resolved.**

### R5-2 — [GAP: destructive count undercounts baseline-only-over-overridden destruction] — **RESOLVED (count); reconciliation partial → see R6-1**
REQ-F002-031 (lines 807-829) now counts the **union** of (a) `resolvedMode == 'overwrite'` and
(b) `baseline-only` (stored `inherit`) workspaces currently `overridden`. Well-definedness verified:
- **No double-count:** `resolvedMode` is single-valued; (a) is overwrite, (b) is baseline-only —
  disjoint by construction, and a stored mode can never resolve to `overwrite` (REQ-F002-059), so an
  inherit workspace is never in (a).
- **No under-count of the newly-named class:** an `overridden` baseline-only workspace necessarily has
  `P ≠ B` (else it would classify `synced`), so real content is discarded; every such row is in (b).
- **Correct exclusions:** stored `append`/`prepend` (remainder preserved) excluded; `synced`/
  `never-applied` baseline-only (no live content) excluded; `fill` writes only empty workspaces. The
  count is derivable from `BaselinePreviewItem.{resolvedMode, syncState}` (§7.1), so it is testable.

The **count** is resolved. The **REQ-F002-025 reconciliation** the fix claims (line 819-820) is only
half-complete — see **R6-1**.

### R5-3 — [`'fill'` omitted from resolved-mode enumerations] — **RESOLVED**
`'fill'` now appears in REQ-F002-020 (line 464: "prepend, baseline-only, overwrite, or fill"),
REQ-F002-059's snapshot-binding bullet (line 264: "prepend / baseline-only / overwrite / fill branch"),
and the §7.1 `resolvedMode` type (line 723). Consistent with REQ-F002-019's live `fill` branch.

### R5-N1 — [F-002-side out-of-domain composition_mode test] — **RESOLVED**
REQ-F002-059 test (f) (lines 280-283) exercises an out-of-domain stored value (`'override'`), asserting
it resolves via the NULL fallback (REQ-F002-010d) and never reaches the `overwrite` branch through the
stored-mode path.

### R5-4 — [async apply-job remnants persist] — **PARTIALLY RESOLVED → see R6-2**
Verified removed: §7.1 no longer defines `BaselineApplyJob` and carries no `nextCursor` fields
(lines 697-769; comment lines 766-768 explicitly deny the async type/202/polling/cursor); §7.2 has no
`202 {jobId}` row and no `:jobId` polling route (lines 773-780); REQ-F002-039 (lines 896-906) is
rewritten to the synchronous model; REQ-F002-035 (line 862) says "synchronous fan-out"; REQ-F002-054
(lines 960-969) is marked RESOLVED to Ruling B. The lingering "async"/"jobId"/"cursor" strings at lines
499, 569-578, 595, 767-768, 901-902, 906, 960-968 are all **deletion/deprecation declarations or the
resolved ruling text**, not live requirements — legitimate.
**But REQ-F002-034 was not swept — see R6-2.**

---

## Part 2 — Fresh adversarial findings (rev-6 deltas)

### R6-1 — [CONTRADICTION] REQ-F002-025 vs REQ-F002-050/019 — baseline-only overridden workspaces are both required and forbidden a per-workspace preserve/discard choice — **BLOCKING**
REQ-F002-025 (lines 636-646, **unchanged in rev 6**) is universally quantified over "an `overridden`
workspace" and states: "Re-applying the baseline to an `overridden` workspace **requires the operator to
make a deliberate choice, surfaced in the preview diff as two candidates (REQ-F002-019)**." Its own test
(line 644-646): "applying to an overridden workspace does not proceed without an explicit
preserve-or-discard choice."

REQ-F002-050 (lines 664-669) and REQ-F002-019's baseline-only branch (lines 434-442) exempt a
baseline-only (stored `inherit`) workspace: even when `overridden`, it "carries no resolution
candidates, requires no `overrides` entry, and is written `B` (never skipped for a missing resolution)";
"An `overrides` entry naming a `baseline-only` workspace is rejected **400**." REQ-F002-031's rev-6
count then surfaces this destruction in the danger dialog — which addresses the *no-silent-clobber* half
of REQ-F002-025, but **not** its *two-candidate deliberate-choice* half.

Two implementations both claim compliance:
- **Reading A** (REQ-F002-025 literal + its test): a baseline-only `overridden` workspace gets a
  two-candidate preserve/discard prompt and the apply does not proceed for it without a per-workspace
  choice.
- **Reading B** (REQ-F002-050/019 literal): the same workspace gets **no** choice, is written `B`, and
  an `overrides` entry naming it is a **400**.

These diverge, and a QA test derived from REQ-F002-025's stated test fails against REQ-F002-050's
mandated behavior. The cross-reference is also broken: REQ-F002-025 says the two candidates are
"surfaced in the preview diff as two candidates (REQ-F002-019)", but REQ-F002-019 explicitly supplies
**no** candidates for baseline-only.

*Location:* REQ-F002-025 lines 636-646 (esp. 637-639, 644-646) vs REQ-F002-050 lines 664-669, REQ-F002-019
lines 434-442. *Fix:* scope REQ-F002-025's two-candidate requirement to `prepend`/`append` workspaces and
cross-reference the baseline-only exemption (REQ-F002-050) + its destructive-count surfacing
(REQ-F002-031) for `inherit`/`baseline-only` overridden workspaces. This is a one-clause scoping edit;
the design intent is discernible from the three concordant requirements (019/050/031), but as written
025 conflicts with them on a MUST.

### R6-2 — [CONTRADICTION / dangling reference] REQ-F002-034 vs REQ-F002-039/049/058 — surviving async apply-progress requirement — **MAJOR**
REQ-F002-034 (lines 838-844) is titled "Accessibility of the new **async**/bulk surfaces" and requires:
"the **async apply-progress** / result region require deliberate focus management … status messaging
announced to assistive technology via an ARIA live region — specifically **async apply progress** and
the partial-failure result." Apply is now synchronous (single blocking `200`, no progress polling) per
REQ-F002-039 (lines 896-906: "NOT an async job with progress polling") and REQ-F002-049/058. There is no
"apply progress" to stream or announce in the synchronous model, so the requirement references a deleted
artifact.

Ambiguity it creates:
- **Reading A:** build an incremental progress region announcing apply progress — which implies
  client-side polling/streaming, resurrecting the model Ruling B deleted (though §7.2 has no route to
  poll).
- **Reading B:** no progress region; announce only the final partial-failure result via the live region.

The rev-6 self-check (lines 1027-1029) claims the async remnants were removed "from §7.1/§7.2 and
REQ-F002-035/039" — it does **not** mention REQ-F002-034, where they persist, so the sweep is
demonstrably incomplete. *Fix:* reword REQ-F002-034 to the synchronous model (focus management +
live-region announcement of apply start and the final partial-failure result; drop "async" and
"apply progress"). The requirement's testable core (focus management, result announcement) survives, so
this is Major rather than a core-behavior block — but it is a genuine dangling reference the task asked
to confirm absent.

---

## Notes (non-blocking)

- **R6-N1 — [NOTE] REQ-F002-023 "same branch the fan-out would actually write" is imprecise for NULL
  workspaces.** Line 609 asserts classification uses "the same branch the fan-out would actually write
  (REQ-F002-059)," but for a NULL (untracked) workspace the fan-out branch depends on the *operator's*
  per-apply mode (which can be `overwrite`/`fill`), whereas the classifier forces NULL→`prepend`
  (line 615). The *outcome* is nonetheless correct (overwrite/fill-applied NULL rows have empty
  remainder, so `effective` collapses to `B` regardless), but the prose overstates the equivalence.
  Consider softening to "the non-destructive resolution of the stored mode" to avoid a reader inferring
  the classifier must know the operator mode.

- **R6-N2 — [NOTE] "bulk-apply progress model" phrasing in REQ-F002-045.** Line 950 (an open-question on
  scale) still speaks of "the bulk-apply progress model," a mild leftover of the async framing. Harmless
  in an open-question context, but worth aligning with the synchronous-bounded model (REQ-F002-058) when
  R6-2 is addressed.

---

## One-line tests for the rev-6 MUSTs (testability confirmation)

- REQ-F002-023 mode-aware classifier: **PASS** — "apply an `inherit` workspace with non-empty retained
  remainder, live `P = B`; assert `synced`" now passes against `effective(B, remainder, 'baseline-only')
  = B`.
- REQ-F002-031 destructive count: **PASS** — "given a prepend/fill-mode apply over an `overridden`
  `inherit` workspace, assert it is counted in the destructive blast radius; when `synced`, assert not
  counted" now has a single answer.
- REQ-F002-025 override-choice: **FAIL/AMBIGUOUS** — "applying to an overridden [baseline-only] workspace
  does not proceed without an explicit preserve-or-discard choice" contradicts REQ-F002-050 (R6-1).
- REQ-F002-034 apply-progress announcement: **UNTESTABLE as written** — no "async apply progress" exists
  to announce in the synchronous model (R6-2).

---

## Final verdict: **BLOCK (revise)** — one blocking CONTRADICTION (R6-1: REQ-F002-025 vs
REQ-F002-050/019) plus one Major dangling reference (R6-2: REQ-F002-034 async remnant). R5-1 is cleanly
resolved and agrees with F-003 REQ-F003-027; R5-2's count is well-defined; R5-3/R5-N1 resolved. Both
blocking-adjacent residuals are narrow, one-clause edits in requirements the rev-6 changes were supposed
to reconcile (025) or sweep (034) — round 2 should be quick.
