# Prioritization run — 2026-07-15T23-42-55Z  (--dry-run)

**Workbook:** ./feature-value-scoring.xlsx · **Mode:** DRY-RUN (no writes, no snapshot) · **Cut line:** none

## Result: no scoring or ranking work queued
The RESEARCH queue and the Scored set are both empty — the prior run advanced the two
outstanding defects (D-003, D-004) to Prioritized. Phases 3–6 had nothing to do, so no
subagent was dispatched. The three pipeline agents are now registered and resolvable
(market-research-agent, feature-prioritizer, feature-brief-writer).

## 1. Ranked list
No rows scored/ranked this run. Current Prioritized backlog (from prior runs, unchanged):
D-003 (85, rank 1) · F-001 (46.2) · D-001 (29.7) · D-002 (24.2) · F-003 (20.5) ·
F-002 (17.3) · F-004 (10) · D-004 (8).

## 2. Review flags
None (no rows scored this run; no stale rows; no cut line).

## 3. Blocked
- **F-007** (Feature, Idea) → `/write-feature-brief F-007`
- **F-008** (Feature, Idea) → `/write-feature-brief F-008`
- **D-005** (Defect, Reported) → triage on the row (set reach/confidence → Triaged)

## 3a. Data-integrity anomaly (needs human correction; not scored)
- **F-006** — `F-###` id but `item_type=Defect`, `status=Idea` (invalid for a Defect),
  `severity=2` set. Reconcile item_type/id before it can enter any pipeline.

## 4. Human-gate leftovers
None.

## 5. Stale (>90d)
None. Oldest date_scored 2026-07-07 (8 days).

## 6. In-flight & cancelled (counts)
In-flight/post-impl: 1 (F-005 Implemented). In Progress/Fixed/Verified: 0. Cancelled: 0.

## 7. Contract violations
None (no dispatch this run).

## 8. Config used
Weights 0.20/0.25/0.25/0.20/0.10 → gate OK. Cut line: none. Dry-run: yes (snapshot skipped).
