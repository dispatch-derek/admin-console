# Feature Value Scoring Framework — Index & Authority Order

This file is deliberately thin. The agent-facing rules that used to live here have moved
into the skill, and duplicating them invites drift. This document exists to tell any
reader — human or agent — where the authoritative version of each thing lives.

## Authority order (highest wins on conflict)

1. **`feature-value-scoring.xlsx` → Data Dictionary sheet** — the schema. Field IDs, column
   positions, types, allowed values, and field ownership. All agents parse this; nothing
   hard-codes columns. Schema changes land here first.
2. **`feature-value-scoring-SKILL.md`** — the operative agent contract. The two scoring models
   (Feature weighted-value, Defect severity fast-track, forked on `item_type`), the six roles
   (DISCOVER, RESEARCH, PRIORITIZE, BRIEF, DESIGN, LOG), their write permissions, procedures,
   and invariants. If this file and the Data Dictionary disagree, the Data Dictionary wins and
   the skill is stale — agents must say so.
3. **The five commands** — pipeline orchestration and gate enforcement:
   - `/scan-opportunities` — top-of-funnel discovery, human triage, Idea rows only (Feature only)
   - `/write-feature-brief` — brief authoring with optional discovery dispatch; never scores
     (Feature only — Defects are logged directly, see skill's LOG role)
   - `/prioritize-features` — research scoring, human gate, ranking, flags; never writes briefs;
     ranks Feature and Defect rows together
   - `/implement-spec` — implements a Feature's spec end-to-end; workbook touchpoints are
     status only (`In Progress` at intake, `Implemented` on green completion); never scores
     or ranks (Feature only)
   - `/fix-defect-or-bug` — reproduce, fail a regression test, fix, verify, and review a Defect
     row; never scores or ranks (Defect only)
4. **`feature-value-scoring-user-guide.md`** — explanation and rationale for humans.
   Descriptive, not normative: if the guide and the skill disagree, the skill wins and the
   guide needs updating.

## The one-paragraph summary

Every row is a Feature or a Defect (`item_type`), and the two fork onto different formulas
that land in the same `priority_score`/`rank`. Features: eight dimensions scored 1–10 against
rubric anchors, five combine into a weighted value, confidence and risk apply as multiplicative
discounts, effort divides. Defects: severity drives a fast-track score directly (reach as a
secondary multiplier, confidence as the same discount), bypassing weighted value, strategic
alignment, and the effort divisor entirely — a critical bug shouldn't wait on a business-value
argument. Either way the result opens a human conversation rather than closing it. Roles are
separated so no actor both frames a feature and evaluates it: discovery reports signals without
framing, the brief-writer frames without scoring, the research agent scores without inheriting
its own prior evidence unverified, the prioritizer ranks without deciding flagged items, and
humans own strategy, effort, risk, severity, every flag, and the `Cancelled` call (the
human-only terminal status for an item later judged not worth doing).

## Maintenance rule

Change things in authority order: Data Dictionary, then skill, then commands, then guide.
Anything found only in this file is by definition wrong — move it or delete it.
