---
description: Run the prioritization pipeline against feature-value-scoring.xlsx for both Feature and Defect/Bug rows — research scoring, human-gate check, unified ranking, and report. Does NOT write feature briefs (use /write-feature-brief) and does NOT fix defects (use /fix-defect-or-bug).
argument-hint: [path-to-workbook] [--cut-line N] [--dry-run]
allowed-tools: Read, Write, Bash, Task
---

# /prioritize-features

Orchestrates the feature prioritization pipeline defined in the `feature-value-scoring`
skill. Read that skill in full before Phase 1.

**Scope boundary — read first:** This command never writes feature briefs, and never touches
a Defect row's fix (that's `/fix-defect-or-bug`). It scores and ranks Feature and Defect rows
side by side in one list — read `item_type` (Data Dictionary column V) before applying any
gate below, since Feature and Defect rows have different entry requirements and human-gated
fields. Brief authoring is a separate concern owned by `/write-feature-brief` and the
brief-writer agent, kept out of this pipeline so the actor that frames a feature is never the
actor that scores or ranks it. Rows missing what they need are *reported as blocked*, not
repaired. If most of the backlog is blocked, stop and tell the user what to run first
(`/write-feature-brief` for Features, direct triage on the row for Defects — see the skill's
LOG role).

Arguments: `$ARGUMENTS`
- Workbook path (default: `./feature-value-scoring.xlsx`)
- `--cut-line N`: rank position of the funding cut, used for the ±10% review flag (default: none; flag suppressed)
- `--dry-run`: run everything but write no changes to the workbook

## Phase 1 — Preflight

1. Confirm the workbook exists and load it.
2. Parse the **Data Dictionary sheet** into a field map (`field_id` → column, type, allowed
   values, owner). Use this map for every subsequent read/write. If parsing fails, halt.
3. Read Config: weights B4:B8, weight check B9, confidence map A12:B21, risk map D12:E21.
4. **Gate:** if `Config!B9` ≠ "OK", halt and report the broken weights. Do not proceed.
5. Snapshot: copy the workbook to `./.prioritization-runs/{ISO-timestamp}/input.xlsx`
   before any mutation (skip on --dry-run).

## Phase 2 — Inventory & entry gate

1. Scan all Scoring rows with a non-empty `feature_id`. Classify by `item_type` first
   (default `Feature` if blank — legacy rows), then by `status`.
2. **Feature rows:** `status = Idea` OR empty/unresolvable `brief_ref` → add to the
   **BLOCKED list**. Do not score them, do not draft briefs for them. They appear in the
   final report with the instruction: run `/write-feature-brief <feature_id>`.
3. **Feature rows:** `status = Brief Drafted` and a resolvable brief → **RESEARCH queue**.
4. **Defect rows:** `status = Reported` → add to the **BLOCKED list** with the instruction:
   triage directly on the row (set `defect_source`, gather enough to score `reach`/`confidence`,
   then set `status = Triaged`) — there is no brief-drafting step for Defects.
5. **Defect rows:** `status = Triaged` → **RESEARCH queue**. A `brief_ref` (ticket/repro link)
   is good practice but not gating for Defects — unlike Features, absence of a written doc
   doesn't block scoring.
6. Rows of either type with `status = Scored` → carry forward to Phase 4 checks.
7. Rows already `Prioritized | Deferred | Rejected | Won't Fix` → left untouched unless
   `date_scored` is > 90 days old, in which case add to the **STALE list** for the report.
8. **Defect rows with `status` in `In Progress | Fixed | Verified`** → out of scope entirely;
   these are mid- or post-fix, owned by `/fix-defect-or-bug`. Count them for the report but
   do not classify, score, or flag them.

## Phase 3 — Research scoring (subagent dispatch)

For each row in the RESEARCH queue, dispatch the **market-research agent** (Task tool) in the
RESEARCH role, with: the feature's brief content (or the defect's `brief_ref`/inline repro
info), the Rubric sheet anchors, the RESEARCH role section of the `feature-value-scoring`
skill, the row's `item_type`, and the field map from Phase 1.

Enforce on return, before accepting any write:
- **Feature rows** — only permitted fields touched: `reach`, `user_value`, `business_value`,
  `time_sensitivity`, `confidence`, `evidence_sources`, `rationale_notes`, `scored_by`,
  `date_scored`, `status`. Any attempt to write `strategic_alignment`, `effort`, `risk`, or
  formula columns → reject the row, log a contract violation, leave the row unmodified.
- **Defect rows** — only permitted fields touched: `reach`, `confidence`, `evidence_sources`,
  `rationale_notes`, `scored_by`, `date_scored`, `status`. Any attempt to write `severity`,
  `defect_source`, `item_type`, `strategic_alignment`, `effort`, `risk`, or formula columns →
  reject the row, log a contract violation, leave the row unmodified. (`severity` is
  human/triage-owned — see the skill's LOG role — never agent-scored.)
- `evidence_sources` non-empty. Empty with `confidence` > 4 → reject.
- All scores are integers 1–10 (`severity` is human-owned and stays 1–5; agents never write it).
- `scored_by = "Market Research Agent"`, `date_scored` = today (ISO), `status = "Scored"`.

Apply accepted writes via openpyxl, then run `recalc.py` and verify zero formula errors.

## Phase 4 — Human-gate check

1. **Feature rows:** for every `Scored` row, check the three human-owned fields:
   `strategic_alignment`, `effort`, `risk`. Missing any of the three → **HUMAN-GATE list**.
2. **Defect rows:** for every `Scored` row, check the one human-owned field the fast-track
   formula needs: `severity`. Missing it → **HUMAN-GATE list**. (`effort`/`risk` are optional
   for Defects — useful for `/fix-defect-or-bug` planning, but not gating here since the
   priority formula doesn't use them.)
3. These rows cannot be ranked. If the HUMAN-GATE list is non-empty, pause here: present the
   list as a compact table (feature_id, name, item_type, which fields are missing) and ask the
   user to fill them in the workbook or supply values inline. Do not proceed to Phase 5 until
   resolved or the user explicitly says to rank only the complete rows.

## Phase 5 — Ranking (subagent dispatch)

Dispatch the **prioritization agent** with: read-only extract of all complete `Scored` rows
of both item types (all fields including calculated columns, post-recalc), the PRIORITIZE
role section of the skill, and the cut line if provided.

Require from it:
1. One ranked list by `priority_score`, Feature and Defect rows mixed together — that's the
   point of the shared formula output, not an oversight.
2. Per-row rationale citing `evidence_sources` — reject any rationale that references only
   the numeric score.
3. Review flags per the skill: ±10% of cut line, `strategic_alignment ≥ 8` with low rank
   (Feature only), `risk ≥ 9`, `severity = 5` (Defect only; severity stays 1–5),
   `date_scored > 90` days.
4. Recommended status per row: `Prioritized | Deferred | Rejected`, with `risk ≥ 9` or
   `severity = 5` rows always recommended-pending-signoff, never auto-Prioritized. A `Won't
   Fix` call on a Defect is the human's to make when resolving its flag, never an agent
   recommendation.

## Phase 6 — Status writes

Apply the prioritization agent's status recommendations to the `status` column only —
no other field. Skip flagged rows: their status stays `Scored` until the human review in
Phase 7 resolves them. Recalc and verify zero errors. (Skip all writes on --dry-run.)

## Phase 7 — Report

Write `./.prioritization-runs/{ISO-timestamp}/report.md` and summarize inline:

1. **Ranked list** (Feature and Defect rows together) with priority scores, item_type, and
   one-line rationale each.
2. **Review flags**, grouped by flag type, each with the question the human must answer.
3. **BLOCKED list** — Feature rows awaiting briefs (`/write-feature-brief` instruction) and
   Defect rows awaiting triage (direct-edit instruction), listed separately.
4. **HUMAN-GATE leftovers** — rows still missing human-owned scores (which field, per row).
5. **STALE list** — previously prioritized rows overdue for re-scoring.
6. **IN-FLIGHT count** — Defect rows in `In Progress | Fixed | Verified`, out of this
   command's scope (owned by `/fix-defect-or-bug`); count only, not itemized.
7. **Contract violations** — any rejected agent writes from Phase 3, verbatim.
8. Config used: weights, maps, cut line, dry-run status, snapshot path.

End by telling the user the workbook is updated (or that --dry-run made no changes) and
that flagged items await their decision.
