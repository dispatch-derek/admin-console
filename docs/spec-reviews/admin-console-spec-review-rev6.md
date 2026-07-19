# Spec Review — rev-6 Verification Pass

**Spec:** `specs/admin-console.md` (rev 6) · **Grounding:** `docs/anythingllm-surface.md` · **Governing:** `docs/governing-architecture.md`
**Reviewer:** spec-reviewer subagent, 2026-07-04 · Scope: verify rev-5 findings N-1..N-7 + regression-hunt rev-6 edits.
**Verdict: REVISE (targeted) — accept-adjacent.** All seven rev-5 findings CLOSED; three MINOR + two NIT residuals from the rev-6 edits, none release-blocking.

## Part 1 — Per-finding verdicts

| Finding | Verdict | Resolving REQ(s) |
|---|---|---|
| N-1 (MAJOR, mixed-batch verify) | CLOSED | REQ-029f (new), REQ-029b/029c amended, REQ-098b (new), REQ-101, §14.2 catalog |
| N-2 (unverified-2xx UI semantics) | CLOSED | REQ-098a (new), REQ-098 |
| N-3 (`retrievalMode` ungrounded enum) | CLOSED | REQ-036b amended (validated free-text) |
| N-4 (raw-editor bypasses setting_changed) | CLOSED | REQ-078f (new), §14.2 `raw_env.written` note |
| N-5 (per-field control-id spelling) | CLOSED | REQ-062b (new), REQ-025, REQ-062a |
| N-6 (REQ-092 fresh-read scope) | CLOSED | REQ-092 amended |
| N-7 (secret set→unset unreachable) | CLOSED | REQ-028 amended, REQ-061 amended |

No rev-5 finding is PARTIALLY ADDRESSED or NOT ADDRESSED.

### Detail

- **N-1 — CLOSED.** Both halves of the rev-5 finding are addressed. (a) The undefined-flag problem
  is resolved: `admin.instance.setting_changed`'s `verified` is now a **per-control-id map**
  (product-control id → boolean), explicitly "NOT a single scalar" (REQ-029c, REQ-029f). (b) The
  unsafe all-or-nothing suppression is resolved: REQ-029b's suppression is scoped to single-delta
  ops, and the batched settings write is explicitly EXEMPT for a 2xx engine write — an observable
  key failing re-read is recorded `false` in the map but does NOT suppress the event, so
  secret/write-only keys that persisted are not hidden from the bus (REQ-029b amended, REQ-029f).
  The 2xx-partial-verify UI state is now defined per-control (REQ-098b), REQ-101 carries the map,
  and the §14.2 `setting_changed` row is reconciled. The mapping is internally consistent across
  REQ-029c/029f/098b/101 and §14.2 — see Part 2 for a residual scalar-vs-map wording inconsistency
  in the REQs that PRE-DATE the N-1 change (REQ-028/029a/093), which is a new MINOR, not a reopening
  of N-1.

- **N-2 — CLOSED.** REQ-098a defines the operator-facing "submitted but not verified" state for
  best-effort `verified:false` writes, with explicit secret-rotation wording ("submitted but its
  persistence could not be confirmed … re-check via the provider or re-enter") and a concrete test.
  REQ-098 references it. Distinct from "confirmed saved" as required.

- **N-3 — CLOSED, grounding-verified.** Grounding §3 lists `vectorSearchMode` as `string?` with
  default `default` and **no** enumerated values (line 64). REQ-036b now removes the ungrounded
  `default`/`rerank` enum and specifies validated free-text (trimmed, non-empty, no whitespace-only,
  default `default`) with a tightening hook if future grounding enumerates values. The relaxation
  matches the grounding fact exactly. §13.3 correctly flags this supersedes rev-5 MIN-6.

- **N-4 — CLOSED.** REQ-078f states raw-editor writes emit ONLY `admin.raw_env.written` (never
  `setting_changed`/`provider_changed`) even for curated/provider keys, declares it intentional with
  rationale (opaque `{key,value}` pairs not mapped to product-control ids/categories), and states the
  consumer consequence (subscribers must also watch `admin.raw_env.written`). The §14.2 row carries a
  matching note. Concrete test present.

- **N-5 — CLOSED.** REQ-062b makes the shared TypeScript product-settings type (REQ-025) the SINGLE
  normative contract of record for EVERY product-control id, demotes REQ-062a's `llm.*`/`embedding.*`
  mappings to illustrative examples, and states no field-suffix convention is authoritative. All
  consumers (web, `PATCH /api/settings` body, `setting_changed` payload) bind to the shared type.
  Directly addresses the rev-5 divergence concern.

- **N-6 — CLOSED.** REQ-092's scope note is corrected: the fresh-read-before-write pre-step covers
  dangerous INSTANCE-settings changes via `GET /v1/system` only; workspace-settings edits are guarded
  by view-open re-fetch (REQ-031) + partial-write clobber-avoidance (REQ-091), not this pre-step; and
  workspace/user DELETE are explicitly exempt (typed-target confirmation + verify-after-write). The
  earlier internal inconsistency (naming "workspace settings" as a `GET /v1/system` target) is gone.

- **N-7 — CLOSED.** REQ-028's observable bullet now lists only "secret unset→set" as the observable
  transition; a Note explains set→unset has no curated product trigger (REQ-061 empty=no change),
  is listed only for completeness, and is reachable only via an explicit clearing value through the
  raw editor "if the engine accepts one" (appropriately hedged). REQ-061 adds the matching statement
  that clearing a set secret is NOT a supported curated operation and v1 exposes no "clear secret"
  affordance. The raw-editor reachability is consistent with REQ-078d (a set→unset boolean change is
  an observable-key write → `verified:true`).

## Part 2 — New findings (rev-6 regression check)

### BLOCKER
None.

### MAJOR
None.

### MINOR

- **R-1 (CONTRADICTION, scalar-vs-map `verified`).** The N-1 fix made
  `admin.instance.setting_changed`'s `verified` a per-control-id MAP (REQ-029c: "NOT a single
  scalar"; REQ-029f), but the upstream REQs that define the `verified` contract still assert a
  scalar and were not reconciled:
  - REQ-028 (§4.2, line 196): "Each mutation is marked with a `verified` **boolean** (carried on the
    emitted event and audit entry, REQ-029c/093)." For the batched settings mutation this is false —
    it is a map. REQ-028 even cross-references REQ-029c as if it agreed.
  - REQ-029a test (§14.1, line 1255): "a secret rotation returning 2xx emits its event with
    `verified:false`." A curated secret rotation goes through `PATCH /api/settings` →
    `setting_changed`, whose `verified` is a map (`{ <secretId>: false }`) per REQ-029f — so an
    implementer testing `event.verified === false` would fail against a compliant map payload. (Only
    a raw-editor rotation → `raw_env.written` carries a scalar `verified:false`.)
  - REQ-093 (§10.1, line 912): the audit entry records "the `verified` flag (REQ-028)" — scalar
    implied; whether a batched settings audit entry stores a boolean or the per-control-id map is
    left unspecified (REQ-029f defines the map for the EVENT only).
  These are non-blocking because REQ-029c/029f explicitly and specifically override for
  `setting_changed` and cross-reference correctly; a careful reader reaches the right shape. But the
  blanket "boolean" language is a genuine contract inconsistency worth a one-line reconciliation
  (e.g., REQ-028: "marked with a `verified` result — a boolean for single-delta ops, a per-control-id
  map for batched settings per REQ-029f"; REQ-029a test qualified to the raw path or restated as a
  map; REQ-093 stating the audit `verified` shape for a batched write).

- **R-2 (AMBIGUOUS, `provider_changed` emission on failed re-read in a 2xx batch).** REQ-029f says
  `admin.instance.provider_changed` "is emitted per changed provider selector, each carrying its OWN
  `verified` boolean from that selector's re-read." A provider selector (`LLMProvider`, etc.) is a
  non-secret OBSERVABLE value. If, in a 2xx batch, that selector's re-read shows the provider did NOT
  actually change:
  - Reading A (REQ-029f literal): emit `admin.instance.provider_changed` with `verified:false`.
  - Reading B (REQ-029b general rule): an observable change whose re-read "affirmatively shows the
    change DID NOT take effect" emits NO success event — so suppress `provider_changed`.
  REQ-029b's batched exception is worded around suppressing "the whole `admin.instance.setting_changed`
  event" and does not name `provider_changed`, leaving the distinct `provider_changed` event exposed
  to both readings. Two compliant implementations diverge, and a `provider_changed:false` emitted for
  a provider that did not change could mislead bus consumers. Recommend one clause stating whether
  `provider_changed` is suppressed or emitted-with-`false` when its own observable re-read fails.

- **R-3 (GAP, `PATCH /api/settings` response contract for the verify map).** REQ-098b requires the
  UI to read "the per-control-id verify map from the response / `admin.instance.setting_changed`
  payload (REQ-029c/029f)." The web app cannot read the on-box bus event (that bus is for independent
  backend feature services, REQ-029d), so it must obtain the map from the HTTP response to
  `PATCH /api/settings`. However, no REQ defines that the `PATCH /api/settings` product RESPONSE body
  carries the per-control-id verify map — REQ-029f/029c/101 define the map for the EVENT payload only;
  the §7 intro and REQ-062a/101 do not specify the response shape. REQ-098b's per-control UI rendering
  is only testable if the response carries the map. Recommend a clause pinning the
  `PATCH /api/settings` response to include the per-control-id verify results (naturally a member of
  the shared product-settings type per REQ-062b).

### NIT

- **R-4.** §13.2 MIN-6 (line 1194) still records `retrievalMode` as "constrained to `default`/`rerank`
  (REQ-036b)". This is an accurate rev-5 changelog entry and §13.3 N-3 explicitly supersedes it, so it
  is not normative; but a reader scanning §13.2 in isolation could mistake it for current behavior.
  The normative source (REQ-036b) is correctly free-text. No action required beyond awareness.

- **R-5.** Requirement-id document order: REQ-029f is defined in §14.1 (line 1288) while the
  pre-existing REQ-029e is defined at the end of §14.2 (line 1335) — i.e. `029e` now appears after
  `029f` in reading order. IDs are stable/non-positional per the header rule, so this is cosmetic
  only.

## ID integrity

- **New ids introduced (rev 6):** REQ-029f, REQ-062b, REQ-078f, REQ-098a, REQ-098b — each defined
  exactly once; no reuse of retired/deprecated ids (REQ-050 retired, REQ-085 deprecated remain
  untouched).
- **Inbound references resolve:** REQ-029f ← REQ-029b/029c/098b/101, §14.2, §13.3; REQ-062b ← §13.3;
  REQ-078f ← §14.2, §13.3; REQ-098a ← REQ-098/098b, §13.3; REQ-098b ← REQ-098/101, §13.3. No dangling
  targets.
- **Cross-references check out:** REQ-098b→REQ-029c/029f/101/098a; REQ-029f→REQ-101/028/063/029b;
  REQ-062b→REQ-025/062a/029c/029f; REQ-078f→REQ-078a/b/c/d/e/088a; REQ-028 note→REQ-061/078a;
  REQ-061→REQ-028 — all present and consistent with the referring text.
- **§14.2 catalog rows** match emitting REQs: `setting_changed` (§7 intro/REQ-101/REQ-029f, map
  `verified`), `provider_changed` (REQ-063, own boolean), `raw_env.written` (REQ-078d/078f, N-4 note).
- No renumbered or reused ids detected.

## Overall verdict

**REVISE (targeted).** All seven rev-5 findings (N-1 MAJOR, N-2..N-7) are CLOSED and the N-1 fix is
internally consistent across its primary REQs (029c/029f/098b/101, §14.2). The remaining items are
three MINOR editorial/contract reconciliations (R-1 scalar-vs-map wording in REQ-028/029a/093; R-2
`provider_changed`-on-failed-re-read ambiguity; R-3 undefined `PATCH /api/settings` response contract
for the verify map) plus two NITs. None is release-blocking — the spec is implementable as written
because the specific REQs (029c/029f/098b) override the stale blanket language via explicit
cross-references. Given this is the second review round and precision returns are diminishing, a
single targeted editorial pass on R-1..R-3 would finalize the spec; absent that pass, it is
acceptable to proceed with R-1..R-3 tracked as known clarifications.
