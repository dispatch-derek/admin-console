# Prioritization run — 2026-07-19 (evening, F-006)

Command: /prioritize-features (no cut line, no --dry-run)
Snapshot: .prioritization-runs/2026-07-19T21-52-43/input.xlsx

## 1. Ranked list (post-run)

| rank | score | id | type | status | note |
|---|---|---|---|---|---|
| 1 | 85.0 | D-003 | Defect | Prioritized | pre-existing |
| 2 | 46.2 | F-001 | Feature | Prioritized | pre-existing |
| 3 | 36.4 | F-007 | Feature | Prioritized | pre-existing (PM run) |
| 4 | 29.7 | D-001 | Defect | Prioritized | pre-existing |
| 5 | 24.2 | D-002 | Defect | Prioritized | pre-existing |
| 6 | 22.1 | F-008 | Feature | Prioritized | pre-existing (PM run) |
| 7 | 21.4 | D-006 | Defect | Prioritized | pre-existing |
| 8 | 21.1 | F-005 | Feature | Implemented | out of scope |
| 9 | 20.5 | F-003 | Feature | Prioritized | pre-existing |
| 10 | 17.3 | F-002 | Feature | Prioritized | pre-existing |
| 11 | 12.4 | F-006 | Feature | **Deferred (this run)** | see rationale below |
| 12 | 10.0 | F-004 | Feature | Implemented | out of scope |
| 13 | 9.9 | F-009 | Feature | Prioritized | pre-existing |
| 14 | 8.0 | D-004 | Defect | Prioritized | pre-existing |
| 15 | 7.5 | D-005 | Defect | Prioritized | pre-existing |

## 2. F-006 outcome

Research scores (Market Research Agent, 2026-07-19): reach 6, user_value 7,
business_value 5, time_sensitivity 4, confidence 5. Human gate (product owner):
strategic_alignment 7, effort 6, risk 5. Computed: weighted_value 6.0 →
priority_score 12.4, rank 11.

Prioritizer recommendation, applied: **Deferred**. Rationale (evidence-cited):
the gap is real and code-proven (only diagnostics surface shows 2 instance-wide
facts; zero telemetry deps; ChatOversight parses zero metric fields), justifying
user_value 7 — but business_value is capped with billing excluded and a fleet of
<5 appliances, time_sensitivity is GTM-coupled but undated, and confidence is
limited by the unresolved metric-capture architecture (engine event_logs
unreachable via BFF API key; Ollama's per-request fields visible only to the
engine). A proven-but-narrow, undated, feasibility-open item lands in the bottom
third — a sequencing signal, not a mis-score.

Revisit triggers named by the prioritizer: (a) a GTM launch date lands
(time_sensitivity re-scores upward), (b) the metric-capture point gets resolved —
possibly informed by F-008's spec-stage architecture work on the same local-first
data/storage surface, (c) fleet growth changes the business_value denominator.
Reversing the deferral is a human edit to the row.

## 3. Review flags

None fired (risk 5, SA 7, fresh scores, Feature row). One non-formal note: check
during F-008 spec work whether its capture/storage decisions resolve or
complicate F-006's capture-point question — sequence F-006 explicitly behind it
if so.

## 4. BLOCKED / HUMAN-GATE / STALE

All empty. Every workbook row is now in a valid, post-triage state.

## 5. IN-FLIGHT & CANCELLED

Implemented (out of scope): 2 (F-004, F-005). Cancelled: 0.

## 6. Contract violations

None. The research report touched only permitted fields. It corrected one brief
detail: the admin event catalog holds 21 event names, not 20 (substance holds).

## Config used

Weights .20/.25/.25/.20/.10 (B9 OK); confidence map 1→0.45…10→1.00; risk map
1→1.00…10→0.60. Cut line none; dry-run no. Research: market-research-agent ×1
(accepted). Ranking: feature-prioritizer (recommendation applied; no flags).

## Post-run resolution — F-006 (2026-07-19, product owner)

Brief revised with PO revenue-via-reporting ruling (PR #28). Targeted agent
re-score: business_value 5 → 6 (Hybrid; anchor-6 retention/revenue class;
confidence unchanged at 5 — no customer evidence yet). Score 12.9, rank 11.
Status: Deferred → **Prioritized by product-owner override** (PR #29-range);
sequencing caveats (capture point unresolved, GTM undated) remain recorded in
rationale_notes and stand as spec-stage inputs.
