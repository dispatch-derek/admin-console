---
name: feature-value-scoring
description: >
  Use this skill whenever a task involves scoring, ranking, or prioritizing feature ideas OR
  customer-reported defects / internally-found bugs against the feature-value-scoring workbook
  (feature-value-scoring.xlsx), writing research scores into it, or generating feature briefs
  intended to feed it. Triggers include: "score this feature", "prioritize the backlog", "run
  the prioritization", "fill in the scoring sheet", "research this feature idea", "gather
  evidence for this brief", "scan for feature opportunities", "design considerations for this
  feature", "log this bug/defect", "triage this defect", "what's the severity of", or any
  reference to priority_score, weighted value, item_type, severity, the Scoring sheet, a
  Feature ID matching F-###, or a Defect ID matching D-###.
  Do NOT use for general product strategy discussion that doesn't read or write the workbook.
---

# Feature Value Scoring

Shared contract for scoring feature ideas **and** tracking defects/bugs in the same workbook.
The workbook is the single source of truth; its **Data Dictionary sheet is the authoritative
schema** — parse it for column positions, `field_id`s, types, and allowed values. Never
hard-code column letters.

## Item Type — the fork in the model

Every row's `item_type` (column V; `Feature` or `Defect`) selects which scoring path applies.
Legacy rows without it are `Feature`. This is the one field every role must read first —
everything below forks on it.

## Scoring model — Feature rows

```
weighted_value = reach*w1 + user_value*w2 + business_value*w3
               + strategic_alignment*w4 + time_sensitivity*w5     # weights: Config!B4:B8
priority_score = MIN(100, weighted_value * confidence_mult * risk_factor / effort * 20)  # 0-100
```

- All eight input dimensions are integers **1–10**, anchored on the **Rubric sheet** (even
  scores carry the pre-2026-07 5-point anchors; odd scores are the judgment calls between
  them). Always score against the anchors, never intuition about what "an 8" means.
- Confidence map: 1→0.45, 2→0.50, 3→0.58, 4→0.65, 5→0.73, 6→0.80, 7→0.85, 8→0.90, 9→0.95,
  10→1.00. Risk map: 1→1.00 … 10→0.60. Both live on Config; read them, don't assume.
- The MIN(100, …) cap exists because effort=1 (hours-to-a-day) is finer than the old scale's
  minimum; it binds only for very-low-effort, very-high-value rows.

## Scoring model — Defect rows (severity fast-track)

```
priority_score = MIN(100, severity_base * reach_factor * confidence_mult)   # 0-100, rounded
```

- `severity_base` is a **Config lookup** from `severity` (**deliberately still 1–5** — unlike
  every other dimension, severity kept its 5-point scale in the 2026-07 migration for industry
  Sev1–Sev4 alignment; Rubric anchors: 1=cosmetic … 5=critical/blocking, industry Sev1).
  `reach_factor` is a **Config lookup** from `reach` (1–10; share of customers who hit the bug) — a secondary multiplier here, not a primary weighted
  dimension like it is for Features. `confidence_mult` is the **same** Confidence map Features
  use, driven by `confidence` (strength of the repro/evidence).
- **Deliberately bypassed for Defects:** `weighted_value` (blank), `strategic_alignment` (doesn't
  apply to a bug), and the `effort` divisor (severity should not get cheaper-to-fix bugs
  discounted below more-severe expensive ones). `effort`/`risk` may still be filled for
  fix-planning purposes but never feed this formula.
- Both formulas land in the **same** `priority_score`/`rank` columns, so a critical customer-
  reported bug can outrank a nice-to-have feature in one shared ranked list — that's the point
  of keeping Feature and Defect rows in one sheet rather than a parallel one.

## Shared mechanics (both item types)

- Columns Q–U (weighted_value, confidence_mult, risk_factor, priority_score, rank) are
  **formulas — never write to them**. After edits via openpyxl, run recalc before reading values.
- `rank` (U) is computed across the whole column regardless of `item_type` — Features and
  Defects are ranked against each other, not in separate pools.

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

**Feature rows may write:** `reach`, `user_value`, `business_value`, `time_sensitivity`,
`confidence`, `evidence_sources`, `rationale_notes`, `scored_by`, `date_scored`, and `status`
(to `Scored`).

**Defect rows may write:** `reach`, `confidence`, `evidence_sources`, `rationale_notes`,
`scored_by`, `date_scored`, and `status` (to `Scored`). `reach` here means share of customers
who hit the bug; `confidence` means strength of the repro/evidence.

**Must never write (either item type):** `strategic_alignment`, `effort`, `risk` (human-owned),
`item_type`, `defect_source`, `severity` (human/triage-owned for Defects), or any formula column.

Procedure:
1. Feature: read the brief at `brief_ref`. No brief → set `status = Idea`, write nothing else,
   report. Defect: read the defect/bug report at `brief_ref` (repro steps, ticket refs). No
   report and no inline repro info → set `status = Reported`, write nothing else, report.
2. Gather evidence: support tickets, usage analytics, competitor moves, benchmarks, interviews
   (Feature); support tickets, occurrence counts, repro confirmations (Defect).
3. **Re-verify, don't inherit.** Treat the brief's Existing Evidence section as leads to
   re-check, not established fact — especially entries tagged `[agent-discovery ...]`, which
   are this agent's own earlier output. Signals go stale between drafting and scoring;
   trusting your own prior report is grading your own homework. Cite the re-verified state
   (fresh counts, fresh dates) in `evidence_sources`, not the brief's snapshot.
4. Score the permitted dimensions against the Rubric anchors (five for Feature; `reach` and
   `confidence` for Defect — `severity` is not in this role's write list even though it's an
   input, because severity is a human triage judgment call, not an evidence-gathering one).
5. `evidence_sources` is mandatory — every score traces to a citation. No citation → cap
   `confidence` at 4.
6. Never inflate value scores to offset thin evidence. Honest value + low confidence is the
   correct encoding; the multiplier carries the uncertainty.
7. Set `scored_by = Market Research Agent` (or `Hybrid` if revising human scores), ISO date.

## Role: PRIORITIZE (ranking scored rows)

**May write:** `status` only. Feature: `Scored` → `Prioritized` | `Deferred` | `Rejected`.
Defect: `Scored` → `Prioritized` | `Deferred` | `Rejected` (a "won't fix" call belongs to the
human reviewing the flag, not an auto-write — see below). Everything else is read-only.

Procedure:
1. Gate: if `Config!B9` ≠ "OK", halt and report broken weights. Do not rank.
2. Rank all `Scored` rows by `priority_score`, **regardless of item_type** — Feature and Defect
   rows share one rank, but treat it as a starting order, not a verdict.
3. **Flag for human review instead of deciding:**
   - rows within ±10% of the funding cut line (inside model noise)
   - `strategic_alignment` ≥ 8 with low rank (strategic bet buried by the effort divisor;
     Feature rows only, since Defects don't score this dimension)
   - `risk` ≥ 9 regardless of rank (one-way door; needs sign-off)
   - `severity` = 5 regardless of rank (critical/blocking defect; a Sev1 landing outside the
     top of the list is worth a human's eyes even though the formula already weights it heavily)
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

## Role: LOG (recording a defect/bug — human-authored, no agent dispatch)

There is no discovery/brief pipeline in front of a Defect row the way there is for Features —
a defect is already known the moment someone hits it. Logging is a direct, human (or
support-intake) write, not a role an agent performs:

1. Create the row: `feature_id` (`D-###` pattern), `feature_name`, `item_type = Defect`,
   `defect_source` (`Customer-Reported` | `Internal`), `status = Reported`.
2. Populate `brief_ref` with a path/link to the bug report, ticket, or repro write-up —
   whatever the fix pipeline (`/fix-defect-or-bug`) will need to reproduce it.
3. Leave scoring dimensions (`reach`, `confidence`, `severity`) for the human triager or the
   RESEARCH role to fill next, advancing `status` to `Triaged` once enough is known to score,
   then `Scored` once scored.
4. Never pre-fill `severity` optimistically to "get it moving" — an unscored `Reported` row is
   honest signal that triage hasn't happened yet, same principle as DISCOVER's "no signal is a
   finding" rule for Features.

## Invariants (all roles)

- One row per feature/defect; `feature_id` pattern `F-###` (Feature) or `D-###` (Defect) is the
  join key to briefs and bug reports respectively.
- Preserve provenance: never blank `scored_by`, `evidence_sources`, or `rationale_notes`.
- Schema changes go Data Dictionary first, then this skill — if they disagree, the
  Data Dictionary wins and this file is stale; say so.
- Known model behavior (Feature): cheap safe items can outrank strategic bets (effort divides).
  This is intentional; the strategic-alignment review flag is the counterweight.
- Known model behavior (Defect): severity dominates the fast-track formula by design — a
  low-reach Sev1 still ranks near the top, because blocking/data-loss defects shouldn't wait
  for a critical mass of affected customers before getting fixed.
