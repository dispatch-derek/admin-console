# Prioritization run — 2026-07-20T08-09-02Z

Command: `/prioritize-features` (no arguments)
Workbook: `./feature-value-scoring.xlsx`
Snapshot (pre-mutation): `.prioritization-runs/2026-07-20T08-09-02Z/input.xlsx`
Dry run: **no** — the workbook was modified.
Branch: `feat/f-010-f-011-feature-briefs` (PR #32)

Two rows entered this run: **F-010** and **F-011**, both `Brief Drafted` after the
`/write-feature-brief` session immediately preceding it. Both were scored, human-gated,
ranked, and given a terminal status. No other row was touched.

---

## 1. Ranked list (Features and Defects together)

`priority_score` is computed by two different formulas — the weighted-value model for
Feature rows, the severity fast-track for Defect rows — landing in one shared column so
the two types rank against each other. That is the design, not an artifact.

| Rank | ID | Type | Score | Status | One-line rationale |
|---|---|---|---|---|---|
| 1 | D-003 | Defect | 85.0 | Prioritized | *(not in scope this run)* |
| 2 | F-001 | Feature | 46.2 | Prioritized | *(not in scope this run)* |
| 3 | F-007 | Feature | 36.4 | Prioritized | *(not in scope this run)* |
| **4** | **F-010** | **Feature** | **31.3** | **Prioritized** | Producer-side work is buildable now despite the consumer not existing: cwa's wire contract is frozen (REQ-F005-062 envelope freeze; REQ-F005-011 delivery-id shape this app already emits), and the gap is bounded — 0 credential-carrying code paths in `bff/src/relay`/`bff/src/events`, 0 of 8 relay config keys carry a secret. |
| 5 | D-001 | Defect | 29.7 | Prioritized | *(not in scope this run)* |
| 6 | D-002 | Defect | 24.2 | Prioritized | *(not in scope this run)* |
| 7 | F-008 | Feature | 22.1 | Prioritized | *(not in scope this run)* |
| 8 | D-006 | Defect | 21.4 | Prioritized | *(not in scope this run)* |
| 9 | F-005 | Feature | 21.1 | Implemented | *(in-flight; out of scope)* |
| 10 | F-003 | Feature | 20.5 | Prioritized | *(not in scope this run)* |
| 11 | F-002 | Feature | 17.3 | Prioritized | *(not in scope this run)* |
| 12 | F-006 | Feature | 12.9 | Prioritized | *(not in scope this run)* |
| **13** | **F-011** | **Feature** | **11.9** | **Deferred** | Hard sequencing constraint: cannot deliver value until cwa F-005 (In Progress) then cwa F-007 (Deferred) ship — until F-007 lands there is no `customer.*` stream arriving. Demand evidence thin by the brief's own accounting: 0 of 5 GitHub issues, 0 tickets, 0 analytics, 0 interviews. |
| 14 | F-004 | Feature | 10.0 | Implemented | *(in-flight; out of scope)* |
| 15 | F-009 | Feature | 9.9 | Prioritized | *(not in scope this run)* |
| 16 | D-004 | Defect | 8.0 | Prioritized | *(not in scope this run)* |
| 17 | D-005 | Defect | 7.5 | Prioritized | *(not in scope this run)* |

### Scores applied this run

| Row | reach | user_value | business_value | strat_align | time_sens | confidence | effort | risk | → score |
|---|---|---|---|---|---|---|---|---|---|
| F-010 | 2 | 5 | 4 | 9 | 6 | 5 | 2 | 5 | 31.3 |
| F-011 | 5 | 7 | 5 | 5 | 5 | 4 | 6 | 2 | 11.9 |

Agent-scored (research): `reach`, `user_value`, `business_value`, `time_sensitivity`,
`confidence`. Human-owned: `strategic_alignment`, `effort`, `risk`.

---

## 2. Review flags

**No flag fired this run.** Each condition was checked explicitly:

| Flag | Fires? | Detail |
|---|---|---|
| `strategic_alignment ≥ 8` with low rank (Feature) | **No** | F-010 has SA=9 but ranks 4 of 17 — top quartile, not buried. See the note below; this is the mirror image of the case the flag exists to catch. |
| `risk ≥ 9` (either type) | No | F-010 risk=5, F-011 risk=2. |
| `severity = 5` (Defect only) | N/A | No Defect rows in scope; both in-scope rows are Features. |
| `date_scored` > 90 days | No | Both scored 2026-07-20. |
| ±10% of cut line | **Suppressed** | No `--cut-line` supplied; none invented. |

### Worth a human's eyes even though no flag fired

**F-010 at rank 4 is the inverse of the model's documented failure mode.** The skill records
that the effort divisor normally *buries* high-strategic-alignment rows, with the SA flag as
counterweight. Here `effort=2` does the opposite — it **lifts** a row whose `reach=2` is the
lowest raw input in it, and whose brief states plainly that nobody feels the gap today.
F-010 now outranks nine already-Prioritized rows while having zero live traffic and no
consumer endpoint in existence. That is legitimate model behavior, not a scoring error, but
the placement rests on cheapness rather than on demand and should be accepted deliberately
rather than on the strength of a rank number.

**"Done" for F-010 is undefined.** Its brief's Open Question 2 asks whether the row can
meaningfully ship — or be verified — before cwa's ingest endpoint exists. Prioritizing it
does not answer that.

**F-011 and F-006 share an unresolved boundary.** F-011 (11.9) sits just below F-006 (12.9,
Prioritized), and both carry the same open question — *"where does customer-facing reporting
live?"* F-011's `business_value` was deliberately held **below** F-006's to avoid
double-counting a single product-owner sentence across both rows. Resolving that boundary
affects both rows' Effort and Risk, not just F-011's.

**Neither row's model inputs capture cross-repo blocking.** Both depend on unshipped
customer-web-app work (cwa F-005 In Progress, cwa F-007 Deferred). No dimension in either
formula represents "blocked on another repo." For F-010 that is a soft note; for F-011 it is
the deciding factor behind Deferred.

**D-006 consistency issue (flagged, not acted on).** D-006's `reach=1` is justified on the
basis that `EVENT_BUS_MODE=inproc` and `EVENT_BUS_URL` is empty, i.e. `HttpPeerTransport` is
inactive. If F-010 ships and puts a live peer on the wire, that stated basis stops describing
reality, and the fan-out composition means a second peer changes D-006's blast radius. Neither
GH #16 nor the workbook row records any dependency on F-010. **No rescoring proposed** — this
belongs to the human who owns that row.

---

## 3. BLOCKED list

**Empty.** No Feature row awaits a brief; no Defect row awaits triage.

(Both previously-blocked rows, F-010 and F-011, received briefs in the `/write-feature-brief`
session immediately before this run.)

---

## 4. HUMAN-GATE leftovers

**None outstanding.** Both in-scope rows hit the gate and were resolved inline by the product
owner during the run:

| Row | strategic_alignment | effort | risk |
|---|---|---|---|
| F-010 | 9 | 2 | 5 *(revised from 2)* |
| F-011 | 5 | 6 *(revised from 2)* | 2 |

Two values were revised after the evidence was challenged:

- **F-011 `effort` 2 → 6.** Anchor 2 is *"days; single dev, no design or new infra"*, which
  contradicts the verified scope: no inbound endpoint, no table for received events, no
  inbound retention config, 0 charting libraries among 3 production dependencies, 4
  build-blocking conformance gates. Because effort is the divisor this was decisive —
  `effort=2` scored ~35.8 (rank 3), `effort=6` scores 11.9 (rank 13). Same evidence, opposite
  conclusion.
- **F-010 `risk` 2 → 5.** Removing a peer is reversible, but a permanent rejection from any
  one peer parks the ordering key for *all* peers, and the credential would ship over a peer
  list with 0 scheme validation that accepts plaintext `http://`. Scored as a soft
  third-party dependency rather than trivially reversible.

---

## 5. STALE list

**Empty.** Oldest `date_scored` in the workbook is 2026-07-07 (13 days). Nothing approaches
the 90-day threshold.

*Data-hygiene note (not a flag):* `date_scored` is stored inconsistently — 4 rows as Excel
datetimes, 11 as ISO strings. Immaterial at current ages, but a naive staleness check that
parses only one type will silently miss rows once the backlog is older.

---

## 6. In-flight and cancelled counts

- **In flight: 2** — F-004, F-005 (`Implemented`). Owned by `/implement-spec`; out of this
  command's scope, counted only.
- **Cancelled: 0.**

---

## 7. Contract violations

**None.** Both research-agent returns were checked against the RESEARCH write contract before
any workbook write:

- Neither proposed `strategic_alignment`, `effort`, `risk`, `item_type`, `defect_source`,
  `severity`, or any formula column.
- `evidence_sources` non-empty on both rows; both carry citations with fresh 2026-07-20
  re-verification dates.
- All five agent-scored dimensions were integers in 1–10.
- Human-owned cells were asserted unchanged before and after each write.
- The Phase 6 status write was asserted to modify column D only.

### Agent corrections to the briefs (logged, not violations)

The research pass re-verified rather than inherited the briefs' `[agent-discovery 2026-07-19]`
leads, and found three inaccuracies. All three were corrected in the brief files during this
run:

1. **F-010** — the brief claimed the workbook note's "config-only" characterization was
   contradicted. The note actually reads *"Config-only on the relay side … **plus credential
   provisioning/runbook**"* — it had already scoped credential work in. The substantive
   finding (no credential code path exists, so this is a transport change) stands; the
   characterization was overstated and has been corrected in place with a dated note.
2. **F-010** — *"0 of 7 cwa rows Implemented on the ingest side"* was imprecise: cwa F-001
   **is** Implemented, it is simply not the ingest row.
3. **F-011** — *"30 registered HTTP routes"* could not be reproduced; the actual count is
   **52 route-method registrations** across the 8 route files. The load-bearing claim (0
   ingest paths) is unaffected. Also refreshed: `web/src` is now 132 files, not 128.

### Methodology note

The `feature-prioritizer` agent could not read the `.xlsx` directly (its Read tool refuses
binary files), so it sourced evidence from the two brief files rather than from the
`evidence_sources`/`rationale_notes` cells. Those cells were written from the same research
reports in Phase 3, so the content is materially equivalent — but the agent read a proxy for
the workbook, not the workbook itself.

---

## 8. Config used

| Setting | Value |
|---|---|
| Weight — reach | 0.20 |
| Weight — user_value | 0.25 |
| Weight — business_value | 0.25 |
| Weight — strategic_alignment | 0.20 |
| Weight — time_sensitivity | 0.10 |
| Weight check (`Config!B9`) | **OK** (sums to 1.00) |
| Confidence map | 1→0.45, 2→0.50, 3→0.58, 4→0.65, 5→0.73, 6→0.80, 7→0.85, 8→0.90, 9→0.95, 10→1.00 |
| Risk map | 1→1.00, 2→1.00, 3→0.95, 4→0.90, 5→0.85, 6→0.80, 7→0.75, 8→0.70, 9→0.65, 10→0.60 |
| Cut line | none supplied (±10% flag suppressed) |
| Dry run | no |
| Snapshot | `.prioritization-runs/2026-07-20T08-09-02Z/input.xlsx` |
| Formula errors after final recalc | **0** |

---

## Outcome

**F-010 → Prioritized** (rank 4 of 17) · **F-011 → Deferred** (rank 13 of 17)

Nothing awaits a decision to complete this run. Three items are carried forward for the
human as judgment calls, none of which this pipeline may make: F-010's placement resting on
cheapness rather than demand, the F-006/F-011 reporting-boundary question, and D-006's
`reach` basis being invalidated if F-010 ships.
