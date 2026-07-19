# Adversarial Spec Review — F-003 Workspace-Level System Prompt

Spec reviewed: `specs/F-003-workspace-system-prompt.md` (Draft rev 1)
Brief: `briefs/F-003-workspace-system-prompt.md`
Sibling / hard dependency: `specs/F-002-customer-system-prompt.md` (rev 3)
Parent: `specs/admin-console.md` (v1, rev 7)
Reviewer posture: adversarial, read-only on the spec.

Checks executed (8/8): misinterpretation attack, one-line-test check, error-coverage
sweep, example-vs-prose reconciliation, definition audit, boundary audit, non-goal probe,
cross-reference check — plus the requested cross-spec verification against F-002 rev 3.

---

## Summary verdict

**REVISE (BLOCK).** F-003 is carefully written, its parent-spec citations are accurate,
and it is admirably honest about the F-002 dependency. But its **central reconciliation
claim — the crux the brief names — is factually false against F-002 rev 3.** F-003's
`override` relationship (workspace layer wins, baseline discarded) is asserted to be
"byte-for-byte" equal to F-002's `overwrite` mode, but F-002's `overwrite` does the exact
opposite (baseline wins, layer discarded). Every downstream claim that leans on that
mapping — convergence of the two editors, drift behavior, the §9 "isolation" argument —
inherits the contradiction. Three more blocking items concern gating holes and a
load-bearing cross-reference error of exactly the class flagged in the F-002 review.

Findings by severity: **Blocking 4 · Minor 6 · Positive 5.**

---

## Positive confirmations (cross-spec fidelity that DOES hold)

- **P1. `append` ↔ `prepend` mapping is byte-correct.** REQ-F003-015 `append`
  (`=L` when `B` empty; `=B` when `L` empty; `=B+SENTINEL+L` when both) matches F-002
  REQ-F002-011 `compose(B,R,'prepend')` exactly (with `L==R`). The REQ-F003-003 truth-table
  entries for `append` are all satisfiable against F-002.
- **P2. `inherit` maps consistently.** REQ-F003-016 defines `inherit` as
  `compose(B,"",'prepend') = B` with the layer suppressed; REQ-F003-015 agrees (`effective = B`).
  Internally consistent and consistent with F-002's prepend branch.
- **P3. The F-002 machinery F-003 consumes genuinely exists in rev 3.** `remainder`
  (REQ-F002-010), the `SENTINEL` BFF constant (REQ-F002-011), SHA-256 hashing
  (REQ-F002-010c), the sync-state classes `synced|stale|overridden|never-applied`
  (REQ-F002-023), the two-artifact danger gate — binding `confirmToken` nonce vs. typed
  `confirmationPhrase` (REQ-F002-048), and the `currentPromptHash` snapshot bound by the
  token (REQ-F002-047) — are all present as F-003 assumes. `BaselineSyncState` is exported
  from F-002 §7.1 as REQ-F003-020/§7.1 reuses.
- **P4. REQ-F003-042 correctly identifies a real integration gap and carries it honestly
  to §9.** F-002's composition mode is chosen **per apply** for the whole fan-out
  (REQ-F002-055); F-002 has **no** per-workspace stored mode and its
  `workspace_baseline_state` (REQ-F002-010) has no `composition_mode` column. So F-002's
  fan-out does NOT today honor a per-workspace relationship. F-003 does not silently assume
  it does — it flags the required F-002 change as an open ruling. Good discipline.
  (But see B1 / M2 — the change needed is larger than REQ-F003-042 states.)
- **P5. Parent citations verified.** REQ-032/031/028/092/092a/093/093a/097a/078c/080/081/
  088/098/098a/098b/021/021a/021b/026/027/029c/012/025/030/100/110/117/120 all exist in
  `admin-console.md` rev 7 and mean what F-003 claims (REQ-088 = dangerous-op audit;
  REQ-098a = unverified-2xx UI semantics; REQ-021b = opaque handles; REQ-078c = typed-token
  danger pattern — all confirmed in the parent). No parent id is missing or misdescribed.

---

## Blocking findings

### B1 — [CONTRADICTION] `override` ≠ `overwrite`: the crux reconciliation is false (REQ-F003-003 / 015 / 016 vs F-002 REQ-F002-056)
This is the load-bearing failure. F-003 defines:

- REQ-F003-015: `rel = 'override'` → `effective = L` (**the workspace layer alone; the
  baseline is discarded for this workspace**). Truth table: `('X','Y',override) = 'Y'`.
- REQ-F003-003 (test): "F-003 `effective(B, L, 'override')` equals F-002
  `compose(B, L, 'overwrite')` (REQ-F002-056) **byte-for-byte**."
- REQ-F003-016: "`override` ≡ F-002 `overwrite`."

F-002 rev 3 defines the opposite:

- REQ-F002-056: `compose(B, R, 'overwrite') = B` when `B` is non-empty — "**the remainder
  `R` is NOT concatenated** … the workspace's prior prompt is discarded." I.e.
  `compose('X','Y','overwrite') = 'X'`.

So for any non-empty baseline `B` and non-empty layer `L`:
- F-003 `override` writes **`L`** (workspace wins, baseline thrown away).
- F-002 `overwrite` writes **`B`** (baseline wins, workspace thrown away).

`'Y' != 'X'`. The two are semantic inverses, not byte-equal. The equivalence holds ONLY in
the degenerate null-baseline branch (both collapse to `L`), which is why the spec's
null-collapse aside reads plausibly — but the general, non-degenerate case is exactly
backwards.

Worse: **F-002 has no compose branch that produces F-003's `override` for non-empty `B`.**
F-002's three modes are baseline-prepend, baseline-overwrite, baseline-fill — all
baseline-forward. "Workspace layer replaces the baseline" is not expressible in F-002 rev 3
at all. So REQ-F003-003's second equivalence is not merely mis-stated; it is **unfulfillable**
against the cited sibling.

Cascade (each independently wrong as a result):
- REQ-F003-016 test ("F-002 fan-out in `overwrite` produces the same engine value as saving
  that workspace via F-003 `override`") is unsatisfiable — one yields `B`, the other `L`.
- REQ-F003-018 / REQ-F003-039 preview-vs-save and client-vs-server parity are fine *within*
  F-003, but the cross-feature convergence promised in REQ-F003-003 ("a workspace written by
  F-002's fan-out and one written by F-003's editor converge … neither silently clobbers the
  other") is false for override/overwrite: they diverge by construction.
- REQ-F003-028 drift model relies on `override` being baseline-independent (`effective = L`),
  which is correct for F-003's definition but is the *opposite* of F-002 `overwrite`, which
  is baseline-dependent (`compose = newBaseline`, F-002 REQ-F002-013 recomposes it on
  baseline change). If these were "the same" mode they would classify drift oppositely.
- The §9 self-check's claim that the F-002 reconciliation ruling is "isolated behind the
  byte-for-byte mapping so … F-003's own compose semantics are unchanged" collapses, because
  the mapping it relies on does not exist.

**Question for the human / spec-writer:** Is F-003's `override` intended to mean
"workspace-layer-wins" (as written) or "baseline-wins" (F-002's `overwrite`)? If the former
(the plausible product intent — an operator overriding the baseline for one workspace), then
(a) drop the `override ≡ overwrite` byte-equivalence claim, (b) state that F-002 rev 3 has
**no** matching branch and that honoring per-workspace `override` in fan-out requires a NEW
F-002 compose branch (fold into REQ-F003-042), and (c) fix the REQ-F003-016 convergence test
to compare only the `append`/`prepend` pair, which is the only pair that actually converges.

### B2 — [CONTRADICTION / GAP] Override-resolution gating has a hole for tracked `append`/`inherit` workspaces (REQ-F003-029 vs REQ-F003-025 / 022)
REQ-F003-029 requires that resolving an `overridden` workspace (preserve/discard) be **bound
to the preview `confirmToken` and confirmed under the danger gate (REQ-F003-025)** — i.e. a
token must exist. But the token is minted only when the save is destructive:

- REQ-F003-022 mints a `confirmToken` **"when the pending save is destructive (REQ-F003-025)."**
- REQ-F003-025 destructive predicate: (a) target rel is `override` AND a baseline is defined;
  OR (b) the save would replace a non-empty live prompt **"that the console has no stored
  layer for."**

Consider an `overridden` workspace whose stored relationship is `append` (out-of-band edit
after a prior append save). Resolving with **discard** recomposes from the stored layer,
overwriting the out-of-band live content (unrecoverable). Is that destructive?
- Case (a) does not fire (rel is `append`, not `override`).
- Case (b) is excluded by its own text: the console **does** have a stored layer for this
  tracked workspace, so "no stored layer for" is false.

Result: no token is minted, yet REQ-F003-029 demands the resolution be confirmed under the
gate and bound to a token. Two implementations both claim compliance:
- **Reading A:** append/inherit override-resolution needs no token (per REQ-F003-025) — the
  out-of-band content can be discarded with an ordinary non-destructive save, contradicting
  the no-silent-clobber intent of REQ-F003-029.
- **Reading B:** override-resolution always needs a token (per REQ-F003-029) — but then the
  destructive predicate in REQ-F003-025/022 must be extended, which it is not.

**Fix:** add "resolving an `overridden` workspace (any relationship)" as an explicit
destructive/gated trigger in REQ-F003-025, OR restate REQ-F003-029 to require a token/gate
only when the resolution itself meets (a)/(b). Either way, make case (b) cover out-of-band
content that the console *did not author* even when a (now-stale) stored layer exists.

### B3 — [GAP] Divergence detection is unspecified for the common (non-destructive) save (REQ-F003-024 vs REQ-F003-022 / §7.1)
REQ-F003-024 (a MUST) says: "Before composing and writing, the console re-reads the live
prompt and compares its hash to the `currentPromptHash` **captured in the preview snapshot**.
On mismatch … the console MUST NOT write; it reports `diverged`."

For this to run at save time, the save must reference a preview snapshot. But:
- The `currentPromptHash` lives in `PromptLayerPreview` (REQ-F003-022), which is bound by the
  `confirmToken` — and the token is minted **only for destructive saves**.
- `PromptLayerSaveRequest` (§7.1) has no `currentPromptHash` field, and its `confirmToken` is
  optional ("required for a destructive save").
- REQ-F003-023 states a non-destructive save (`append`/`inherit`) "requires NO danger gate"
  — so it carries no token.

Therefore, for the ordinary append/inherit save, there is **no artifact conveying the
previewed snapshot hash**, and REQ-F003-024's "compare to the currentPromptHash captured in
the preview snapshot" has no referent. The MUST-not-write-on-divergence guarantee — a core
safety property — cannot be performed for the majority case as specified. (F-002 avoids this
because its apply is *always* danger-gated and thus always carries the snapshot-binding
token.)

**Fix:** either require every save (destructive or not) to carry a snapshot reference — a
lightweight preview token or the `currentPromptHash` — in `PromptLayerSaveRequest`, or
specify that the PUT performs its own fresh read + recompute + divergence check without a
prior preview and define what it compares against. As written, divergence detection for
non-destructive saves is a gap.

### B4 — [CROSS-REFERENCE CORRUPTION] REQ-F003-025 and REQ-F003-026 mis-cite REQ-F003-032 (should be REQ-F003-037)
The spec's preamble makes REQ-id citation the downstream test contract. Two citations point
at the wrong requirement:

| Location | Text | Cites | Should cite |
|---|---|---|---|
| §6.4 REQ-F003-025 | "the prior content is unrecoverable, **REQ-F003-032**" | 032 = *effective-prompt preview semantics* (read-only AT region, live region) | **REQ-F003-037** (reversibility caveat: "only record of prior content") |
| §6.4 REQ-F003-026 | "the ONLY record of the prior workspace-specific content (**REQ-F003-032**)" | 032 | **REQ-F003-037** |

REQ-F003-032 is about the preview being exposed read-only to assistive tech and debounced
announcements — nothing to do with irreversibility or the stored layer being the sole record
of prior content. That content is REQ-F003-037 (and REQ-F003-014 for capture extent). A test
author following the danger-copy requirement lands on an accessibility requirement. This is
the identical corruption class that was blocking in the F-002 review (B1). **Fix:** correct
both to REQ-F003-037 and run a mechanical §-reference pass before finalizing.

---

## Minor / non-blocking findings

- **M1 [AMBIGUOUS] Is an `append` save destructive?** REQ-F003-023 enumerates non-destructive
  saves as "(`append` or `inherit`, not overwriting operator content the console did not
  author)," while REQ-F003-025(b) makes an `append` destructive when it overwrites an
  uncaptured non-empty prompt. Reading A (simple): append is always non-destructive → no gate.
  Reading B (with the parenthetical + REQ-F003-046): append over uncaptured content is case
  (b) → gated. REQ-F003-046 flags this as an open question, which mitigates it, but the flat
  "append/inherit = non-destructive" phrasing in REQ-F003-023 invites Reading A. Pin the rule
  in REQ-F003-025 and make REQ-F003-023 defer to it rather than restate a shorter list.

- **M2 [NOTE] REQ-F003-042 undersells the F-002 change it requires.** It frames the fix as
  F-002's fan-out "consulting the F-003 per-workspace `composition_mode`." But because of B1,
  consulting the stored mode is insufficient: F-002 `overwrite` produces `B`, never F-003's
  `override` = `L`. Honoring a per-workspace `override` requires F-002 to gain a **new
  layer-wins compose branch**, not just read a column. State this so the ruling is scoped
  correctly.

- **M3 [MINOR] "Sync state … reused unchanged" is not quite true (REQ-F003-027 / §3).** F-002
  REQ-F002-023 computes `synced` as `P == compose(B, remainder)` with no stored mode (F-002
  has none). F-003 must parameterize by the stored relationship: `synced` iff
  `P == effective(B, L, rel)`. That is an *extension* of the predicate (it depends on the new
  `composition_mode` column), not a verbatim reuse. Testable divergence: an `override`
  workspace's `synced` check must use `effective = L`, not `compose(B,R)`. Reword §3/REQ-F003-027
  to say F-003 evaluates F-002's classification against `effective(B,L,rel)`.

- **M4 [MINOR] Default `composition_mode = 'append'` vs the structural derivation (REQ-F003-013
  vs REQ-F003-014).** REQ-F003-013 sets a stored DB default of `'append'`; REQ-F003-014 derives
  an initial view of `inherit`/`append`/`override` structurally from the live prompt. It is
  unstated which governs the first save of, e.g., a standalone hand-authored prompt: the DB
  default (`append`) or the derivation (`override`). REQ-F003-044 flags the default choice but
  not the default-vs-derivation interaction. Clarify that the persisted mode on first save is
  the derived (operator-confirmed) value, and that the column default only applies to rows
  created without going through the editor (if any).

- **M5 [AMBIGUOUS] Does an `inherit` save issue an engine write? (REQ-F003-015 / 001).** "The
  stored layer `L` is retained but **not written**" reads, in isolation, as "inherit skips the
  engine write." But REQ-F003-015 gives `effective = B` and REQ-F003-001 says the effective
  prompt is written to `systemPrompt`. Reading A: inherit writes `B` to the engine (overwriting
  whatever was there). Reading B: inherit leaves the engine untouched. The truth table implies
  A. Make explicit that "not written" refers to `L` only and that `B` IS written on an inherit
  save (which also means an inherit save can silently overwrite out-of-band content unless
  caught by the override-resolution flow — see B2).

- **M6 [NIT] ID numbering.** REQ-F003-015a is placed in §4 (data model, mirroring F-002
  REQ-F002-010a) while REQ-F003-015 is in §5 (composition) — the `a` suffix wrongly implies it
  refines 015. And REQ-F003-024b exists with no REQ-F003-024a. Non-blocking, but the parent's
  stability convention is about ids being unambiguous; consider renaming 015a to a §4-local id
  on the next non-breaking pass (or note the intentional cross-section mirror).

---

## §9 open-questions audit (are they truly open, or silently baked?)

- REQ-F003-042 (F-002 reconciliation): **genuinely open and honestly flagged** — good — but
  its framing is too small (M2), and the byte-for-byte mapping it claims to hide behind is
  broken (B1).
- REQ-F003-043 (remainder reuse), 044 (default/derivation), 045 (wording), 046 (append-gating),
  047 (announcement), 048 (sequencing), 049 (scale): each adopts a provisional default, cites
  the governing REQ, and asks for ratification. No disguised unilateral decision detected — the
  adopt-provisionally-and-flag discipline is sound. The only silent bake is the override↔overwrite
  equivalence (B1), which is presented as *settled fact* (REQ-F003-003/016) rather than as an
  open question, when it is in fact both unresolved and incorrect.

---

## Blocking items (must resolve before ACCEPT)

1. **B1** — correct the `override`↔`overwrite` semantics: drop the false byte-equivalence,
   state F-002 has no matching branch, and rescope REQ-F003-042 accordingly.
2. **B2** — close the override-resolution gating hole for tracked `append`/`inherit`
   workspaces (extend REQ-F003-025 or restate REQ-F003-029).
3. **B3** — specify how a non-destructive save conveys the preview snapshot so REQ-F003-024
   divergence detection can actually run.
4. **B4** — fix the REQ-F003-032 mis-citations (→ REQ-F003-037) and run a §-reference pass.

**Overall: REVISE (BLOCK).** The append/inherit half of the composition model is solid and
correctly reconciled with F-002; the override half is inverted against the sibling it cites,
and that error propagates through the crux, the drift model, and the §9 isolation argument.
Fix B1–B4 and the spec is close.
