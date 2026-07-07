---
name: feature-value-scoring
description: >
  Use this skill whenever a task involves scoring, ranking, or prioritizing feature ideas
  against the feature-value-scoring workbook (feature-value-scoring.xlsx), writing research
  scores into it, or generating feature briefs intended to feed it. Triggers include: "score
  this feature", "prioritize the backlog", "run the prioritization", "fill in the scoring
  sheet", "research this feature idea", "gather evidence for this brief", "scan for feature
  opportunities", "design considerations for this feature", or any reference to
  priority_score, weighted value, the Scoring sheet, or a Feature ID matching F-###.
  Do NOT use for general product strategy discussion that doesn't read or write the workbook.
---

# Feature Value Scoring

Shared contract for scoring feature ideas. The workbook is the single source of truth;
its **Data Dictionary sheet is the authoritative schema** — parse it for column positions,
`field_id`s, types, and allowed values. Never hard-code column letters.

## Scoring model

```
weighted_value = reach*w1 + user_value*w2 + business_value*w3
               + strategic_alignment*w4 + time_sensitivity*w5     # weights: Config!B4:B8
priority_score = weighted_value * confidence_mult * risk_factor / effort * 20   # 0-100
```

- All eight input dimensions are integers 1–5, anchored on the **Rubric sheet**. Always score
  against the anchors, never intuition about what "a 4" means.
- Confidence map: 1→0.50, 2→0.65, 3→0.80, 4→0.90, 5→1.00. Risk map: 1→1.00 … 5→0.60.
  Both live on Config; read them, don't assume.
- Columns Q–U (weighted_value, confidence_mult, risk_factor, priority_score, rank) are
  **formulas — never write to them**. After edits via openpyxl, run recalc before reading values.

## Role: DISCOVER (evidence gathering for brief authoring — signals only)

Serves `/write-feature-brief` Phase 2b, and periodic opportunity scans. **Writes no workbook
scores in this role.** Output is a *signal report*, not framing.

**Signal report format** — one entry per finding:
```
- source:    {system + query/link, reproducible}
- signal:    {the raw observation, quantified}
- magnitude: {count / % / trend, with denominator}
- date:      {observation date or range, ISO}
- citation:  {ticket IDs, dashboard URL, doc ref}
```

Hard rules:
1. **No framing.** Prohibited in output: recommendations, problem statements, adjectives of
   need or urgency ("desperate", "critical", "clearly wants"), solution language, and any
   score or score-like phrasing ("this looks like a 4 on reach"). Report "42 tickets matching
   'CSV import', Q1–Q2 2026, 31 from mid-market tier" — never "users urgently need CSV import."
   The brief-writer interprets; the human decides.
2. **No signal is a finding.** If sources turn up nothing, say exactly that. An empty report
   is a legitimate early kill gate — never pad it, never fabricate a source.
3. **Tag provenance.** Every entry the brief-writer carries into a brief's Existing Evidence
   section must be prefixed `[agent-discovery YYYY-MM-DD]` so the RESEARCH role later knows
   which leads were its own prior output.
4. **Opportunity-scan mode** (periodic, not per-feature): may create new workbook rows with
   `feature_id`, `feature_name`, `status = Idea`, and the signal report in `rationale_notes`.
   Nothing else — no brief, no scores. Proposing an idea is permitted; authoring its brief
   never is.

## Role: RESEARCH (filling scores from evidence)

**May write:** `reach`, `user_value`, `business_value`, `time_sensitivity`, `confidence`,
`evidence_sources`, `rationale_notes`, `scored_by`, `date_scored`, and `status` (to `Scored`).

**Must never write:** `strategic_alignment`, `effort`, `risk` (human-owned), or any formula column.

Procedure:
1. Read the feature brief at `brief_ref`. No brief → set `status = Idea`, write nothing else, report.
2. Gather evidence: support tickets, usage analytics, competitor moves, benchmarks, interviews.
3. **Re-verify, don't inherit.** Treat the brief's Existing Evidence section as leads to
   re-check, not established fact — especially entries tagged `[agent-discovery ...]`, which
   are this agent's own earlier output. Signals go stale between drafting and scoring;
   trusting your own prior report is grading your own homework. Cite the re-verified state
   (fresh counts, fresh dates) in `evidence_sources`, not the brief's snapshot.
4. Score the five permitted dimensions against the Rubric anchors.
5. `evidence_sources` is mandatory — every score traces to a citation. No citation → cap
   `confidence` at 2.
6. Never inflate value scores to offset thin evidence. Honest value + low confidence is the
   correct encoding; the multiplier carries the uncertainty.
7. Set `scored_by = Market Research Agent` (or `Hybrid` if revising human scores), ISO date.

## Role: PRIORITIZE (ranking scored rows)

**May write:** `status` only (`Scored` → `Prioritized` | `Deferred` | `Rejected`). Everything
else is read-only.

Procedure:
1. Gate: if `Config!B9` ≠ "OK", halt and report broken weights. Do not rank.
2. Rank all `Scored` rows by `priority_score`, but treat it as a starting order, not a verdict.
3. **Flag for human review instead of deciding:**
   - rows within ±10% of the funding cut line (inside model noise)
   - `strategic_alignment` ≥ 4 with low rank (strategic bet buried by the effort divisor)
   - `risk` = 5 regardless of rank (one-way door; needs sign-off)
   - `date_scored` > 90 days old (recommend re-score, don't rank stale data)
4. Rationale per placement must cite `evidence_sources`, never the score alone.
   Good: "ranked 3rd: 42 support tickets + competitor launch establish reach and urgency,
   discounted for integration risk." Bad: "ranked 3rd because it scored 19.2."

## Role: BRIEF (writing feature briefs upstream)

Briefs must supply the raw material each dimension needs: problem statement + affected users
(→ reach, user_value), business rationale (→ business_value), deadlines/competitive windows
(→ time_sensitivity), existing evidence pointers (→ confidence). Never score your own brief —
authoring and evaluating are separated by design.

## Role: DESIGN (UX input to brief authoring — reads, not scores)

Serves `/write-feature-brief` Phase 3b, only for features with a user-facing surface.
**Writes no workbook scores in this role, ever.** Output is two short reads that inform
the human's later Effort and Risk scores — it does not set them.

**Design read format:**
```
- complexity_read: {new screens/flows, novel interaction patterns, design-system fit —
                     qualitative, e.g. "extends existing table pattern" vs
                     "requires new multi-step wizard, no existing precedent"}
- ux_risk_read:    {accessibility exposure, reversibility of the interaction pattern,
                     usability-testing needs}
```

Hard rules:
1. **Confined to Proposed Direction.** Contribute only to that section of the brief.
   Never touch Problem or Affected Users — those must stay solution-free so reach and
   user_value scoring stays evidence-based rather than shaped by a proposed design.
2. **Non-binding, like the section it feeds.** A sketch or wireframe idea, not a spec.
   A binding spec would quietly narrow what engineering later estimates Effort against.
3. **Reads, not verdicts.** Never write or suggest a numeric score, an Effort estimate, or
   a Risk score — those stay human-owned, blending design complexity with engineering
   cost and organizational risk appetite that this role doesn't have full visibility into.
4. **Conditional.** Only dispatched when the feature has a user-facing component. Backend,
   API-only, or infrastructure features skip this role entirely.

## Invariants (all roles)

- One row per feature; `feature_id` pattern `F-###` is the join key to briefs.
- Preserve provenance: never blank `scored_by`, `evidence_sources`, or `rationale_notes`.
- Schema changes go Data Dictionary first, then this skill — if they disagree, the
  Data Dictionary wins and this file is stale; say so.
- Known model behavior: cheap safe items can outrank strategic bets (effort divides).
  This is intentional; the strategic-alignment review flag is the counterweight.
