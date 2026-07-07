# Prioritization Run — 2026-07-07T20-39-12Z

Workbook: `feature-value-scoring.xlsx` · Snapshot (pre-mutation): `input.xlsx` (this dir)
Cut line: none (±10% flag suppressed) · Dry-run: no

## 1. Ranked list

| Rank | ID | Feature | Priority | Status | One-line rationale (evidence-cited) |
|------|----|---------|:--------:|--------|-------------------------------------|
| 1 | F-001 | Adhere to a Design System | 46.2 | Prioritized | Broadest reach on a de-risked track — ~723-line index.css / ~143 className sites / 5 diverging areas, DS bundle already vendored at `web/vendor/design-system/`, spec rev3 rulings all resolved. |
| 2 | F-003 | Workspace-level system prompt (composition layer) | 20.5 | **Prioritized (new)** | Lone `openAiPrompt` field with no layering; F-002 reserves per-workspace prompting for F-003 — natural strategic completion of the governance layer. Depends on F-002; no external demand signal (conf 2). |
| 3 | F-002 | Customer-specific system prompt | 17.3 | Prioritized | No customer-wide baseline mechanism; engine single prompt field, native default is session-auth (out of API-key custody). Real governance value, capped by no external sales signal (conf 2). Build-order prerequisite for F-003. |
| 4 | F-004 | Production-ready event bus | 10.0 | **Scored (held — flagged)** | Highest raw weighted value (3.85) but dragged last by effort 4 (1–2 quarters) + risk 3; inproc default, relay is an enqueue-only stub with zero drain callers, zero subscribers, contract built. |

## 2. Review flags

**(a) Strategic bet buried by the effort divisor → F-004.**
`strategic_alignment=5` and the highest weighted value of the set (3.85), yet `effort=4` + `risk=3` collapse it to last at 10.0.
→ **Decision needed:** Is the production-ready event bus a strategic must-do for the Oct-2026 GTM that should be funded/sequenced ahead of its effort-divided rank?
→ **RESOLVED 2026-07-07 (human ruling): PRIORITIZE (commit).** The human overrode the effort-divided rank on strategic / production-readiness grounds (consistent with the standing note "needed for actual customer use… may as well develop on a real eventbus ASAP"). F-004 status Scored → **Prioritized**. It remains #4 by priority score — the commit is a sequencing/funding decision, not a score change; effort 4 / risk 3 still describe its cost and should inform build ordering.

**(b) risk = 5 one-way door → none.** Max risk in the set is F-004 = 3. No sign-off gate triggered.

**(c) Stale scoring (date_scored > 90 days) → none.** All four rows scored 2026-07-07 (F-001 stored as serial 46210 = 2026-07-07). None predate the 2026-04-08 cutoff.

**±10% funding cut-line flag → suppressed** (no `--cut-line` provided).

## 3. BLOCKED list (awaiting briefs)
None. All rows with a `feature_id` have a resolvable brief.

## 4. Human-gate leftovers (missing human-owned scores)
None remaining. `strategic_alignment` / `effort` / `risk` supplied by the human for F-003 and F-004 during this run.

## 5. Stale list (previously prioritized, overdue for re-score)
None. F-001 and F-002 were prioritized 2026-07-07 (fresh).

## 6. Contract violations (rejected research writes)
None. Both research dispatches (F-003, F-004) wrote only permitted fields, cited evidence, and honestly capped confidence at 2 (no external demand data).

## 7. Config used
- Weights: Reach 0.20, User Value 0.25, Business Value 0.25, Strategic Alignment 0.20, Time Sensitivity 0.10 (sum 1.00; `Config!B9 = OK`).
- Confidence map: 1→0.50, 2→0.65, 3→0.80, 4→0.90, 5→1.00.
- Risk map: 1→1.00, 2→0.90, 3→0.80, 4→0.70, 5→0.60.
- Cut line: none · Dry-run: no · Snapshot: `.prioritization-runs/2026-07-07T20-39-12Z/input.xlsx`

## Writes applied this run
- F-003: research scores (reach 3, user_value 3, business_value 2, time_sensitivity 3, confidence 2) + evidence/rationale + scored_by/date; status Brief Drafted → Scored → **Prioritized**.
- F-004: research scores (reach 4, user_value 4, business_value 3, time_sensitivity 3, confidence 2) + evidence + human rationale preserved & research rationale appended; status Brief Drafted → **Scored** (held, flagged).
- F-001 / F-002: untouched (already Prioritized, fresh).
