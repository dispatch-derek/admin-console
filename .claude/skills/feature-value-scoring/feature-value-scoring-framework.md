# Feature Value Scoring Framework — Index & Authority Order

This file is deliberately thin. The agent-facing rules that used to live here have moved
into the skill, and duplicating them invites drift. This document exists to tell any
reader — human or agent — where the authoritative version of each thing lives.

## Authority order (highest wins on conflict)

1. **`feature-value-scoring.xlsx` → Data Dictionary sheet** — the schema. Field IDs, column
   positions, types, allowed values, and field ownership. All agents parse this; nothing
   hard-codes columns. Schema changes land here first.
2. **`feature-value-scoring-SKILL.md`** — the operative agent contract. The scoring model,
   the four roles (DISCOVER, RESEARCH, BRIEF, PRIORITIZE), their write permissions,
   procedures, and invariants. If this file and the Data Dictionary disagree, the
   Data Dictionary wins and the skill is stale — agents must say so.
3. **The three commands** — pipeline orchestration and gate enforcement:
   - `/scan-opportunities` — top-of-funnel discovery, human triage, Idea rows only
   - `/write-feature-brief` — brief authoring with optional discovery dispatch; never scores
   - `/prioritize-features` — research scoring, human gate, ranking, flags; never writes briefs
4. **`feature-value-scoring-user-guide.md`** — explanation and rationale for humans.
   Descriptive, not normative: if the guide and the skill disagree, the skill wins and the
   guide needs updating.

## The one-paragraph summary

Eight dimensions scored 1–5 against rubric anchors; five combine into a weighted value,
confidence and risk apply as multiplicative discounts, effort divides, and the result is a
0–100 priority score that opens a human conversation rather than closing it. Roles are
separated so no actor both frames a feature and evaluates it: discovery reports signals
without framing, the brief-writer frames without scoring, the research agent scores without
inheriting its own prior evidence unverified, the prioritizer ranks without deciding flagged
items, and humans own strategy, effort, risk, and every flag.

## Maintenance rule

Change things in authority order: Data Dictionary, then skill, then commands, then guide.
Anything found only in this file is by definition wrong — move it or delete it.
