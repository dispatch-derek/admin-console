# Spec Review — rev-7 Follow-up Verification

**Spec:** `specs/admin-console.md` (rev 7) · **Grounding:** `docs/anythingllm-surface.md` · **Governing:** `docs/governing-architecture.md`
**Prior review:** `docs/spec-review-rev6.md` (findings R-1..R-5)
**Reviewer:** spec-reviewer subagent, 2026-07-04 · Scope: verify R-1..R-5 resolved + regression-hunt the rev-7 `verified`-contract reconciliation.
**Verdict: ACCEPT.** All rev-6 findings closed; the `verified` scalar-vs-map contract is now internally consistent; ID integrity holds. Two non-blocking NOTES tracked for implementation.

## Part 1 — Per-finding verdicts

| Finding | Verdict | Resolving REQ(s) |
|---|---|---|
| R-1 scalar-vs-map `verified` reconciliation | CLOSED | REQ-028, REQ-029a, REQ-093 |
| R-2 `provider_changed` on failed 2xx-batch re-read | CLOSED | REQ-029b, REQ-029f, §14.2 row |
| R-3 `PATCH /api/settings` response carries verify map | CLOSED | REQ-101, REQ-098b |
| R-4 stale §13.2 MIN-6 note | CLOSED | §13.2 annotated (superseded-by → §13.3 N-3) |
| R-5 cosmetic id order | CLOSED (noted-only) | §13.4 R-5 note |

**Detail**

- **R-1 — CLOSED.** REQ-028 now states `verified` is a boolean per mutation/key EXCEPT the batched curated settings write, whose `admin.instance.setting_changed` serializes `verified` as a per-control-id MAP. REQ-029a adds a shape note (single-delta = scalar; batched curated = map) and its corrected test asserts a curated secret rotation produces `{ <secretId>: false }` in the map, while only a raw-editor rotation carries a scalar `verified:false`. REQ-093 records the per-control-id map for a batched settings audit entry. The three previously-stale definitions align with REQ-029c/029f.
- **R-2 — CLOSED.** Resolved decisively to emit-with-`verified:false`. REQ-029b's batch exception now names `admin.instance.provider_changed`; REQ-029f adds the failed-provider-re-read clause (emitted with `verified:false`, NOT suppressed); §14.2's `provider_changed` row is annotated to match. A non-OK engine write still suppresses BOTH events.
- **R-3 — CLOSED.** REQ-101 adds an HTTP-response contract: the `PATCH /api/settings` product response body returns the per-control-id verify map (a member of the shared product-settings type per REQ-062b), delivered over HTTP — distinct from the on-box bus event (REQ-029d). REQ-098b reads the map from the HTTP response, preserving the `web/`-can't-read-the-bus boundary.
- **R-4 — CLOSED.** §13.2 MIN-6 carries a "(SUPERSEDED by §13.3 N-3)" parenthetical; history preserved, not rewritten.
- **R-5 — CLOSED / no-op.** Correctly recorded as cosmetic; ids are stable and non-positional.

## Part 2 — Regression hunt on the `verified` contract

The reconciled rule — scalar boolean per mutation/key, EXCEPT a batched curated `PATCH /api/settings` write = per-control-id map on `setting_changed`; `provider_changed` carries its own scalar (emit-with-`false` on failed re-read); `raw_env.written` carries a scalar — is consistent across REQ-028, 029a, 029b, 029c, 029f, 093, 098a, 098b, 101 and all three §14.2 settings rows.

Cross-checks:
- **REQ-029a example vs REQ-061 vs REQ-078f — consistent.** REQ-029a's example is secret *rotation* (overwrite), which REQ-061 supports as unobservable → `verified:false`; it does not touch the set→unset case REQ-061 forbids. Curated rotation → `setting_changed` map entry `false`; raw rotation → `raw_env.written` scalar `false` (matches REQ-078f's raw-only event scope).
- **REQ-101 response-map vs REQ-029d vs REQ-062b — consistent.** The map is pinned to the HTTP response (readable by `web/`), separate from the bus event (REQ-029d, unreadable by `web/`), typed as a member of the shared product-settings type (REQ-062b).

### Findings
**Blocking: 0** (AMBIGUOUS 0 / UNTESTABLE 0 / CONTRADICTION 0 / GAP 0).

**Notes: 2** (non-blocking, tracked for implementation)
- **[NOTE-1] REQ-029 no-op parenthetical vs R-2.** REQ-029 says "a verified no-op (nothing actually changed) emits no event," while R-2 mandates a changed provider selector whose re-read shows no change emits `provider_changed` with `verified:false`. By outcome these describe the same post-state but prescribe opposite behavior. Not blocking: R-2 is the newer, specific clause and governs by specificity; REQ-029's no-op is intent/delta-based (a selector absent from the changed-fields body per REQ-033 is the true no-op). Suggested one-line clarification of REQ-029 to "(the operator submitted no changed value)".
- **[NOTE-2] REQ-093 `verified` for BFF-local staff-lifecycle audit entries (pre-existing, out of rev-7 delta).** REQ-018a/019 staff-account ops are BFF-local (no engine write, no verify-after-write), so the `verified` value for those audit entries is unspecified. Pre-existing gap unrelated to the R-1..R-5 reconciliation; flagged for awareness.

## ID integrity
No new REQ ids in rev 7 — all changes were in-place amendments. Every reconciled id (REQ-028, 029a, 029b, 029c, 029f, 093, 098a, 098b, 101) is defined exactly once. Retired/deprecated ids intact (REQ-050 RETIRED→REQ-117; REQ-085 DEPRECATED). All cross-references resolve; §14.2 rows match emitting REQs. No dangling/reused/renumbered ids.

## Overall verdict
**ACCEPT.** The spec is accept-ready as written. NOTE-1 (one-line clarity) and NOTE-2 (pre-existing out-of-delta gap) are non-blocking and can be tracked as implementation-time clarifications.
