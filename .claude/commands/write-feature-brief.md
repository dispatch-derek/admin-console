---
description: Draft or revise a feature brief for the prioritization pipeline, with optional evidence discovery, optional UX design input, and a human refinement loop. Never scores features — scoring belongs to /prioritize-features.
argument-hint: <feature-id | "raw idea text"> [--workbook path] [--revise]
allowed-tools: Read, Write, Bash, Task
---

# /write-feature-brief

Authors one feature brief per invocation, iteratively with the user, and registers it in
the scoring workbook. Read the BRIEF role section of the `feature-value-scoring` skill
before Phase 1.

**Scope boundary — read first:** This command writes briefs and nothing downstream of them.
It never fills any scoring dimension, never sets `scored_by` or `date_scored`, and never
touches `status` beyond `Idea → Brief Drafted`. The author of a framing must not evaluate
it; scoring and ranking belong exclusively to `/prioritize-features`. If the user asks for
scores mid-session ("so what would this score?"), decline within this command and point
them to the pipeline — an authored-and-scored-in-one-breath feature is exactly the bias
this separation exists to prevent.

Arguments: `$ARGUMENTS`
- Either an existing `feature_id` (F-### pattern) from the workbook, or quoted raw idea text
- `--workbook path` (default: `./feature-value-scoring.xlsx`)
- `--revise`: rework an existing brief rather than reporting it as already present

## Phase 1 — Resolve the target

1. Load the workbook; parse the Data Dictionary sheet for the field map.
2. If the argument is a `feature_id`: read its row. If the row has a resolvable `brief_ref`
   and `--revise` was not passed, stop and report that a brief exists (show its path) —
   don't silently overwrite reviewed framing.
3. If the argument is raw idea text: allocate the next unused `F-###` id and hold it;
   the workbook row is created in Phase 5, not now, so an abandoned session leaves no orphan row.
4. If no argument: list workbook rows with `status = Idea` and empty `brief_ref`, ask the
   user to pick one.

## Phase 2 — Context gathering

1. Collect what exists: the idea text or row name, any notes in `rationale_notes`, related
   briefs in `./briefs/` (scan titles for overlap — flag near-duplicates to the user before
   drafting a competing brief).
2. Ask the user only what the template needs and the context doesn't supply — target user,
   observed problem, any known deadline. One round of questions, not an interrogation;
   gaps the user can't fill become Open Questions in the brief, which is honest signal
   for the research agent's confidence scoring downstream.

## Phase 2b — Evidence discovery (optional subagent dispatch)

1. Offer discovery: "Want me to scan for existing signals before drafting?" Skip silently
   if the user already supplied rich evidence or declines.
2. If accepted, dispatch the **market-research-agent in DISCOVER role** (Task tool,
   `subagent_type: market-research-agent`) with the raw idea text and the DISCOVER section
   of the `feature-value-scoring` skill. It returns a signal report: source / signal /
   magnitude / date / citation entries, or an explicit "no signal found".
3. **Enforce signals-only on return:** reject and re-dispatch if the report contains
   recommendations, problem framing, urgency adjectives, solution language, or score-like
   phrasing. The discovery output feeds the brief-writer as raw material — if it arrives
   pre-framed, the research agent has co-authored the brief it will later score.
4. **Kill gate:** if the report is "no signal found", present that to the user before
   drafting. Proceeding on conviction is legitimate — it just means confidence will score
   low later — but the user decides that with the empty report in front of them, not after
   a brief has been invested in.
5. Carry accepted entries into the draft's Existing Evidence section, each prefixed
   `[agent-discovery YYYY-MM-DD]` so the RESEARCH role can distinguish its own prior
   output from human-supplied leads when it re-verifies at scoring time.

## Phase 3 — Draft (subagent dispatch)

Dispatch the **feature-brief-writer** (Task tool, `subagent_type: feature-brief-writer`) with
the gathered context, the BRIEF role section of the skill, and the template below. The template's sections map one-to-one onto
the scoring dimensions so the research agent finds what it needs where it expects it:

```markdown
# {F-###}: {Feature Name}

## Problem
What's broken or missing, for whom, observed how. No solution language here.
(feeds: user_value)

## Affected Users
Which segments, what share of the base, how often they hit the problem.
(feeds: reach)

## Business Rationale
The revenue / retention / cost / market-access argument, stated falsifiably.
(feeds: business_value)

## Timing
Deadlines, competitive moves, regulatory dates, seasonal windows — or "none known".
(feeds: time_sensitivity)

## Existing Evidence
Pointers only: ticket queries, analytics dashboards, interview notes, competitor links.
Prefix agent-discovered entries `[agent-discovery YYYY-MM-DD]`; leave human-supplied
leads untagged. All entries are leads the research agent re-verifies at scoring time,
not established fact.
(feeds: confidence)

## Proposed Direction
A sketch of the solution shape, explicitly non-binding. One paragraph.

## Design Considerations
UX complexity and risk reads, if this feature has a user-facing surface — see Phase 3b.
Not a spec; informs the human's Effort and Risk scores, does not set them. Omit this
section entirely for backend/API-only/infrastructure features.
(informs, does not feed: effort, risk — both remain human-scored)

## Out of Scope
What this feature is not, to keep effort estimation honest later.

## Open Questions
Unknowns the author couldn't resolve. An empty section is a red flag, not a virtue.
```

Enforce on return: every section present; Problem section contains no solution language;
Existing Evidence contains pointers or an explicit "none found" (never fabricated sources);
**no scores, no score-like language** ("this is probably a 4 on reach") anywhere — strip
and log if the agent editorializes toward numbers.

## Phase 3b — Design input (optional subagent dispatch)

1. Skip entirely if the feature has no user-facing surface (backend, API-only,
   infrastructure, internal tooling with no UI change) — omit the Design Considerations
   section from the brief rather than leaving it empty.
2. Otherwise offer it: "This looks user-facing — want a UX read before we finalize?" Skip
   silently if declined.
3. If accepted, dispatch the **ux-designer** (Task tool, `subagent_type: ux-designer`) with the drafted Problem,
   Affected Users, and Proposed Direction sections, plus the DESIGN role section of the
   `feature-value-scoring` skill. It returns a complexity read and a UX risk read.
4. **Enforce on return, same bar as Phase 2b:** reject and re-dispatch if the response
   contains a numeric score, an Effort or Risk estimate, or scoring-adjacent phrasing
   ("this is roughly a 3 on effort"). The design read informs the human's later Effort
   and Risk scores; it does not set them — if it arrives pre-scored, the boundary between
   design input and human-owned judgment has collapsed.
5. Insert the accepted reads into the Design Considerations section verbatim, attributed
   to the ux-designer agent.

## Phase 4 — Human refinement loop

1. Present the draft in full. Ask for revisions; apply; re-present. Repeat until the user
   approves — this loop is the point of the command, not an afterthought. Briefs feed
   everything downstream, so a rushed brief poisons the whole pipeline.
2. If the user approves silently and Open Questions is empty, prompt once: "No open
   questions — is that real certainty or unexamined assumptions?" Then respect their answer.

## Phase 5 — Finalize & register

1. Write the brief to `./briefs/{feature_id}-{kebab-name}.md`.
2. Workbook writes, via the field map: `feature_id`, `feature_name`, `brief_ref` (relative
   path), `status = "Brief Drafted"`. New-idea case: create the row now. Nothing else —
   all scoring columns stay empty for the pipeline.
3. Recalc, verify zero formula errors.
4. Report: brief path, workbook row, and the handoff line — "Ready for scoring: run
   /prioritize-features when the batch is ready."
