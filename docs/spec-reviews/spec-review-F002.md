# Adversarial Spec Review — F-002 Customer-Wide Baseline System Prompt

Spec reviewed: `specs/F-002-customer-system-prompt.md` (Draft rev 1)
Brief: `briefs/F-002-customer-system-prompt.md`
Parent: `specs/admin-console.md` (v1, rev 7)
Reviewer posture: adversarial, read-only on the spec.

Checks executed: misinterpretation attack, one-line-test check, error-coverage sweep,
example-vs-prose reconciliation, definition audit, boundary audit, non-goal probe,
cross-reference check (8/8).

---

## Summary verdict

**REVISE.** The feature is well-conceived and its parent-spec citations are accurate,
but seven blocking items would let two conformant implementations diverge, or describe
behavior the declared API cannot produce. The single highest-value fix is the pervasive
cross-reference corruption (§B1): for a spec whose stated contract is "downstream tests
cite the REQ-F002-### id," several ids point at the wrong requirement.

Findings by severity: **Blocking/Major 7 · Minor 9 · Positive 2.**

---

## Positive confirmations (parent-spec fidelity)

- **P1. Parent REQ citations are accurate.** Every parent id F-002 leans on exists in
  `specs/admin-console.md` and says what F-002 claims: REQ-021/021a/021b (custody &
  opaque handles), REQ-026/027 (sole broker, per-call chain), REQ-028 (verify-after-
  write), REQ-029c (actor/`verified`/redaction), REQ-031 (`GET /api/workspaces/:id`),
  REQ-032 (`PATCH /api/workspaces/:id/settings`, `systemPrompt`→`openAiPrompt`),
  REQ-078c/080/081 (typed-token danger pattern), REQ-092/092a (fresh-read-before-write),
  REQ-093/093a (audit), REQ-094/096/097a (log hygiene, validation, verbatim messages),
  REQ-098/098b (no-partial-success), REQ-100 (≤200 ws), REQ-110/117/120 (custody non-
  goals). No cited parent id is missing or misdescribed.
- **P2. Brief fidelity is honest.** The spec does not quietly expand scope: composition
  is adopted provisionally (prepend-with-boundary) and explicitly flagged for human
  ruling (REQ-F002-041); best-effort enforcement, native-default avoidance, and the
  drift/preview/partial-failure design all trace to brief Open Questions and ux reads.

---

## Blocking / Major findings

### B1 — Systematic cross-reference corruption (Major; traceability is load-bearing)
Section: multiple. The spec's preamble makes REQ-id citation the contract of record, yet
several citations point at the wrong requirement. Concretely:

| Location | Text | Cites | Should cite |
|---|---|---|---|
| §2 REQ-F002-006 (l.78) | "(Deferred — REQ-F002-041.)" for auto-apply-on-create | 041 = *composition ratification* | **042** (enforcement strength) |
| §4 REQ-F002-010b (l.141) | "content reference (see REQ-F002-030)" | 030 = *UI preview mandate* | **035** (event payload) |
| §6.1 REQ-F002-017 (l.202) | "is audited (REQ-F002-030)" | 030 = *UI preview mandate* | **036** (audit) |
| §7.2 table (l.375) | `admin.baseline_prompt.updated (REQ-F002-016/030)` | 030 | **035** (event catalog) |
| §7.2 table (l.378) | `admin.baseline_prompt.applied summary (REQ-F002-031)` | 031 = *danger gating* | **035** (event catalog) |
| §8 REQ-F002-031 (l.409) | "no native undo — REQ-F002-036" | 036 = *audit* | **038** (reversibility caveat) |

Impact: a test author following "audited (REQ-F002-030)" lands on a UI preview
requirement; an implementer following the applied-event citation lands on the danger
gate. This looks like an un-propagated renumber — ironic given the stability preamble.
**Resolution:** correct all six citations; add a mechanical §-reference pass before
finalizing.

### B2 — Undefined / cleared baseline behavior is unspecified (Major GAP; affects §5 + §6)
`compose(B,R)` is defined only "for a baseline `B` (non-empty)" (REQ-F002-011). Yet:
- §3 says the baseline "may be undefined," and §4 says `text` NULL = never defined.
- REQ-F002-018 asserts "Clearing the baseline (setting it to empty) is an explicit
  distinct action," but no route supports it — `PUT /api/baseline-prompt` takes
  `{ text: string }` and rejects whitespace-only with 400. There is no clear/DELETE verb.
- The effect of a cleared/undefined baseline on already-applied workspaces is unstated:
  do their prompts become the remainder alone, become empty, or freeze and report
  `overridden`? `compose(B,R)` and the `synced` predicate (REQ-F002-023) are both
  undefined when `B` is empty/null.
- Whether apply/preview are even permitted with no baseline defined is unstated.

**Resolution:** define `compose` for empty/null `B`; add the explicit clear verb to §7
with its own semantics; specify what a clear does to applied workspaces and to their
sync state; state that apply/preview require a defined baseline (or define their no-
baseline behavior).

### B3 — `confirmToken` vs. typed danger token conflation (Major AMBIGUOUS + security)
REQ-F002-021 says the operator "MUST type the exact confirmation token displayed with the
preview, **and** the request MUST echo the `confirmToken` from REQ-F002-020," while the
apply body (§7.1) carries only one field, `confirmToken`.
- **Reading A:** the server-issued `confirmToken` *is* the human-typed token; the operator
  types the server value and the server validates it. (Then the "token" must be short/
  human-typeable, unlike a binding nonce, and there is no independent blast-radius binding.)
- **Reading B:** there are two artifacts — a machine binding token (`confirmToken`) and a
  separate human-typed confirmation string (per DangerConfirm) — but only the former is
  transmitted, so the typed-token gate is client-only and the server cannot enforce it.

These validate differently on the server and imply different token contents; both claim
compliance. **Resolution:** state explicitly whether the typed token and the binding
token are the same value; if distinct, add the typed value to the apply request and define
what the server validates.

### B4 — Token-staleness vs. per-workspace divergence contradiction (Major CONTRADICTION + GAP)
REQ-F002-021: an apply with a "stale/absent token" is rejected (409/400) and **no fan-out
occurs**. REQ-F002-040: if a workspace was edited out-of-band between preview and apply,
"the affected per-workspace write is reported as a divergence in the result rather than
silently overwriting" — implying the apply **proceeds** and reports per-item divergence.
- What makes a token "stale" is never defined (time? new preview? baseline change?
  any live divergence?). If out-of-band divergence makes the token stale, REQ-021 rejects
  the whole apply, contradicting REQ-040's per-item divergence path.
- `BaselineApplyOutcome` is only `applied | failed | skipped` — there is **no `diverged`
  value**, so REQ-F002-040's "reported as a divergence in the result" has no representation
  in the declared type.

**Resolution:** define token staleness precisely; reconcile whole-apply rejection vs. per-
workspace divergence; add a `diverged` (or equivalent) outcome, or state that divergence
maps to `failed` with a reason.

### B5 — Async progress + pagination MUST cannot be met by the declared API (Major CONTRADICTION/GAP)
REQ-F002-039 states apply "streams or polls progress rather than blocking opaquely" and
"Preview and apply MUST paginate/stream results," and REQ-F002-034 requires an ARIA live
region for "async apply progress." But §7.1 `BaselinePreview` and `BaselineApplyResult`
are single JSON objects with flat `items[]` arrays — no cursor/pagination fields, no job
id, no streaming/polling endpoint, and `POST /api/baseline-prompt/apply` returns the
complete result synchronously. The API as specified cannot stream, poll, or paginate.
**Resolution:** either add the progress/polling endpoint (job id + status route) and
pagination cursors to §7, or downgrade REQ-F002-039 to a synchronous bounded response and
remove the streaming/pagination MUST. (Also: "apply completes within a bounded, progress-
reported window" states no number and is untestable as written — give a bound or delete
the time claim.)

### B6 — Override preserve/discard flow is underspecified (Major GAP; §6.4↔§6.2↔§7)
REQ-F002-025 requires a deliberate preserve-or-discard choice per `overridden` workspace,
"surfaced in the preview diff." But:
- **Ordering paradox:** the preview must return `composedPrompt` per item (REQ-F002-019),
  yet for an overridden workspace the composed prompt *depends on* the not-yet-made
  resolution. The spec does not say whether the preview is re-fetched after each choice,
  shows both candidates, or defers.
- **Binding:** resolutions travel in the apply body (`overrides?`), separate from the
  `confirmToken` that binds the blast radius. Nothing validates that the apply's
  `overrides` match what was previewed, so a resolution can be changed after preview
  without invalidating the token.
- **Missing resolution:** REQ-F002-025 says apply "does not proceed" without a choice, but
  not whether that rejects the whole apply or skips just that workspace.

**Resolution:** specify preview behavior for overridden items (both candidates, or a
resolution-parameterized preview); bind resolutions into the confirmToken; define the
behavior when an overridden target has no resolution (reject vs. skip).

### B7 — First-apply "already a console composition" detection is underspecified; double-prepend risk (Major AMBIGUOUS/GAP)
REQ-F002-012 captures the live prompt `P` verbatim as the remainder unless `P` is "already
a console composition (does not equal `compose(currentBaseline, …)` for any stored state)."
For a first-apply workspace there is by definition **no** `workspace_baseline_state` row,
so "for any stored state" has no referent — the guard can never fire, and the detection
criterion is undefined. This is exactly the case (re-onboard, lost/rebuilt state row, or a
prompt already carrying the sentinel) where `P = B + SENTINEL + R` would be re-captured
whole, yielding `compose(B, P) = B + SENTINEL + B + SENTINEL + R` — a **doubled baseline**.
- **Reading A:** the guard compares `P` to compositions of *this* workspace's stored state
  (none on first apply) → guard never applies → double-prepend possible.
- **Reading B:** the guard means "does `P` structurally look composed" (e.g., starts with
  the current baseline / contains the SENTINEL) → very different, and undefined which.

**Resolution:** define the detection concretely (e.g., "if `P` begins with the current
baseline followed by SENTINEL, treat the trailing segment as remainder"); specify behavior
when a captured remainder itself contains the SENTINEL bytes.

---

## Minor / non-blocking findings

- **M1 (GAP).** Hash function for `applied_composed_hash` / `applied_baseline_hash` is
  unspecified. External behavior is unaffected (self-comparison), but the sync-state tests
  in REQ-F002-023 read as hash comparisons; name the algorithm for reproducibility.
- **M2 (AMBIGUOUS).** Token rejection status code is given as "409/400" in REQ-F002-020/021
  without a rule for which applies when. Pin one per condition.
- **M3 (GAP).** "Target set" is referenced in §6.2/§6.5 but never defined. Reading it as
  "always all workspaces, effective writes = only those whose composed prompt changes"
  makes REQ-F002-022b consistent, but the spec should say so, and state whether an operator
  may exclude specific workspaces (no mechanism exists today — likely intended).
- **M4 (GAP).** Orphaned `workspace_baseline_state` rows for deleted workspaces are not
  addressed (status/preview read live via `GET /v1/workspaces`, so deleted ws vanish while
  their rows persist). State cleanup on `admin.workspace.deleted` is unspecified.
- **M5 (NOTE).** REQ-F002-035 records `admin.baseline_prompt.updated` with `verified` "not
  applicable / store-confirmed true," a benign deviation from parent REQ-029c ("every event
  carries `verified`"). Acknowledged but worth an explicit note in the event contract.
- **M6 (NOTE).** `GET /api/baseline-prompt/preview` is a GET that mints and stores a
  stateful `confirmToken` (a side effect). Harmless but non-idiomatic; consider POST or note
  the intentional side effect.
- **M7 (NOTE).** The status route (§7.2) lists engine `GET /v1/workspaces` as its call;
  the product-layer list route is `GET /api/workspaces` (parent REQ-030). Confirm the BFF
  reuses existing broker code rather than a second raw engine path.
- **M8 (NOTE).** "Drift"/"drifted" (REQ-F002-002 test, §6.4 heading) is used loosely; the
  defined states are `synced|stale|overridden|never-applied`. Map "drifted" to a defined
  set to keep tests unambiguous.
- **M9 (NOTE).** `admin.baseline_prompt.applied` payload lists "affected workspace ids"
  (REQ-F002-035); clarify whether "affected" = applied only or applied+failed, so the audit
  breakdown in REQ-F002-036 lines up.

---

## Blocking items (must resolve before ACCEPT)

1. B1 — correct the six mis-cited REQ ids.
2. B2 — define cleared/undefined-baseline semantics + a clear verb.
3. B3 — resolve the `confirmToken` vs. typed-token conflation.
4. B4 — reconcile token-staleness rejection vs. per-workspace divergence; add a divergence outcome.
5. B5 — make the API able to stream/poll/paginate, or drop those MUSTs; give apply a real time bound or remove it.
6. B6 — specify the override preserve/discard flow end-to-end (preview, binding, missing-resolution).
7. B7 — define "already a console composition" detection to prevent double-prepend.

**Overall: REVISE.**
