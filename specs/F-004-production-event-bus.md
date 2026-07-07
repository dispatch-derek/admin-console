# F-004: Production-Ready Event Bus (Replace the In-Process Bus) — Specification

Status: Draft rev 3 — §9 open questions ratified/decided by 2026-07-07 human rulings; for implementation and QA review
Feature brief (authoritative intent): `briefs/F-004-production-event-bus.md`
Parent spec (conventions, architecture, shared requirements): `specs/admin-console.md` (v1, rev 7)
Grounding references: `bff/src/events/bus.ts`, `bff/src/events/emitter.ts`, `bff/src/events/catalog.ts`,
`bff/src/store/repositories/outbox.repo.ts`, `bff/src/config.ts`, `docs/design/04-cross-cutting.md` (§c),
`docs/design/06-risks.md` (R1).

This is an **infrastructure** feature spec layered on `specs/admin-console.md`. It changes the **delivery
mechanism** of the already-built `admin.*` domain-event spine; it does **not** change what is emitted. It
introduces a distinct requirement-ID namespace, **`REQ-F004-###`**, so its IDs never collide with the
parent spec's `REQ-###` series or any sibling `REQ-F00x-###` series. Section numbers (§1, §1.1, …) below
are **local to this document**; downstream tests cite the `REQ-F004-###` id (globally unique) plus the
local §. Requirement IDs and section numbers are **stable**: never renumber or reuse an id; append new
ids or mark items **DEPRECATED**.

This is a **backend / on-box infrastructure** feature. There is deliberately **no Web UI or UX/Design
section**: the browser cannot and does not read the on-box bus (parent REQ-029d), so F-004 introduces no
frontend surface. Where this spec reuses parent-spec machinery (the domain-event emission chain
REQ-029/029a/029b, the minimal-payload + redaction + `verified` contract REQ-029c/029f, the on-box bus
publication target REQ-029d, the §14 event catalog, and the transactional outbox design in
`docs/design/04-cross-cutting.md` §c) it cites the parent `REQ-###` id rather than restating it.

---

## §1 Overview & Scope

### §1.1 Purpose
F-004 builds the **production delivery path** for the console's `admin.*` domain events: a background
**outbox relay** that drains the durable `event_outbox` table, delivers each event to a real
on-box/durable bus (transport reachable at `EVENT_BUS_URL`), marks rows published on success, retries
with backoff on failure, isolates poison events, and back-fills after an outage. It makes `bus` mode
the production configuration and demotes `inproc` (the interim Node `EventEmitter`) to development-only.

- REQ-F004-001 — F-004 delivers, **behind the existing `EventBus` seam** (`bff/src/events/bus.ts`), a
  **per-key-ordered, effectively-once-or-isolated** delivery guarantee for every `admin.*` event the
  console emits after a verified mutation (parent REQ-029/029a): every emitted event is delivered to the
  transport **one or more times** (at-least-once on the wire) with **in-order delivery within its
  ordering key** (REQ-F004-016/031) and **consumer dedupe via the transport delivery id** (REQ-F004-018/036)
  yielding **effectively-once** processing, **or** — if it cannot be delivered (poison / max attempts
  exhausted / permanent rejection) — is **isolated** (parked or dead-lettered) and alerted
  (REQ-F004-014/025); an emitted event is **never silently dropped** (see the reconciled guarantee
  statement in §5 REQ-F004-011 and the §3 definition). Ordering is guaranteed **within** an ordering key
  and skip-ahead is permitted **across** keys (REQ-F004-016/042); effectively-once is **not**
  broker-enforced exactly-once (REQ-F004-031). The seam is unchanged for callers: `emitAdminEvent()`
  (`bff/src/events/emitter.ts`) still calls `getEventBus().publish()`, which in `bus` mode durably
  enqueues the `event_outbox` row (already implemented, `OutboxRelayBus.publish`); F-004 adds the relay
  that drains and delivers it. *Test:* enabling `bus` mode requires **no** change to any
  `emitAdminEvent` call site or to any mutating route/service; a static scan confirms services still
  publish only via `emitAdminEvent`, and an emitted event is delivered to a subscribed transport at
  least once.

### §1.2 F-004 changes DELIVERY, not the contract
- REQ-F004-002 — The event **contract** — the `admin.*` catalog (`bff/src/events/catalog.ts`, 18
  event names; parent §14.2), the `AdminEventEnvelope` shape (parent REQ-029c), event **cardinality**
  ("one or more" per state delta, parent REQ-029/029e), the per-control `verified` map for
  `admin.instance.setting_changed` (parent REQ-029f), and secret **redaction before publish** (parent
  REQ-029c, applied in `emitAdminEvent` via `redactSecrets`) — is defined, built, and **out of scope**
  for F-004 (§2). F-004 consumes the already-redacted, already-shaped envelope as opaque bytes and
  delivers it unchanged. *Test:* the relay delivers the exact envelope JSON that was persisted to
  `event_outbox`, byte-for-byte, without re-shaping, re-redacting, or dropping any field.

### §1.3 Relationship to the parent spec
- REQ-F004-003 — F-004 is what actually **satisfies parent REQ-029d** ("Events publish to the shared
  on-box event bus so independent feature services may subscribe and react") in production. Today
  REQ-029d is met only in principle: the `inproc` default publishes to an in-process `EventEmitter`
  with no cross-process reach, and `bus` mode enqueues rows that are never drained. F-004 makes the
  parent REQ-029d test ("a subscriber on the bus receives the published event after a write") pass for
  an **independent, out-of-process** subscriber. The parent rule that `web/` **cannot** read the bus
  (parent REQ-029d; it reads mutation results over HTTP, e.g. REQ-101) is preserved unchanged. *Test:*
  after a verified mutation with `bus` mode active, a second process subscribed to the transport
  receives the corresponding `admin.*` event; no browser-originated code path can subscribe to or read
  the transport.

---

## §2 Out of Scope (Non-Goals)

Mirrors the brief's Out of Scope. Each is a boundary a QA engineer can assert F-004 did **not** cross.

- REQ-F004-004 — The **event contract itself** — the `admin.*` catalog, envelope shape, cardinality
  (parent REQ-029), the `verified` semantics (parent REQ-029a/029f), and redaction (parent REQ-029c) —
  is not changed, extended, or re-specified by F-004. *Test:* no F-004 change edits
  `bff/src/events/catalog.ts` event names/payloads or the `AdminEventEnvelope` shape (but see
  REQ-F004-018 / §9 REQ-F004-036 on a delivery-level dedupe id, RATIFIED 2026-07-07 as a transport
  concern — it does **not** change the envelope).
- REQ-F004-005 — The **transactional outbox WRITE** — the `event_outbox` INSERT performed in the same
  DB transaction as the verify result (`outbox.repo.ts` `insert`; `OutboxRelayBus.publish`;
  `docs/design/04-cross-cutting.md` §c) — is already implemented and is **consumed, not rebuilt**, by
  F-004. F-004 MAY add delivery-bookkeeping columns/table (REQ-F004-029) but does not alter the
  atomic write-in-verify-txn path itself. *Test:* the emit → INSERT-in-verify-txn behavior is
  unchanged; F-004 code does not modify the transactional insert semantics.
- REQ-F004-006 — **No web/frontend change.** The browser cannot read the on-box bus (parent REQ-029d).
  F-004 touches no `web/` code. *Test:* F-004 introduces zero changes under `web/`.
- REQ-F004-007 — **Building downstream consumers** (audit/compliance pipelines, alerting, cross-service
  automation) is separate work. F-004 delivers events reliably to the transport; what subscribes is
  out of scope (a transport stub/probe suffices for F-004's own tests). *Test:* F-004's deliverables
  contain no production consumer of `admin.*` events beyond test doubles/probes.
- REQ-F004-008 — **Provisioning the physical broker** — choosing, standing up, and operating the actual
  on-box bus product/appliance service — may be an **ops/platform dependency, not a console-code
  build** (brief Out of Scope; `docs/design/06-risks.md` R1 leaves the bus technology deferred). F-004
  builds the relay + a transport adapter **against** `EVENT_BUS_URL`; the concrete broker behind that
  URL is flagged as a dependency in §9 (REQ-F004-030), not delivered by this feature. *Test:* F-004 is
  demonstrable against a conforming transport stub at `EVENT_BUS_URL` without a specific broker
  product being present in-repo.

---

## §3 Definitions & Glossary

- **Outbox** — the durable `event_outbox` table (`outbox.repo.ts`): columns `id`, `ts`, `envelope`
  (JSON `AdminEventEnvelope`), `published_at` (nullable). A row is written in the same DB transaction
  as the verify result (`docs/design/04-cross-cutting.md` §c). The record of an event, independent of
  its delivery.
- **Relay (drain worker)** — the F-004 background component that repeatedly selects the **eligible**
  undelivered rows (unpublished **and** not parked **and** whose next-attempt time has elapsed —
  REQ-F004-041, **not** the unfiltered `listUnpublished`), delivers them to the transport, and marks
  them published on success. Does not exist today (the `OutboxRelayBus` comment calls it "a later
  slice").
- **Transport / broker** — the real on-box/durable bus the relay delivers to, reachable at
  `EVENT_BUS_URL`, satisfying the **conforming-transport contract** (REQ-F004-043: ack, delivery-id
  carriage, permanent-vs-transient rejection signal). Its concrete technology/wire protocol is deferred
  (§9, REQ-F004-030; `docs/design/06-risks.md` R1).
- **Delivery / publish (to the bus)** — handing an envelope to the transport and receiving its
  acknowledgement (ack, REQ-F004-043). Distinct from the outbox INSERT.
- **Per-key-ordered, effectively-once-or-isolated (the guarantee)** — every emitted event is delivered
  one **or more** times (at-least-once on the wire), **in order within its ordering key** (skip-ahead
  permitted across keys, REQ-F004-016/042), **or** — if undeliverable — **isolated**
  (parked/dead-lettered, REQ-F004-014) and alerted; it is **never silently dropped**. Duplicates are
  possible on the wire (a crash after transport ack but before `markPublished`) and are collapsed to
  **effectively-once** processing by consumer dedupe on the stable transport delivery id (REQ-F004-018/036);
  this is **not** broker-enforced exactly-once (REQ-F004-031). "Isolated" is the explicit escape hatch
  that reconciles the "never zero deliveries" floor with poison events: a parked event has zero
  *deliveries* but is retained, queryable, and alerted — not lost; under per-key ordering a parked event
  also stalls **its own key's** subsequent rows (REQ-F004-014/032) without blocking other keys.
- **Ordering key** — the per-partition key that scopes ordering (REQ-F004-016/031), derived from the
  `AdminEventEnvelope.target` (parent REQ-029c): the identifier of the mutated entity, namespaced by
  target type — e.g. `ws:<workspaceId>` for `admin.workspace.*`, `user:<userId>` for `admin.user.*`,
  and the reserved singleton key `instance` for the instance-settings target of `admin.instance.*`.
  An event whose target exposes **no** natural entity id falls into the reserved default key
  `__unkeyed__` and is treated as **unordered** relative to other `__unkeyed__` events (no per-key
  ordering guarantee among them; best-effort id-ascending only). The key is computed once from the
  persisted envelope and stored in the `ordering_key` column (REQ-F004-029/038) so the relay enforces
  per-key order and per-key head-of-line (REQ-F004-042) without recomputing it each drain.
- **Eligible row (drain selection)** — an `event_outbox` row that is unpublished
  (`published_at IS NULL`), **not** parked (`parked_at IS NULL`), whose `next_attempt_at` is null or
  in the past, **and** for which no **older** unpublished-or-parked row shares its `ordering_key`
  (per-key head-of-line, REQ-F004-042). Only eligible rows are drained (REQ-F004-041); across distinct
  ordering keys the relay may skip ahead freely, but within a key the oldest undelivered row must go
  first.
- **Parked / next-attempt bookkeeping** — the DELIVERY-bookkeeping state (attempt_count,
  next_attempt_at, last_error, parked_at) F-004 adds (REQ-F004-029) to make retry/backoff and parking
  observable and selectable. This is delivery state, **not** a change to the frozen event contract
  (REQ-F004-004).
- **Backfill** — draining rows that accumulated as `published_at IS NULL` while the transport was
  unreachable, once it becomes reachable again (`docs/design/04-cross-cutting.md` §c: "back-fill once
  the bus appears").
- **Poison event** — a row that repeatedly fails delivery (e.g. transport rejects it as malformed, or
  it exceeds max attempts). Must be isolated so it does not block the queue (park or dead-letter, §9
  REQ-F004-032).
- **Park / dead-letter (DLQ)** — removing a poison event from the active retry set (marking it parked
  in place, or moving it to a dead-letter store) and alerting, so the relay continues with subsequent
  rows **of other ordering keys**. Under per-key ordering (REQ-F004-031) a parked row still blocks its
  **own** key's later rows (per-key head-of-line, REQ-F004-014/042): that key **stalls** (and is flagged
  by the parked-count metric, REQ-F004-025) until the parked row is resolved/replayed, but no other key
  and no global progress is blocked.
- **Relay lag** — the age of the oldest unpublished (`published_at IS NULL`, non-parked) outbox row;
  the primary delivery-freshness signal.
- **Backlog** — the count of unpublished, non-parked outbox rows awaiting delivery.

---

## §4 Current State (grounded) & Delivery Architecture

### §4.1 What is built (verified in-repo)
- REQ-F004-009 — F-004 is scoped against the following **verified** state of the code (grounding, to
  re-confirm at build time):
  - `bff/src/events/bus.ts` defines `EventBus.publish`. `InProcessBus` (default) INSERTs the outbox
    row, emits over a Node `EventEmitter` (by name and to a `'*'` firehose), then `markPublished`
    immediately. `OutboxRelayBus` (selected when `config.eventBusMode === 'bus'`) **only** INSERTs the
    row and never marks it published — its comment states the "background outbox relay (a later slice)"
    that drains `published_at IS NULL` rows "was never built."
  - `outbox.repo.ts` exposes `insert`, `markPublished`, and `listUnpublished` (`SELECT * … WHERE
    published_at IS NULL ORDER BY id ASC`). **`listUnpublished` has zero production callers** — only
    test files reference it (`bff/test/events/bus.test.ts`, `bff/test/events/emitter.test.ts`).
  - There are **zero real event subscribers**: the only `.emitter.on(...)` usages are in tests.
  - `config.ts` (per `docs/design/04-cross-cutting.md` §h): `eventBusMode = EVENT_BUS_MODE ?? 'inproc'`;
    `eventBusUrl = EVENT_BUS_URL` (optional).
  *Test:* a static audit confirms `listUnpublished` has no non-test caller and no non-test subscriber
  exists at the time F-004 work begins; F-004 introduces the first production caller (the relay).

### §4.2 Delivery model (the F-004 build, behind the seam)
- REQ-F004-010 — **The relay drains the outbox (eligible rows only).** F-004 provides a background
  relay that, in `bus` mode, repeatedly reads the **eligible** rows (the drain-selection contract,
  REQ-F004-041 — oldest-first, `id ASC`), delivers each envelope to the transport at `EVENT_BUS_URL`,
  and on a successful ack calls `outboxRepo.markPublished(id, <iso>)`. The unfiltered
  `outboxRepo.listUnpublished` is **NOT** the drain source (it returns parked and mid-backoff rows too,
  hot-looping poison and not-yet-due rows — see REQ-F004-041); F-004 replaces/augments it with an
  eligibility-filtered selection. The relay runs continuously; the drain **cadence** (poll interval /
  drain-on-enqueue) is **implementation-defined** (`docs/design/06-risks.md`: "the spec leaves relay
  cadence and retry policy to implementation") subject to the delivery-latency bound REQ-F004-027.
  *Test:* with `bus` mode and a reachable conforming transport probe (REQ-F004-043), emitting an event
  results in (a) the transport probe receiving the envelope and (b) that row's `published_at`
  transitioning from NULL to a timestamp; with the transport unreachable, the row stays NULL.
- REQ-F004-011 — **Per-key-ordered, effectively-once-or-isolated durability across a crash between emit
  and deliver (the core guarantee).** Because the outbox INSERT is committed in the verify transaction
  (parent chain; `04-cross-cutting.md` §c) and `markPublished` happens only after a transport ack, an
  event is never lost by a crash between emit and delivery. The guarantee, stated precisely (and
  reconciled with the poison-parking escape hatch REQ-F004-014 and the per-key ordering ruling
  REQ-F004-031): a **deliverable** event is delivered **one or more times, never zero**, and **in order
  within its ordering key** (REQ-F004-016; skip-ahead permitted across keys, REQ-F004-042); on-wire
  duplicates are collapsed to **effectively-once** processing by consumer dedupe on the stable delivery
  id (REQ-F004-018/036) — this is **not** broker-enforced exactly-once. An **undeliverable** (poison)
  event is **isolated** (parked/dead-lettered, REQ-F004-014) and alerted (REQ-F004-025), which is **not**
  a delivery and **not** a silent drop; under per-key ordering a parked row stalls only **its own key**
  (REQ-F004-014/032). No emitted event is ever silently discarded. *Test:* force a crash after the outbox
  row is committed but before delivery (`published_at` still NULL, `parked_at` NULL); on restart the relay
  re-drains that (eligible) row and delivers it — delivered **one or more** times, **never zero**. A crash
  after transport ack but before `markPublished` results in the same row being re-delivered on restart
  (a duplicate carrying the **same** delivery id, REQ-F004-018), collapsed to one effect by a deduping
  consumer, never a loss. A row that instead exhausts max attempts is parked (REQ-F004-014), delivered
  zero times but retained and alerted — never silently dropped. *Test (per-key order):* seed two rows on
  the **same** ordering key where the older row's first delivery fails transiently and a third row on a
  **different** key succeeds; the different-key row is delivered ahead (skip-ahead across keys) while the
  older same-key row is always delivered before its same-key successor (per-key order preserved).
- REQ-F004-012 — **Mark-published only on ack.** A row is marked published **iff** the transport
  acknowledged receipt. A delivery that errors, times out, or is negatively acknowledged leaves
  `published_at` NULL so the row is retried (REQ-F004-013). *Test:* a transport configured to reject a
  delivery leaves the row unpublished and increments its attempt count; only a successful ack sets
  `published_at`.

### §4.3 Drain selection & head-of-line behavior (resolves B1/B2)
- REQ-F004-041 — **Drain-selection contract (eligible rows only; `listUnpublished` is insufficient).**
  The relay's drain source is **NOT** the grounded `outboxRepo.listUnpublished`
  (`SELECT * FROM event_outbox WHERE published_at IS NULL ORDER BY id ASC`, `outbox.repo.ts:21-23`):
  that returns **every** undelivered row, including **parked** rows (which would be re-attempted forever,
  contradicting REQ-F004-014) and rows still in their **backoff window** (which would be hot-looped,
  contradicting REQ-F004-013). F-004 **replaces/augments** it with an **eligibility-filtered selection**
  — a new/parameterized repo query (a read; not the frozen write path of REQ-F004-005) — that returns
  only **eligible** rows: `published_at IS NULL` **AND** `parked_at IS NULL` **AND**
  `(next_attempt_at IS NULL OR next_attempt_at <= now)` **AND**, per the per-key ordering ruling
  (REQ-F004-031), **no older undelivered row shares the same `ordering_key`** — i.e. for each
  `ordering_key` only the **oldest** unpublished row is eligible, and a row is **not** eligible if an
  older row on its key is unpublished (whether mid-backoff or parked); result **ORDER BY id ASC**. This
  is the per-key head-of-line condition (REQ-F004-042): across distinct keys the selection skips ahead
  freely, but within a key it never returns a later row ahead of an older undelivered one. The
  bookkeeping columns (including `ordering_key`) it filters on are added by REQ-F004-029/038.
  `listUnpublished` MAY be retained for tests/diagnostics but MUST NOT be the production drain source.
  *Test:* seed (a) a fresh row on key K1, (b) a parked row (`parked_at` set) on key K2, (c) a backoff row
  (`next_attempt_at` in the future) on key K3, and (d) a fresh row on key K2 **newer** than (b), all with
  `published_at IS NULL`; the drain selection returns (a) but **not** (d) (blocked by the older parked (b)
  on the same key K2), and not (b); after (c)'s `next_attempt_at` elapses it also returns (c). A static
  check confirms the relay does not call the unfiltered `listUnpublished`.
- REQ-F004-042 — **Head-of-line behavior (RECONCILED to per-key per REQ-F004-031/042 ruling): skip
  ACROSS keys, block WITHIN a key.** The B2 fix — skip a mid-backoff/pre-park row rather than stall the
  whole stream — is now scoped by ordering key. Two rules:
  - **Across distinct ordering keys — SKIP, do not block.** When the oldest undelivered row of key X is
    in its backoff window (`next_attempt_at` in the future) or parked, the relay **SKIPS key X** and
    delivers **eligible rows of other keys**, returning to key X when it becomes eligible again. A
    transiently-failing (or parked) event on one key does **NOT** stall delivery for other keys. This can
    deliver a newer-id event on another key **before** an older still-retrying one — permitted skip-ahead
    across keys (REQ-F004-016).
  - **Within a single ordering key — BLOCK (per-key head-of-line).** A stuck row (mid-backoff, or parked
    per REQ-F004-014) **blocks that key's later rows** to preserve per-key order (REQ-F004-016/031):
    while key X's oldest undelivered row is not deliverable, no **newer** row on key X is delivered ahead
    of it. That key **stalls** (mid-backoff: transiently, until the backoff elapses; parked: until the
    poison row is resolved/replaced/replayed, REQ-F004-014/032) while every other key keeps flowing.
  *Test (across keys):* seed row A1 on key A whose first delivery fails transiently (future
  `next_attempt_at`) and row B1 on key B that succeeds; before A1's backoff elapses, B1 is delivered and
  marked published while A1 remains unpublished and eligible-later; the relay does not wait for A1 to
  deliver B1. *Test (within a key):* seed A1 (fails transiently / is parked) followed by A2 on the **same**
  key A; A2 is **not** delivered while A1 is stuck (per-key order preserved) — it is delivered only after
  A1 is delivered (or, if A1 is parked, key A stalls and A2 waits until A1 is resolved).

---

## §5 Delivery Semantics (guarantee, ordering, idempotency)

- REQ-F004-016 — **Ordering (RATIFIED per REQ-F004-031: in-order WITHIN an ordering key; skip-ahead
  ACROSS keys).** Per the 2026-07-07 ruling (REQ-F004-031) F-004 **guarantees in-order delivery within
  an ordering key** and **permits skip-ahead across keys** — it does **not** promise strict *global*
  ordering. The ordering key is derived from `AdminEventEnvelope.target` and persisted in `ordering_key`
  (§3 definition; REQ-F004-029/038). The relay drains oldest-first (`id ASC`, REQ-F004-010) and, within
  any single ordering key, MUST deliver that key's rows in `id ASC` order — the oldest undelivered
  (unpublished-or-parked) row for a key blocks that key's later rows (per-key head-of-line,
  REQ-F004-042). Across **distinct** keys the relay MAY deliver a newer-id row before an older-id one
  (skip-ahead), e.g. when an older key is mid-backoff or parked. On-wire duplicates remain possible and
  are collapsed by consumer dedupe (effectively-once, REQ-F004-018/036); consumers therefore MAY assume
  per-key order but MUST still dedupe and MUST NOT assume global order. `__unkeyed__` events carry **no**
  per-key ordering guarantee relative to one another (§3 definition). *Test:* emit rows A1, A2 on key A
  and B1 on key B; when A1's first delivery fails transiently, B1 is delivered ahead of A1 (skip-ahead
  across keys) but A1 is **always** delivered before A2 (per-key order); after a mid-batch transport
  failure and recovery, the spec asserts all are delivered at least once and same-key order is preserved,
  not that global emission order is preserved.
- REQ-F004-017 — **Single-drainer / no double-processing — enforced across the deployment (CHANGED per
  REQ-F004-033: separate supervised relay service).** At-least-once tolerates duplicates, but the relay
  MUST NOT gratuitously multiply them. Per the 2026-07-07 ruling (REQ-F004-033) the relay is a
  **separate, supervised service** (REQ-F004-020), no longer an in-process BFF worker, so the
  single-drainer guarantee can no longer rely on "one BFF process." F-004 rev 3 requires a
  **deployment-wide single-drainer constraint**: at most **one** relay instance drains a given
  `event_outbox` at any time, enforced by **either** (a) a **single-instance deployment constraint** on
  the relay service (the supervisor runs exactly one instance — the ratified default per REQ-F004-033,
  adequate for the parent single-instance nominal load, parent REQ-100), **or** (b) a **lease/advisory-lock** the relay
  acquires before draining (a lease row/column, or a DB advisory lock) so that if two relay instances are
  ever scheduled, only the lease holder drains and the other stands by. Under either mechanism there is
  exactly **one logical drainer per `event_outbox`**. Concurrent drain *ticks within the drainer* MUST
  NOT both deliver the same row and both call `markPublished`. *Test:* two relay instances (or two
  concurrent drain ticks) contend for the same `event_outbox`; only one delivers a given row per
  successful pass — the second acquires no lease / is not the single instance and stands by; a
  re-`markPublished` of an already-published row does **not** error and leaves the row published (M7: the
  grounded `markPublished` unconditionally overwrites `published_at`, so it is idempotent-in-effect but is
  NOT literally a no-op — the test asserts "does not error and stays published," not byte-identity of the
  timestamp; an optional `WHERE published_at IS NULL` guard MAY be added to make it a true no-op).
- REQ-F004-018 — **Consumer dedupe id — the mechanism that DELIVERS effectively-once (RATIFIED per
  REQ-F004-031/036).** Per the 2026-07-07 ruling, the delivery guarantee is **effectively-once** =
  at-least-once on the wire **+** consumer dedupe on the transport delivery id — **not** broker-enforced
  exactly-once. The stable delivery id defined here is therefore **load-bearing**: it is the key on which
  a consumer collapses on-wire duplicates to a single effect. Because delivery is at-least-once, consumers
  can receive duplicates and MUST de-duplicate. The
  `AdminEventEnvelope` (parent REQ-029c) currently carries no unique event id — only `event`, `actor`,
  `target`, `changes`, `verified`, `timestamp`. So the relay MUST supply a **stable delivery id** that
  is identical across re-deliveries of the same outbox row, carried at the transport/message level, so a
  consumer can dedupe on it. **Uniqueness scope (M6):** the bare `event_outbox` row `id` is unique and
  stable only **within a single DB lifetime** — SQLite rowids restart after a DB rebuild/reset/
  re-provision, so a fresh row could reuse an id a consumer already saw and be wrongly dropped as a
  duplicate. Therefore the delivery id MUST be **qualified by a stable per-DB-lifetime epoch** — the
  provisional default is `"<outbox-epoch>:<row-id>"`, where `<outbox-epoch>` is a value generated once
  per `event_outbox` provisioning (e.g. a stored DB-instance UUID / creation timestamp) and constant for
  that DB's lifetime — so a delivery id is globally unique across DB resets while still identical across
  re-deliveries of the same row. This composition lives entirely at the transport/message level and does
  **not** touch the frozen `AdminEventEnvelope` (REQ-F004-004). See REQ-F004-048 for the epoch source.
  Whether instead to add an id to the envelope itself (a contract change,
  otherwise out of scope per REQ-F004-004) is deferred to §9 (REQ-F004-036). This spec also states, as
  guidance for downstream consumer work (REQ-F004-007), that consumers must treat handlers as
  idempotent. *Test:* the same outbox row re-delivered after a crash (REQ-F004-011) carries the **same**
  delivery id on both deliveries, so a consumer keyed on that id processes the effect once.
- REQ-F004-043 — **Conforming-transport contract (what "a conforming transport/probe" means).** Many
  requirements assert compliance "against a conforming transport" (REQ-F004-008/010/012/018/022/027);
  rev 2 defines that contract as the transport-adapter interface F-004 requires. A transport at
  `EVENT_BUS_URL` is **conforming** iff it provides all three: (a) **delivery acknowledgement** — a
  positive `ack` on a delivery attempt that is distinguishable from an error, a timeout, and a negative
  acknowledgement (this is what gates `markPublished`, REQ-F004-012); (b) **message-level delivery-id
  carriage** — the relay can attach the stable delivery id (REQ-F004-018/048) as message metadata that
  reaches the consumer, so the consumer can dedupe (this id is transport/message-level and does NOT
  enter the frozen `AdminEventEnvelope`, REQ-F004-004); (c) a **permanent-vs-transient rejection
  signal** — the transport can signal a rejection as **permanent** (undeliverable regardless of retry ⇒
  immediate park, REQ-F004-014) distinct from **transient** (retry-worthy ⇒ backoff, REQ-F004-013), per
  the classification in REQ-F004-047. A fire-and-forget transport, or one with no message metadata or no
  rejection typing, is **non-conforming** and out of scope. F-004's test doubles/probes MUST implement
  this contract so QA stubs do not diverge. The concrete broker/wire mapping behind this interface stays
  deferred to ops (§9, REQ-F004-030). *Test:* the F-004 transport-adapter interface exposes ack /
  delivery-id-carriage / permanent-vs-transient signaling; the reference probe used by F-004 tests
  implements all three, and a stub missing any one is rejected as non-conforming by the adapter's
  contract check.
- REQ-F004-048 — **Delivery-id epoch (uniqueness across DB resets, M6).** The stable delivery id
  (REQ-F004-018) is composed as `"<outbox-epoch>:<row-id>"`. The `<outbox-epoch>` is a value generated
  **once per `event_outbox` provisioning** and constant for that DB's lifetime (provisioned by the
  REQ-F004-029 migration — e.g. a stored DB-instance UUID), so that after a DB rebuild/reset/
  re-provision (which restarts SQLite rowids) a new row's delivery id can never collide with one a
  consumer already saw. This composition is transport/message-level only and does not alter the envelope
  (REQ-F004-004). *Test:* two rows with the same numeric `id` but produced under different
  `outbox_epoch` values (simulating a DB reset) yield **different** delivery ids; two re-deliveries of
  the same row under the same epoch yield the **same** delivery id.

---

## §6 Functional Requirements — Relay, Retry, Isolation, Backfill, Lifecycle, Retention

### §6.1 Retry & backoff
- REQ-F004-013 — **Retry with bounded backoff (transient failures).** A row whose delivery fails
  **transiently** (REQ-F004-047 classification) is retried on a **backoff schedule** (provisional
  default: exponential — base delay, doubling, with a maximum cap). On each transient failure the relay
  increments `attempt_count`, records `last_error`, and sets `next_attempt_at` to now + the backoff
  delay (REQ-F004-029) so the row becomes ineligible until due (REQ-F004-041) and is not hot-looped —
  retried up to a **maximum attempt count** before it is parked (REQ-F004-014). The policy shape —
  **capped exponential backoff** (base, factor, cap) with a **max attempt count** before park-in-place —
  is RATIFIED (§9, REQ-F004-032); the concrete values are fixed as a documented BFF constant of record.
  Retries stay **within** the failing row's ordering key (REQ-F004-042): a row in backoff holds its key
  but not other keys. *Test:* a row whose delivery fails K (< max)
  transient times has `next_attempt_at` advanced with monotonically non-decreasing delays per the
  documented schedule (observed via attempt timestamps), is not re-selected before `next_attempt_at`,
  and is not on a tight loop; a transient failure that later succeeds ends with the row marked
  published.

### §6.2 Failure isolation (poison events must not block the queue)
- REQ-F004-014 — **Poison-event isolation (park or dead-letter) — per-key scoped (RECONCILED per
  REQ-F004-031/032).** A row that exhausts its maximum transient attempts (REQ-F004-013), or that the
  transport rejects as **permanently** undeliverable (REQ-F004-047 classification), MUST be **isolated** —
  parked in place (setting `parked_at`, a terminal-state marker) or moved to a dead-letter store — which
  makes it **ineligible** for the drain selection (REQ-F004-041) so the relay does not re-attempt it, and
  the relay MUST **continue draining eligible rows of OTHER ordering keys**. A single poison event MUST
  NOT block delivery across the **global** stream, and MUST NOT be silently dropped: a parked event is
  delivered zero times but is retained for inspection/replay and raises an alert metric (§7 REQ-F004-025)
  — this is the "isolated" arm of the reconciled guarantee (REQ-F004-011). **Per-key scope of a park:**
  under per-key ordering (REQ-F004-031) a parked/poison row **stalls only ITS OWN ordering key** — that
  key's subsequent rows are held to preserve per-key order (per-key head-of-line, REQ-F004-042) and the
  key is flagged (parked-count metric, REQ-F004-025) until the parked row is resolved/replayed; it does
  **NOT** block any other key or the global stream. Park-vs-DLQ is RATIFIED (§9, REQ-F004-032) as
  **park-in-place** (`parked_at` on the outbox row) so no separate store is required for rev 1. *Test:*
  seed a row on key K1 that always fails delivery transiently, and rows on **other** keys that succeed;
  the K1 row is retried up to the max (with backoff, REQ-F004-013), then `parked_at` is set, and the
  other-key rows are delivered — the global stream is not head-of-line blocked; the parked row is no
  longer selected by the drain (REQ-F004-041), remains queryable, and is reflected in the parked-count
  metric. *Test (parked stalls only its key):* seed the K1 poison row followed by a **later K1** row and
  a K2 row; the K2 row is delivered, but the later K1 row is **not** delivered while K1's row is parked
  (K1 stalls); it is delivered only after the parked row is resolved/replayed. Seed a second row the
  transport rejects as permanent on the first attempt; it is parked immediately (no backoff retries) and
  other keys still deliver.
- REQ-F004-047 — **Transient-vs-permanent failure classification (resolves M3).** The relay classifies
  each failed delivery to decide retry (REQ-F004-013) vs immediate park (REQ-F004-014), using the
  conforming transport's rejection signal (REQ-F004-043c): a failure the transport marks **permanent**
  (e.g. malformed/rejected-as-undeliverable) parks the row immediately; any other failure — including
  errors, timeouts, negative acks, and an unreachable transport — is treated as **transient** and
  retried with backoff up to max attempts, then parked. Because the concrete transport is deferred
  (§9, REQ-F004-030), the **rev 2 provisional default when the transport gives no explicit permanent
  signal is: treat every failure as transient until max-attempts** (fail-safe toward retry, not toward
  dropping). *Test:* a transport reply flagged permanent parks the row on the first failure with no
  backoff retries; an error/timeout/unreachable failure increments `attempt_count`, sets
  `next_attempt_at`, and is retried, parking only after max attempts.

### §6.3 Backfill after outage
- REQ-F004-015 — **Backfill after the transport is unavailable.** While the transport is unreachable,
  emitted rows accumulate as `published_at IS NULL` (REQ-F004-012). When the transport becomes
  reachable, the relay drains the accumulated backlog oldest-first (REQ-F004-010) until the backlog is
  cleared. *Test:* with the transport unreachable, emit M events (all rows unpublished); restore the
  transport; all M events are delivered (at least once) and all M rows become published, in `id ASC`
  order. The horizon of first-connection backfill is RATIFIED (§9, REQ-F004-037): on the **first** bus
  connection the relay replays **ALL** accumulated unpublished rows **oldest-first** (no bounded window),
  subject to per-key order (REQ-F004-016). *Test (first connection):* accumulate a large unpublished
  backlog before any bus has ever connected; on first connection every accumulated row is delivered
  oldest-first (none skipped by an age/count horizon), and per-key order holds within each key.

### §6.4 Lifecycle & supervision
- REQ-F004-020 — **Relay lifecycle, supervision & graceful shutdown (CHANGED per REQ-F004-033: separate
  supervised service).** Per the 2026-07-07 ruling the relay is an **independent, supervised process/
  service** — **not** an in-process BFF worker — that drains the shared `event_outbox`. Its lifecycle:
  - **Supervision.** The relay runs under a process supervisor (e.g. the platform's service manager /
    systemd-style unit / container orchestrator restart policy) that **restarts it on crash** and keeps
    exactly the **single-drainer** count required by REQ-F004-017 (single-instance constraint or lease
    holder). The supervisor — not the BFF request path — owns the relay's start/stop/restart. The BFF and
    the relay share only the durable `event_outbox` (and the transport at `EVENT_BUS_URL`); the BFF
    continues to durably enqueue rows (`OutboxRelayBus.publish`) whether or not the relay is running.
  - **Graceful shutdown.** On shutdown the relay (a) **stops selecting new rows**, releases its lease if
    it holds one (REQ-F004-017), then (b) performs a **bounded graceful drain** of the single in-flight
    delivery — it awaits the outcome of the one delivery already handed to the transport up to a bounded
    shutdown timeout (M5, Reading A retained): if the ack arrives it calls `markPublished`; if the timeout
    elapses first it **abandons** the delivery, leaving `published_at` NULL for redelivery on next start.
  - **Restart mid-drain (safe by construction).** Because delivery is at-least-once and dedupe delivers
    effectively-once (REQ-F004-018/031), a relay restart mid-drain is safe: an **unpublished** in-flight
    row (crash/kill before ack) stays `published_at IS NULL` and is re-drained on restart; an
    **acked-but-not-yet-marked** row is re-delivered (a duplicate carrying the **same** delivery id) and
    collapsed to one effect by a deduping consumer. State is never corrupted (an unacked delivery stays
    unpublished; an acked one is marked published) and per-key order is preserved because re-drain still
    honors per-key head-of-line (REQ-F004-042).
  *Test:* a shutdown/kill initiated while one delivery is in flight waits up to the shutdown timeout (or,
  on hard kill, is simply re-driven by the supervisor); the in-flight row ends **either** published (ack
  arrived within the timeout) **or** unpublished (timeout elapsed / hard kill), never partially written;
  after the supervisor restarts the relay, every remaining unpublished eligible row is delivered in
  per-key order, and a mid-drain kill produces at most a same-delivery-id duplicate, never a loss.

### §6.5 Retention & pruning
- REQ-F004-019 — **Outbox retention & pruning.** Published rows are retained for a configurable window
  and then pruned so the outbox does not grow without bound. Pruning MUST **never** delete rows that are
  unpublished (`published_at IS NULL`) or parked (undelivered), regardless of age — only successfully
  published rows past the retention window are eligible. Retention is RATIFIED (§9, REQ-F004-035):
  **prune published rows older than a configured window** (e.g. N days) and **keep unpublished and parked
  rows indefinitely** pending delivery/inspection. *Test:* a published row older than the window is
  removed by pruning; an unpublished row and a parked row of the same age are both retained regardless of
  age.

### §6.6 Mode & migration
- REQ-F004-021 — **`bus` is production; `inproc` is development-only.** `bus` mode
  (`OutboxRelayBus` + relay) is the production configuration; `inproc` (Node `EventEmitter`) is
  demoted to development/interim. Running **anything other than `bus`** in a production context MUST be
  surfaced loudly. Because the grounded factory selects `bus` **iff** `eventBusMode === 'bus'` and falls
  back to `inproc` for every other value (`bus.ts:40`), the loud posture MUST trip for **any non-`bus`
  value under `NODE_ENV=production`** — literal `inproc`, an unset mode, **and** a typo such as `buss`
  (M2, validated per REQ-F004-046) — not only the literal string `inproc`. **Startup posture — HARD-REFUSE
  in production (CHANGED per REQ-F004-039).** Per the 2026-07-07 ruling the console MUST **fail fast**:
  under `NODE_ENV=production`, a non-`bus` `EVENT_BUS_MODE` (literal `inproc`, unset, or an unrecognized
  value such as `buss`) — **and** `bus` with no `EVENT_BUS_URL` (REQ-F004-045) — MUST cause the **BFF to
  refuse to start**, exiting with a clear, actionable error naming the offending variable. This is **not**
  the rev-2 warn-and-continue posture; a misconfigured production deployment does not boot at all rather
  than running degraded. The **separate `GET /ready` readiness probe (REQ-F004-044)** is retained for
  **runtime** relay health (transport reachability, backlog/lag), and the parent's fixed liveness `GET
  /health → {ok:true}` (parent REQ-024) is **not** modified (B6) — but the misconfig case is now caught at
  **startup** (hard-refuse) before `/ready` is ever served. In **development** a non-`bus` value MAY warn
  and default to `inproc` (REQ-F004-046). *Test:* starting under `NODE_ENV=production` with `EVENT_BUS_MODE`
  set to `inproc`, unset, or a non-`bus` typo — or `bus` with no `EVENT_BUS_URL` — causes the BFF process
  to **refuse to boot** (non-zero exit, error names the offending variable); no HTTP listener (neither
  `/health` nor `/ready`) is served in that misconfigured state. Starting in `bus` mode with a configured
  `EVENT_BUS_URL` boots normally, `GET /health` returns `{ok:true}`, and `/ready` reports ready once the
  transport is reachable.
- REQ-F004-022 — **Transport adapter lives behind the `EventBus` seam; no route/service changes.**
  Delivering to the real bus is implemented as a transport adapter used by the relay, selected/configured
  by `EVENT_BUS_MODE` / `EVENT_BUS_URL` — consistent with `docs/design/04-cross-cutting.md` §c and
  `06-risks.md` R1 ("adopting the real bus later is a new adapter behind `EventBus`, with no route or
  service changes"). *Test:* enabling `bus` mode and pointing `EVENT_BUS_URL` at a conforming transport
  requires no edits to mutating routes/services or to `emitAdminEvent`; only relay/transport/config code
  changes.
- REQ-F004-029 — **Delivery-bookkeeping schema (migration).** The relay's drain selection
  (REQ-F004-041), retry/backoff (REQ-F004-013), parking (REQ-F004-014), and observability require
  per-row DELIVERY bookkeeping the current `event_outbox` lacks. F-004 adds, via a migration (in
  `store/db.ts`), at minimum: `attempt_count` (integer, default 0), `next_attempt_at` (nullable
  timestamp; null ⇒ immediately eligible), `last_error` (nullable text), `parked_at` (nullable
  timestamp; non-null ⇒ isolated/terminal), and — added in rev 3 per the per-key ordering ruling
  (REQ-F004-031/038) — **`ordering_key`** (text; the per-key partition derived from
  `AdminEventEnvelope.target`, §3 definition; `__unkeyed__` for events with no natural key). Persisting
  `ordering_key` as a column lets the relay enforce per-key order and per-key head-of-line (REQ-F004-042)
  and run the eligibility query (REQ-F004-041) without recomputing the key from the envelope each drain;
  it MAY be populated at enqueue or lazily on first drain, and SHOULD be indexed with `id` to make the
  "oldest undelivered row per key" selection cheap. It also provisions the **per-DB-lifetime epoch**
  (REQ-F004-048) used to qualify the delivery id (REQ-F004-018, M6) — e.g. a single stored
  `outbox_epoch` value (DB-instance UUID / creation marker) generated once per `event_outbox`
  provisioning. These are added as **columns on `event_outbox`** (RATIFIED §9, REQ-F004-038 — not a
  sidecar table) plus a small singleton row/table for the epoch. This is DELIVERY bookkeeping, **not** a
  change to the event contract (REQ-F004-004); the transactional INSERT path (REQ-F004-005) is not
  altered. *Test:* the migration adds the bookkeeping fields (including `ordering_key`) and the epoch
  value; an emitted row starts with `attempt_count` = 0, `next_attempt_at` = null, `parked_at` = null,
  and a non-null `ordering_key` matching its target (or `__unkeyed__`); a failed delivery increments
  `attempt_count` and records `last_error`/`next_attempt_at` without touching `envelope`, `ts`, or
  `ordering_key`.
- REQ-F004-045 — **`bus` mode selected but `EVENT_BUS_URL` unset (resolves M1; HARD-REFUSE in production
  per REQ-F004-039).** `EVENT_BUS_URL` is optional in config (`config.ts:51`). When `EVENT_BUS_MODE=bus`
  but no `EVENT_BUS_URL` is configured the relay has nowhere to deliver. F-004 defines this as a
  **misconfiguration** with the same **hard-refuse** startup posture as a non-`bus` production mode
  (REQ-F004-021, CHANGED per REQ-F004-039): under `NODE_ENV=production` the **BFF MUST refuse to start**,
  exiting with a clear error citing "bus mode without EVENT_BUS_URL", rather than booting and letting the
  backlog grow. Outside production (development/interim), the softer posture MAY apply — the relay treats
  delivery as impossible, leaves rows unpublished (backlog grows, REQ-F004-024), emits a warning log, and
  reports `/ready` (REQ-F004-044) not-ready with reason "bus mode without EVENT_BUS_URL". *Test:* starting
  under `NODE_ENV=production` in `bus` mode with `EVENT_BUS_URL` unset causes the BFF to **refuse to boot**
  (non-zero exit, error cites the missing URL); no HTTP listener is served. In development the same config
  boots with a warn log and a not-ready `/ready` citing the missing URL, and no row ever transitions to
  published while parent `GET /health` still returns `{ok:true}`.
- REQ-F004-046 — **Mode validation — any non-`bus` value is a degrade (resolves M2).** The grounded
  factory selects `bus` **iff** `eventBusMode === 'bus'` and falls back to `inproc` for **every** other
  value (`bus.ts:40`), so a typo like `EVENT_BUS_MODE=buss` silently runs `inproc`. F-004 requires
  `EVENT_BUS_MODE` to be validated against the closed set `{inproc, bus}`: an **unrecognized** value is
  treated as a misconfiguration and, under `NODE_ENV=production`, trips the same **hard-refuse** startup
  posture as a non-`bus` mode (refuse to boot, REQ-F004-021/039) — never a silent `inproc` fallback
  masquerading as healthy. In development an unrecognized value MAY warn and default to `inproc`.
  *Test:* `EVENT_BUS_MODE=buss` under production causes the BFF to **refuse to boot** with an error citing
  the invalid mode; the same value in development warns but starts.

---

## §7 Delivery Observability

- REQ-F004-023 — **Relay lag.** The console exposes the **age of the oldest unpublished, non-parked**
  outbox row (relay lag) as an observable metric/diagnostic. *Test:* with one row unpublished for T
  seconds, the relay-lag signal reports approximately T; with an empty/all-published outbox it reports
  zero.
- REQ-F004-024 — **Backlog count.** The count of unpublished, non-parked rows (backlog) is observable.
  *Test:* enqueuing N rows against an unreachable transport makes the backlog report N; draining them
  returns it to zero.
- REQ-F004-025 — **Failure, attempt & parked/DLQ counts.** Delivery failure counts, retry/attempt
  counts, and parked/dead-lettered depth (REQ-F004-014) are observable, so operators can alert on a
  stuck or poison-accumulating relay. *Test:* a permanently failing row increments the failure/attempt
  counters and, after max attempts, increments the parked count by one.
- REQ-F004-026 — **Relay readiness signal (contributes to REQ-F004-044).** The relay contributes to the
  **separate readiness signal defined in REQ-F004-044** (NOT the parent's fixed `GET /health`, REQ-024)
  a status reflecting whether it is running, whether the mode is `bus` (REQ-F004-021), whether the
  transport is configured (REQ-F004-045) and reachable, and whether backlog/lag are within a configured
  threshold — usable by the deployment's orchestration probes and by REQ-F004-021. *Test:* with `bus`
  mode, a reachable conforming transport, and backlog under threshold the readiness signal (REQ-F004-044)
  is ready; with the transport unconfigured/unreachable or backlog/lag over threshold it is
  not-ready/degraded, while parent `GET /health` still returns `{ok:true}`. The metric set, thresholds,
  and delivery-latency/throughput SLOs are RATIFIED (§9, REQ-F004-034; §8 REQ-F004-027).
- REQ-F004-044 — **Readiness signal — SEPARATE `/ready` probe, RATIFIED as the readiness surface; startup
  misconfig now HARD-REFUSES (RECONCILED per REQ-F004-039).** The readiness/health signal that
  REQ-F004-026 (and, at runtime, REQ-F004-021/045) depend on has no home in the parent's fixed liveness
  contract (parent REQ-024: `GET /health → {ok:true}`, a fixed payload with no readiness/degraded
  dimension). F-004 therefore does **NOT** modify REQ-024; it adds a **separate, server-side readiness
  signal** — RATIFIED per the 2026-07-07 ruling (REQ-F004-039) as a dedicated readiness probe endpoint
  `GET /ready` (no session, server-side only, sibling to `/health`), leaving parent REQ-024 untouched.
  `/ready` expresses observable **runtime** states: **ready** (HTTP 200; `bus` mode, transport configured
  and reachable, backlog/lag under threshold) and **not-ready/degraded** (HTTP 503 with a machine-readable
  `reason`, e.g. `transport-unreachable`, `backlog-over-threshold`, `lag-over-threshold`). **Startup
  reconciliation (REQ-F004-039 CHANGED → hard-refuse):** the misconfiguration reasons that rev 2 surfaced
  through `/ready` (`inproc-in-production`, `bus mode without EVENT_BUS_URL`) are now caught at **startup**
  — the BFF **refuses to boot** (REQ-F004-021/045) and therefore never serves `/ready` in that state — so
  `/ready` reports only runtime relay health of an already-booted `bus`-mode process. Consumers/
  orchestrators use `/ready`, not `/health`, to gate traffic/rollout. *Test:* `GET /health` returns
  `{ok:true}` unchanged in every case where the process is up; on a running `bus`-mode process `/ready`
  returns ready under a reachable transport + backlog under threshold, and not-ready with a specific
  runtime `reason` (unreachable transport, over-threshold backlog/lag); a production misconfig
  (inproc/missing URL) is instead a **refuse-to-boot** (REQ-F004-021/045), so neither `/ready` nor
  `/health` is served in that state.

---

## §8 Non-Functional Requirements & Configuration

- REQ-F004-027 — **Delivery latency & throughput bound (RATIFIED per REQ-F004-034; F-004's own
  constants).** The relay delivers a newly emitted event to a reachable conforming transport within a
  target of **p95 < 5 s** end-to-end from outbox commit to transport ack. For throughput, F-004 states
  its **own** provisional event-rate target rather than borrowing parent REQ-100 — which defines only a
  read-view render latency (p95 < 1500 ms) at a data scale (≤200 ws / ≤500 users) and carries **no**
  mutation/emission rate (B5). Throughput target: the relay sustains a steady state of **≥ 50
  events/second** of emitted `admin.*` events with backlog (REQ-F004-024) trending to zero rather than
  growing, and clears a backfill backlog of **≥ 10,000** accumulated rows without stalling. These SLO
  values are RATIFIED (§9, REQ-F004-034) as F-004's constants of record (NOT parent REQ-100). **Per-key
  ordering does not cap throughput to a single serial stream:** the in-order guarantee is scoped to each
  ordering key (REQ-F004-016/031), so **distinct keys deliver in parallel** — throughput is bounded by
  transport/relay capacity across all keys, not by a global serial order; only rows sharing one key are
  serialized (and only that key stalls behind a stuck row, REQ-F004-042). *Test:* under a sustained emit
  load spread across many ordering keys at the target rate against a reachable transport, emit-to-ack
  latency stays within the p95 target and backlog trends to zero rather than growing; a seeded backlog of
  the target size across multiple keys drains to zero without the relay stalling; concurrent delivery
  across distinct keys is observable (the relay is not single-threaded-capped by per-key order).
- REQ-F004-028 — **Security & log hygiene (inherited).** The browser never reads the on-box bus
  (parent REQ-029d) and never receives `EVENT_BUS_URL` or transport credentials; the relay and
  transport are server-side only. Envelopes are already redacted at emit (parent REQ-029c via
  `redactSecrets`), so the relay delivers pre-redacted content and MUST NOT re-expand or log secret
  values; relay/transport logs follow the parent log-hygiene discipline (parent REQ-094 — no secret
  values in logs; envelope `changes` not dumped in plaintext). *Test:* no browser-originated request
  can reach the transport or obtain `EVENT_BUS_URL`; relay error/diagnostic logs do not contain secret
  values from envelope `changes`.

---

## §9 Rulings (2026-07-07) — formerly Open Questions

These were the decisions F-004 could not responsibly make alone (aligned with the brief's Open Questions
and `docs/design/06-risks.md` R1's deferred items). As of the **2026-07-07 human rulings** every item is
resolved: each is marked **RATIFIED (2026-07-07)** where the adopted default was confirmed, or
**DECIDED (2026-07-07)** with the change described where the ruling diverged from the default. No item
remains open. The governing REQ(s) — updated in rev 3 to match — are cited.

- REQ-F004-030 — **Target transport/broker (external dependency?).** What is "the real on-box bus"
  concretely — a specific broker product, a socket/wire protocol, a platform service? Does
  `EVENT_BUS_URL` point at something that already exists, or must it be provisioned (an ops/platform
  dependency, not a console-code build, REQ-F004-008)? **RATIFIED (2026-07-07):** build the relay + a
  thin transport-adapter interface against `EVENT_BUS_URL`; the concrete broker is **deferred to ops**
  (`06-risks.md` R1 keeps technology/protocol deferred). Governing: REQ-F004-008/022/043.
- REQ-F004-031 — **Delivery semantics: ordering / exactly-once.** At-least-once is the assumed floor
  (REQ-F004-011). Does any consumer require **exactly-once** or **strict ordering**? If ordering
  matters, is it **per-key** (e.g. per workspace/user id) or **global**? **DECIDED (2026-07-07):**
  **per-key ordering + effectively-once** — NOT at-least-once/no-order, and NOT exactly-once/global-order.
  An **ordering key** is derived from `AdminEventEnvelope.target` (§3 definition; `ws:<id>` / `user:<id>`
  / `instance`, with `__unkeyed__` for events with no natural key, treated as unordered among themselves).
  Guarantee: **in-order delivery WITHIN a key**; **skip-ahead ALLOWED ACROSS keys**; **effectively-once**
  = at-least-once wire delivery + consumer dedupe via the transport delivery id (REQ-F004-018/036), NOT
  broker-enforced exactly-once. Governing: REQ-F004-011/016/018/042; §3 defs; schema REQ-F004-029/038.
- REQ-F004-032 — **Failure handling: park vs dead-letter, and retry policy.** Dead-letter queue vs
  park-and-alert for poison events; and the concrete retry/backoff policy (base delay, factor, cap,
  **max attempts before parking**). **RATIFIED (2026-07-07):** **park-in-place** (terminal marker on the
  outbox row) + **capped exponential backoff** with a max-attempt count, values fixed as a documented
  BFF constant. **Per-key reconcile:** under per-key ordering (REQ-F004-031) a parked/poison event blocks
  only **ITS key's** subsequent ordering (that key stalls / is flagged); it does **NOT** block other keys
  or the global stream (REQ-F004-014/042). Governing: REQ-F004-013/014.
- REQ-F004-033 — **Relay topology & lifecycle.** In-process background worker within the BFF, or a
  separate supervised process/service? How is it supervised, and what happens on restart mid-drain (a
  concern already raised alongside `06-risks.md` R1 / "outbox relay cadence")? **DECIDED (2026-07-07):**
  a **SEPARATE, supervised relay service** — NOT an in-process BFF worker. It is an independent,
  supervised process that drains the shared `event_outbox`; supervision restarts it on crash; a
  **deployment-wide single-drainer constraint** (single-instance deployment, or a lease/advisory-lock)
  prevents two relay instances double-draining; restart mid-drain is safe because delivery is
  at-least-once + effectively-once dedupe (REQ-F004-018). Governing: REQ-F004-017/020.
- REQ-F004-034 — **Observability metric set, thresholds & SLO (latency + throughput).** Exactly which
  relay-lag / backlog / failure / parked metrics are required, what thresholds drive the readiness
  signal (REQ-F004-044), and whether there are committed delivery-latency **and event-throughput** SLOs.
  **RATIFIED (2026-07-07):** lag + backlog + failure/attempt + parked counts + a threshold-based
  readiness signal (§7), with **p95 < 5 s** latency, **≥ 50 events/sec** sustained throughput, and a
  **≥ 10,000-row** backfill-drain target — F-004's **own** constants (REQ-F004-027), NOT parent REQ-100.
  Note per-key ordering does **not** force global serial delivery (distinct keys deliver in parallel), so
  throughput is not single-threaded-capped (REQ-F004-027). Governing: §7 + REQ-F004-027 + REQ-F004-044.
- REQ-F004-035 — **Outbox retention.** Once `published_at` is set, are rows pruned, archived, or
  retained for replay/audit, and over what window? **RATIFIED (2026-07-07):** prune published rows older
  than a configured window; keep unpublished and parked rows indefinitely (REQ-F004-019). Governing:
  REQ-F004-019.
- REQ-F004-036 — **Consumer dedupe id: transport-level vs envelope field.** At-least-once requires a
  stable dedupe key, but `AdminEventEnvelope` has no id today. Supply it at the transport/message
  level (default), or add an id to the envelope contract (which is otherwise out of scope, REQ-F004-004,
  and would touch parent REQ-029c)? **RATIFIED (2026-07-07):** relay supplies a stable **transport-level**
  delivery id derived from the `event_outbox` row id (epoch-qualified per M6, REQ-F004-048), leaving the
  envelope contract untouched. **Now load-bearing:** per REQ-F004-031 this delivery id is the dedupe key
  that DELIVERS effectively-once (REQ-F004-018). Governing: REQ-F004-018/048.
- REQ-F004-037 — **First-connection backfill horizon.** When a brand-new bus first appears with a large
  accumulated backlog, replay **all** unpublished rows, or bound the replay to a horizon (age/count)?
  **RATIFIED (2026-07-07):** on first bus connection replay **ALL** accumulated unpublished rows
  oldest-first (REQ-F004-015). Governing: REQ-F004-015.
- REQ-F004-038 — **Bookkeeping schema shape.** Add relay bookkeeping (attempts, next-attempt, last
  error, parked marker) as **columns on `event_outbox`** or as a **sidecar table** keyed by outbox id?
  **RATIFIED (2026-07-07):** columns on `event_outbox` (not a sidecar). **ADDITIONALLY** add an
  **`ordering_key` column** (the per-key partition from REQ-F004-031) so the relay enforces per-key order
  and per-key head-of-line without recomputing it each drain. Governing: REQ-F004-029.
- REQ-F004-039 — **`inproc`/non-`bus`-in-production posture, and readiness-surface shape.** Should the
  console **hard-refuse** to start with a non-`bus` `EVENT_BUS_MODE` under production, or start with a
  loud warning + failing readiness signal? And should the readiness signal be a **separate endpoint**
  (`GET /ready`) or an **extension of the parent `/health`** contract (which would change parent
  REQ-024)? **DECIDED (2026-07-07):** **HARD-REFUSE in production** — a non-`bus` `EVENT_BUS_MODE` (or
  `bus` with no `EVENT_BUS_URL`) MUST cause the BFF to **refuse to start** (fail fast, clear error), NOT
  warn-and-continue. The readiness-surface shape is **RATIFIED** as a **separate `GET /ready` probe**
  (leaving parent REQ-024's `{ok:true}` liveness untouched); `/ready` reports relay health at **runtime**,
  but the **startup** posture for misconfiguration is hard-refuse. Governing: REQ-F004-021/044/045.
- REQ-F004-040 — **Consumer readiness / urgency framing.** Are there real subscribers waiting for this
  now, or is F-004 platform-enabling ahead of demand? (Affects sequencing against the October 2026 GTM
  gate; per the brief no consumer-demand signal was gathered.) **RATIFIED (2026-07-07, informational):**
  treat F-004 as a **production-readiness gate** that must land before consumers are built against the
  interim path, per the brief's Timing/Business Rationale. Governing: §1.1 (informational; no code
  behavior hinges on it).

---

## §10 Traceability to the Brief

| Brief element | Addressed by |
|---|---|
| Problem: interim `inproc` bus, stubbed enqueue-only relay, no production delivery | §1.1 REQ-F004-001, §4 REQ-F004-009 |
| Problem: durability of the record but no delivery (relay never built, zero subscribers) | §4.1 REQ-F004-009; §4.2 REQ-F004-010 |
| Proposed Direction: background relay drains eligible rows, delivers, marks published | §4.2 REQ-F004-010/012; §4.3 REQ-F004-041 |
| Proposed Direction: per-key-ordered, effectively-once-or-isolated delivery guarantee | §5 REQ-F004-011; §1.1 REQ-F004-001; §3 def; §9 REQ-F004-031 |
| Proposed Direction: retry with capped exponential backoff | §6.1 REQ-F004-013; §4.3 REQ-F004-042; §6.2 REQ-F004-047; §9 REQ-F004-032 |
| Proposed Direction: failure isolation — poison event blocks only its key, not the global stream (park) | §6.2 REQ-F004-014/047 + §9 REQ-F004-032 |
| Proposed Direction: back-fill after an outage (replay all on first connection) | §6.3 REQ-F004-015 + §9 REQ-F004-037 |
| Proposed Direction: ordering — in-order within a key, skip-ahead across keys | §5 REQ-F004-016 + §4.3 REQ-F004-042 + §9 REQ-F004-031 |
| Proposed Direction: consumer dedupe id — the key that delivers effectively-once | §5 REQ-F004-018/048 + §9 REQ-F004-031/036 |
| Proposed Direction: delivery observability (lag, backlog, failure counts) | §7 REQ-F004-023/024/025/026/044 + §9 REQ-F004-034 |
| Proposed Direction: relay lifecycle/supervision — SEPARATE supervised service | §6.4 REQ-F004-020; §5 REQ-F004-017 + §9 REQ-F004-033 |
| Proposed Direction: outbox retention/pruning | §6.5 REQ-F004-019 + §9 REQ-F004-035 |
| Proposed Direction: make `bus` production, demote `inproc` to dev-only (hard-refuse in prod) | §6.6 REQ-F004-021/045 + §7 REQ-F004-044 + §9 REQ-F004-039 |
| Delivery mechanics: conforming transport contract (ack, delivery-id, permanent/transient) | §5 REQ-F004-043 |
| Build behind the existing `EventBus` seam (no route/service changes) | §1.1 REQ-F004-001, §6.6 REQ-F004-022 |
| Out of scope: event contract/catalog itself | §2 REQ-F004-004 |
| Out of scope: transactional outbox WRITE | §2 REQ-F004-005 |
| Out of scope: any web/ change (web can't read the bus, REQ-029d) | §2 REQ-F004-006; §1.3 REQ-F004-003 |
| Out of scope: building downstream consumers | §2 REQ-F004-007 |
| Out of scope / flag: physical broker may be an ops dependency | §2 REQ-F004-008 + §9 REQ-F004-030 |
| Ruling: target transport/broker deferred to ops (RATIFIED) | §9 REQ-F004-030 |
| Ruling: delivery semantics — per-key order + effectively-once (DECIDED) | §9 REQ-F004-031 |
| Ruling: park-in-place + capped exponential backoff; per-key scope (RATIFIED) | §9 REQ-F004-032 |
| Ruling: relay topology — SEPARATE supervised service; single-drainer lease (DECIDED) | §9 REQ-F004-033 |
| Ruling: observability & SLO constants (RATIFIED) | §9 REQ-F004-034 + §7/§8 REQ-F004-027 |
| Ruling: outbox retention — prune published, keep unpublished/parked (RATIFIED) | §9 REQ-F004-035 |
| Ruling: dedupe id transport-level, now load-bearing (RATIFIED) | §9 REQ-F004-036 |
| Ruling: first-connection backfill — replay all (RATIFIED) | §9 REQ-F004-037 |
| Ruling: bookkeeping columns + ordering_key column (RATIFIED + add) | §9 REQ-F004-038; §6.6 REQ-F004-029 |
| Ruling: non-`bus` prod posture — HARD-REFUSE; separate `/ready` (DECIDED) | §9 REQ-F004-039 |
| Ruling: consumer readiness / production-readiness gate (RATIFIED) | §9 REQ-F004-040 |
| Timing: October 2026 GTM production-readiness gate | §1.1, §9 REQ-F004-040 |
| Parent REQ-029d fulfilled in production; web still cannot read the bus | §1.3 REQ-F004-003 |

### §10.1 Spec-review resolution (rev 2 — `docs/spec-review-F004.md`)

| Finding | Resolution | Where |
|---|---|---|
| B1 drain query returns rows it must skip | Drain source is the eligibility-filtered selection (unpublished AND not parked AND next_attempt_at due), NOT unfiltered `listUnpublished` | §4.3 REQ-F004-041; §4.2 REQ-F004-010; §3 defs |
| B2 head-of-line for mid-backoff row | Relay SKIPS a not-yet-due row and delivers newer eligible rows (relaxes ordering) | §4.3 REQ-F004-042 |
| B3 "conforming transport" undefined | Transport contract = ack + delivery-id carriage + permanent/transient signal | §5 REQ-F004-043 |
| B4 at-least-once "never zero" vs parked poison | Guarantee restated as delivered-**or-isolated**, never silently dropped | §1.1 REQ-F004-001; §3 def; §5 REQ-F004-011; §6.2 REQ-F004-014 |
| B5 REQ-027 misattributes REQ-100 throughput | Own provisional throughput constants (≥50 ev/s, ≥10k backfill); REQ-100 no longer cited for rate | §8 REQ-F004-027; OQ REQ-F004-034 |
| B6 readiness signal has no home | Separate `/ready` readiness signal; parent REQ-024 `/health → {ok:true}` unchanged | §7 REQ-F004-044; REQ-F004-021/026/045 |
| M1 bus mode without EVENT_BUS_URL | Misconfiguration: warn + not-ready + backlog grows, no hard exit | §6.6 REQ-F004-045 |
| M2 invalid/non-`bus` mode silently degrades | Mode validated against `{inproc,bus}`; loud posture trips for ANY non-`bus` value under production | §6.6 REQ-F004-021/046 |
| M3 transient vs permanent undefined | Classification defined; default = transient-until-max unless transport signals permanent | §6.2 REQ-F004-047 |
| M4 single-drainer per deployment vs per-process | Guarantee scoped to a single BFF process; multi-replica out of scope (lease → OQ) | §5 REQ-F004-017 |
| M5 shutdown-mid-drain ambiguity | Bounded graceful drain (await ack up to timeout, else abandon) chosen | §6.4 REQ-F004-020 |
| M6 delivery-id recycles on DB reset | Delivery id qualified by per-DB-lifetime epoch: `<epoch>:<row-id>` | §5 REQ-F004-018/048; §6.6 REQ-F004-029 |
| M7 `markPublished` not a strict no-op | Test restated to "does not error, stays published" (optional WHERE guard) | §5 REQ-F004-017 |
| M8 dangling cadence cross-ref | Cadence = implementation-defined (`06-risks.md`) subject to REQ-F004-027 | §4.2 REQ-F004-010 |
| N1 event count | "~17" → 18 (matches `catalog.ts`) | §1.2 REQ-F004-002 |

Note: rev 2 M4 (single-drainer scoped to one BFF process) and M5 (bounded graceful drain) are **carried
forward and refined** by the rev 3 REQ-F004-033 ruling — the drainer is now a **separate supervised
service** with a deployment-wide single-drainer constraint (lease/single-instance), and the bounded
graceful drain is retained under supervisor restart semantics (REQ-F004-017/020).

### §10.2 §9 ruling resolution (rev 3 — 2026-07-07 human rulings)

| Ruling | Disposition | Change applied | Where |
|---|---|---|---|
| REQ-F004-030 transport/broker | RATIFIED (default) | Relay + thin transport-adapter against `EVENT_BUS_URL`; broker deferred to ops | §9 REQ-F004-030; §2 REQ-F004-008; §5 REQ-F004-043 |
| REQ-F004-031 delivery semantics | DECIDED (non-default) | Per-key ordering + effectively-once; ordering key from `target`; in-order within key, skip-ahead across keys; dedupe (not broker exactly-once) | §9 REQ-F004-031; §1.1/-001; §3 defs; §4.2/-011; §5/-016/-018 |
| REQ-F004-032 park + retry | RATIFIED + per-key reconcile | Park-in-place + capped exponential backoff; parked/poison blocks only its key | §9 REQ-F004-032; §6.1/-013; §6.2/-014 |
| REQ-F004-042 head-of-line | RECONCILED to per-key | Skip across keys, block within a key (per-key head-of-line) | §4.3 REQ-F004-042; §4.3/-041; §3 defs |
| REQ-F004-033 relay topology | DECIDED (non-default) | Separate supervised service; deployment-wide single-drainer (lease/single-instance); safe restart mid-drain | §9 REQ-F004-033; §5/-017; §6.4/-020 |
| REQ-F004-034 observability/SLO | RATIFIED (default) | p95<5s, ≥50 ev/s, ≥10k backfill; per-key ≠ global-serial (parallel keys) | §9 REQ-F004-034; §8/-027; §7 |
| REQ-F004-035 retention | RATIFIED (default) | Prune published past window; keep unpublished + parked indefinitely | §9 REQ-F004-035; §6.5/-019 |
| REQ-F004-036 dedupe id | RATIFIED (default), now load-bearing | Transport-level epoch-qualified delivery id; now the effectively-once dedupe key | §9 REQ-F004-036; §5/-018/-048 |
| REQ-F004-037 backfill horizon | RATIFIED (default) | First connection replays ALL unpublished rows oldest-first | §9 REQ-F004-037; §6.3/-015 |
| REQ-F004-038 schema shape | RATIFIED + add column | Columns on `event_outbox`; ADD `ordering_key` column | §9 REQ-F004-038; §6.6/-029 |
| REQ-F004-039 prod posture | DECIDED (non-default) | HARD-REFUSE to start on non-`bus` prod mode / missing URL; keep separate `/ready` for runtime | §9 REQ-F004-039; §6.6/-021/-045/-046; §7/-044 |
| REQ-F004-040 urgency framing | RATIFIED (default, informational) | Production-readiness gate framing | §9 REQ-F004-040; §1.1 |

---

### Self-check note (per analyst workflow step 5)
The requirements most at risk of divergent implementation are now the **per-key ordering guarantee**
(REQ-F004-016/031), **per-key head-of-line** (REQ-F004-042), and **per-key-scoped failure isolation**
(REQ-F004-014) introduced by the 2026-07-07 rulings, alongside the pre-existing **effectively-once
durability** (REQ-F004-011). Each is pinned to a concrete observable test so two implementers cannot both
claim compliance with divergent behavior: **across keys** a stuck/backoff/parked row on key A must not
delay key B (skip-ahead), while **within a key** a stuck row must block that key's later rows (order
preserved) — the added tests seed A1/A2 on one key and B1 on another and assert exactly this; a
**parked** poison row stalls only its own key while other keys keep flowing (REQ-F004-014 test); and the
BFF **refuses to boot** under a non-`bus` production mode or missing `EVENT_BUS_URL` (REQ-F004-021/045
tests assert non-zero exit and no HTTP listener). The three genuinely non-default rulings were applied and
their ripples reconciled end-to-end: **REQ-F004-031** (per-key + effectively-once) rewires the guarantee
statements (REQ-F004-001/011/016/018), the §3 definitions, the ordering-key derivation, the drain
selection (REQ-F004-041), head-of-line (REQ-F004-042), park scope (REQ-F004-014), and adds the
`ordering_key` column (REQ-F004-029/038); **REQ-F004-033** (separate supervised service) rewrites the
single-drainer guarantee to a deployment-wide lease/single-instance constraint (REQ-F004-017) and the
supervised lifecycle + safe restart-mid-drain (REQ-F004-020); **REQ-F004-039** (hard-refuse) converts the
misconfiguration posture from warn-and-continue to refuse-to-boot (REQ-F004-021/045/046) while keeping the
separate `/ready` probe for runtime health (REQ-F004-044) and leaving parent REQ-024 `/health → {ok:true}`
untouched. All other §9 items were confirmed as RATIFIED without behavioral change beyond noting the
now-load-bearing dedupe id (REQ-F004-036/018) and that per-key ordering does not cap throughput to a
single serial stream (REQ-F004-027/034). No requirement silently commits to a broker (REQ-F004-030 stays
deferred to ops); the transport-level, epoch-qualified delivery id (REQ-F004-048) still does NOT leak into
the frozen `AdminEventEnvelope` (REQ-F004-004); and requirement IDs are unchanged — every item was edited
in place, none renumbered or deleted. §9 now contains **no open questions**.
