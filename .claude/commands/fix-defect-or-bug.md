---
description: Reproduce, fix, and verify a customer-reported defect or internally-found bug logged in feature-value-scoring.xlsx (item_type=Defect). Adapted from /implement-spec for the fix pipeline — never scores or ranks (that's /prioritize-features).
argument-hint: <defect-id D-### | path-to-bug-report.md> [--workbook path] [--skip-triage-gate]
allowed-tools: Read, Write, Bash, Task
---

# /fix-defect-or-bug

Fixes one Defect row end-to-end using strict role separation between subagents — the same
discipline as `/implement-spec`, retargeted at a bug instead of a spec. You are the
orchestrator: you delegate and pass reports between agents; you never reproduce, diagnose,
write tests, or write fix code yourself, and you never resolve disputes by weakening tests.

**Scope boundary — read first:** This command never scores, ranks, or advances a row to
`Prioritized` — that's `/prioritize-features`. It never writes feature briefs. It operates
only on `item_type = Defect` rows; if pointed at a Feature row, stop and say so (use
`/implement-spec` for new-feature work).

Arguments: `$ARGUMENTS`
- A `feature_id` matching `D-###` from the workbook's Scoring sheet, or a path to a standalone
  bug report if the row doesn't exist yet (offer to log it via the LOG role in Phase 0 rather
  than refusing — but the workbook row is still the source of truth going forward).
- `--workbook path` (default: `./feature-value-scoring.xlsx`)
- `--skip-triage-gate`: proceed even if the row's `status` is `Reported`/`Triaged` rather than
  `Scored`/`Prioritized` — for a hotfix too urgent to wait on scoring. Still requires `severity`
  to be set (inline in the row or supplied now) before starting; refuse otherwise.

## Phase 0 — Intake

1. Load the workbook; parse the **Data Dictionary sheet** into a field map. Read the Defect
   row via the map — never hard-code columns.
2. Confirm `item_type = Defect`. Wrong type → stop, point to `/implement-spec`.
3. No resolvable row (raw bug report path given instead) → offer to log it now per the
   `feature-value-scoring` skill's **LOG role**: allocate `D-###`, set `item_type = Defect`,
   `defect_source`, `status = Reported`, `brief_ref` to the report. Then continue below.
4. **Triage gate:** `status` must be `Scored` or `Prioritized` to proceed, unless
   `--skip-triage-gate` was passed AND `severity` is set. Otherwise stop and tell the user to
   run triage/`/prioritize-features` first, or supply `--skip-triage-gate` with a severity.
   `status = Cancelled` → always STOP, even with `--skip-triage-gate`: a human cancelled the
   item and only a human edit to the row reverses that — never rewrite the status yourself.
5. Pull `feature_name`, `brief_ref`, `severity`, `defect_source`, `reach`, `confidence`,
   `evidence_sources`, `rationale_notes`. No repro information anywhere (`brief_ref`
   unresolvable and nothing inline) → STOP and ask the user for repro steps; never guess.
6. Write `status = "In Progress"` now (via openpyxl, recalc) so `/prioritize-features` excludes
   this row while it's being worked.

## Phase 0.5 — Reproduction & root cause (debugger)

Delegate to **debugger**: "Reproduce the defect described in `<brief_ref / inline repro>`
(Defect `<D-###>`, severity `<n>`). Confirm you can trigger the reported symptom, then produce
a root-cause statement with evidence (file:line, stack trace, or failing condition) — do not
fix it."

- Cannot reproduce → STOP and report back to me with what was tried. Never let the implementer
  guess-fix an unreproduced bug.
- The root-cause report is the single source of truth handed to Phase 1 and Phase 2 below —
  neither may substitute its own theory without flagging the conflict to me.

## Phase 1 — Regression test (qa-engineer)

Delegate to **qa-engineer**: "Write ONE failing regression test reproducing Defect `<D-###>`
per the debugger's root-cause report. It must fail for the reported reason specifically (not
a coincidental, unrelated error) and must pass once that root cause is fixed. Do not write
fix code."

Confirm red: run just this test, verify FAIL, and verify the failure matches the reported
symptom — not, say, a missing import that happens to also throw.

## Phase 1.5 — Migration check (migration-agent) [only if the root cause is a schema/data issue]

If the debugger's report implicates a database schema or stored-data shape, delegate to
migration-agent before the fix. Pass its "application changes required" list to the
implementer in Phase 2.

## Phase 2 — Fix (implementer)

Delegate to implementer: "Fix the root cause of Defect `<D-###>` per the debugger's report.
The regression test at `<path>` is red — make it green without modifying it. Fix the root
cause only; no unrelated refactoring or 'while I'm here' cleanup — that's a separate concern
if warranted, not this pass."

## Phase 3 — Verification loop (qa-engineer ↔ implementer, debugger on stall)

1. qa-engineer runs the regression test AND the full existing suite (a bug fix that breaks
   something else isn't a fix), classifies any failures.
2. All green → Phase 4. Implementation bugs → pass the QA report verbatim to implementer to
   fix; repeat. MAXIMUM 4 iterations.
3. STALL RULE: same test fails after 2 consecutive fix attempts, or the cap is hit → delegate
   to debugger for a fresh root-cause pass, then implementer gets ONE more attempt guided by
   it. Still failing → STOP and escalate to me with all reports.
4. Agent disputes (test wrong vs. code wrong) escalate to me — never self-resolve.

## Phase 4 — Unit test hardening (unit-test-writer) [severity-gated]

`severity` ≥ 4 (major/critical, per Rubric) → always run: unit-test-writer covers the fixed
code path with edge cases the regression test alone doesn't reach. `severity` ≤ 3 → skip by
default (keep low-severity fixes fast and minimal); run only if the user asks. Suspected bugs
found go to implementer (max 2 iterations, debugger on stall), then qa-engineer re-runs the
full suite.

## Phase 5 — E2E confirmation (e2e-tester) [conditional]

Run only if the defect is user-facing (web UI / API surface a user or integration hits
directly) AND `severity` ≥ 4, or the user explicitly asks. Confirms the fix holds end-to-end,
not just at the unit/integration level. Integration bugs found follow the same
fix-loop/debugger/escalation rules (max 2 iterations).

## Phase 6 — Performance check (performance-profiler) [only if the defect IS a performance regression]

If the reported symptom is itself a performance regression (latency, memory, throughput),
performance-profiler confirms the fix resolves it against the reported baseline. FAIL routes
back to implementer (max 2 iterations), followed by full re-verification (qa + unit).

## Phase 7 — Review gate (code-reviewer + security-reviewer, in parallel)

Run both in parallel on the branch diff (it's small — one root cause, one fix):
- security-reviewer: full methodology, report under `security/`.
- code-reviewer: review the diff.
- accessibility-reviewer additionally, ONLY if UI code changed.
Any BLOCK verdict → findings verbatim to implementer for root-cause remediation → re-review
affected areas AND re-run qa + unit suites. Maximum 3 iterations, then escalate. PASS WITH
NOTES / non-blocker findings are carried to the final report, not silently fixed or accepted.

No refactorer phase by default — a bug fix doesn't need surrounding cleanup. Available on
request only, same green-suite-before/after discipline as `/implement-spec` Phase 9.

## Phase 8 — Documentation (documenter)

CHANGELOG entry referencing `<D-###>`: one line for the symptom, one for the root cause, one
for the fix. Skip broader README/docstring churn unless the fix changed public behavior or an
API contract.

## Phase 9 — Release prep (release-agent) [only if I say to release]

Ask me first. If yes: release-agent verifies green, bumps version, builds locally, drafts
`release/PR_DESCRIPTION.md` — and stops. Push/tag/publish are mine.

## Phase 10 — Workbook write-back & final report

1. Update the Defect row via the field map: `status` → `"Fixed"` (or `"Verified"` if Phase 5
   e2e confirmation ran and passed with no open questions). Append to `rationale_notes`:
   `[fix-defect-or-bug YYYY-MM-DD] root cause: <one line>; fixed in <files>; regression test:
   <path>.` Never blank prior provenance — append, don't overwrite. Recalc, verify zero
   formula errors.
2. Summarize: root cause (with evidence), files created/modified, regression test path and
   status, full suite status, unit/e2e/performance verdicts where run, review verdicts with
   accepted findings, iteration counts per phase, workbook status transition, and remaining
   human actions (e.g., close the originating ticket; decide a `Won't Fix` reclassification
   if the user disagrees with the fix approach).

Orchestrator rules:
- Never bypass role separation, even to save time.
- Never mark complete with any failing or skipped test.
- Conditional phases: state in one line why you ran or skipped each.
- One-line status to me at every phase transition.
- If at any point the reported defect turns out not to reproduce as described, or the "root
  cause" turns out to be intended behavior, STOP and report that to me rather than fixing
  something that isn't actually broken.
