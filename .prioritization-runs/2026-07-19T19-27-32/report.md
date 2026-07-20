# Prioritization run — 2026-07-19 (PM)

Command: /prioritize-features (no cut line, no --dry-run)
Snapshot: .prioritization-runs/2026-07-19T19-27-32/input.xlsx

## 1. Ranked list (Feature + Defect, shared ranking, post-run)

| rank | score | id | type | status | rationale (evidence-cited) |
|---|---|---|---|---|---|
| 1 | 85.0 | D-003 | Defect | Prioritized | pre-existing; chat-history JSON leak, GH #9 |
| 2 | 46.2 | F-001 | Feature | Prioritized | pre-existing; design-system adherence |
| 3 | 36.4 | F-007 | Feature | **Prioritized (this run)** | zero i18n infra confirmed (no deps; 56 inline JSX strings/21 files; zero Intl handling/111 files) vs upstream shipping ~26 locales; cheap low-downside bet (effort 2, risk 2, human-confirmed) — recommended on cost/risk profile, NOT on demand signal (thin by construction; see flag) |
| 4 | 29.7 | D-001 | Defect | Prioritized | pre-existing; LLM-settings panel contrast, GH #5 |
| 5 | 24.2 | D-002 | Defect | Prioritized | pre-existing; WCAG AA secondary-text contrast, GH #7 |
| 6 | 22.1 | F-008 | Feature | **Prioritized (this run)** | total code-confirmed backup-capability gap across all 3 apps + Ollama (zero backup/restore code in both repos; Ollama over-the-wire only); sa=10 + near-universal latent exposure (reach 8) vs effort 4 / risk 7 discounting to rank 6 (see flag) |
| 7 | 21.4 | D-006 | Defect | Prioritized | pre-existing this date; relay peer auth/TLS, GH #16 |
| 8 | 21.1 | F-005 | Feature | Implemented | out of scope |
| 9 | 20.5 | F-003 | Feature | Prioritized | pre-existing; workspace system prompt |
| 10 | 17.3 | F-002 | Feature | Prioritized | pre-existing; customer system prompt |
| 11 | 10.0 | F-004 | Feature | Implemented | out of scope |
| 12 | 9.9 | F-009 | Feature | Prioritized | console admin login (risk sign-off resolved AM run) |
| 13 | 8.0 | D-004 | Defect | Prioritized | pre-existing; sidebar scrollbar |
| 14 | 7.5 | D-005 | Defect | Prioritized | dead-code envDump cleanup |

## 2. Review flags (advisory, non-blocking — statuses applied)

**strategic_alignment ≥ 8 at low rank — F-008 (sa=10, rank 6).** effort=4 (÷4) and
risk=7 (×0.75) discount a weighted_value of 7.35 down to 22.1. Question: fast-track
this DR capability ahead of raw rank given the total capability gap, or let the
risk=7 discount hold it back until the Apple Business Manager / iCloud scoping
(open PO investigation) lands and risk can be re-assessed?

**Low-evidence-high-rank (non-canonical, raised on request) — F-007 (rank 3,
confidence 4, reach 2).** Outranks well-evidenced defects D-001/D-002 purely on the
effort=2 divisor. Prioritizer's read: model working as designed (documented
"cheap safe items outrank strategic bets" behavior), and the demand evidence is
thin by construction — no ticketing channel exists that could surface fork demand.
Question: is there an actual dated GTM/market-entry commitment behind
business_value=8, or a hypothetical market? If a date exists the row is
under-scored; if not, sanity-check spec/build spend before implementation. The
scorer's dissent: a dated market-entry commitment should trigger a reach re-score
upward.

- risk ≥ 9: none (F-008 risk=7 is the highest in scope)
- severity = 5: n/a (both scoped rows are Features)
- date_scored > 90 days: none
- cut-line ±10%: suppressed (no cut line)

## 3. BLOCKED

- None awaiting briefs (F-007/F-008 brief gap closed this date).
- No Defects awaiting triage.

## 4. HUMAN-GATE

Paused mid-run: pre-existing SA/effort/risk on both rows predated their briefs
(F-007 held placeholder-looking 1/1/1 which would have scored 57.2/rank 2).
Product owner confirmed at gate (2026-07-19): F-007 sa=7 effort=2 risk=2;
F-008 sa=10 effort=4 risk=7. No leftovers.

## 5. STALE

None (all scored rows dated 2026-07-07 … 2026-07-19).

## 6. IN-FLIGHT & CANCELLED

- Implemented (out of scope): 2 (F-004, F-005)
- Cancelled: 0

## 7. Contract violations

None. Both research reports touched only permitted fields. Note: the F-008
research pass corrected a brief claim — manual-backup preconditions exist in TWO
runbooks (F-004, F-005), not three; the F-002 runbook has none. Brief text not
modified (out of this command's scope).

## 8. Data-quality note (carried from AM run, still unrepaired)

- **F-006**: F-### id with item_type=Defect, status=Idea, severity=2 — invalid
  combination for either type. Needs human edit (Feature: fix item_type + brief it;
  or Defect: re-id as D-###, status=Reported).

## Config used

- Weights B4:B8 = .20/.25/.25/.20/.10 (B9 OK); confidence map 1→0.45…10→1.00;
  risk map 1→1.00…10→0.60
- Cut line: none; dry-run: no
- Research: market-research-agent ×2 (both accepted); Ranking: feature-prioritizer
  (advisory; both recommendations applied — flags were non-blocking)
