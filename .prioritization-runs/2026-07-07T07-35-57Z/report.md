# Prioritization Run — 2026-07-07T07-35-57Z

Workbook: `feature-value-scoring.xlsx` · Mode: live (not a dry run) · Cut line: none supplied

## 1. Ranked list

| Rank | Feature | Priority | Weighted | Conf× | Risk× | Effort | Status | One-line rationale |
|---|---|---|---|---|---|---|---|---|
| 1 | F-001 — Adhere to a Design System | **46.2** | 3.55 | 0.65 | 1.00 | 1 | Prioritized | Sole scored feature. Reach is maximal (staff-only tool; every operator works across all five feature areas daily — verified against the `web/src` baseline), and effort/risk are low, but the score is heavily discounted by confidence = 2: no project-specific demand evidence exists (no ticket/analytics system for this internal tool; the Claude Design project itself was auth-gated, HTTP 403), and the cost/velocity business case rests only on general-industry design-system ROI benchmarks. |

Rationale traces to `evidence_sources`, not the score alone: current-state baseline independently re-verified in-repo (723-line `index.css`, 143 `className` sites across 22 files, 5 feature areas, 3 shared components); analogous ROI benchmarks (Sparkbox, Figma, Atlassian, Smashing Magazine 2022) treated as directional/low-specificity.

## 2. Review flags

None.

- ±10% of cut line — suppressed (no `--cut-line` supplied).
- strategic_alignment ≥ 4 at low rank — N/A (strategic 5, but rank 1, not buried).
- risk = 5 — N/A (risk = 1).
- date_scored > 90 days — N/A (scored today, 2026-07-07).

## 3. BLOCKED list (awaiting briefs)

None. F-001 had a resolvable brief (`briefs/F-001-adhere-to-design-system.md`).

## 4. HUMAN-GATE leftovers (missing human-owned scores)

None. F-001 had all three human-owned fields present before ranking: strategic_alignment = 5, effort = 1, risk = 1.

## 5. STALE list (previously prioritized, > 90 days)

None.

## 6. Contract violations (rejected agent writes)

None. The market-research agent (RESEARCH role) touched only permitted fields (reach, user_value, business_value, time_sensitivity, confidence, evidence_sources, rationale_notes, scored_by, date_scored, status); left strategic_alignment, effort, risk, and all formula columns untouched; supplied non-empty evidence_sources; all scores integers 1–5.

## 7. Human-vs-agent scoring decision (F-001)

The workbook arrived with a **Human** scoring already entered (scored_by = Human, dated today; user_value 3, business_value 5, time_sensitivity 2, confidence 5 → priority 84.0) while status was still `Brief Drafted` and the row was routed to the research agent by `/prioritize-features`. The agent scored independently and much lower (priority ~46.2), driven mainly by confidence (5 → 2) and a more conservative value read.

The divergence was surfaced to the user rather than silently overwritten. **User decision: use the research-agent scores.** The Human scores were replaced; the agent's rationale is preserved in the row's `rationale_notes`. This report records the Human read as the dissenting prior for provenance: Human priority 84.0 vs. accepted (agent) priority 46.2.

## Config used

- Weights: reach 0.20, user_value 0.25, business_value 0.25, strategic_alignment 0.20, time_sensitivity 0.10 (sum = 1.00; `Config!B9` = OK).
- Confidence map: 1→0.50, 2→0.65, 3→0.80, 4→0.90, 5→1.00.
- Risk map: 1→1.00, 2→0.90, 3→0.80, 4→0.70, 5→0.60.
- Cut line: none. Dry-run: no.
- Pre-mutation snapshot: `.prioritization-runs/2026-07-07T07-35-57Z/input.xlsx`
- Post-run snapshot: `.prioritization-runs/2026-07-07T07-35-57Z/output.xlsx`

## Notes / deviations

- Environment has no `openpyxl`/`recalc.py`; workbook edits were applied via direct OOXML splicing, formula caches recomputed by hand (weighted 3.55, conf-mult 0.65, risk-factor 1.00, priority 46.2), and `fullCalcOnLoad="1"` set so Excel re-verifies every formula on open.
- This project's agent roster has no dedicated `market-research agent`; a general-purpose agent was briefed with the RESEARCH-role contract as the stand-in. Phase 5 ranking (single deterministic, unflagged row) was applied inline under the PRIORITIZE-role rules rather than dispatching an agent to sort one item.
