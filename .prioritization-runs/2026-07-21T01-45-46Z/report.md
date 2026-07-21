# Prioritization run — admin-console — 2026-07-20

Two rows scored (F-012, F-013), both first-time scores. Both recommended and set to `Deferred`.

## 1. Ranked list (Features + Defects, one list)

| rank | score | id | type | status | note |
|---|---|---|---|---|---|
| 1 | 85.0 | D-003 | Defect | Prioritized | context |
| 2 | 46.2 | F-001 | Feature | Prioritized | context |
| 3 | 36.4 | F-007 | Feature | Prioritized | context |
| 4 | 31.3 | F-010 | Feature | Prioritized | context — F-013 depends on this |
| 5 | 29.7 | D-001 | Defect | Prioritized | context |
| 6 | 24.2 | D-002 | Defect | Prioritized | context |
| 7 | 22.1 | F-008 | Feature | Prioritized | context |
| 8 | 21.4 | D-006 | Defect | Prioritized | context |
| 9 | 21.1 | F-005 | Feature | Implemented | out of scope |
| 10 | 20.5 | F-003 | Feature | Prioritized | context |
| 11 | 17.3 | F-002 | Feature | Prioritized | context |
| 12 | 12.9 | F-006 | Feature | Prioritized | context |
| 13 | 10.0 | F-004 | Feature | Implemented | out of scope |
| 14 | 9.9 | F-009 | Feature | Prioritized | context |
| 15 | 9.5 | F-011 | Feature | Deferred | context |
| 16 | 8.0 | D-004 | Defect | Prioritized | context |
| **17** | **7.7** | **F-012** | Feature | **Deferred** | **scored this run** |
| 18 | 7.5 | D-005 | Defect | Prioritized | context |
| **19** | **6.0** | **F-013** | Feature | **Deferred** | **scored this run** |

### F-012 — 7.7, rank 17 → Deferred
reach 5 / user_value 4 / business_value 3 / time_sensitivity 2 / confidence 3 (agent);
strategic_alignment 6 / effort 5 / risk 6 (human).

The brief's load-bearing claim ("admins are blocked") was falsified during drafting — the
engine's own `react-dropzone` upload UI (`UploadFile/index.jsx:6,78`) already lets admins
ingest documents. Research then verified that channel **also** supports deletion
(`Directory/index.jsx:53-89`), drag-drop, and progress — all excluded from F-012's scope
(OQ8: create-only, no undo). The proposal is **strictly less capable than the channel it
replaces**. What remains is an unverified consolidation-cost argument (OQ6) with no timing
driver.

### F-013 — 6.0, rank 19 → Deferred
reach 4 / user_value 4 / business_value 3 / time_sensitivity 2 / confidence 3 (agent);
strategic_alignment 7 / effort 6 / risk 7 (human).

Two of three business claims took hits at scoring time. Claim 1 ("notices sit outside the
audit discipline entirely") is **partially falsified** — cwa's `notice.create` /
`notice.retire` writes are already audited, narrowing this to audit-*locus*. Claim 2's own
named falsifier — that both apps' admin populations are the same person — is reported as
**likely true** (~1 usable console operator per deployment per F-009; cwa admins populated
by admin-console emission), which is exactly the condition the brief says would make
consolidation "weaken sharply." Compounded by the unresolved F-010 build-order dependency
(OQ7) and a risk=7 surface with no delivery-visibility signal (OQ9).

## 2. Review flags

**None fired.** All four checked explicitly against both rows:

- `strategic_alignment >= 8` at low rank: no (F-012 SA=6, F-013 SA=7).
- `risk >= 9`: no (F-012 risk=6, F-013 risk=7). Neither needs sign-off gating.
- `severity = 5`: N/A — both rows under decision are Features.
- `date_scored > 90 days`: no — both scored today.

Advisory (not a flag): F-013's SA=7 sits one point under the threshold while ranking 19th.
Worth a human glance if the governance framing is weighted more heavily than the raw score.

## 3. BLOCKED list

None. No `Idea` Feature rows, no `Reported` Defect rows.

## 4. HUMAN-GATE leftovers

None remaining. Both rows paused at Phase 4 missing `strategic_alignment`/`effort`/`risk`;
the human supplied F-012 6/5/6 and F-013 7/6/7 and the run resumed.

## 5. STALE list

None. Oldest `date_scored` is 13 days (F-001/F-002/F-003); threshold is 90.

## 6. IN-FLIGHT & CANCELLED counts

- In Progress / Implemented / Fixed / Verified: **2** (F-004, F-005) — out of scope.
- Cancelled: **0**.

## 7. Contract violations

**None.** Both research dispatches proposed only permitted fields and left
`strategic_alignment`, `effort`, `risk` and all formula columns untouched.

One agent claim was checked and **rejected** by the calling command before any write: the
F-012 research agent flagged the workbook `feature_name` for row 21 as stale ("…for
customer-web-app"). It is not — the row was retitled at registration. The agent was reading
the brief's note about the *former* title.

## 8. Findings the run produced beyond scoring

- **`catalog.ts` declares 21 `admin.*` event types, not 22.** F-013's brief says 22.
  Off-by-one; brief-maintenance item.
- **cwa's local notice writes are already audited** (`appstate.routes.ts:76,88` —
  `ctx.audit({action:'notice.create'})` / `'notice.retire'`). Verified. F-013's Business
  Rationale claim 1 overstates the gap and should be corrected to audit-locus.
- **F-013's OQ4 is partially answerable in-repo**, contrary to the brief's claim that it is
  not. Two identity planes exist (console `staff` vs engine-projected cwa users), but cwa
  admin users are populated by admin-console emission, and F-009 establishes ~1 usable
  console operator per deployment.

## 9. Config used

- Weights: Reach 0.20, User Value 0.25, Business Value 0.25, Strategic Alignment 0.20,
  Time Sensitivity 0.10. `Config!B9` = OK.
- Confidence map: 1:0.45 2:0.50 3:0.58 4:0.65 5:0.73 6:0.80 7:0.85 8:0.90 9:0.95 10:1.00
- Risk map: 1:1.00 2:1.00 3:0.95 4:0.90 5:0.85 6:0.80 7:0.75 8:0.70 9:0.65 10:0.60
- Cut line: none. Dry run: no.
- Snapshot: `.prioritization-runs/2026-07-21T01-45-46Z/input.xlsx`
