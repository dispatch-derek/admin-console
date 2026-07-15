# Prioritization run — 2026-07-15T23-01-10Z

**Workbook:** `./feature-value-scoring.xlsx` · **Mode:** live (not dry-run) · **Cut line:** none (±10% flag suppressed)
**Snapshot:** `./.prioritization-runs/2026-07-15T23-01-10Z/input.xlsx`

> Execution note: the `market-research agent` (Phase 3) and `prioritization agent` (Phase 5)
> are not in this environment's agent roster. Both roles were executed **inline by the main
> agent under the same role contracts** (RESEARCH: reach/confidence only, mandatory citations;
> PRIORITIZE: rank + flag, no field writes beyond `status`). Evidence for the two defects came
> from GH issues + direct source inspection. Permitted-field contract was verified after write.

## 1. Unified ranked list (Features + Defects together)

| Rank | Score | ID | Type | Status | One-line rationale |
|---|---|---|---|---|---|
| 1 | **85.0** | D-003 | Defect | Scored ⚑ | Workspace Chats renders raw `JSON.stringify` (ChatOversight.tsx:78); sev-5, code+screenshot repro (issue #9). **Flagged — see §2.** |
| 2 | 46.2 | F-001 | Feature | Prioritized | Design-system adoption; unchanged this run (scored 2026-07-07). |
| 3 | 29.7 | D-001 | Defect | Prioritized | Provider-panel contrast; unchanged (2026-07-11). |
| 4 | 24.2 | D-002 | Defect | Prioritized | Light-theme secondary-text WCAG fail; unchanged (2026-07-13). |
| — | 21.1 | F-005 | Feature | *Implemented* | Out of scope (post-impl); rank is a formula artifact only — see §6. |
| 5 | 20.5 | F-003 | Feature | Prioritized | Workspace system prompt; unchanged. |
| 6 | 17.3 | F-002 | Feature | Prioritized | Customer system prompt; unchanged. |
| 7 | 10.0 | F-004 | Feature | Prioritized | Production event bus; unchanged. |
| 8 | 8.0 | D-004 | Defect | **Prioritized** (new) | Visible sidebar scrollbar (index.css:105, no scrollbar-hide); sev-1 cosmetic, confirmed in source. |

*Rows scored/updated this run: D-003, D-004. All other ranked rows carried forward untouched.*

## 2. Review flags

**Severity = 5 (critical/blocking defect) — D-003.** Ranks #1 overall. Per the model, sev-5
defects are **never auto-Prioritized**; status held at `Scored` pending human signoff.
→ **Decision needed:** approve advancing D-003 to `Prioritized` (and queue `/fix-defect-or-bug D-003`)?
It's a data-presentation break on a primary oversight surface — raw DB JSON shown instead of a
table — reproduced both in source and via the reporter's screenshot.

No other flags: no `risk ≥ 9`, no stale rows (all `date_scored` within 8 days), no cut line set.

## 3. Blocked

**Awaiting brief (`/write-feature-brief <id>`):**
- **F-007** — "Multi-language / number-format i18n" (Feature, Idea)
- **F-008** — "System-wide scheduled backups" (Feature, Idea)

**Awaiting defect triage (edit the row directly — set `reach`/`confidence`, advance to `Triaged`):**
- **D-005** — dead-code envDump cleanup (Reported; `defect_source=Internal`, `brief_ref=`issue #10 already set)

**⚠ Data-integrity — needs human correction before it can enter any pipeline:**
- **F-006** — "Local-first per-workspace observability." Row is internally inconsistent: `feature_id`
  is `F-###` (Feature) but `item_type=Defect`, `status=Idea` (not a valid Defect state), and
  `severity=2` is set (Defects only). The description reads as a **Feature**. Fix one way or the other:
  - If Feature: set `item_type=Feature`, clear `severity`, then `/write-feature-brief F-006`.
  - If Defect: renumber to `D-###`, set `status=Reported`, clear the feature-ish framing.
  Left untouched by this run — the pipeline reports, it does not repair rows.

## 4. Human-gate leftovers

None. Both rows scored this run (D-003, D-004) already had human-owned `severity`.

## 5. Stale (prioritized > 90 days)

None. Oldest `date_scored` is 2026-07-07 (F-001), 8 days old.

## 6. In-flight & cancelled (counts only, out of scope)

- **Implemented / in-flight:** 1 — F-005 (owned by `/implement-spec`; its score/rank are formula
  artifacts and carry no action here).
- **In Progress / Fixed / Verified:** 0
- **Cancelled:** 0

## 7. Contract violations

None. Inline RESEARCH scoring touched only `reach`, `confidence`, `evidence_sources`,
`rationale_notes`, `scored_by`, `date_scored`, `status`. Post-write check confirmed
`severity`, `effort`, `risk`, `item_type`, `defect_source` unchanged on both rows.

## 8. Config used

- Weights (B4:B8): Reach 0.20 · User 0.25 · Business 0.25 · Strategic 0.20 · Time 0.10 → gate **OK** (sum = 1.0)
- Confidence map 1→0.45 … 7→0.85 … 10→1.00 · Risk map 1→1.00 … 10→0.60
- Defect severity base: 1→10, 2→30, 3→55, 4→80, 5→100 · Reach factor: 1→0.75 … 6→1.00 … 10→1.20
- Cut line: none · Dry-run: no · Recalc: LibreOffice headless, **0 formula errors** (×2 passes)

### Scores written this run
| ID | reach | confidence | severity (human) | → priority | rank |
|---|---|---|---|---|---|
| D-003 | 6 | 7 | 5 | 100 × 1.00 × 0.85 = **85.0** | 1 |
| D-004 | 6 | 6 | 1 | 10 × 1.00 × 0.80 = **8.0** | 9→(status Prioritized) |
