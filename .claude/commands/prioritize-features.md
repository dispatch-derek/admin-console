---
description: Run the feature prioritization pipeline against feature-value-scoring.xlsx — research scoring, human-gate check, ranking, and report. Does NOT write feature briefs (use /write-feature-brief separately).
argument-hint: [path-to-workbook] [--cut-line N] [--dry-run]
allowed-tools: Read, Write, Bash, Task
---

# /prioritize-features

Orchestrates the feature prioritization pipeline defined in the `feature-value-scoring`
skill. Read that skill in full before Phase 1.

**Scope boundary — read first:** This command never writes feature briefs. Brief authoring
is a separate concern owned by `/write-feature-brief` and the brief-writer agent, kept out
of this pipeline so the actor that frames a feature is never the actor that scores or ranks
it. Rows without briefs are *reported as blocked*, not repaired. If most of the backlog is
blocked on briefs, stop and tell the user to run `/write-feature-brief` first.

Arguments: `$ARGUMENTS`
- Workbook path (default: `./feature-value-scoring.xlsx`)
- `--cut-line N`: rank position of the funding cut, used for the ±10% review flag (default: none; flag suppressed)
- `--dry-run`: run everything but write no changes to the workbook

## Phase 1 — Preflight

1. Confirm the workbook exists and load it.
2. Parse the **Data Dictionary sheet** into a field map (`field_id` → column, type, allowed
   values, owner). Use this map for every subsequent read/write. If parsing fails, halt.
3. Read Config: weights B4:B8, weight check B9, confidence map A12:B16, risk map D12:E16.
4. **Gate:** if `Config!B9` ≠ "OK", halt and report the broken weights. Do not proceed.
5. Snapshot: copy the workbook to `./.prioritization-runs/{ISO-timestamp}/input.xlsx`
   before any mutation (skip on --dry-run).

## Phase 2 — Inventory & brief gate

1. Scan all Scoring rows with a non-empty `feature_id`. Classify by `status`.
2. Rows with `status = Idea` OR empty/unresolvable `brief_ref` → add to the **BLOCKED list**.
   Do not score them, do not draft briefs for them. They appear in the final report with
   the instruction: run `/write-feature-brief <feature_id>`.
3. Rows with `status = Brief Drafted` and a resolvable brief → **RESEARCH queue**.
4. Rows with `status = Scored` → carry forward to Phase 4 checks.
5. Rows already `Prioritized | Deferred | Rejected` → left untouched unless `date_scored`
   is > 90 days old, in which case add to the **STALE list** for the report.

## Phase 3 — Research scoring (subagent dispatch)

For each row in the RESEARCH queue, dispatch the **market-research agent** (Task tool) with:
the feature's brief content, the Rubric sheet anchors, the RESEARCH role section of the
`feature-value-scoring` skill, and the field map from Phase 1.

Enforce on return, before accepting any write:
- Only permitted fields touched: `reach`, `user_value`, `business_value`, `time_sensitivity`,
  `confidence`, `evidence_sources`, `rationale_notes`, `scored_by`, `date_scored`, `status`.
  Any attempt to write `strategic_alignment`, `effort`, `risk`, or formula columns → reject
  the row, log a contract violation, leave the row unmodified.
- `evidence_sources` non-empty. Empty with `confidence` > 2 → reject.
- All scores are integers 1–5.
- `scored_by = "Market Research Agent"`, `date_scored` = today (ISO), `status = "Scored"`.

Apply accepted writes via openpyxl, then run `recalc.py` and verify zero formula errors.

## Phase 4 — Human-gate check

1. For every `Scored` row, check the three human-owned fields: `strategic_alignment`,
   `effort`, `risk`.
2. Rows missing any of the three → **HUMAN-GATE list**. These cannot be ranked.
3. If the HUMAN-GATE list is non-empty, pause here: present the list as a compact table
   (feature_id, name, which fields are missing) and ask the user to fill them in the
   workbook or supply values inline. Do not proceed to Phase 5 until resolved or the user
   explicitly says to rank only the complete rows.

## Phase 5 — Ranking (subagent dispatch)

Dispatch the **prioritization agent** with: read-only extract of all complete `Scored` rows
(all fields including calculated columns, post-recalc), the PRIORITIZE role section of the
skill, and the cut line if provided.

Require from it:
1. Ranked list by `priority_score`.
2. Per-feature rationale citing `evidence_sources` — reject any rationale that references
   only the numeric score.
3. Review flags per the skill: ±10% of cut line, `strategic_alignment ≥ 4` with low rank,
   `risk = 5`, `date_scored > 90` days.
4. Recommended status per feature: `Prioritized | Deferred | Rejected`, with `risk = 5`
   rows always recommended-pending-signoff, never auto-Prioritized.

## Phase 6 — Status writes

Apply the prioritization agent's status recommendations to the `status` column only —
no other field. Skip flagged rows: their status stays `Scored` until the human review in
Phase 7 resolves them. Recalc and verify zero errors. (Skip all writes on --dry-run.)

## Phase 7 — Report

Write `./.prioritization-runs/{ISO-timestamp}/report.md` and summarize inline:

1. **Ranked list** with priority scores and one-line rationale each.
2. **Review flags**, grouped by flag type, each with the question the human must answer.
3. **BLOCKED list** — features awaiting briefs, with the `/write-feature-brief` instruction.
4. **HUMAN-GATE leftovers** — rows still missing human-owned scores.
5. **STALE list** — previously prioritized rows overdue for re-scoring.
6. **Contract violations** — any rejected agent writes from Phase 3, verbatim.
7. Config used: weights, maps, cut line, dry-run status, snapshot path.

End by telling the user the workbook is updated (or that --dry-run made no changes) and
that flagged items await their decision.
