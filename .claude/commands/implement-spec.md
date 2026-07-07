---
description: Implement a specification end-to-end using the full subagent pipeline
argument-hint: <path-to-spec.md or path-to-feature-request.md>
---

Implement $ARGUMENTS end-to-end using strict role separation between
subagents. You are the orchestrator: you delegate and pass reports between
agents; you never write specs, tests, code, or docs yourself, and you never
resolve disputes by weakening tests.

## Phase 0 — Specification (spec-writer) [skip if input is already a formal spec]
If $ARGUMENTS is a formal spec (numbered requirements, error handling,
non-goals), skip Phase 0 but still run Phase 0.5. Otherwise delegate to
spec-writer to formalize it. Hold its open questions — they go to me in
Phase 0.5 step 3, combined with the review findings.

## Phase 0.5 — Spec review (spec-reviewer ↔ spec-writer)
1. Delegate to spec-reviewer: "Adversarially review the spec at <path>.
   Execute all 8 checks. Do not consult drafting history — the page must
   stand alone."
2. If verdict is BLOCK: pass the findings verbatim to spec-writer for
   revision, then have spec-reviewer re-review the deltas. MAXIMUM 2 review
   rounds total — if blocking findings remain after round 2, include them
   in step 3 for my ruling rather than looping further.
3. STOP and present to me in one batch: spec-writer's open questions (with
   its recommended defaults), any unresolved blocking findings, and the
   reviewer's NOTEs. Resume only after my rulings, applied by spec-writer.
4. This phase verifies the spec is unambiguous and testable — NOT that it
   describes what I actually want. Remind me of that distinction when
   presenting step 3.

## Phase 1 — Design (architect) [skip for small features]
If the spec implies more than ~2-3 modules or touches persistence/public
APIs, delegate to the architect for a design doc. Small features skip this.

## Phase 1.25 — UX design (ux-designer) [only if user-facing UI surface]
If the spec defines user-facing UI (screens, forms, visual components —
not APIs or CLIs), delegate to ux-designer: "Design the UI for the spec
(and architect design doc if present). The spec is authoritative — flag
ambiguities, never resolve them in the design. Design references (e.g.
Claude Design handoff bundles) may exist under
docs/design/ux/references/ — they are visual intent, not requirements."
If its report lists open questions or reference behaviors not in the
spec, surface them to me before Phase 2; neither the design doc nor a
reference bundle may become a second source of requirements. Pass the
doc path to the implementer in Phase 3 (never the raw bundle).

## Phase 1.5 — Migrations (migration-agent) [only if schema changes]
If the spec/design requires database schema or data changes, delegate to
migration-agent before implementation. Pass its "application changes
required" list to the implementer in Phase 3.

## Phase 2 — Test generation (qa-engineer)
Delegate to qa-engineer: "Generate a complete test suite from the spec.
Produce tests/TEST_PLAN.md and executable tests. Do not read implementation
code." If it flags spec ambiguities, STOP and get my ruling.

## Phase 3 — Implementation (implementer)
Delegate to implementer: "Implement the spec (and design doc / UX design
doc if present; where either conflicts with the spec, the spec wins —
stop and report the conflict rather than picking silently).
Tests exist under tests/ — run them, never modify them."

## Phase 4 — Verification loop (qa-engineer ↔ implementer, debugger on stall)
1. qa-engineer runs the full suite and classifies failures.
2. Suite green → Phase 5. Implementation bugs → pass the QA report verbatim
   to implementer to fix; repeat. MAXIMUM 4 iterations.
3. STALL RULE: if the same test fails after 2 consecutive fix attempts, or
   the cap is hit, delegate that failure to the debugger for a root-cause
   report, then give implementer ONE more attempt guided by it. Still
   failing → STOP and escalate to me with all reports.
4. Agent disputes (test wrong vs code wrong) escalate to me — never
   self-resolve.

## Phase 5 — Unit test hardening (unit-test-writer ↔ implementer)
unit-test-writer covers tests/unit/ with coverage tooling if available.
Suspected bugs go to implementer (max 2 iterations, debugger on stall as
above), then qa-engineer re-runs the full suite to confirm no regressions.

## Phase 6 — E2E tests (e2e-tester) [only if user-facing surface]
If the project has a web UI, API service, or CLI, delegate critical-journey
coverage to e2e-tester. Integration bugs found follow the same
fix-loop/debugger/escalation rules (max 2 iterations).

## Phase 7 — Review gate (security-reviewer + code-reviewer, in parallel)
Run both reviews; both are read-only and independent, so launch them in
parallel and collect both reports:
- security-reviewer: full methodology, report under security/.
- code-reviewer: review the branch diff.
- accessibility-reviewer additionally, ONLY if UI code changed.
Any BLOCK verdict → findings verbatim to implementer for root-cause
remediation → re-review affected areas AND re-run qa + unit suites.
Maximum 3 iterations, then escalate. PASS WITH NOTES / non-blocker findings
are carried to the final report, not silently fixed or accepted.

## Phase 8 — Performance (performance-profiler) [only if spec has perf targets]
If the spec contains performance requirements, performance-profiler
benchmarks against them. FAIL verdicts route hotspot reports to implementer
(max 2 iterations), followed by full re-verification (qa + unit).

## Phase 9 — Cleanup (refactorer)
With everything green, refactorer pays down debt from the fix iterations.
Suite must be green before, after every step, and at the end. Bugs it
reports (but correctly does not fix) go back through Phase 4 rules.

## Phase 10 — Documentation (documenter)
documenter updates README, docstrings, API docs, and CHANGELOG from the
diff and spec, verifying every example by execution.

## Phase 11 — Release prep (release-agent) [only if I say to release]
Ask me first. If yes: release-agent verifies green, bumps version, builds
locally, drafts release/PR_DESCRIPTION.md — and stops. Push/tag/publish are
mine.

## Phase 12 — Final report
Summarize: requirements coverage, suite status (spec/unit/e2e), review
verdicts with accepted findings, performance verdict, iteration counts per
phase, files created, ambiguity rulings made, and remaining human actions.

Orchestrator rules:
- Never bypass role separation, even to save time.
- Never mark complete with any failing or skipped test.
- Conditional phases: state in one line why you ran or skipped each.
- One-line status to me at every phase transition.
