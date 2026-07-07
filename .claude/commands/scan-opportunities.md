---
description: On-demand top-of-funnel scan for unproposed feature opportunities. Creates Idea rows with signal reports only — never briefs, never scores. Downstream: /write-feature-brief, then /prioritize-features.
argument-hint: [--focus "topic or segment"] [--since 90d] [--workbook path] [--dry-run]
allowed-tools: Read, Write, Bash, Task
---

# /scan-opportunities

On-demand invocation of the DISCOVER role's opportunity-scan mode. Read the DISCOVER
section of the `feature-value-scoring` skill before Phase 1.

**Scope boundary — read first:** This command proposes ideas and nothing more. It writes
rows with `status = Idea` and a signal report; it never authors briefs, never scores, and
never advances status. Proposing is the one thing the discovery agent may originate,
because the brief-writer and human refinement sit between a proposal and any score of it.
If the user asks mid-run "which of these should we build?", decline within this command —
that question belongs to the pipeline, after briefs exist.

Arguments: `$ARGUMENTS`
- `--focus "..."`: constrain the scan to a topic, segment, or source ("mid-market churn",
  "competitor X", "onboarding"). Default: unconstrained scan of all configured sources.
- `--since 90d`: lookback window for signals (default 90d; accepts Nd/Nw/Nm).
- `--workbook path` (default: `./feature-value-scoring.xlsx`)
- `--dry-run`: produce the report, write no rows.

## Phase 1 — Preflight

1. Load the workbook; parse the Data Dictionary for the field map.
2. Build the dedupe index: all existing `feature_name` values, all brief titles in
   `./briefs/`, and any signal citations already present in `rationale_notes` of
   `Idea` rows — so a re-scan doesn't re-propose last month's proposals.
3. Note the next free `F-###` ids for allocation in Phase 4.

## Phase 2 — Scan (subagent dispatch)

Dispatch the **research agent in DISCOVER role** (Task tool) with: the focus and lookback
arguments, the DISCOVER section of the skill, and the dedupe index as exclusion context.

Instruct it to look for *patterns without a proposal*: recurring ticket clusters, feature
requests spread across accounts, churned-customer themes, competitor launches with no
counterpart in the backlog, usage drop-offs at consistent workflow points. For each
candidate opportunity it returns:

- a neutral working name (noun phrase, no solution language — "CSV import failures at
  onboarding", not "Add smart CSV importer")
- a signal report in the standard format (source / signal / magnitude / date / citation)
- a cluster size: how many independent signals converge on this pattern

**Enforce on return, same bar as Phase 2b of /write-feature-brief:** signals only. Reject
and re-dispatch anything containing recommendations, urgency adjectives, solution framing,
or score-like language. Single-signal candidates (cluster size 1) are kept but marked
weak — one loud ticket is not a pattern.

## Phase 3 — Human triage

1. Present candidates as a compact table: working name, cluster size, strongest signal,
   date range. Sort by cluster size descending.
2. The user picks which to register (accept / skip / merge-with-existing per candidate).
   Nothing is written without this triage — an unattended scan that auto-populates the
   backlog turns signal into noise on the very sheet built to fight noise.
3. Skipped candidates are recorded in the run report only, so a future scan can note
   "previously skipped {date}" instead of silently re-proposing.

## Phase 4 — Register accepted candidates

For each accepted candidate, via the field map: allocate `feature_id`, write
`feature_name` (the neutral working name), `status = "Idea"`, and the full signal report
into `rationale_notes` with entries prefixed `[agent-discovery YYYY-MM-DD]`. Nothing else —
`brief_ref` stays empty, all scoring columns stay empty. Recalc, verify zero formula
errors. (Skip all writes on --dry-run.)

## Phase 5 — Report

Write `./.prioritization-runs/{ISO-timestamp}/scan-report.md` and summarize inline:

1. Registered ideas: feature_id, name, cluster size.
2. Skipped candidates with the user's reason where given.
3. Weak singles kept or skipped.
4. Sources scanned, focus, lookback window, dedupe exclusions applied.
5. Handoff line: "New ideas registered. Next: /write-feature-brief <feature_id> for any
   you want to advance."
