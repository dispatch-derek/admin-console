# Adversarial Spec Review — F-004 Production-Ready Event Bus (Replace the In-Process Bus)

Spec reviewed: `specs/F-004-production-event-bus.md` (Draft rev 1, `REQ-F004-###` namespace)
Brief: `briefs/F-004-production-event-bus.md`
Parent: `specs/admin-console.md` (v1, rev 7) — REQ-029/029a/029c/029d/029f, §14 catalog
Grounding: `bff/src/events/bus.ts`, `outbox.repo.ts`, `catalog.ts`, `emitter.ts`, `config.ts`,
`docs/design/04-cross-cutting.md` §c, `06-risks.md` R1
Reviewer posture: adversarial, read-only on the spec.

Checks executed (8/8): misinterpretation attack, one-line-test check, error-coverage sweep,
example-vs-prose reconciliation, definition audit, boundary audit, non-goal probe, cross-reference check.

---

## Summary verdict

**REVISE.** The spec is unusually disciplined about its own honesty: the §9 open questions are
genuinely open (no requirement secretly picks a broker), the crash-recovery and poison-isolation
core tests are pinned to concrete observable scenarios, and the transport-level dedupe-id approach
does **not** leak into the frozen event contract. But six blocking items would let two conformant
implementations diverge or describe behavior the grounded code/parent contract cannot produce. The
single highest-value cluster is the **drain-eligibility gap**: the spec pins the relay to the
existing `listUnpublished` query, which returns *every* `published_at IS NULL` row — including parked
and mid-backoff rows — directly contradicting the retry-backoff and park requirements.

Findings by severity: **Blocking/Major 6 · Minor 8 · Notes/Positives 5.**

---

## Factual verification (grounding claims confirmed against the codebase)

- **Envelope has no `id` field** (the crux of the dedupe question, REQ-F004-018/036): `AdminEventEnvelope`
  (`catalog.ts:28-35`) carries exactly `event, actor, target, changes?, verified, timestamp`. Confirmed.
- **`OutboxRelayBus.publish` is enqueue-only** (`bus.ts:30-34`): inserts, never marks published. Confirmed.
- **`InProcessBus`** inserts → emits by name + `'*'` → marks published immediately (`bus.ts:16-25`). Confirmed.
- **`outboxRepo.listUnpublished`** = `SELECT * ... WHERE published_at IS NULL ORDER BY id ASC`
  (`outbox.repo.ts:21-23`); no non-test caller in production. Confirmed. (This is load-bearing for B1.)
- **`markPublished`** = `UPDATE event_outbox SET published_at = ? WHERE id = ?` — *unconditional* overwrite,
  no `WHERE published_at IS NULL` guard (`outbox.repo.ts:18-20,31-33`). Relevant to REQ-F004-017 (M7).
- **Config** (`config.ts:50-51`): `eventBusMode = EVENT_BUS_MODE ?? 'inproc'`, `eventBusUrl = EVENT_BUS_URL`
  (optional); `isProduction = NODE_ENV === 'production'`. `eventBusMode` is **not** validated against
  `{inproc,bus}`; `getEventBus()` selects `bus` iff `=== 'bus'`, else `inproc` (`bus.ts:40`). Confirmed.
- **Parent REQ-024**: `GET /health → { ok: true }`, no session (`admin-console.md:299-300`). This is a
  fixed liveness payload with **no readiness/degraded dimension** — relevant to B6.
- **Parent REQ-100**: read-view render p95 < 1500 ms at ≤200 ws / ≤500 users; **no mutation/event rate**
  is defined (`admin-console.md:997-1000`). Relevant to B5.
- **§9 honesty check:** no requirement silently commits an open question. REQ-F004-030's default is
  "build against `EVENT_BUS_URL`, leave the broker to ops" — no broker product is chosen. No exactly-once
  is accidentally promised (definitions §3 explicitly permit duplicates). Confirmed honest.

---

## Blocking / Major findings

### B1 — [CONTRADICTION/GAP] §4.2/§6.1/§6.2, REQ-F004-010 vs REQ-F004-013/014 — the pinned drain query returns rows it must skip
REQ-F004-010 states the relay "reads unpublished rows via `outboxRepo.listUnpublished` (oldest-first,
`id ASC`)." That query (verified) is `WHERE published_at IS NULL ORDER BY id ASC` — it returns **all**
undelivered rows, with no notion of retry-eligibility or parked state. But:
- REQ-F004-014 says a **parked** row is "removed from the active retry set." A parked poison event still
  has `published_at IS NULL` (it was never delivered) — so `listUnpublished` keeps returning it, and the
  relay would re-attempt it forever, contradicting "removed from the active retry set" and re-tripping
  the very head-of-line block the requirement forbids.
- REQ-F004-013 requires failing rows to wait on a backoff schedule ("not hot-looped"), tracked via
  REQ-F004-029's `next-eligible-attempt time`. But `listUnpublished` does not filter on that column, so a
  row in backoff is re-selected on the very next tick.
Either `listUnpublished` must be replaced/parameterized (allowed — it is a read, not the frozen write
path of REQ-F004-005), or the relay must filter in memory; the spec says neither and instead pins the
drain to the unfiltered query.
**Resolution:** state that the drain source excludes parked rows and rows whose `next-eligible-attempt`
is in the future (a new query or an explicit in-relay filter), and stop citing the current
`listUnpublished` as the drain source verbatim.

### B2 — [AMBIGUOUS] §6.1/§6.2, REQ-F004-013/014 — head-of-line behavior during a *transient* (pre-park) failure is undefined
REQ-F004-014's poison test only covers the terminal case (a row that fails until max attempts, then
parks, then later rows deliver). It never specifies what happens to newer rows *while an older row is in
its backoff window but has not yet exhausted attempts*. Combined with the id-ASC drain (REQ-F004-010):
- **Reading A:** the relay processes strictly oldest-first and a row in backoff **blocks** every newer
  row until its next-attempt elapses — so one transiently-failing event stalls the whole stream for the
  backoff duration.
- **Reading B:** the relay **skips** a not-yet-eligible row and delivers newer eligible rows, returning
  to the backoff row when due — newer events flow past a transiently-failing older one.
These produce radically different latency and ordering under transient failure, and both satisfy every
written test. **Resolution:** state whether a mid-backoff row blocks or is skipped by younger rows.

### B3 — [GAP/AMBIGUOUS] §2/§4/§5 and throughout — "a conforming transport" is load-bearing but never defined
At least six requirements assert compliance "against a conforming transport stub/probe"
(REQ-F004-008, -010, -012, -018, -022, -027) yet no section defines what makes a transport *conforming*.
The tests silently assume the transport: (a) returns an **ack** distinguishable from error/timeout/nack
(REQ-F004-012); (b) can carry a **message-level delivery id** so a consumer can dedupe (REQ-F004-018);
(c) can signal a **permanent rejection** distinct from a transient one (REQ-F004-014, poison def §3).
A fire-and-forget transport, or one with no message metadata, provides none of these — yet would still
be "a transport at `EVENT_BUS_URL`." Two implementers build two different stubs and their tests diverge.
**Resolution:** specify the transport-adapter conformance contract (ack semantics, delivery-id/metadata
carriage, and the transient-vs-permanent-failure signal) as a first-class requirement the stub must meet.

### B4 — [CONTRADICTION] §3/§4.2 REQ-F004-011 "never zero" vs §6.2 REQ-F004-014 parked poison events (zero deliveries)
REQ-F004-011 states the headline guarantee as an absolute: an event "is delivered **one or more** times,
**never zero**." REQ-F004-014 parks a poison event that exhausts its attempts or is permanently rejected
— a parked event is delivered **zero** times (retained for inspection, never handed to the transport).
- **Reading A (REQ-011 literal):** every emitted event reaches the transport at least once.
- **Reading B (REQ-014):** every event is delivered at least once **or** parked-and-alerted.
A parked poison event satisfies B but violates A. The at-least-once floor and the parking escape hatch
are never reconciled. **Resolution:** scope the guarantee to "delivered at least once **or** isolated
(parked/dead-lettered) and alerted, never silently dropped," and make REQ-F004-011's "never zero"
consistent with that (the crash-recovery scenario it describes is fine; the universal phrasing is not).

### B5 — [UNTESTABLE/cross-ref] §8, REQ-F004-027 — the throughput half has no defined rate and cites the wrong parent req
REQ-F004-027's p95 < 5 s latency half is testable. Its throughput half — "sustains the deployment's
mutation event rate without unbounded backlog growth" — cites parent REQ-100 for "nominal single-instance
load." But REQ-100 (verified) defines a **read-view render latency** (p95 < 1500 ms) at a **data scale**
(≤200 ws, ≤500 users); it defines **no mutation or event emission rate**. There is therefore no number
against which "sustains the mutation event rate" can be tested, and REQ-100 is the wrong anchor for a
write/emit-throughput claim. (Mirrors F-001 B4.) **Resolution:** state a concrete emit rate (events/sec
or mutations/min) as the throughput target — as its own provisional constant flagged under REQ-F004-034
— rather than borrowing REQ-100, which does not carry one.

### B6 — [GAP/cross-ref] §6.6/§7, REQ-F004-021/026 — the "readiness/health signal" has no home in the parent's fixed `/health` contract
REQ-F004-021's `inproc`-in-production posture and REQ-F004-026's relay signal both depend on a
"failing readiness/health signal" and "non-ready health" usable by "the deployment's health checks."
But the only health surface in the parent is REQ-024: `GET /health → { ok: true }` — a fixed liveness
payload with no readiness dimension and no way to express "degraded/unhealthy." The spec never says
whether F-004 (a) **modifies** the REQ-024 `/health` contract (a parent-contract change, which the spec
elsewhere is careful to avoid), or (b) adds a **separate** readiness signal/endpoint. As written, the
enforcement mechanism for REQ-F004-021 (its whole "surfaced loudly" test) points at a signal that does
not exist and whose relationship to REQ-024 is unspecified. **Resolution:** name the concrete signal —
either an explicit extension of `/health` (and acknowledge the REQ-024 change) or a new readiness
endpoint/probe — and define its observable states.

---

## Minor findings

- **M1 — [GAP] EVENT_BUS_MODE=bus with EVENT_BUS_URL unset.** `EVENT_BUS_URL` is optional (`config.ts`).
  Nothing specifies relay behavior when `bus` mode is selected but no transport URL is configured — the
  relay has nowhere to deliver. REQ-F004-021's readiness test only covers "`bus` mode with a reachable
  transport." Define this (fail readiness? refuse start? treat as unreachable transport → backlog grows).
- **M2 — [GAP] Invalid EVENT_BUS_MODE value silently degrades.** `getEventBus()` selects `bus` iff
  `=== 'bus'`, else `InProcessBus`. So `EVENT_BUS_MODE=buss` (typo) silently runs `inproc` — in
  production this is exactly the mis-config REQ-F004-021 wants surfaced, but the posture only checks the
  literal string `inproc`. State that any non-`bus` value under production trips the same loud signal.
- **M3 — [AMBIGUOUS] Transient vs permanent rejection is undefined.** REQ-F004-012 treats a transport
  "reject" as increment-attempt-and-retry; poison def §3 / REQ-F004-014 treat "transport rejects as
  malformed/permanently undeliverable" as immediate isolation. The criterion distinguishing the two is
  never given (and is transport-dependent, deferred by REQ-F004-030). Two readings: (A) all failures are
  transient → park only on max-attempts; (B) some responses park immediately. Pin the classification, or
  state that rev 1 treats every failure as transient until max-attempts.
- **M4 — [GAP] "Single logical drainer within a deployment" vs per-process singleton.** REQ-F004-017
  asserts one drainer per "deployment," but the grounded factory creates one `OutboxRelayBus` **per
  process** with no cross-process coordination, and REQ-F004-029's bookkeeping columns include no
  claim/lease column. If a deployment runs more than one BFF replica against the shared `event_outbox`,
  multiple relays drain concurrently with no lease — the guarantee is violated and the "claim/lease"
  alternative REQ-F004-017 offers has no schema support. "Deployment" is also undefined (process? host?
  cluster?). State that the single-drainer guarantee assumes a single BFF process (consistent with
  REQ-100 single-instance nominal), or specify the lease + its schema.
- **M5 — [AMBIGUOUS] Graceful shutdown permits two behaviors.** REQ-F004-020: on shutdown the relay
  "finishes **or** cleanly abandons the in-flight delivery." Reading A: block until the in-flight
  delivery is acked/marked (bounded graceful drain). Reading B: abandon immediately, leave the row NULL
  for restart. These differ in shutdown latency and duplicate rate; both are at-least-once-safe but the
  test cannot distinguish them. Pick one (or state both are acceptable and why the test need not care).
- **M6 — [GAP] Delivery-id uniqueness scope.** REQ-F004-018 calls the `event_outbox` row `id` "stable
  and unique per emitted event." It is unique only **within one DB lifetime**: SQLite `rowid` restarts
  after a DB rebuild/reset/re-provision, so a fresh row could reuse an id a consumer already saw and be
  dropped as a duplicate. State the uniqueness scope (per-DB-lifetime) and whether that is acceptable, or
  compose the delivery id with a stable instance/epoch qualifier.
- **M7 — [Contradiction, minor] `markPublished` is not a strict no-op.** REQ-F004-017's test asserts a
  double-mark "is a no-op." The grounded `markPublished` (`UPDATE ... SET published_at = ? WHERE id = ?`)
  unconditionally overwrites the timestamp — idempotent in effect (still published) but it rewrites
  `published_at` to a later value, which is not literally a no-op. Either add a `WHERE published_at IS
  NULL` guard to the requirement or restate the test as "already-published re-mark does not error and
  leaves the row published" (drop "no-op").
- **M8 — [cross-ref] Cadence reference resolves to nothing.** REQ-F004-010 defers drain cadence "per
  §7/§9," but §7 (observability) and §9 (open questions, incl. REQ-F004-034 = metrics/SLO) specify no
  cadence. Cadence is actually left to implementation by `06-risks.md` ("Items the spec leaves to
  implementation: Outbox relay cadence and retry policy"). Point the reference there or state cadence is
  implementation-defined subject to REQ-F004-027's p95.

---

## Notes / positive confirmations (non-blocking)

- **P1 — Dedupe-id approach is sound and does NOT leak into the contract (focus-area confirmation).**
  REQ-F004-018/036 supply the delivery id at the transport/message level derived from the outbox row id,
  leaving `AdminEventEnvelope` byte-for-byte unchanged (REQ-F004-002/004). The envelope-has-no-`id` fact
  is accurately grounded, and the contract boundary (REQ-029c) is honestly preserved — the only residual
  concern is uniqueness scope (M6) and the transport's ability to carry the id (B3), not a contract leak.
- **P2 — Core crash/recovery and poison tests are genuinely concrete.** REQ-F004-011 ("crash after
  commit before delivery ⇒ redrained ⇒ delivered ≥1, never zero — for deliverable events; see B4") and
  REQ-F004-014 ("failing row parked, rows behind it still deliver") are pinned to observable
  crash/recovery and poison-then-succeed scenarios; two implementers cannot both claim compliance with
  divergent behavior on the happy/park paths. This is the spec's strongest section.
- **P3 — §9 open questions are honestly open.** Each carries a provisional default and a governing REQ,
  and none is silently overridden by a requirement elsewhere. In particular no requirement picks a broker
  (REQ-F004-030 stays deferred to ops), and no exactly-once is accidentally promised — the at-least-once
  floor and "duplicates possible" are stated in the definitions.
- **N1 — Event-name count.** REQ-F004-002 says "~17 event names"; `catalog.ts` lists 18. The "~" hedges
  it; harmless, but the exact count is 18 if precision is wanted.
- **N2 — "no double-processing" heading (REQ-F004-017) could be misread as exactly-once.** The body
  correctly scopes it to "not gratuitously multiply" under an at-least-once floor with mandatory consumer
  dedupe, so this is not a defect — flagging only because a downstream reader skimming headings might
  infer an exactly-once promise the spec does not make.

---

## Blocking items to resolve before ACCEPT

1. **B1** — stop pinning the drain to the unfiltered `listUnpublished`; exclude parked and not-yet-eligible rows.
2. **B2** — define head-of-line behavior for a mid-backoff (pre-park) row (block vs skip).
3. **B3** — specify the "conforming transport" contract (ack, delivery-id/metadata, permanent-vs-transient signal).
4. **B4** — reconcile at-least-once "never zero" with parked poison events (delivered-or-isolated).
5. **B5** — give REQ-F004-027 a real event-throughput number; stop borrowing REQ-100 (no rate there).
6. **B6** — define the readiness/health signal and its relationship to the parent REQ-024 `/health` contract.

**Overall: REVISE.** Traceability to the brief is complete (no dropped intent), the delivery-only
boundary is respected (the contract is not silently redefined and the dedupe id stays transport-level),
and the crash/poison core is testable. The blockers are targeted: a drain-eligibility contradiction, an
underspecified transport contract, an unreconciled at-least-once/parking edge, one untestable throughput
bound, one ambiguous backoff-ordering case, and a health-signal gap against the parent's fixed `/health`.
Fix the six and this spec is implementation-ready.
