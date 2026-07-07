# Prioritization Run — 2026-07-07T08-20-12Z

Workbook: `feature-value-scoring.xlsx` · Mode: live (not a dry run) · Cut line: none supplied

## 1. Ranked list

| Rank | Feature | Priority | Weighted | Conf× | Risk× | Effort | Status | One-line rationale |
|---|---|---|---|---|---|---|---|---|
| 1 | F-001 — Adhere to a Design System | 46.2 | 3.55 | 0.65 | 1.00 | 1 | Prioritized *(prior run)* | Carried from the previous run; not re-scored (scored 2026-07-07, not stale). |
| 2 | F-002 — Set a customer specific system prompt | **17.3** | 2.95 | 0.65 | 0.90 | 2 | **Prioritized** *(strategic override)* | Newly scored this run. Priority deeply discounted: confidence 0.65 (no direct demand evidence for this internal tool — value case rests on analogous prompt-governance market benchmarks + a verified single-prompt-field enforcement gap), risk factor 0.90, effort ÷2. strategic_alignment 4 conflicts with the low rank — see flag. |

Rationale traces to `evidence_sources`, not the score alone: F-002's three internal leads (per-workspace textarea in `WorkspaceSettings.tsx`; single-field `systemPrompt→openAiPrompt` map with no native layering in `mappers.ts`; session-auth-only native default-prompt boundary in `anythingllm-surface.md`) were independently re-verified in-repo; external evidence (Technavio/Gartner prompt-governance market sizing) is directional/analogous only; no ticket/CRM/analytics demand signal was accessible.

## 2. Review flags

**Strategic bet buried by the model — F-002** (`strategic_alignment` ≥ 4 at low rank).
- F-002 has `strategic_alignment = 4` (directly advances a strategic pillar) but sits at the bottom of the ranking (priority 17.3), because confidence + risk discounts and the effort divisor suppress its computed score.
- **Question for the human:** Do you want to **Prioritize** F-002 on strategic grounds despite the low computed score, **Defer** it, or **Reject** it?
- **RESOLVED (2026-07-07):** Human chose **Prioritize (strategic override)** — status set to `Prioritized` despite the low computed rank, on the strength of `strategic_alignment = 4`. Recorded here as the rationale for the manual override of the model's ordering.

Other flag types — none:
- ±10% of cut line — suppressed (no `--cut-line` supplied).
- risk = 5 — N/A (F-002 risk = 2).
- date_scored > 90 days — N/A (scored today).

## 3. BLOCKED list (awaiting briefs)

- **F-003 — Set a workspace level system prompt** (status Idea, no brief). Run `/write-feature-brief F-003`.

## 4. HUMAN-GATE leftovers (missing human-owned scores)

None remaining. F-002 was human-gated mid-run (missing strategic_alignment, effort, risk); the user supplied strategic_alignment = 4, effort = 2, risk = 2, which unblocked ranking.

## 5. STALE list (previously prioritized, > 90 days)

None. F-001 was prioritized today.

## 6. Contract violations (rejected agent writes)

None. The market-research agent (RESEARCH role) touched only permitted fields; left strategic_alignment, effort, risk, and formula columns untouched; supplied non-empty evidence_sources; all scores integers 1–5.

## Config used

- Weights: reach 0.20, user_value 0.25, business_value 0.25, strategic_alignment 0.20, time_sensitivity 0.10 (sum = 1.00; `Config!B9` = OK).
- Confidence map: 1→0.50, 2→0.65, 3→0.80, 4→0.90, 5→1.00.
- Risk map: 1→1.00, 2→0.90, 3→0.80, 4→0.70, 5→0.60.
- Cut line: none. Dry-run: no.
- Pre-mutation snapshot: `.prioritization-runs/2026-07-07T08-20-12Z/input.xlsx`
- Post-run snapshot: `.prioritization-runs/2026-07-07T08-20-12Z/output.xlsx`

## Notes / deviations

- **Workbook integrity fix:** the manually-inserted rows 5 (F-002) and 6 (F-003) were missing the Q–U template formulas (a row-insert artifact — without them, priority never computes). Restored standalone Q–U formulas on both rows during the F-002 write; Excel recomputed them correctly on open (F-002 → 17.3). Any future manually-added rows should have the formulas copied down from an existing row.
- Environment has no `openpyxl`/`recalc.py`; edits applied via direct OOXML splicing with `fullCalcOnLoad="1"` set so Excel re-verifies every formula on open. The human-owned scores were entered by the user directly in Excel.
- No dedicated `market-research`/`prioritization` agents in this project's roster; a general-purpose agent served the RESEARCH role (F-002 scored independently of its brief author), and the single-row ranking was applied inline under the PRIORITIZE-role rules.
