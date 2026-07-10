# F-002 — Customer-Wide Baseline System Prompt: Final Report

Spec: `specs/F-002-customer-system-prompt.md` (rev 9)
Status: **implementation complete, all pipeline phases green.** Nothing committed/pushed — all changes are uncommitted, pending human review.

## Summary

Lets a staff operator set one baseline system-prompt text that gets composed onto every workspace's prompt (`prepend` / `overwrite` / `fill`), previewed per-workspace before anything is written, and applied synchronously with per-workspace `applied` / `failed` / `skipped` / `diverged` outcomes — never collapsed into a single success/failure banner.

## Test suite

- BFF: 711 tests passing (`cd bff && npx vitest run`)
- Web: 266 tests passing (`cd web && npx vitest run`)
- E2E: 1 flow test passing (`cd tests/e2e && npx playwright test`) — login → set baseline → preview → typed-confirmation apply → per-workspace outcomes, plus a mismatched-confirmation rejection case
- `tsc --noEmit` clean in `bff/` and `web/`

## Requirements coverage

All 60 requirements in spec rev 9 (REQ-F002-001 through REQ-F002-060) are covered by the spec-level test suite (`bff/test/routes/baseline-prompt.*.test.ts`, `bff/test/store/baseline-migration.test.ts`, `tests/TEST_PLAN.md`), plus 87 additional white-box unit tests targeting `compose.ts`, `confirm-token.ts`, `baseline.repo.ts`, and `baseline.service.ts` directly.

## Pipeline path (14 agent runs across 10 phases)

1. **Spec review** — 2 rounds; caught and fixed two real contradictions in the sync-state classification logic (REQ-F002-023) before any code was written.
2. **Architecture design** (`docs/design/07-F002-baseline-prompt.md`) + **UX design** (`docs/design/ux/F-002-baseline-prompt.md`) + **DB migration** with rollback (`rollbackF002()` in `bff/src/store/db.ts`).
3. **QA test generation** — 99 spec-derived tests written before implementation existed.
4. **Implementation** — hit a session-limit interruption partway through; resumed cleanly from partial state rather than restarting.
5. **Verification loop** — found 4 failing tests; independently confirmed all 4 were genuine mock-setup bugs in the QA-authored tests (not implementation bugs), fixed by QA without weakening any assertion.
6. **Unit test hardening** — 87 new white-box tests added; found zero implementation bugs.
7. **E2E** — no E2E framework existed in this repo; Playwright was introduced from scratch (per human go-ahead) with a real login → preview → apply → verify flow driven against a standalone fake-engine HTTP stub.
8. **Review gate** — security: **PASS with notes**; code quality: **APPROVE with comments**; accessibility: **BLOCK → PASS with notes** after 2 fix rounds. The accessibility blocker was a real keyboard-focus-management defect in the shared `DangerConfirm` dialog (used by 6 different features, not just this one) — fixed at the root and independently re-verified 3 times.
9. **Refactor** — code was already clean; one real duplication in `baseline.service.ts` consolidated, one whitespace fix.
10. **Documentation** — design doc reconciled against final implementation; migration runbook confirmed accurate; no stale docs or code/spec mismatches found.

Phase 11 (release prep) was **not run** — not requested.

## Review verdicts and accepted findings

**Security — PASS with notes.** No Critical/High findings. Custody boundary, authz, IDOR protection, and the `confirmToken`/typed-confirmation danger-gate mechanism verified sound. One Low finding fixed during the review-gate pass: the client was echoing the server-issued confirmation phrase back instead of sending what the operator actually typed, making the server-side check decorative; now threads the real typed value through.

**Code quality — APPROVE with comments.** 0 blockers. 3 should-fix items, all addressed: the status route's per-workspace engine reads were sequential instead of using the existing bounded-concurrency pool (now shared via an extracted `mapWithConcurrency` helper); a swallowed error was replaced with the sibling-service convention of surfacing `err.message` in partial-failure results; a stray migration-runbook file was moved out of `bff/src/store/` into `docs/`.

**Accessibility — PASS with notes** (after 2 fix rounds from an initial BLOCK). Root cause: the shared `DangerConfirm` dialog (used across 6 features) had no initial focus, no Tab trap, no Escape handling, and no reliable focus-restore on close. Fixed in the component once, benefiting all 6 callers. Round 2 caught a subtler bug the first fix missed: focus-restore on a *successful* confirm silently failed when the trigger button became disabled/removed in the same render commit (React 18 batching) — fixed with a focusability check and an optional fallback-focus landmark, wired into the 4 affected callers. Also fixed: a contrast failure on the "stale" sync-state chip (2.77:1 → now 8.99:1 dark / 6.50:1 light), and DOM tab-order so the Apply button now follows the preview/override content instead of preceding it.

Non-blocking follow-ups noted for a future pass (do not block this feature shipping):
- Add `aria-label` to two fallback-focus landmark `<div>`s (`SettingsPage.tsx`, `RawEnvEditor.tsx`) that currently have no accessible name.
- Add `aria-live="polite"` to two unrelated settings pages' save-confirmation text, for consistency with the pattern this feature introduced.
- Add Shift+Tab (first→last) wrap test coverage alongside the existing forward-wrap test.
- Wire the same `fallbackFocusRef` mechanism into `WorkspaceList.tsx`/`UserList.tsx` if their list-reload behavior ever changes to disable/remove a trigger in the same commit as dialog close.

## Human rulings applied

- Target scale is always fewer than 200 workspaces — drove the decision to keep apply synchronous and bounded-concurrency rather than building an async job/polling model.
- The native, console-unreachable AnythingLLM Default System Prompt setting gets a persistent, non-dismissible advisory banner on the baseline settings surface (REQ-F002-060).
- The four "minor notes" flagged during spec review (bookkeeping, concurrency-width formula, fill-mode UI edge case, the §7.2 apply-body `mode` field omission) were left to downstream agents' engineering judgment rather than escalated — the `mode` field ambiguity was resolved consistently as "prose governs" across the UX, QA, and implementation phases.
- REQ-F002-051 (orphan-cleanup wiring): resolved as an inline call in `workspace.service.deleteWorkspace`, consistent with the existing `forget()` cleanup pattern there.

## Files created/modified

BFF: `bff/src/baseline/compose.ts`, `bff/src/baseline/confirm-token.ts`, `bff/src/store/repositories/baseline.repo.ts`, `bff/src/services/baseline.service.ts`, `bff/src/routes/baseline.routes.ts`, plus additive changes to `bff/src/types/product-types.ts`, `bff/src/events/catalog.ts`, `bff/src/store/db.ts`, `bff/src/index.ts`, `bff/src/services/workspace.service.ts` (orphan cleanup).

Web: `web/src/features/baseline-prompt/*` (8 components), `web/src/components/DangerConfirm.tsx` (accessibility fixes, now benefiting 6 features), plus small `fallbackFocusRef` wiring in `web/src/features/settings/SettingsPage.tsx`, `web/src/features/workspaces/KnowledgePanel.tsx`, `web/src/features/raweditor/RawEnvEditor.tsx`, `web/src/features/raweditor/MaskedDiffConfirm.tsx`, and additive changes to `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/App.tsx`, `web/src/index.css`.

Tests: `bff/test/routes/baseline-prompt.*.test.ts` (4 files), `bff/test/store/baseline-migration.test.ts`, `bff/test/baseline/*.test.ts`, `bff/test/services/baseline.service.test.ts`, `bff/test/store/repositories/baseline.repo.test.ts`, `web/src/components/DangerConfirm.test.tsx` (extended), `tests/e2e/` (new Playwright package, introduced for this feature).

Docs: `docs/design/07-F002-baseline-prompt.md`, `docs/design/ux/F-002-baseline-prompt.md`, `docs/F-002-migration-runbook.md`, `tests/TEST_PLAN.md`.

## Remaining human actions

- Review and commit the changes (nothing has been committed).
- Decide whether to run Phase 11 (release prep) or open a PR.
- Optionally schedule the non-blocking accessibility follow-ups listed above.
