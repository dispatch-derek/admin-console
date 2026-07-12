# Prioritization Run — 2026-07-12T07:43:23Z

Workbook: `feature-value-scoring.xlsx` · Cut line: none provided (±10% flag suppressed) · Dry run: no
Snapshot (pre-mutation): `.prioritization-runs/2026-07-12T07-43-23Z/input.xlsx`

## 1. Ranked list (Feature + Defect, shared rank)

| Rank | ID | Type | Score | Status (post-run) | Rationale |
|---|---|---|---|---|---|
| 1 | F-001 | Feature | 46.2 | Prioritized | Verified in-repo CSS/component footprint (723-line index.css, 30 custom properties, 143 className usages/22 files) plus cross-industry design-system ROI benchmarks (Sparkbox, Figma, Atlassian). Low effort/risk lets a modest-value, well-evidenced item top the list; no project-specific demand signal exists (no ticket/analytics system for this internal tool). |
| 2 | D-001 | Defect | 29.7 | Prioritized | Fast-tracked on a code-confirmed mechanism (identical dark-theme hex tokens across bg-primary/bg-container/settings-input-bg, borderless shared Field control) affecting ~30+ provider panels uniformly in the default theme; tempered by a single open, unconfirmed GitHub issue as the only external corroboration. |
| 3 | F-005 | Feature | 21.1 | **Prioritized (this run)** | Analogous market data (Statsig/Chargebee/Salable: ~38% higher YoY growth, ~10pt higher NDR for usage-gated pricing, 1–3% industry revenue leakage from ungated features) plus a named October GTM blocking dependency. Discounted because the brief concedes reach/user_value/time_sensitivity rest on internal narrative only — product hasn't shipped, no usage/ticket evidence yet. |
| 4 | F-003 | Feature | 20.5 | Prioritized | Verified in-repo single-field engine model (no baseline/sentinel layering); top strategic_alignment (10) and low risk (2), but no support/CRM/analytics demand signal, and explicitly spec-dependent on F-002's baseline model. |
| 5 | F-002 | Feature | 17.3 | Prioritized | Same in-repo verification (WorkspaceSettings.tsx, single-field mapper) plus analogous market growth data (Technavio, Gartner AI-governance spend); higher effort/risk than sibling F-003 pulls it lower despite no direct demand evidence for either. |
| 6 | F-004 | Feature | 10.0 | Prioritized | Verified in-repo that OutboxRelayBus is an enqueue-only stub with zero drain-worker callers and zero subscribers; design docs flag the relay as deferred/open. High effort (8) divides down an otherwise high-value, max-alignment item. |

Only **F-005** changed status this run (`Scored` → `Prioritized`). F-001–F-004 and D-001 were already `Prioritized` from prior runs and were left untouched (all `date_scored` within 90 days).

## 2. Review flags

**Strategic-alignment flag** (`strategic_alignment` ≥ 8 with low rank, Feature rows only) — triggered for three already-prioritized rows, all in the bottom half of the list despite top-tier alignment:

- **F-004** (alignment=10, rank 6): Buried by effort=8 despite the strongest verified technical case (stub eventbus, zero subscribers) and max alignment. *Question:* Is this a strategic infra bet worth funding ahead of its score, or does "deferred/open" in the design docs confirm it's correctly ranked last?
- **F-003** (alignment=10, rank 4): Full alignment, low risk (2), but sequenced behind/dependent on F-002. *Question:* Should F-003/F-002 be evaluated as a bundled, sequenced bet rather than two independently ranked items?
- **F-002** (alignment=8, rank 5): Weakest of the three (alignment=8 vs 10) but still qualifies. *Question:* Same bundling question as F-003.

No other flag types triggered:
- Funding cut line — suppressed (none provided this run).
- `risk` ≥ 9 — none; highest is F-004 at risk=6.
- `severity` = 5 (Defect only) — D-001 is the only Defect row, severity=2.
- `date_scored` > 90 days — all rows scored 2026-07-07 to 2026-07-11, well within window.

**F-005 signoff-block check:** risk=1 (well under 9), item_type=Feature (severity rule N/A), strategic_alignment=5 (under 8, so the alignment flag above doesn't apply to it either), date_scored 1 day old. None of the flag conditions apply, so F-005 was eligible for an auto-decided status rather than pending-signoff — recommended and applied: **Prioritized**.

## 3. BLOCKED list

None. No Feature rows in `Idea`/missing-brief state; no Defect rows in `Reported` state.

## 4. HUMAN-GATE leftovers

None. F-005 (the only `Scored` row) already had all three human-owned Feature fields (`strategic_alignment=5`, `effort=5`, `risk=1`) filled in before this run.

## 5. STALE list

None. All 6 rows' `date_scored` fall within 2026-07-07 to 2026-07-11 — none exceed the 90-day staleness threshold.

## 6. IN-FLIGHT count

0 Defect rows in `In Progress | Fixed | Verified` (out of this command's scope, owned by `/fix-defect-or-bug`).

## 7. Contract violations

None. Phase 3 research queue was empty (no rows in `Brief Drafted`/`Triaged` status), so no agent writes were made or rejected this run.

## 8. Config used

- Weights (Config!B4:B8): Reach 0.20, User Value 0.25, Business Value 0.25, Strategic Alignment 0.20, Time Sensitivity 0.10 — sum check `Config!B9` = **OK**
- Confidence map (A12:B21) and Risk map (D12:E21): read from Config, unchanged
- Defect severity→base map (G12:H16) and defect reach→multiplier map (I12:J21): read from Config, unchanged
- Cut line: none provided
- Dry run: no (workbook mutated)
- Snapshot: `.prioritization-runs/2026-07-12T07-43-23Z/input.xlsx`
