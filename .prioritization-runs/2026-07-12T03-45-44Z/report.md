# Prioritization Run — 2026-07-12T03:45:44Z

Config: weights (Reach 0.20, User Value 0.25, Business Value 0.25, Strategic Alignment 0.20,
Time Sensitivity 0.10), weight check = OK. No `--cut-line` supplied (±10% flag suppressed).
Dry-run: no. Snapshot: `.prioritization-runs/2026-07-12T03-45-44Z/input.xlsx`.

## Data integrity fix (pre-pipeline)

Row `B-001` did not conform to schema: `feature_id` didn't match the `F-###`/`D-###` pattern,
`item_type` was blank (defaulting to Feature) despite being an unambiguous UI defect, and it
had been marked `Scored` directly by a human without `confidence`/`evidence_sources`. Corrected
in collaboration with the user before scoring: renamed to `D-001`, `item_type=Defect`,
`defect_source=Internal`, `severity=2` (Minor), `status` rolled back to `Triaged` so it could
properly enter the RESEARCH queue.

## Ranked list (Feature + Defect, shared ranking)

| Rank | ID | Type | Priority Score | Status | Rationale |
|---|---|---|---|---|---|
| 1 | F-001 | Feature | 46.2 | Prioritized | Full strategic alignment (5) + minimal risk (1) — anchor initiative for a consistent design system. |
| 2 | D-001 | Defect | 29.7 | **Prioritized (this run)** | Shared-token collision hides input fields except on focus in dark theme, reproduces across every LLM provider panel (reach=4), diagnosed with high confidence (4) via direct code trace, low fix risk (1). |
| 3 | F-003 | Feature | 20.5 | Prioritized | Full strategic alignment (5), low risk (1) — workspace-level system prompt, broader scope than its customer-specific counterpart. |
| 4 | F-002 | Feature | 17.3 | Prioritized | Strong alignment (4), marginally elevated risk (2) — narrower-scope customer-specific system prompt. |
| 5 | F-004 | Feature | 10.0 | Prioritized | Full strategic alignment (5) but highest risk of the set (3) — production event bus, larger unknowns pull it to the bottom. |

Excluded from ranking this run (per user's explicit choice, "rank only complete rows"):

- **F-005** (Per-Customer Feature Toggle Console) — Scored on reach/user_value/business_value/
  time_sensitivity/confidence, but missing `strategic_alignment`, `effort`, `risk` (human-owned).
  priority_score cannot compute until these are filled.

## Review flags

- **Strategic alignment ≥ 4 with low rank (Feature only):** F-002 (sa=4, rank=4), F-004 (sa=5,
  rank=5) — both carry high/full strategic alignment but rank near the bottom. Question for the
  human: is this ordering intentional given the effort/risk tradeoffs, or should strategic
  alignment carry more weight for these two?
- Cut-line ±10%: suppressed (no cut line provided).
- Risk = 5: none this run.
- Severity = 5 (Defect): none this run (D-001 is severity 2).
- Stale (`date_scored` > 90 days): none this run.

## Blocked list

- Feature rows awaiting a brief: none.
- Defect rows awaiting triage: none.

## Human-gate leftovers

- **F-005** — missing `strategic_alignment`, `effort`, `risk`. Run `/prioritize-features` again
  once these are filled to bring it into the ranked list.

## Stale list

None.

## In-flight count

Defect rows in `In Progress | Fixed | Verified` (out of this command's scope, owned by
`/fix-defect-or-bug`): 0.

## Contract violations

None — both RESEARCH-role agent writes (F-005, D-001) stayed within their permitted field
sets, cited evidence, and used integer 1–5 scores.
