# Prioritization run — 2026-07-19

Command: /prioritize-features (no cut line, no --dry-run)
Snapshot: .prioritization-runs/2026-07-19T18-30-41/input.xlsx

## 1. Ranked list (Feature + Defect, shared ranking, post-run)

| rank | score | id | type | status | rationale (evidence-cited) |
|---|---|---|---|---|---|
| 1 | 85.0 | D-003 | Defect | Prioritized | pre-existing; chat-history JSON leak, GH #9 |
| 2 | 46.2 | F-001 | Feature | Prioritized | pre-existing; design-system adherence |
| 3 | 29.7 | D-001 | Defect | Prioritized | pre-existing; LLM-settings panel contrast, GH #5 |
| 4 | 24.2 | D-002 | Defect | Prioritized | pre-existing; WCAG AA secondary-text contrast, GH #7 |
| 5 | 21.1 | F-005 | Feature | Implemented | out of scope (post-implementation) |
| 6 | 20.5 | F-003 | Feature | Prioritized | pre-existing; workspace system prompt |
| 7 | 17.3 | F-002 | Feature | Prioritized | pre-existing; customer system prompt |
| 8 | 10.0 | F-004 | Feature | Implemented | out of scope (post-implementation) |
| 9 | 8.0 | D-004 | Defect | Prioritized | pre-existing; sidebar scrollbar visibility |
| 10 | 7.5 | D-005 | Defect | **Prioritized (this run)** | dead code envDump: 0 runtime callers by exhaustive grep (adapter.ts:57, :242-245), 11 stale mock refs across 9 test files, fix already landed at settings.service.ts:341; reach=1, confidence=10 — low placement is the model working as designed |
| 11 | 7.0 | F-009 | Feature | **Scored — held, flagged** | console-created admins can't log in (auth.routes.ts:133 staff-only login; user.service.ts:101-135 engine-only create; single bootstrap account); firsthand operator report + product-owner ASAP/GTM ruling argue urgency, but human-set risk=10 (risk_factor 0.6) and effort=7 divide priority to 7.0 |

## 2. Review flags

**risk ≥ 9 — F-009 (risk=10, human-set).** Never auto-Prioritized. Questions for the human:
(a) Is risk=10 ("one-way door") the intended encoding — what specifically is irreversible
(auth/credential model? lifecycle coupling?), and could staging/de-risking lower it?
(b) If risk=10 stands, do you accept a GTM-blocker (time_sensitivity=9, ASAP ruling)
sitting at rank 11 — behind a dead-code cleanup — until the risk is retired, or do you
Prioritize it by fiat / re-scope to reduce risk first?

**Prioritizer's model-behavior note (verbatim thread):** the "cheap safe item outranks a
strategic/urgent bet" pattern is visibly at play — F-009 carries the strongest urgency
signal in scope yet lands last purely on risk×effort discounting. strategic_alignment=7
sits just under the ≥8 auto-flag, so only the risk flag surfaces it; both threads should
be weighed together at sign-off.

- strategic_alignment ≥ 8 at low rank: none fired (F-009 is 7)
- severity = 5: none in scope
- date_scored > 90 days: none
- cut-line ±10%: suppressed (no cut line)

## 3. BLOCKED

Features awaiting briefs (run `/write-feature-brief <id>`):
- F-007 — i18n / number-format support (Idea, no brief)
- F-008 — scheduled system-wide backups (Idea, no brief)

Defects awaiting triage (direct row edit: set severity, confirm defect_source, → Triaged):
- D-006 — event relay peer auth/TLS hardening (Reported; GH #16; severity unset)

## 4. HUMAN-GATE leftovers

- F-009 — human fields now filled (SA=7, effort=7, risk=10); held at `Scored` solely by
  the risk ≥ 9 sign-off flag above.

## 5. STALE

None (all scored rows dated 2026-07-07 … 2026-07-19; 90-day threshold).

## 6. IN-FLIGHT & CANCELLED

- In/post-implementation, out of scope: 2 (F-004, F-005 — Implemented)
- Cancelled: 0

## 7. Contract violations

None. Both research reports touched only permitted fields; all writes applied verbatim.

## 8. Data-quality note (not repaired, per scope)

- **F-006** has an F-### id with `item_type=Defect`, `status=Idea`, `severity=2`,
  `strategic_alignment=5` — an invalid combination for either item type. Needs a human
  edit: either it is a Feature (fix item_type, clear severity/defect_source, then
  `/write-feature-brief F-006`) or it is a Defect (re-id as D-###, status=Reported per the
  LOG role). Left untouched.

## Config used

- Weights B4:B8 = reach .20, user_value .25, business_value .25, strategic .20, time .10 (B9 OK)
- Confidence map 1→0.45 … 10→1.00; risk map 1→1.00 … 10→0.60
- Severity base 1→10, 2→30, 3→55, 4→80, 5→100; reach factor 1→0.75 … 10→1.20
- Cut line: none; dry-run: no
- Research scoring: market-research-agent (2 dispatches, both accepted)
- Ranking: feature-prioritizer (advisory; recommendations applied for unflagged rows only)

## Post-run flag resolution (2026-07-19, product owner)

F-009 risk ≥ 9 flag resolved: risk revised 10 → 5 ("moderate unknowns", reversible).
Status applied: Scored → Prioritized. New priority_score 9.9, rank 9 (above D-004 8.0
and D-005 7.5). Merged to main via PR #22.

## Post-run addendum — D-006 (2026-07-19, incremental pass)

Human triage: severity 2, defect_source Internal → Triaged. Research scoring:
reach 1 (transport inactive in known deployment — EVENT_BUS_MODE=inproc),
confidence 9 (statically confirmed + security review F2). Fast-track score
21.4, rank 5. Status → Prioritized (PR #23). Prioritizer caveat: risk
acceptance holds only while EVENT_BUS_MODE stays inproc; flipping to bus mode
before HMAC/mTLS hardening ships should reopen the decision.
