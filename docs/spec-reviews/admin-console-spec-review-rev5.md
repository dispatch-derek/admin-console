# Spec Review — rev-5 Verification Pass

**Spec:** `specs/admin-console.md` (rev 5) · **Grounding:** `docs/anythingllm-surface.md` · **Governing:** `docs/governing-architecture.md`
**Reviewer:** spec-reviewer subagent, 2026-07-04 · Scope: verify rev-4 findings + regression-hunt rev-5 edits.
**Verdict: REVISE (targeted) — near-accept.** All rev-4 blockers/majors resolved; one new Major (N-1) to close.

## Part 1 — Per-finding verdicts

| Finding | Verdict | Resolving REQ(s) |
|---|---|---|
| BLK-1 event cardinality | CLOSED | REQ-029, 029e, 063, 101, 043/049 |
| BLK-2 verify feasibility | CLOSED (residual N-1) | REQ-028, 061, 078d, 029a/b/c, 093 |
| BLK-3 §7 product vocabulary | PARTIALLY ADDRESSED (residual N-5) | REQ-062a, 021a |
| MAJ-1 pin route | CLOSED | REQ-039, §14 |
| MAJ-2 membership ownership | CLOSED | REQ-021b |
| MAJ-3 delete vs 404 | CLOSED | REQ-028, 038, 044, 097 |
| MAJ-4 membership deltas | CLOSED | REQ-027 step 4, 049 |
| MAJ-5 orphan remove-documents | CLOSED | REQ-087, 122 |
| MIN-1 engine names in REQ-077 | CLOSED | REQ-077, OQ-3 |
| MIN-2 provider_changed count | CLOSED | REQ-063, 101 |
| MIN-3 category payload | CLOSED | REQ-029c, 101, §14 |
| MIN-4 post-create numeric id | CLOSED | REQ-037 |
| MIN-5 avatar mechanism | CLOSED | REQ-036c, 121 |
| MIN-6 retrievalMode enum | PARTIALLY ADDRESSED (residual N-3) | REQ-036b |
| NIT-1 bootstrap env | CLOSED | REQ-019a |
| NIT-2 fresh-read scope | CLOSED (residual N-6) | REQ-092 |

No prior finding is NOT ADDRESSED.

## Part 2 — New findings (rev-5 regression check)

### MAJOR
**N-1 — Batched settings write mixing observable + unobservable keys has an undefined `verified` flag and unsafe all-or-nothing event suppression.** REQ-101 makes the curated save one `update-env` call emitting one `setting_changed` with a single `verified` boolean (REQ-029c), but REQ-028 assigns `verified` per key class. A batch can mix observable (true), secret-overwrite (false), write-only (false). (a) The single flag's value for a mixed batch is undefined (AND / observable-only / split). (b) REQ-029b's suppression: one observable key failing verification suppresses the whole `setting_changed` event even though secret/write-only keys in the same call may have persisted — hiding a real secret write from the bus and leaving REQ-098's UI state (only covers non-OK HTTP) undefined for 2xx-with-partial-verify-failure.
**Fix:** make `setting_changed`'s `verified` a per-control-id map (or split into per-key events); define batch behavior when some observable keys verify and others don't (emit with per-key detail, not all-or-nothing suppression); add a REQ-098 clause for the 2xx-but-verify-failed batch.

### MINOR
- **N-2** — Operator-facing semantics of a `verified:false` best-effort 2xx write are unspecified (REQ-098 only covers non-OK). Add a requirement that the UI surfaces the unverified state (esp. secret rotation) + a test.
- **N-3** — REQ-036b's `retrievalMode` values `default`/`rerank` are not grounded; grounding §3 shows `vectorSearchMode` only as `string?` default `default`. Verify against engine source; cite real values or relax to validated free-text.
- **N-4** — Raw-editor writes to provider/curated keys emit only `admin.raw_env.written`, bypassing `setting_changed`/`provider_changed`; bus consumers watching `provider_changed` miss break-glass provider changes. State whether intended and note in §14.
- **N-5** (BLK-3 residual) — REQ-062a leaves per-field control-id spelling to convention for the ~180 non-representative keys (and renames inconsistently: `llm.ollama.model`→`OllamaLLMModelPref` vs `llm.ollama.baseUrl`→`OllamaLLMBasePath`). Web/BFF agree by shared type (REQ-025) but downstream/event-consumer contracts diverge. Make the shared TS product-settings type the contract of record, or pin the field-suffix convention.

### NIT
- **N-6** — REQ-092 scope note names "workspace settings" as a fresh-read target, but its trigger is dangerous ops and mechanism is `GET /v1/system` (instance-only); minor internal inconsistency.
- **N-7** — REQ-028 lists "secret set→unset" as an observable verified transition, but no curated product op can unset a secret (REQ-061 empty=no change). Unreachable case; clarify whether unsetting is supported.

## ID integrity
New ids REQ-036b/036c/062a/121/122 defined; inbound refs resolve; §14 rows match emitting REQs; delete-404 exception consistent across REQ-028/038/044/097. No dangling/reused ids.
