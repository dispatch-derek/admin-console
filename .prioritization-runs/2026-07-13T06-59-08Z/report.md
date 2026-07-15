# Prioritization Run — 2026-07-13T06:59:08Z

Workbook: `feature-value-scoring.xlsx` · Cut line: none provided (±10% flag suppressed) · Dry run: no
Snapshot (pre-mutation): `.prioritization-runs/2026-07-13T06-59-08Z/input.xlsx`

**Run outcome in one line:** D-002 completed the full pipeline this run — human triage
(severity=2 supplied inline by the user mid-run), research scoring (reach=5, confidence=7),
ranking (24.2, rank 3), and `Scored → Prioritized`. No other row changed.

## 1. Ranked list (Feature + Defect, shared rank)

| Rank | ID | Type | Score | Status (post-run) | Rationale |
|---|---|---|---|---|---|
| 1 | F-001 | Feature | 46.2 | Prioritized | Standing from 2026-07-07 run; unchanged. |
| 2 | D-001 | Defect | 29.7 | Prioritized | Standing from 2026-07-11 scoring; unchanged. Afflicts the **default** dark theme, which keeps it above D-002. |
| 3 | D-002 | Defect | 24.2 | **Prioritized (this run)** | GH issue #7: WCAG 2.1 AA contrast failure independently recomputed twice (4.148:1 on #ffffff vs 4.5:1 minimum, degrading to 3.45:1 on chat-input bg) in a token consumed by 27 `index.css` declarations incl. F-005 provenance/label surfaces plus 5 shared DS component modules, auto-applied to OS-light users via `prefers-color-scheme.css:10-20`. Below D-001 because light theme is non-default with unmeasured share and triage set Sev4/minor (severity 2). Fix is F-001-scope: token byte-pinned by three gate tests (`adopted-tokens.test.ts:27`, `vendor-immutability.test.ts:38`, `dual-theme-harness.test.ts:46`). |
| 4 | F-005 | Feature | 21.1 | Implemented | Out of scope (post-implementation); rank shown for context only. |
| 5 | F-003 | Feature | 20.5 | Prioritized | Standing; unchanged. |
| 6 | F-002 | Feature | 17.3 | Prioritized | Standing; unchanged. |
| 7 | F-004 | Feature | 10.0 | Prioritized | Standing; unchanged. |

Only **D-002** changed status this run. Its research scores: reach=5 (token on virtually every
screen, but only light-theme operators affected — dark is default, split unmeasured),
confidence=7 (deterministic repro, ratios independently recomputed, byte-pin verified in gate
sources; held below 8 by zero theme-adoption measurement).

## 2. Review flags

**None triggered for D-002** — every rule evaluated explicitly:
- ±10% of cut line: suppressed (no cut line this run)
- `strategic_alignment ≥ 8` with low rank: Feature-only rule, N/A for a Defect
- `risk ≥ 9`: risk=1
- `severity = 5`: severity=2 (human-triaged Sev4/minor)
- `date_scored > 90` days: scored today

The strategic-alignment flags raised on F-002/F-003/F-004 in the 2026-07-12T07-43-23Z report
remain open questions for the human; those rows were not re-ranked here.

## 3. BLOCKED list

None. No Feature rows in `Idea`/missing-brief state; no Defect rows left in `Reported`.

## 4. HUMAN-GATE leftovers

None remaining. D-002 hit the gate mid-run (severity missing — the user's earlier edit had
populated `effort`/`risk`/`strategic_alignment` but left column X empty); resolved inline by
the user supplying **severity = 2** during the run, recorded verbatim.

## 5. STALE list

None. All scored rows dated 2026-07-07 to 2026-07-13 — well within the 90-day window.

## 6. IN-FLIGHT & CANCELLED counts

- In-flight (`In Progress | Implemented | Fixed | Verified`): **1** (F-005 `Implemented`,
  owned by `/implement-spec`)
- Cancelled: **0**

## 7. Contract violations

None. The research agent's proposal touched only Defect-permitted fields (`reach`,
`confidence`, `evidence_sources`, `rationale_notes`, `scored_by`, `date_scored`, `status`);
citations present; integers in range. Accepted as-is.

## 8. Config used

- Weights (Config!B4:B8): Reach 0.20, User Value 0.25, Business Value 0.25,
  Strategic Alignment 0.20, Time Sensitivity 0.10 — sum check `Config!B9` = **OK**
- Confidence map (A12:B21): 1→0.45 … 10→1.00 · Risk map (D12:E21): 1→1.00 … 10→0.60
- Defect severity→base map (G12:H16): 1→10, 2→30, 3→55, 4→80, 5→100 ·
  Defect reach→factor map (I12:J21): 1→0.75 … 10→1.20
- D-002 fast-track arithmetic: severity_base 30 × reach_factor 0.95 × confidence_mult 0.85 = **24.2**
- Cut line: none provided · Dry run: no
- Recalc after each write pass (headless LibreOffice): zero formula errors
- Snapshot: `.prioritization-runs/2026-07-13T06-59-08Z/input.xlsx`

---

## Addendum — 2026-07-13: human resolutions of the standing strategic-alignment flags

The three flags carried from the 2026-07-12T07-43-23Z report were ruled on by Derek and
recorded in each row's `rationale_notes` (scores, statuses, and formula columns unchanged):

1. **F-004 (event bus): OVERRIDE — top priority.** The rank-7 formula placement is
   consciously overridden: the eventbus is architecturally significant and all strategically
   important features must build on it, so it precedes them in implementation order. This is
   exactly the "strategic bet buried by the effort divisor" case the flag exists to surface.
   Effective implementation order: F-004 next (`/implement-spec F-004`).
2. **F-002 + F-003 (system prompts): BUNDLED.** Ranked as one sequenced initiative
   (F-002 baseline model first, then F-003), taken or deferred as a unit at the bundle's
   position — no longer evaluated as independent line items.

No flags remain open. All backlog rows are `Prioritized`; the funding-order guidance is now:
F-004 (human override) → F-001 → D-001 → D-002 → [F-002 → F-003] bundle, subject to Derek's
sequencing at implementation time.
