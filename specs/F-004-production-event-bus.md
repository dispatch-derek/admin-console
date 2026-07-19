# F-004: Production-Ready Event Bus (Replace the In-Process Bus) — Specification

Status: Draft rev 9 — resolves spec-review `docs/spec-reviews/spec-review-F004-rev5.md` (rev 6), folds in the resolved
delivery-transport decision (rev 7, 2026-07-19: HTTP-to-known-peer for GTM; broker as a future `EventTransport`
adapter), resolves the rev-7 adversarial BLOCK (rev 8, 2026-07-19: baseline `baseline` singleton
ordering key; corrected 21-event/8-family catalog count; stateful per-`deliveryId` fan-out re-drive; pinned
`EVENT_BUS_URL` comma-list + `EVENT_BUS_TRANSPORT` selector), resolves a fresh adversarial BLOCK (rev 9,
2026-07-19: shutdown drains the SET of in-flight deliveries; fan-out permanent-peer rejection parks
immediately; `EVENT_BUS_TRANSPORT=broker` hard-refuses in the GTM build; + notes N1–N6), and applies the
round-2 PASS-WITH-NOTES clarity pass (rev 10, 2026-07-19: broker refuses to boot in ALL environments;
term/edge/cross-ref clarity — no MUST semantics changed), and pins the `HttpPeerTransport` HTTP-response →
permanent/transient classification (rev 11, 2026-07-19: REQ-F004-055, standard webhook convention); for
implementation and QA review
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
- REQ-F004-002 — The event **contract** — the `admin.*` catalog (`bff/src/events/catalog.ts`, **21
  event names across 8 families** — the six core families plus `admin.baseline_prompt.*` (F-002) and
  `admin.feature_toggle.*` (F-005); parent §14.2), the `AdminEventEnvelope` shape (parent REQ-029c), event **cardinality**
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
  (§9, REQ-F004-030; `docs/design/06-risks.md` R1). For the October 2026 GTM it is concretely
  **HTTP-to-a-known-peer** (`HttpPeerTransport`, REQ-F004-050), **not** a message broker.
- **`EventTransport` / `HttpPeerTransport` / `BrokerTransport`** — the **narrow transport-adapter
  interface** (REQ-F004-049) the transport-agnostic drain/orchestration layer delivers through
  (`deliver(envelope, deliveryId)` resolving on ack, rejecting with the transient-vs-permanent
  classification, REQ-F004-047). **`HttpPeerTransport`** is the **single GTM implementation** — POST each
  envelope to every configured peer endpoint and ack only on full fan-out (REQ-F004-050/051/052).
  **`BrokerTransport`** is the **future** (post-GTM) implementation added behind the same interface as a
  **new class plus one config branch**, with zero churn above the seam (REQ-F004-050). The
  drain/orchestration layer is written once and is transport-agnostic (REQ-F004-049).
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
- **Ordering key** — the per-partition key that scopes ordering (REQ-F004-016/031). It is derived from
  the event **name** (which selects the namespace rule) plus a **named field of
  `AdminEventEnvelope.target`** (parent REQ-029c) — **not** from a literal `target.workspaceId` /
  `target.userId` field (no such field exists; the grounded `target` uses `{id}`, `{workspace, user}`,
  or `{keys}`, see REQ-F004-031/MJ2). The derivation is **total over all eight live catalog families**
  (`bff/src/events/catalog.ts`, 21 event names; resolves review BR2/MJ2 and rev-7 Fix 1/2), keyed off the
  event-name prefix:
  - `admin.workspace.*`      → `ws:<target.id>`
  - `admin.user.*`           → `user:<target.id>`
  - `admin.instance.*`       → reserved singleton `instance`
  - `admin.workspace_user.*` → `ws:<target.workspace>` (membership serializes on the affected
    **workspace**; ruling BR2, 2026-07-07 — the two-id membership target keys on `target.workspace`,
    not `target.user`). *Caveat (review MN5):* this puts membership events on the **same** key as that
    workspace's `admin.workspace.*` lifecycle events (both `ws:<id>`, so they stay mutually ordered), but
    on a **different** key from the user's `admin.user.*` events (`user:<id>`) — so a create-user →
    assign-to-workspace pair carries **no** relative order across those two keys. This is expected under
    per-key semantics; consumers needing that causal order must not assume it from emission order.
  - `admin.invite.*`         → `invite:<target.id>`
  - `admin.raw_env.*`        → reserved singleton `instance` (raw-env writes are instance-scoped
    configuration and share the `admin.instance.*` partition so sequential config writes stay ordered;
    resolves review MN4)
  - `admin.baseline_prompt.*` → reserved singleton `baseline` (rev-7 Fix 1 human ruling). The F-002
    baseline events are emitted with `target: { baseline: 'singleton' }` (`baseline.service.ts`), so they
    have no natural per-entity id and would otherwise fall to `__unkeyed__` — which would leave the causal
    pair `admin.baseline_prompt.updated → admin.baseline_prompt.applied` with **no** delivery-order
    guarantee. They are therefore given their **own dedicated `baseline` singleton key** so baseline writes
    stay mutually ordered. This is a **distinct** key from `instance` (deliberately **not** lumped onto the
    `raw_env`/`instance` partition) so baseline writes are not false-serialized against unrelated raw-env
    config writes — mirroring the `admin.raw_env.* → instance` singleton pattern but on its own partition.
  - `admin.feature_toggle.*` → `__unkeyed__` (**intentional**; rev-7 Fix 2). The F-005 toggle event is
    emitted with `target: { featureKey }` and F-005 explicitly routes its ordering to the reserved
    `__unkeyed__` key (`catalog.ts:69-70` note; REQ-F005-052) — toggle changes carry no cross-event
    ordering requirement, so they are independent (no per-key serialization). This is a deliberate mapping,
    not a totality fallthrough.
  **Prefix match MUST include the trailing separator (rev-9, folds in review N6).** The prefix rules above
  are matched on the **full dotted namespace segment including its trailing `.`** — e.g. `admin.workspace.`
  (with the dot), **not** the bare string `admin.workspace`. This is load-bearing because
  `admin.workspace_user.*` shares the leading substring `admin.workspace` with `admin.workspace.*`: a naive
  `startsWith('admin.workspace')` would **wrongly** classify membership events as `admin.workspace.*` and
  try to read a non-existent `target.id` (membership carries `{workspace, user}`, no `id`), silently folding
  them into `__unkeyed__` and **losing membership ordering** on the `ws:<workspace>` key. The derivation
  MUST therefore match `admin.workspace_user.` (underscore-separated segment) as its **own** rule
  distinct from `admin.workspace.` (dot-separated), and generally anchor each rule to a complete
  `.`-delimited prefix. *Test:* an `admin.workspace_user.assigned` event resolves to `ws:<target.workspace>`
  (its membership key), **not** to `__unkeyed__` and **not** to a workspace-lifecycle misparse.
  Any event that still matches none of the above (no rule, no natural id) falls into the reserved key
  `__unkeyed__`. **Totality edge (resolves review N5):** an event that *matches* a prefix rule but whose
  named `target` field is **absent/empty** (e.g. an `admin.workspace.*` event with no `target.id`) also
  falls back to `__unkeyed__` — it MUST NOT produce a literal `ws:undefined` (which would wrongly become a
  shared blocking partition across every such row). No grounded emit site omits the required field today,
  so this is defensive; it keeps the function total and the fallback independent. **`__unkeyed__` rows are
  INDEPENDENT** (ruling BR1, 2026-07-07): they are explicitly
  **exempt from per-key head-of-line** — no `__unkeyed__` row blocks another, and a parked/poison
  `__unkeyed__` row's blast radius is **exactly itself** (one row), never the whole bucket. The key is
  computed once from the persisted envelope and stored in the `ordering_key` column (REQ-F004-029/038)
  so the relay enforces per-key order and per-key head-of-line (REQ-F004-042) without recomputing it
  each drain.
- **Eligible row (drain selection)** — an `event_outbox` row that is unpublished
  (`published_at IS NULL`), **not** parked (`parked_at IS NULL`), whose `next_attempt_at` is null or
  in the past, **and** — for a row whose `ordering_key` is **not** `'__unkeyed__'` — for which no
  **older** unpublished-or-parked row shares its `ordering_key` (per-key head-of-line, REQ-F004-042).
  A row whose `ordering_key = '__unkeyed__'` is **exempt** from that last clause (ruling BR1): it is
  eligible independently of any other `__unkeyed__` row, so the eligibility query special-cases
  `ordering_key = '__unkeyed__'` and never applies the older-shares-key filter to it. Only eligible
  rows are drained (REQ-F004-041); across distinct ordering keys (and among all `__unkeyed__` rows) the
  relay may skip ahead freely, but within a single non-`__unkeyed__` key the oldest undelivered row
  must go first.
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
  and no global progress is blocked. **Exception — `__unkeyed__` (ruling BR1):** a parked `__unkeyed__`
  row blocks nothing, not even other `__unkeyed__` rows (they are independent, not a shared partition),
  so its blast radius is one row.
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
  consumer, never a loss. **Persistent post-ack `markPublished` failure — routed on a persisted ack marker
  (resolves reviews MN2 + B1 + B1-new):** a row whose delivery is acked but whose `markPublished`
  **repeatedly** fails (a persistent, non-crash write error against `published_at`; a transient
  `SQLITE_BUSY` is retried under REQ-F004-020 and does **not** count toward the cap) would otherwise be
  re-drained forever and, under per-key head-of-line (REQ-F004-042), permanently stall its key. To make
  the cap decision deterministic on **persisted state** rather than on the type of whichever attempt
  happens to trip the cap, REQ-F004-029 adds a durable **`acked_at`** marker: on **every** transport ack
  the relay records `acked_at` (best-effort, before/with `markPublished`), so "this row has been
  delivered at least once" survives restarts and mixed failure histories. The cap itself is cause-agnostic:
  a delivery failure **or** a post-ack mark failure **increments `attempt_count`** (a successful ack does
  **not** reset it — it bounds total redelivery churn), subject to the **same max-attempt cap**
  (REQ-F004-013/014). **At the cap the outcome is routed solely by `acked_at`:**
  - **`acked_at` set (ever delivered) → force-mark published**, NOT parked. `published_at` is set
    best-effort; a published row is **not** eligible and does **not** participate in per-key head-of-line
    (REQ-F004-041/042), so this **both** stops the re-delivery loop **and** genuinely lets the key resume —
    never an infinite duplicate loop, never a permanently wedged key. This holds even for a **mixed-history**
    row (acked, mark failed, later a pre-ack failure trips the cap): because `acked_at` is set, it
    force-publishes, never parks. It is alerted via the **post-ack-cap** counter (REQ-F004-025) — the event
    reached the consumer, only its local bookkeeping was lossy.
  - **`acked_at` NULL (never delivered) → parked** (REQ-F004-014): a genuine poison row, delivered zero
    times but retained and alerted, blocking its key until resolved.
  Because the route is the persisted `acked_at`, **`parked_at` now carries a single unambiguous meaning —
  never-delivered poison** (closing review N2's conflation for good, including mixed histories). If even the
  force-mark / `acked_at` write cannot land, the relay's store is **unwritable** — surfaced by `/ready`
  (REQ-F004-044, `store-unwritable`), not by wedging a single key.
  **Crash-in-window is a separate, dedupe-bounded case (resolves review MJ-B):** a bare crash *after* ack
  but *before* any post-ack write persists **no** state (`attempt_count` does not advance), so it is **not**
  and need not be bounded by the attempt cap — it is bounded by **at-least-once + dedupe** (redelivery
  collapses to one effect, REQ-F004-018) and, if it recurs deterministically, by **supervision restart-loop
  alerting** (REQ-F004-020), not by parking a single row. The attempt cap above bounds only **persistent,
  process-alive** post-ack write failures, which can advance `attempt_count`. *Test (per-key order):* seed two rows on
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
  older row on its key is unpublished (whether mid-backoff or parked); result **ORDER BY id ASC**.
  **`__unkeyed__` exemption (ruling BR1):** the older-shares-key clause does **NOT** apply to rows whose
  `ordering_key = '__unkeyed__'` — each such row is eligible independently, so the query special-cases
  `ordering_key = '__unkeyed__'` (e.g. `AND (ordering_key = '__unkeyed__' OR NOT EXISTS (older
  undelivered row on the same key))`). This
  is the per-key head-of-line condition (REQ-F004-042): across distinct keys (and among all
  `__unkeyed__` rows) the selection skips ahead freely, but within a single non-`__unkeyed__` key it
  never returns a later row ahead of an older undelivered one. The
  bookkeeping columns (including `ordering_key`) it filters on are added by REQ-F004-029/038.
  `listUnpublished` MAY be retained for tests/diagnostics but MUST NOT be the production drain source.
  *Test:* seed (a) a fresh row on key K1, (b) a parked row (`parked_at` set) on key K2, (c) a backoff row
  (`next_attempt_at` in the future) on key K3, and (d) a fresh row on key K2 **newer** than (b), all with
  `published_at IS NULL`; the drain selection returns (a) but **not** (d) (blocked by the older parked (b)
  on the same key K2), and not (b); after (c)'s `next_attempt_at` elapses it also returns (c). *Test
  (`__unkeyed__` independence):* seed (e) a parked `__unkeyed__` row and (f) a newer fresh `__unkeyed__`
  row; the selection returns (f) despite the older parked (e) on the same `'__unkeyed__'` value (no
  head-of-line among unkeyed rows). A static
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
    **`__unkeyed__` is NOT a blocking partition (ruling BR1):** rows on the reserved `'__unkeyed__'` key
    are treated as independent, not as one shared key, so a stuck/parked `__unkeyed__` row never blocks
    another `__unkeyed__` row — the WITHIN-a-key BLOCK rule applies only to real (non-`__unkeyed__`)
    ordering keys.
  *Test (across keys):* seed row A1 on key A whose first delivery fails transiently (future
  `next_attempt_at`) and row B1 on key B that succeeds; before A1's backoff elapses, B1 is delivered and
  marked published while A1 remains unpublished and eligible-later; the relay does not wait for A1 to
  deliver B1. *Test (within a key):* seed A1 (fails transiently / is parked) followed by A2 on the **same**
  key A; A2 is **not** delivered while A1 is stuck (per-key order preserved) — it is delivered only after
  A1 is delivered (or, if A1 is parked, key A stalls and A2 waits until A1 is resolved).

### §4.4 Transport seam (drain orchestration vs pluggable transport; broker-swap-ready)
This section encodes the resolved delivery-transport decision (§9 REQ-F004-030): the GTM transport is
**HTTP-to-a-known-peer**, and the design must guarantee that swapping to a real broker later is a
**drop-in adapter change** with zero churn to producers, the emitter, the outbox, routes, or services.

- REQ-F004-049 — **Two-layer transport seam (the core swap-ability guarantee).** The relay MUST be built
  as **two separated layers**: (a) a **transport-agnostic drain / delivery-orchestration layer**, written
  **once**, that owns everything independent of the wire — polling the eligible rows (REQ-F004-041),
  per-key ordering and head-of-line (REQ-F004-016/042), retry/backoff (REQ-F004-013), mark-published /
  `acked_at` bookkeeping (REQ-F004-011/012), park / dead-letter (REQ-F004-014), and metrics (§7); and
  (b) a **narrow `EventTransport` interface** — a single method such as
  `deliver(envelope, deliveryId): Promise<void>` (or a batch variant) that **resolves on ack** (gating
  `markPublished`, REQ-F004-012) and **rejects carrying the transient-vs-permanent classification**
  (REQ-F004-047) — with a **single concrete implementation for GTM, `HttpPeerTransport`** (REQ-F004-050).
  A future `BrokerTransport` MUST be introducible as a **new class plus one config branch only** — that
  branch is the separate `EVENT_BUS_TRANSPORT` selector (REQ-F004-052), **mirroring the pattern** of the
  grounded `createEventBus` / `getEventBus` factory that already switches on `EVENT_BUS_MODE`
  (`bus.ts:38-43`), on its own axis (transport ≠ mode). **No transport-specific logic — HTTP client, peer list, POST,
  status-code mapping, per-peer retry (or, later, broker client / topics / partitions) — may leak into
  the orchestration layer**, which sees only the `EventTransport` interface and the conforming-transport
  contract (REQ-F004-043). *Test (transport-agnostic drain — the broker swap in miniature):* substitute a
  **fake / second in-memory `EventTransport`** for `HttpPeerTransport` with **zero** changes to the
  drain / ordering / retry / park / metrics code; the full drain-orchestration suite (retry/backoff
  REQ-F004-013, park REQ-F004-014, crash/restart backfill REQ-F004-011/015, per-key order
  REQ-F004-016/042) passes against the fake transport — proving the later broker swap is exercised now by
  transport substitution. *Test (no leak):* a static check confirms the orchestration/drain module imports
  only the `EventTransport` interface (not `HttpPeerTransport`, an HTTP client, or peer-list / URL
  parsing).
- REQ-F004-050 — **GTM transport is HTTP-to-a-known-peer, NOT a broker; broker is a future adapter
  (zero-churn swap boundary).** For the **October 2026 GTM** the single concrete `EventTransport`
  (REQ-F004-049) is **`HttpPeerTransport`**: the relay **POSTs each drained envelope to each configured
  peer endpoint** (REQ-F004-052) and acks the orchestration layer per the fan-out rule (REQ-F004-051).
  This is deliberately **not** a message broker. A real broker (Kafka / NATS / etc.) is **future state**
  (post-GTM, as more subscribers to **both** applications' events appear) and MUST be introducible
  **solely** as a new `EventTransport` implementation behind the REQ-F004-049 interface, selected by one
  config branch (`EVENT_BUS_TRANSPORT=broker`, REQ-F004-052), with **zero churn to producers, the emitter
  (`emitAdminEvent`), the `AdminEventEnvelope`,
  the `event_outbox` write, mutating routes, or services** (reinforcing REQ-F004-004/005/006/022 for the
  transport axis specifically): F-004 changes delivery only, and the *choice of* delivery transport —
  HTTP now, broker later — changes nothing **above** the `EventTransport` seam. *Test (zero-churn swap
  boundary):* introducing a second `EventTransport` (the REQ-F004-049 fake, standing in for a future
  broker) requires **no** edit to `emitter.ts`, `catalog.ts`, the `outbox.repo.ts` write path, any
  mutating route/service, or the envelope shape; a static scan confirms the only files touched to add a
  transport are the transport class itself and the one factory/config branch.
- REQ-F004-051 — **Multi-peer fan-out ack (at-least-once per peer), STATEFUL per-`deliveryId` re-drive;
  `published_at` still means "handed to transport"; schema invariant across the swap.**
  `HttpPeerTransport` **owns the peer / subscriber list** (REQ-F004-052) and, per the **rev-7 Fix 3 human
  ruling**, is **STATEFUL across orchestration-driven re-drives**. A `deliver(envelope, deliveryId)` call
  **resolves (acks) — and the row is marked `published_at` (REQ-F004-012) — ONLY when EVERY configured peer
  has accepted** the event (HTTP 2xx). The stateful re-drive model is specified concretely:
  - **(a) Partial failure rejects; the row stays unpublished.** On **partial failure** (some peers
    accepted, others errored / timed out / returned 4xx-5xx) `deliver()` does **NOT** resolve — it
    **rejects** (with the transient-vs-permanent classification, REQ-F004-047; concrete HTTP-outcome
    mapping REQ-F004-055) — so the row stays
    `published_at IS NULL` and the orchestration backoff (REQ-F004-013) **later re-invokes `deliver()` with
    the SAME `deliveryId`**.
  - **(b) In-memory per-`deliveryId` ack map; re-POST only un-acked peers.** The transport MUST **persist
    the per-peer ack state in memory, keyed by `deliveryId`**, across those repeated `deliver()` calls, so
    on each re-drive it **re-POSTs ONLY the peers not yet acked** for that `deliveryId` (an already-accepted
    peer is never re-POSTed while its `deliveryId` entry lives). This is a transport-internal map, invisible
    to the orchestration layer and to the `event_outbox` schema.
  - **(c) Eviction rule (bounded memory).** The transport **drops the `deliveryId` entry** when the row is
    **fully acked** (all peers accepted → orchestration marks `published_at`) **OR** when the row is
    **parked / dead-lettered** (REQ-F004-014). So the ack map cannot grow unbounded even on a long-parked or
    long-retrying key: a terminal outcome (published or parked) always evicts the entry.
  - **(d) Permanent-peer rejection parks IMMEDIATELY (rev-9 fix — reconciles with REQ-F004-047/014).** If
    **any not-yet-acked peer** returns a **permanent** rejection (the transport's permanent-vs-transient
    signal, REQ-F004-043(c); classified per REQ-F004-047, with the concrete HTTP-outcome mapping in
    REQ-F004-055), `deliver()` **rejects as
    permanent** and the orchestration layer **parks the row immediately** per REQ-F004-047/014 — with **no**
    backoff retries and **regardless** of the attempt bound. The **"after the bound"** path (retry with
    capped backoff up to max attempts, then park) applies **only** to **transiently**-failing peers
    (REQ-F004-013); a permanent peer failure short-circuits it. Either way the row's map entry is evicted
    per (c), and parking never blocks other ordering keys (REQ-F004-014).
  - **(e) Partially-delivered park is a DISTINCT signal (rev-9 — folds in review N3).** Because a peer may
    have **already accepted** before another peer permanently rejects (or before max transient attempts
    exhaust), a parked fan-out row is **not** necessarily "delivered to nobody": it was never **fully
    acked** at the **row/transport level** (`acked_at IS NULL`, so REQ-F004-011 correctly **parks** it
    rather than force-publishing — the row-level ack requires the FULL fan-out), yet some peers hold a
    (dedupable) copy. This **partially-delivered park** MUST be surfaced as a **distinct** observability
    signal from a fully-never-delivered park (REQ-F004-025), so operators know the already-accepted peers
    have copies (consumers dedupe on the delivery id, REQ-F004-018) and that only the un-acked peers need
    reconciliation on replay. `parked_at` still means "never fully handed off to the transport"
    (REQ-F004-014); the partial-vs-total distinction is metric-level, not a new row state.
  Because the entire
  fan-out and per-peer bookkeeping are **encapsulated inside the transport**, `published_at` keeps its
  **single meaning — "successfully handed off to the transport"** — and the `event_outbox` schema
  (REQ-F004-029) **does NOT need to change when the transport is later swapped** to a broker (which acks
  once, from the broker itself, with no peer list). Delivery remains **at-least-once per peer**: after a
  **process crash** the transport's in-memory ack map is lost and the whole row is re-driven to **all**
  peers on restart, so a peer may see a duplicate — collapsed to one effect by consumer dedupe on the
  stable delivery id (REQ-F004-018). *Test (stateful fan-out ack):* with **N** peers configured (from the
  comma-delimited `EVENT_BUS_URL` list, REQ-F004-052), a row is marked `published_at` **only after all N
  accept**; with one peer failing, the row stays unpublished and on the next backoff-driven `deliver()`
  (same `deliveryId`) **only the previously-failing peer is re-POSTed** — the already-acked peers receive
  **no** second POST — and once it accepts the row is published. *Test (partial-failure re-drive + dedupe):*
  a peer that fails once then succeeds yields exactly-one net effect at the succeeding peer and at-most-one
  duplicate at the already-acked peer (same delivery id, REQ-F004-018) — and after the row publishes (or
  parks) the `deliveryId` entry is evicted (a subsequent unrelated delivery does not carry stale ack state).
  *Test (permanent peer → immediate park + partial signal):* with N peers where one **permanently** rejects
  (REQ-F004-043(c)) on the first attempt after another peer has already accepted, `deliver()` rejects as
  permanent, the row is **parked immediately** (no backoff retries, `parked_at` set, `acked_at` NULL,
  REQ-F004-014), other ordering keys keep delivering, and the row is counted under the **partially-delivered
  park** signal (REQ-F004-025), not the never-delivered-park signal. *Test (schema invariant):* swapping
  `HttpPeerTransport` for the fake single-ack transport (REQ-F004-049) requires **no** migration or column
  change to `event_outbox`.
- REQ-F004-055 — **HTTP response → permanent/transient classification (RATIFIED 2026-07-19 — standard
  webhook convention).** The concrete mapping from a peer's HTTP outcome to the **permanent-vs-transient
  signal** (REQ-F004-043(c)) is a **transport-specific wire concern owned by `HttpPeerTransport`** and is
  kept **OUT of the transport-agnostic drainer** (REQ-F004-049 seam) — the drainer only ever sees the
  abstract ack / transient-reject / permanent-reject outcomes, never HTTP status codes. `HttpPeerTransport`
  MUST classify each **per-peer** POST outcome exactly as follows:
  - **Ack (success) — gates `markPublished` (REQ-F004-012).** The peer responds **2xx**.
  - **Transient — `deliver()` rejects transient ⇒ orchestration retries with capped backoff up to the
    max-attempt bound, then parks (REQ-F004-013/014).** Any **network / connection-level failure**
    (connection refused, connection timeout, DNS-resolution failure, socket reset / dropped connection),
    **every 5xx** response, **and** the two throttling/timeout status codes **408 (Request Timeout)** and
    **429 (Too Many Requests)**.
  - **Permanent — `deliver()` rejects permanent ⇒ the row parks IMMEDIATELY, no backoff
    (REQ-F004-047/051(d)).** **All other 4xx** (e.g. 400, 401, 403, 404, 422), **and any other unexpected
    non-2xx response, including any 3xx** (a webhook peer is expected to accept at its final URL, so a
    redirect is treated as a misconfiguration, not a retry).
  This closed mapping is total over every possible outcome (2xx ack; the enumerated transient set; **all
  else** permanent), so no response is left unclassified. **Fan-out composition (cross-ref REQ-F004-051):**
  in the multi-peer case the per-peer classification composes with the existing fan-out rules — a
  **permanent** response from **any not-yet-acked peer** makes the **whole `deliver()` reject permanent**
  (immediate park, REQ-F004-051(d)); if **no** not-yet-acked peer is permanent but **at least one** is
  **transient**, `deliver()` **rejects transient** and the transport re-drives **only the un-acked peers**
  on the next backoff-driven call (REQ-F004-051(a)/(b)); `deliver()` **resolves (acks)** only when **every**
  peer has returned 2xx. The classification carries **no** HTTP-specific detail into the outbox schema or
  the drainer; a later `BrokerTransport` supplies its own equivalent mapping behind the same
  REQ-F004-043(c) signal (REQ-F004-049). *Test (single-peer table):* drive one peer through each outcome and
  assert the resulting signal — **2xx → ack** (row published); **500/502/503, 408, 429, connection-refused,
  timeout, DNS-failure, socket-reset → transient** (row stays `published_at IS NULL`, `attempt_count`
  advances, retried with backoff, parked only after the max-attempt bound, REQ-F004-013/014); **400/401/403/
  404/422, any 3xx, any other non-2xx → permanent** (row `parked_at` set immediately, no backoff retries,
  REQ-F004-047). *Test (fan-out composition):* with N peers where one returns 400 (permanent) and others are
  2xx or 5xx, `deliver()` rejects **permanent** and the row parks immediately (REQ-F004-051(d)); with no
  permanent peer but one returning 503 (transient), `deliver()` rejects **transient** and only the 503 peer
  is re-POSTed on the next attempt while already-2xx peers are not (REQ-F004-051(a)/(b)). *Test (seam):* a
  static check confirms HTTP status-code constants live only in `HttpPeerTransport`, not in the drain /
  orchestration module (REQ-F004-049).

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
  per-key ordering guarantee relative to one another and are **independent** — not a shared partition, so
  none blocks another and a stuck one does not stall the rest (§3 definition; ruling BR1). *Test:* emit rows A1, A2 on key A
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
  exactly **one logical drainer per `event_outbox`**. **Lease TTL & overlap (resolves review MN1):** a
  lease under option (b) MUST carry a **TTL with periodic renewal** so a crashed holder's lease is
  reclaimable (a bare, never-expiring lease would wedge the relay on crash). A lease-expiry / GC-pause
  overlap — a stalled holder past expiry while a new holder acquires and drains the same row — is
  **tolerated, not prevented**: it yields at most a **same-delivery-id** re-delivery that the consumer
  absorbs (effectively-once, REQ-F004-018), so the "one drainer at any time" invariant is a
  **single-writer-of-`markPublished`-per-row** guarantee backed by dedupe, not a distributed mutual
  exclusion; a fencing token is OPTIONAL and not required for correctness. Concurrent drain *ticks within the drainer* MUST
  NOT both deliver the same row and both call `markPublished`. *Test (nominal path — single instance / held
  lease):* under one live instance (or one lease holder with a valid, unexpired lease) two concurrent drain
  ticks contend for the same `event_outbox`; only one delivers a given row per successful pass — the second
  acquires no lease / is not the single instance and stands by. (This asserts the nominal guarantee; the
  lease-expiry/GC-pause **overlap** window above is the deliberately tolerated exception — two holders may
  each deliver the same row, absorbed as a same-delivery-id duplicate — so the single-delivery assertion is
  scoped to a held lease, not the crash-overlap gap.) A
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
- REQ-F004-053 — **Consumer contract is broker-swap-invariant: dedupe + reorder-tolerance are baked in
  NOW.** So that introducing a later **partitioned broker** (REQ-F004-050) causes **no behavioral change**
  for consumers, the consumer contract F-004 publishes under the GTM HTTP transport already bakes in both
  weaknesses a broker would exhibit: (a) **duplicates** — consumers MUST dedupe on the **stable transport
  delivery id** (REQ-F004-018/048), which is the **same** id under HTTP now and under a broker later; and
  (b) **reorder across keys** — consumers MUST tolerate events arriving in a different order than emitted
  **across** ordering keys (F-004 promises order only **within** an ordering key, REQ-F004-016/031, and
  `__unkeyed__` events carry no mutual order at all). F-004 does **NOT** promise strict global ordering to
  consumers under HTTP, precisely so a future broker's per-partition ordering is a **subset** of what
  consumers already tolerate — the swap adds no new consumer-visible failure mode. Because a **stable,
  load-bearing delivery id already exists** at the transport/message level (REQ-F004-018), the swap forces
  **no** envelope-contract change (REQ-F004-004/036) and no consumer rewrite. *Test:* a consumer built
  against the GTM HTTP transport that dedupes on the delivery id and does not assume cross-key order
  processes a stream correctly under (i) duplicate redelivery (REQ-F004-011) and (ii) cross-key
  reordering, and processes the **same** stream with **no code change** when it is later delivered by a
  partitioned-broker transport double.

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
  **Cap edge is INCLUSIVE at the Nth failure (rev-9, folds in review N2 — for deterministic tests):** the
  documented constant `MAX_ATTEMPTS` is the number of **failed attempts** at which the row is parked, i.e.
  a row is parked **when `attempt_count` reaches `MAX_ATTEMPTS`** (the `MAX_ATTEMPTS`-th failure parks it),
  not after `MAX_ATTEMPTS` further retries beyond the first — so with `MAX_ATTEMPTS = N` a row that fails N
  times is parked on the Nth failure and is retried at most `N-1` times. This inclusive-at-N convention
  MUST be stated alongside the constant.
  **Post-ack mark-failure pacing (rev-9, folds in review N1):** a **persistent** post-ack `markPublished`
  failure that counts toward the post-ack cap (REQ-F004-011 — i.e. **not** a transient `SQLITE_BUSY`, which
  is retried and excluded, REQ-F004-020) **also advances `next_attempt_at` under the SAME backoff
  schedule** and increments `attempt_count`, so a row that is acked-but-unmarkable is **not** hot-looped —
  it re-drains on the same capped-exponential cadence as a transient delivery failure until it hits the cap
  and is force-marked published (REQ-F004-011). Retries stay **within** the failing row's ordering key
  (REQ-F004-042): a row in backoff holds its key but not other keys. *Test:* a row whose delivery fails K (< max)
  transient times has `next_attempt_at` advanced with monotonically non-decreasing delays per the
  documented schedule (observed via attempt timestamps), is not re-selected before `next_attempt_at`,
  and is not on a tight loop; a transient failure that later succeeds ends with the row marked
  published.

### §6.2 Failure isolation (poison events must not block the queue)
- REQ-F004-014 — **Poison-event isolation (park or dead-letter) — per-key scoped (RECONCILED per
  REQ-F004-031/032).** A **never-acked** row (`acked_at IS NULL`, REQ-F004-029) that exhausts its maximum
  transient attempts (REQ-F004-013), or that the transport rejects as **permanently** undeliverable
  (REQ-F004-047 classification), MUST be **isolated** — parked in place (setting `parked_at`, a
  terminal-state marker) or moved to a dead-letter store. (A row that was **ever acked** — `acked_at`
  set — is **never** parked at the cap; it force-marks published instead, REQ-F004-011, so `parked_at`
  means exclusively **never-fully-acked** poison.) **"Never-acked" is at the ROW / transport-ack level
  (rev-9 clarification, review N3):** `acked_at` is set only when the transport **fully** acks the row; for
  the multi-peer HTTP transport (REQ-F004-051) full ack requires **every** configured peer to accept, so a
  **partially-delivered** row (some peers accepted, but a peer permanently rejected or transient attempts
  exhausted before full fan-out) has `acked_at IS NULL` and is correctly **parked** — even though some
  peers already hold a (dedupable) copy. `parked_at` therefore means "never **fully** handed off to the
  transport", which subsumes both a fully-never-delivered row and a partially-delivered one; the two are
  distinguished only at the **metric** level by the partially-delivered-park signal (REQ-F004-025/051),
  not by a distinct row state. Isolation makes the row **ineligible** for the drain
  selection (REQ-F004-041) so the relay does not re-attempt it, and
  the relay MUST **continue draining eligible rows of OTHER ordering keys**. A single poison event MUST
  NOT block delivery across the **global** stream, and MUST NOT be silently dropped: a parked event is
  delivered zero times but is retained for inspection/replay and raises an alert metric (§7 REQ-F004-025)
  — this is the "isolated" arm of the reconciled guarantee (REQ-F004-011). **Per-key scope of a park:**
  under per-key ordering (REQ-F004-031) a parked/poison row **stalls only ITS OWN ordering key** — that
  key's subsequent rows are held to preserve per-key order (per-key head-of-line, REQ-F004-042) and the
  key is flagged (parked-count metric, REQ-F004-025) until the parked row is resolved/replayed; it does
  **NOT** block any other key or the global stream. **`__unkeyed__` rows are independent (ruling BR1):**
  a parked `__unkeyed__` row stalls **nothing** — not even other `__unkeyed__` rows — because they are
  not a shared partition (§3, REQ-F004-041 exemption); its blast radius is exactly one row.
  Park-vs-DLQ is RATIFIED (§9, REQ-F004-032) as
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
  dropping). **For the GTM `HttpPeerTransport` this provisional default is SUPERSEDED by an explicit,
  total classification (rev-11):** REQ-F004-055 pins the concrete HTTP-response → permanent/transient
  mapping (2xx ack; 5xx / 408 / 429 / network errors transient; all other 4xx, any 3xx, any other non-2xx
  permanent), so under HTTP the transport always emits an explicit signal and never falls back to
  treat-all-as-transient. The provisional default still governs any transport that gives no explicit
  signal. *Test:* a transport reply flagged permanent parks the row on the first failure with no
  backoff retries; an error/timeout/unreachable failure increments `attempt_count`, sets
  `next_attempt_at`, and is retried, parking only after max attempts. (HTTP-specific outcome-to-signal
  cases are tested under REQ-F004-055.)

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
  Per-key order over a **pre-F-004** backlog depends on every backlog row carrying a non-null
  `ordering_key`; the migration backfills it for all pre-existing rows from their stored envelopes
  (REQ-F004-029, resolves review MJ-A), so the eligibility query (REQ-F004-041) partitions the replay
  correctly rather than draining a NULL-key backlog with no per-key order.

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
  - **Shared-store access model (resolves review MN3).** The grounded store is a local SQLite file
    (`store/db.ts`, better-sqlite3), so "shared `event_outbox`" means **two processes against one SQLite
    database file**: the BFF (writer of new rows) and the separate relay (reader + delivery-bookkeeping
    writer). This deployment therefore requires (a) both processes open the **same DB file path** on the
    box, (b) **WAL journal mode** enabled so a reader/drainer and the enqueuing writer do not block each
    other, and (c) the single-drainer constraint (REQ-F004-017) to serialize `markPublished`/park writes.
  - **Write-vs-write contention (resolves review N3).** WAL removes reader/writer blocking but **not**
    writer/writer: SQLite still serializes the BFF's INSERT against the relay's bookkeeping writes
    (`markPublished`/park/`attempt_count`), so either writer can observe `SQLITE_BUSY`. Both processes MUST
    set a **`busy_timeout`** (a bounded blocking wait) and treat a `SQLITE_BUSY`/`SQLITE_LOCKED` as a
    **transient, retryable** error — **not** a delivery or mark failure. In particular a transient
    `SQLITE_BUSY` on the post-ack `markPublished` MUST be retried and MUST **NOT** increment `attempt_count`
    toward the post-ack cap of REQ-F004-011 (which would wrongly force-mark or churn a delivered row); it
    counts only genuine, persistent write errors. *Test:* with the BFF issuing concurrent INSERTs, a relay
    `markPublished` that first returns `SQLITE_BUSY` succeeds on retry within `busy_timeout` without
    incrementing `attempt_count`.
    Note the lease option REQ-F004-017(b) "**DB advisory lock**" is Postgres terminology with **no native
    SQLite equivalent** — for a SQLite deployment only the **lease row/column** form (or the
    single-instance constraint) is realizable; the advisory-lock phrasing applies only if the store is
    later a client/server DB. A cross-box relay would require the store to become a shared network DB (out
    of scope for rev 1; the on-box SQLite model is assumed).
  - **Graceful shutdown (bounded drain over the SET of in-flight deliveries — rev 9 fix, reconciles with
    the parallel-delivery model REQ-F004-017/027).** Because distinct ordering keys deliver **in parallel**
    (REQ-F004-027 — the relay is not single-threaded-capped by per-key order, and REQ-F004-017 presumes
    concurrent drain ticks), a relay under load has **N concurrent in-flight deliveries** at shutdown, not
    one. On shutdown the relay (a) **stops selecting new rows**, releases its lease if it holds one
    (REQ-F004-017), then (b) performs a **bounded graceful drain over ALL currently in-flight deliveries**:
    it awaits the outcome of **every** delivery already handed to the transport, up to a single bounded
    shutdown timeout shared across the set (M5, Reading A generalized). For **each** in-flight delivery, if
    its ack arrives before the timeout the relay calls `markPublished` for that row; any delivery whose ack
    has **not** arrived when the timeout elapses is **abandoned**, leaving its `published_at` NULL for
    redelivery on next start. **Abandonment does NOT advance `attempt_count` (rev-10 clarification):** an
    in-flight delivery abandoned at the shutdown timeout is **neither a transport ack nor a delivery
    failure** — it is an interrupted attempt — so it leaves the row's retry bookkeeping (`attempt_count`,
    `next_attempt_at`, `last_error`) **unchanged** and simply re-drains on next start. A restart *during*
    delivery therefore does **not** erode the row's retry budget (REQ-F004-013/014): repeated
    shutdown-interruptions cannot spuriously push a row toward the max-attempt park cap. No in-flight row is
    left partially written: each ends either published (acked within the timeout) or unpublished
    (abandoned, bookkeeping untouched), independently of the others. This is the multi-delivery
    generalization of the former single-in-flight wording; it does **not** serialize shutdown (the set is
    awaited concurrently, not one-by-one).
  - **Restart mid-drain (safe by construction).** Because delivery is at-least-once and dedupe delivers
    effectively-once (REQ-F004-018/031), a relay restart mid-drain is safe: an **unpublished** in-flight
    row (crash/kill before ack) stays `published_at IS NULL` and is re-drained on restart; an
    **acked-but-not-yet-marked** row is re-delivered (a duplicate carrying the **same** delivery id) and
    collapsed to one effect by a deduping consumer. State is never corrupted (an unacked delivery stays
    unpublished; an acked one is marked published) and per-key order is preserved because re-drain still
    honors per-key head-of-line (REQ-F004-042).
  *Test:* a shutdown/kill initiated while **multiple deliveries on distinct keys are concurrently in
  flight** waits up to the shared shutdown timeout (or, on hard kill, is simply re-driven by the
  supervisor); **each** in-flight row ends **either** published (its ack arrived within the timeout) **or**
  unpublished (its ack did not arrive before the timeout, or hard kill), never partially written, and the
  outcomes are per-row independent (some may publish while others abandon within the same shutdown); an
  abandoned in-flight row keeps its `attempt_count` **unchanged** (abandonment is not a failure), so
  repeated shutdown-during-delivery does not advance it toward the park cap; after
  the supervisor restarts the relay, every remaining unpublished eligible row is delivered in per-key
  order, and a mid-drain kill produces at most a same-delivery-id duplicate per row, never a loss.
- REQ-F004-054 — **The relay is a PER-APP pattern (each app drains its own outbox).** Consistent with the
  grounded **copy-and-renamespace** precedent used for the bus / catalog / emitter (each application
  carries its own `bff/src/events/*` and its own `event_outbox`), the relay is instantiated **once per
  application**: the admin-console relay drains the **admin-console** `event_outbox` in the admin-console's
  own process/deployment, and the **customer-web-app twin** — **out of scope for this spec**, tracked by
  that app's own F-004 instantiation — runs its **own** relay draining its **own** outbox. F-004 does
  **NOT** introduce a single cross-app worker reaching across multiple applications' databases; the
  single-drainer constraint (REQ-F004-017) is **per-app-outbox**. This holds identically under the GTM
  HTTP transport and a future broker (each app's relay simply targets the shared transport via its own
  `EventTransport`, REQ-F004-049). *Test:* the admin-console relay selects only from the admin-console
  `event_outbox`; no F-004 code path opens or drains another application's database.

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
  in production, split by process per the separate-relay topology (RECONCILED per REQ-F004-033/039;
  resolves review MJ1).** Because ruling REQ-F004-033 makes the relay a **separate supervised service**,
  the two misconfig variables are consumed by **different processes**, and each process hard-refuses on
  the variable it actually reads:
  - **`EVENT_BUS_MODE` → the BFF hard-refuses.** The mode selects the **BFF's** emitter (the grounded
    factory at `bus.ts:40` picks `OutboxRelayBus` vs the in-proc bus). The hazard of a non-`bus` value in
    production is **not** that the row is un-enqueued — the grounded `InProcessBus.publish` (`bus.ts:19-24`)
    **does** `insert` the outbox row and **immediately** `markPublished` — it is that the row is marked
    **published without ever being delivered** to a real cross-process transport (the in-proc bus has zero
    subscribers). Because those rows already carry `published_at`, a later switch to `bus` mode will **not**
    re-drain them (they are not eligible, REQ-F004-041): the events are **silently and permanently lost**.
    So under `NODE_ENV=production` a non-`bus` `EVENT_BUS_MODE` (literal `inproc`, unset, or an
    unrecognized value such as `buss`, REQ-F004-046) MUST cause the **BFF to refuse to start**, exiting
    non-zero with a clear error naming `EVENT_BUS_MODE`. This is the core of ruling REQ-F004-039 — a
    production BFF never runs the interim in-proc bus (which would mark-published-without-delivery).
  - **`EVENT_BUS_URL` → the RELAY hard-refuses (not the BFF).** Only the relay delivers and only the
    relay reads `EVENT_BUS_URL` (the BFF's `OutboxRelayBus.publish` is INSERT-only and never uses it).
    So `bus` mode with no `EVENT_BUS_URL` is a **relay** misconfiguration: the **relay service refuses
    to start** (REQ-F004-045), while the **BFF boots and keeps enqueuing** to the outbox regardless — a
    running BFF with a down/unstarted relay is a recoverable backlog state, not a lost-event state.
  This is **not** the rev-2 warn-and-continue posture; a misconfigured production deployment does not run
  degraded on the offending axis. The **separate `GET /ready` readiness probe is served by the RELAY**
  (REQ-F004-044) for **runtime** relay health (transport reachability, backlog/lag — facts only the relay
  observes), and the parent's fixed liveness `GET /health → {ok:true}` on the **BFF** (parent REQ-024) is
  **not** modified (B6). In **development** a non-`bus` value MAY warn and default to `inproc`
  (REQ-F004-046), and a missing `EVENT_BUS_URL` leaves the relay in a not-ready backlog-growing state
  (REQ-F004-045). *Test:* under `NODE_ENV=production`, `EVENT_BUS_MODE` set to `inproc`/unset/a non-`bus`
  typo makes the **BFF** refuse to boot (non-zero exit naming `EVENT_BUS_MODE`; no BFF HTTP listener);
  `bus` mode with `EVENT_BUS_URL` unset makes the **relay** refuse to boot (naming the missing URL) while
  the BFF boots, serves `GET /health → {ok:true}`, and keeps enqueuing (backlog grows). Starting in `bus`
  mode with a configured `EVENT_BUS_URL` boots both processes normally; the relay's `/ready` reports ready
  once the transport is reachable.
- REQ-F004-022 — **Transport adapter lives behind the `EventBus` seam; no route/service changes.**
  Delivering to the real bus is implemented as a transport adapter used by the relay, selected/configured
  by `EVENT_BUS_MODE` / `EVENT_BUS_URL` — consistent with `docs/design/04-cross-cutting.md` §c and
  `06-risks.md` R1 ("adopting the real bus later is a new adapter behind `EventBus`, with no route or
  service changes"). *Test:* enabling `bus` mode and pointing `EVENT_BUS_URL` at a conforming transport
  requires no edits to mutating routes/services or to `emitAdminEvent`; only relay/transport/config code
  changes. The two-layer split that makes the transport a genuine drop-in — a transport-agnostic drain
  orchestration layer plus a narrow `EventTransport` interface, with `HttpPeerTransport` for GTM and a
  future `BrokerTransport` behind one config branch — is specified in §4.4 (REQ-F004-049/050/051).
- REQ-F004-029 — **Delivery-bookkeeping schema (migration).** The relay's drain selection
  (REQ-F004-041), retry/backoff (REQ-F004-013), parking (REQ-F004-014), and observability require
  per-row DELIVERY bookkeeping the current `event_outbox` lacks. F-004 adds, via a migration (in
  `store/db.ts`), at minimum: `attempt_count` (integer, default 0), `next_attempt_at` (nullable
  timestamp; null ⇒ immediately eligible), `last_error` (nullable text), `parked_at` (nullable
  timestamp; non-null ⇒ isolated/terminal), **`acked_at`** (nullable timestamp; non-null ⇒ this row's
  delivery was **acked by the transport at least once**, recorded best-effort on every ack before/with
  `markPublished` — the durable "ever-delivered" marker that routes the post-ack cap decision of
  REQ-F004-011 and keeps `parked_at` meaning exclusively *never-delivered poison*, resolves review
  B1-new/N2), and — added in rev 3 per the per-key ordering ruling
  (REQ-F004-031/038) — **`ordering_key`** (text; the per-key partition derived from
  `AdminEventEnvelope.target`, §3 definition; `__unkeyed__` for events with no natural key). Persisting
  `ordering_key` as a column lets the relay enforce per-key order and per-key head-of-line (REQ-F004-042)
  and run the eligibility query (REQ-F004-041) without recomputing the key from the envelope each drain.
  **`ordering_key` MUST be populated for every row (resolves review MJ-A).** The derivation is a total,
  deterministic function of the persisted `AdminEventEnvelope` (event **name** + a named `target` field,
  §3), so: (i) the migration that adds the column **backfills `ordering_key` for all rows already
  present** — critically the pre-F-004 unpublished backlog that the first-connection replay (REQ-F004-015)
  must drain **in per-key order** — by applying the §3 derivation to each stored envelope; and (ii) the
  enqueue path populates `ordering_key` at INSERT for every new row. It is **NOT** "lazily populated on
  first drain" (that is circular — the drain *selection* is precisely what needs the key). **Malformed /
  unparseable stored envelope during backfill (rev-9, folds in review N4):** the derivation parses each
  stored `envelope` JSON and reads the event name + a named `target` field. If a pre-existing row's stored
  envelope is **unparseable or structurally invalid** (cannot be JSON-parsed, or lacks a usable event
  name), the migration MUST still assign a **non-null** key — it falls the row back to `'__unkeyed__'`
  (independent — never a shared blocking partition), the **same** total fallback the §3 derivation uses for
  a matched-prefix-but-missing-`target`-field row. So the migration **never** leaves a row NULL, **never**
  aborts on a bad row, and a malformed row degrades only to unordered-but-still-deliverable (its delivery
  may then park normally, REQ-F004-014, without stalling a real key). After the
  migration `ordering_key` is therefore **NON-NULL for every row**, so the eligibility query
  (REQ-F004-041) can rely on a non-null key; **defensively**, any row that nonetheless presents a NULL
  `ordering_key` is treated as `'__unkeyed__'` (independent — eligible on its own, never a shared blocking
  partition), matching the §3 totality fallback (resolves review N5). It SHOULD be indexed with `id` to
  make the "oldest undelivered row per key" selection cheap. It also provisions the **per-DB-lifetime epoch**
  (REQ-F004-048) used to qualify the delivery id (REQ-F004-018, M6) — e.g. a single stored
  `outbox_epoch` value (DB-instance UUID / creation marker) generated once per `event_outbox`
  provisioning. These are added as **columns on `event_outbox`** (RATIFIED §9, REQ-F004-038 — not a
  sidecar table) plus a small singleton row/table for the epoch. This is DELIVERY bookkeeping, **not** a
  change to the event contract (REQ-F004-004); the transactional INSERT path (REQ-F004-005) is not
  altered. *Test:* the migration adds the bookkeeping fields (including `ordering_key`) and the epoch
  value; an emitted row starts with `attempt_count` = 0, `next_attempt_at` = null, `parked_at` = null,
  and a non-null `ordering_key` matching its family's rule in the **total** derivation of §3
  (`admin.workspace.*`→`ws:<id>`, `admin.user.*`→`user:<id>`, `admin.instance.*`/`admin.raw_env.*`→
  `instance`, `admin.workspace_user.*`→`ws:<workspace>`, `admin.invite.*`→`invite:<id>`,
  `admin.baseline_prompt.*`→`baseline` (rev-7 Fix 1), `admin.feature_toggle.*`→`__unkeyed__` (rev-7 Fix 2,
  intentional), else `__unkeyed__` — **all eight live catalog families** covered, resolves review BR2 +
  rev-7 Fix 2); a failed delivery increments
  `attempt_count` and records `last_error`/`next_attempt_at` without touching `envelope`, `ts`, or
  `ordering_key`. *Test (backfill):* given an `event_outbox` pre-seeded with unpublished pre-F-004 rows
  (written before the `ordering_key` column existed, so NULL), running the migration populates each such
  row's `ordering_key` from its stored envelope via the §3 derivation, leaving **no** unpublished row with
  a NULL key; a first-connection replay (REQ-F004-015) over that backlog then honors per-key order.
- REQ-F004-045 — **`bus` mode selected but `EVENT_BUS_URL` unset (resolves M1; HARD-REFUSE in production
  per REQ-F004-039).** `EVENT_BUS_URL` is optional in config (`config.ts:51`). When `EVENT_BUS_MODE=bus`
  but no `EVENT_BUS_URL` is configured the relay has nowhere to deliver. F-004 defines this as a
  **misconfiguration** with a **hard-refuse** startup posture, but — per the separate-relay topology
  (REQ-F004-033) and the process split of REQ-F004-021 (resolves review MJ1) — it is the **RELAY**, not
  the BFF, that owns this variable: under `NODE_ENV=production` the **relay service MUST refuse to
  start**, exiting with a clear error citing "bus mode without EVENT_BUS_URL", rather than starting with
  nowhere to deliver. The **BFF is unaffected** — it reads no `EVENT_BUS_URL`, so it **boots normally and
  keeps enqueuing** to `event_outbox` (a recoverable backlog, REQ-F004-024, not lost events), and its
  `GET /health` returns `{ok:true}`. Outside production (development/interim), the softer posture MAY
  apply — the relay starts but treats delivery as impossible, leaves rows unpublished (backlog grows,
  REQ-F004-024), emits a warning log, and reports `/ready` (REQ-F004-044) not-ready with reason "bus mode
  without EVENT_BUS_URL". *Test:* starting under `NODE_ENV=production` in `bus` mode with `EVENT_BUS_URL`
  unset causes the **relay** to **refuse to boot** (non-zero exit, error cites the missing URL) while the
  **BFF** boots, serves `GET /health → {ok:true}`, and continues enqueuing (backlog grows, no row
  published). In development the same config starts the relay with a warn log and a not-ready `/ready`
  citing the missing URL, and no row ever transitions to published.
- REQ-F004-046 — **Mode validation — any non-`bus` value is a degrade (resolves M2).** The grounded
  factory selects `bus` **iff** `eventBusMode === 'bus'` and falls back to `inproc` for **every** other
  value (`bus.ts:40`), so a typo like `EVENT_BUS_MODE=buss` silently runs `inproc`. F-004 requires
  `EVENT_BUS_MODE` to be validated against the closed set `{inproc, bus}`: an **unrecognized** value is
  treated as a misconfiguration and, under `NODE_ENV=production`, trips the same **hard-refuse** startup
  posture as a non-`bus` mode (refuse to boot, REQ-F004-021/039) — never a silent `inproc` fallback
  masquerading as healthy. In development an unrecognized value MAY warn and default to `inproc`.
  *Test:* `EVENT_BUS_MODE=buss` under production causes the BFF to **refuse to boot** with an error citing
  the invalid mode; the same value in development warns but starts.
- REQ-F004-052 — **Config surface — peer list + transport selector (both shapes PINNED, rev-7 Fix 4).**
  Two distinct config mechanisms, on **two distinct axes**:
  - **(1) Peer list — `EVENT_BUS_URL` is a comma-delimited list.** The GTM `HttpPeerTransport`
    (REQ-F004-050) reads its **peer endpoint(s)** from the existing **`EVENT_BUS_URL`** variable
    (`config.ts:52`) — **not** a new variable — parsed as a **comma-delimited list of one or more peer
    URLs**: the delimiter is a **comma (`,`)**, surrounding **whitespace is trimmed** from each entry, and
    empty entries are dropped (mirroring the grounded `WEB_ORIGINS` parse, `config.ts:22`). One URL yields a
    single peer; several comma-separated URLs yield the **N peers** of the multi-peer fan-out
    (REQ-F004-051), making that requirement's "N peers configured" test deterministic. This value is read
    **only by the relay process** (the BFF reads no `EVENT_BUS_URL` / peer list, REQ-F004-021/045).
  - **(2) Transport selector — `EVENT_BUS_TRANSPORT`, a SEPARATE axis from `EVENT_BUS_MODE`.** Because
    `EVENT_BUS_MODE` is a closed `{inproc, bus}` set (REQ-F004-046) that selects the **BFF's emitter**, it
    is **not** overloaded to pick the transport. F-004 adds a **separate** key **`EVENT_BUS_TRANSPORT`**
    with values **`{http, broker}`**, **default `http`**, evaluated **ONLY when `EVENT_BUS_MODE=bus`** and
    **only by the relay**. This selector is **the single config branch** the future `BrokerTransport` swaps
    behind (REQ-F004-049/050): `http` → `HttpPeerTransport` (GTM default), `broker` → the future
    `BrokerTransport`. It is **orthogonal** to `EVENT_BUS_MODE` — mode chooses
    *whether* to relay, transport chooses *how* to deliver — so adding the broker imposes **no** new
    production-config shape on producers, the emitter, or the BFF.
  - **(3) `broker` is a valid value with NO GTM behavior — HARD-REFUSE in ALL environments (rev-9 fix +
    rev-10 human ruling; resolves review blocking-3).** `BrokerTransport` is **future / post-GTM** and is
    **not** part of this deliverable (REQ-F004-030/050). So although `broker` is in the closed set (to keep
    the selector's future values documented and validated), the **GTM relay has no broker implementation to
    select**. Setting `EVENT_BUS_TRANSPORT=broker` against the GTM build is therefore a **misconfiguration**:
    the **relay refuses to boot** with a clear error — **"broker transport not available in this build"**
    (non-zero exit; the BFF is unaffected and keeps enqueuing). **This refuse-to-boot applies in BOTH
    development AND production (rev-10 human ruling) — it is deliberately NOT the environment-split posture
    of REQ-F004-045.** REQ-F004-045 boots-soft in dev for a *missing `EVENT_BUS_URL`* because that is a
    **recoverable** state (the operator can supply the URL and the already-instantiated `HttpPeerTransport`
    starts delivering the accumulated backlog). By contrast there is **structurally no `BrokerTransport` to
    instantiate** in this build, so a dev "boot but never ready" state would be pointless — nothing can ever
    make it ready without a different build. The relay therefore hard-refuses regardless of `NODE_ENV`. This
    makes the GTM behavior of every value in the closed set defined: `http` (or unset → default `http`)
    selects `HttpPeerTransport`; `broker` refuses to boot **in every environment** until a build actually
    ships `BrokerTransport`; any value outside `{http, broker}` is likewise a refuse-to-boot misconfiguration
    in every environment (same closed-set validation posture as `EVENT_BUS_MODE`, REQ-F004-046).
  With `bus` mode and the `http` transport but **no** `EVENT_BUS_URL` (empty peer list), the relay has
  nowhere to deliver, so it **refuses to start in production** and reports `/ready` not-ready in
  development — exactly the REQ-F004-045 posture — while the BFF boots and keeps enqueuing regardless.
  *Test (peer list):* `EVENT_BUS_URL="https://a.example, https://b.example"` yields exactly two trimmed
  peers for fan-out (REQ-F004-051). *Test (selector, GTM build):* `EVENT_BUS_TRANSPORT` unset defaults to
  `http` and selects `HttpPeerTransport`; `EVENT_BUS_TRANSPORT=broker` makes the **relay refuse to boot**
  with "broker transport not available in this build" (non-zero exit) **in BOTH development AND production**
  (there is no dev-soft "boot but never ready" arm for the broker case, rev-10 ruling) while the BFF boots
  and enqueues; an out-of-set value likewise refuses to boot in every environment; and any selector value
  is **ignored when `EVENT_BUS_MODE!=bus`**;
  `bus`+`http` with an empty `EVENT_BUS_URL` trips the REQ-F004-045 refuse-to-boot (production) / not-ready
  (dev) posture while the BFF boots and enqueues; no peer/transport config is ever read by the BFF or
  reaches the browser (REQ-F004-028). *Test (post-GTM / broker-era — does NOT gate this deliverable):* once a
  build ships `BrokerTransport`, `EVENT_BUS_TRANSPORT=broker` selects it via the one branch with no change
  above the seam (REQ-F004-049); this test is deferred to the broker-era build and is **not** part of the
  GTM acceptance set.

---

## §7 Delivery Observability

- REQ-F004-023 — **Relay lag.** The console exposes the **age of the oldest unpublished, non-parked**
  outbox row (relay lag) as an observable metric/diagnostic. *Test:* with one row unpublished for T
  seconds, the relay-lag signal reports approximately T; with an empty/all-published outbox it reports
  zero.
- REQ-F004-024 — **Backlog count.** The count of unpublished, non-parked rows (backlog) is observable.
  *Test:* enqueuing N rows against an unreachable transport makes the backlog report N; draining them
  returns it to zero.
- REQ-F004-025 — **Failure, attempt, parked/DLQ, partially-delivered-park & post-ack-cap counts.**
  Delivery failure counts, retry/attempt counts, and parked/dead-lettered depth (REQ-F004-014) are
  observable, so operators can alert on a stuck or poison-accumulating relay. Additionally, a
  **post-ack-cap** counter (REQ-F004-011) records rows that were **delivered/acked** but force-marked
  published after their `markPublished` repeatedly failed — a distinct signal from parked depth (which is
  now exclusively never-**fully**-acked poison, REQ-F004-011/N2): it means the event reached the consumer
  but its local bookkeeping was lossy, warranting reconciliation without implying event loss. **Additionally
  (rev-9, folds in review N3), the parked depth is split into two counters:** a **never-delivered park**
  count (no peer ever accepted before parking) and a **partially-delivered park** count (a fan-out row
  parked while **some** peers had already accepted, REQ-F004-051(e)/-014). The partially-delivered-park
  signal tells operators that already-accepted peers hold dedupable copies (REQ-F004-018) and only the
  un-acked peers need reconciliation on replay — a materially different remediation than a never-delivered
  park, though both share the `parked_at` row state. *Test:* a **repeatedly transiently-failing**
  (never-acked, no peer accepted) row increments the failure/attempt counters and, after **max transient
  attempts** (REQ-F004-013 — not the permanent-classification short-circuit), increments the
  **never-delivered park** count by one; a fan-out row where one peer accepts and another returns a
  **permanent** rejection (REQ-F004-043(c)) is parked immediately and increments the **partially-delivered
  park** count (not the never-delivered count); a row whose delivery is acked but whose `markPublished`
  repeatedly fails increments the **post-ack-cap** counter (neither park count) and ends up
  `published_at`-set.
- REQ-F004-026 — **Relay readiness signal (contributes to REQ-F004-044).** The relay contributes to the
  **separate readiness signal defined in REQ-F004-044** (NOT the parent's fixed `GET /health`, REQ-024)
  a status reflecting whether it is running, whether the mode is `bus` (REQ-F004-021), whether the
  transport is configured (REQ-F004-045) and reachable, and whether backlog/lag are within a configured
  threshold — usable by the deployment's orchestration probes and by REQ-F004-021. **Named threshold config
  surface (rev-9, folds in review N5):** the backlog and lag thresholds that flip `/ready` to
  not-ready/degraded are two **named, relay-only** config keys following the `EVENT_BUS_*` convention:
  **`EVENT_BUS_BACKLOG_THRESHOLD`** (unpublished-non-parked row count, REQ-F004-024) and
  **`EVENT_BUS_LAG_THRESHOLD_MS`** (oldest-unpublished-row age in ms, REQ-F004-023). Each has a
  **provisional default** documented as a constant of record (the same treatment as the backoff constants,
  REQ-F004-013): default `EVENT_BUS_LAG_THRESHOLD_MS` = **30000** (30 s — comfortably above the p95 < 5 s
  delivery target so transient bursts do not flap the probe, REQ-F004-027) and default
  `EVENT_BUS_BACKLOG_THRESHOLD` = **1000** rows (well under the ≥10,000-row backfill-drain target so a
  genuinely growing backlog trips before saturation, REQ-F004-027). Both are operator-tunable; unset ⇒ the
  documented default. **Boundary edge is AT-OR-OVER ⇒ not-ready (rev-10 clarification, deterministic
  comparison):** the probe reports **not-ready/degraded** when **`backlog ≥ EVENT_BUS_BACKLOG_THRESHOLD`
  OR `lag ≥ EVENT_BUS_LAG_THRESHOLD_MS`** (either condition, inclusive `≥` — reaching the threshold is
  already degraded); it is **ready** only when **both** are **strictly below** their thresholds (`backlog <
  … AND lag < …`), the transport is reachable, and the mode/URL are configured. *Test:* with `bus`
  mode, a reachable conforming transport, and backlog **and** lag both **strictly below** threshold the
  readiness signal (REQ-F004-044) is ready; with the transport unconfigured/unreachable, or with backlog or
  lag **at-or-over** its threshold (a row count **equal to** `EVENT_BUS_BACKLOG_THRESHOLD`, or an age
  **equal to** `EVENT_BUS_LAG_THRESHOLD_MS`, is already not-ready), it is not-ready/degraded, while parent
  `GET /health` still returns `{ok:true}`; setting `EVENT_BUS_BACKLOG_THRESHOLD`/`EVENT_BUS_LAG_THRESHOLD_MS`
  to a low value flips `/ready` to not-ready at that lower bound. The metric set, thresholds' **shape**,
  and delivery-latency/throughput SLOs are RATIFIED (§9, REQ-F004-034; §8 REQ-F004-027); the concrete
  default threshold values above are provisional constants of record (tunable via the named keys).
- REQ-F004-044 — **Readiness signal — SEPARATE `/ready` probe served by the RELAY; startup
  misconfig HARD-REFUSES per-process (RECONCILED per REQ-F004-033/039; resolves review MJ1).** The
  readiness signal that REQ-F004-026 (and, at runtime, REQ-F004-045) depends on has no home in the
  parent's fixed liveness contract (parent REQ-024: `GET /health → {ok:true}`, a fixed payload with no
  readiness/degraded dimension). F-004 therefore does **NOT** modify REQ-024; it adds a **separate,
  server-side readiness signal** — RATIFIED per the 2026-07-07 ruling (REQ-F004-039) as a dedicated
  readiness probe endpoint **`GET /ready` served by the RELAY service** (no session, server-side only),
  leaving parent REQ-024 (`/health` on the BFF) untouched. `/ready` lives on the relay — **not** as a
  sibling of the BFF's `/health` — because the states it reports (transport reachability especially) are
  observable **only** to the process that holds the transport connection (REQ-F004-033); the BFF, which
  shares only the durable `event_outbox`, cannot observe transport reachability and so cannot serve this
  probe. `/ready` expresses observable **runtime** states: **ready** (HTTP 200; transport reachable,
  backlog/lag under threshold) and **not-ready/degraded** (HTTP 503 with a machine-readable `reason`,
  e.g. `transport-unreachable`, `bus mode without EVENT_BUS_URL`, `backlog-over-threshold`,
  `lag-over-threshold`, `store-unwritable` — the last covering a relay that cannot land its
  bookkeeping writes, e.g. a persistent inability to write `acked_at`/`published_at` per REQ-F004-011,
  resolves review N-b). **Startup reconciliation (per-process, REQ-F004-021/045):** the mode misconfig
  (`inproc`-in-production) is caught at **BFF** startup — the BFF **refuses to boot** (REQ-F004-021), so
  a production BFF is never up in a non-`bus` state; the URL misconfig (`bus` with no `EVENT_BUS_URL`) is
  caught at **relay** startup in production — the relay **refuses to boot** (REQ-F004-045), so it never
  serves `/ready` in that state — while in development the relay may boot and report `/ready` not-ready
  with that `reason`. Consumers/orchestrators use the relay's `/ready`, not `/health`, to gate the relay
  rollout. *Test:* the BFF's `GET /health` returns `{ok:true}` unchanged whenever the BFF is up
  (including when the relay is down); on a running relay `/ready` returns ready under a reachable
  transport + backlog under threshold, and not-ready with a specific runtime `reason` (unreachable
  transport, over-threshold backlog/lag); a production URL misconfig is instead a relay **refuse-to-boot**
  (REQ-F004-045), so the relay serves no `/ready` in that state though the BFF stays up and enqueuing.

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
**DECIDED (2026-07-07)** with the change described where the ruling diverged from the default. As of the
2026-07-07 rulings every item that **gates F-004** is resolved; **rev 7 (2026-07-19)** further resolves the
**delivery-transport choice** for GTM (REQ-F004-030 below — HTTP-to-known-peer, broker as a future
`EventTransport` adapter) and records a small set of **genuinely-open, non-gating post-GTM (broker-era)**
items under that same REQ. The governing REQ(s) — updated in rev 3 to match, and rev 7 for the transport
seam — are cited.

- REQ-F004-030 — **Target transport/broker (external dependency?).** What is "the real on-box bus"
  concretely — a specific broker product, a socket/wire protocol, a platform service? Does
  `EVENT_BUS_URL` point at something that already exists, or must it be provisioned (an ops/platform
  dependency, not a console-code build, REQ-F004-008)? **RATIFIED (2026-07-07):** build the relay + a
  thin transport-adapter interface against `EVENT_BUS_URL`; the concrete broker is **deferred to ops**
  (`06-risks.md` R1 keeps technology/protocol deferred).
  **RESOLVED (2026-07-19, rev 7):** for the **October 2026 GTM** the delivery transport is
  **HTTP-to-a-known-peer** — `HttpPeerTransport` POSTs each drained envelope to configured peer
  endpoint(s) (REQ-F004-050/051/052) — **NOT** a message broker. The "thin transport-adapter interface"
  ratified above is now concretely the **`EventTransport` seam** (REQ-F004-049): a future broker is a
  **drop-in `BrokerTransport`** (new class + one config branch, zero churn above the seam, REQ-F004-050),
  and the transport-agnostic drain/orchestration layer is written once and proven swap-ready by a fake
  second transport in tests (REQ-F004-049). **Swap trigger:** move to a broker when the **per-peer fan-out /
  retry bookkeeping inside `HttpPeerTransport`** (REQ-F004-051) becomes the operational pain point — i.e.
  as the **subscriber / peer count grows** (more subscribers to both applications' events, post-GTM).
  **Genuinely still open (post-GTM, non-gating — do NOT block the GTM HTTP transport):** (a) the
  **concrete broker product / wire protocol**; (b) whether any **specific future consumer** requires
  guarantees stronger than per-key-order + effectively-once (e.g. **exactly-once** or **strict global
  ordering**, REQ-F004-031); and (c) **broker-era re-tuning** of outbox retention (REQ-F004-035) and
  first-connection backfill horizon (REQ-F004-037) at broker-scale volume — the **GTM decisions for
  retention and backfill stand and are not reopened here**, only their broker-era re-evaluation is open.
  Governing: REQ-F004-008/022/043/049/050/051/052.
- REQ-F004-031 — **Delivery semantics: ordering / exactly-once.** At-least-once is the assumed floor
  (REQ-F004-011). Does any consumer require **exactly-once** or **strict ordering**? If ordering
  matters, is it **per-key** (e.g. per workspace/user id) or **global**? **DECIDED (2026-07-07):**
  **per-key ordering + effectively-once** — NOT at-least-once/no-order, and NOT exactly-once/global-order.
  An **ordering key** is derived from the event **name** + a named `AdminEventEnvelope.target` field,
  **total over all eight live catalog families** (`catalog.ts`, 21 event names; §3 definition, resolves
  review BR2/MJ2 + rev-7 Fix 1/2:
  `admin.workspace.*`→`ws:<target.id>`, `admin.user.*`→`user:<target.id>`,
  `admin.instance.*`/`admin.raw_env.*`→`instance`, `admin.workspace_user.*`→`ws:<target.workspace>`
  [ruling BR1/BR2, 2026-07-07], `admin.invite.*`→`invite:<target.id>`,
  `admin.baseline_prompt.*`→`baseline` [dedicated singleton, rev-7 Fix 1],
  `admin.feature_toggle.*`→`__unkeyed__` [intentional per F-005, rev-7 Fix 2], else `__unkeyed__`).
  **`__unkeyed__` rows are INDEPENDENT** — exempt from per-key head-of-line, so none blocks another
  (ruling BR1, 2026-07-07; §3, REQ-F004-041). Guarantee: **in-order delivery WITHIN a key**; **skip-ahead
  ALLOWED ACROSS keys** (and among all `__unkeyed__` rows); **effectively-once**
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
  (Rev-9, review N5: the readiness thresholds are exposed via named config keys
  `EVENT_BUS_BACKLOG_THRESHOLD` / `EVENT_BUS_LAG_THRESHOLD_MS` with provisional documented defaults —
  REQ-F004-026; and the parked-count metric is split into never-delivered vs partially-delivered park
  signals — REQ-F004-025.)
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
  `bus` with no `EVENT_BUS_URL`) MUST cause a **refuse to start** (fail fast, clear error), NOT
  warn-and-continue. **Reconciled with the separate-relay topology (REQ-F004-033) per ruling MJ1
  (2026-07-08), split by the process that reads each variable:** a non-`bus` `EVENT_BUS_MODE` makes the
  **BFF** refuse to start (the mode selects the BFF's emitter — otherwise it silently runs the interim
  in-proc bus, which marks rows **published without ever delivering** them so a later switch to `bus` mode
  never re-drains them: silent, permanent event loss — see REQ-F004-021, resolves review N1); `bus` with
  no `EVENT_BUS_URL` makes the **RELAY** refuse to start (only
  the relay delivers/reads the URL), while the BFF boots and keeps enqueuing (recoverable backlog, not
  lost events). The readiness-surface shape is **RATIFIED** as a **separate `GET /ready` probe served by
  the RELAY** (it holds the transport, so only it can report transport reachability), leaving parent
  REQ-024's `{ok:true}` liveness on the BFF untouched; `/ready` reports relay health at **runtime**,
  while the **startup** misconfig posture is per-process hard-refuse. Governing: REQ-F004-021/033/044/045.
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
| Transport seam: transport-agnostic drain + narrow `EventTransport` interface (broker-swap-ready; fake-transport test) | §4.4 REQ-F004-049 |
| GTM transport = HTTP-to-known-peer; broker a future drop-in adapter (zero-churn boundary) | §4.4 REQ-F004-050 + §9 REQ-F004-030 |
| Multi-peer fan-out ack; `published_at` keeps its meaning; outbox schema invariant across swap | §4.4 REQ-F004-051 |
| HTTP response → permanent/transient classification (webhook convention); fan-out composition | §4.4 REQ-F004-055 + §6.2 REQ-F004-047 + §5 REQ-F004-043(c) |
| Config surface: `EVENT_BUS_URL` comma-delimited peer list + separate `EVENT_BUS_TRANSPORT` {http,broker} selector | §6.6 REQ-F004-052 |
| Ordering: `admin.baseline_prompt.*` → dedicated `baseline` singleton key; `admin.feature_toggle.*` → intentional `__unkeyed__` | §3 def; §9 REQ-F004-031; §6.6 REQ-F004-029 |
| Catalog count corrected to 21 event names / 8 families | §1.2 REQ-F004-002; §3 def |
| Consumer contract broker-swap-invariant (dedupe + reorder-tolerance baked in now) | §5 REQ-F004-053 |
| Relay is a per-app pattern (each app drains its own outbox; twin out of scope) | §6.4 REQ-F004-054 |
| Ruling: delivery-transport RESOLVED — HTTP-to-known-peer for GTM, broker future adapter; swap trigger | §9 REQ-F004-030 (rev 7) |
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

### §10.1 Spec-review resolution (rev 2 — `docs/spec-reviews/spec-review-F004.md`)

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
| N1 event count | rev 2: "~17" → 18; **rev 8 correction: 21 names / 8 families** (matches `catalog.ts`) | §1.2 REQ-F004-002 |

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
**parked** poison row stalls only its own key while other keys keep flowing (REQ-F004-014 test); a
**`__unkeyed__`** row is independent and blocks nothing (ruling BR1, REQ-F004-041 exemption); and the
production boot posture is **per-process** (ruling MJ1): the **BFF refuses to boot** on a non-`bus`
`EVENT_BUS_MODE` (mode selects its emitter) while the **RELAY refuses to boot** on a missing
`EVENT_BUS_URL` (only it delivers) and serves the `/ready` probe (REQ-F004-021/044/045 tests). The three genuinely non-default rulings were applied and
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

Rev 5 (resolves spec-review `docs/spec-reviews/spec-review-F004-rev4.md`, 2026-07-08) closes the one regression the
rev-4 MN2 fix introduced plus one gap, and folds in the notes. **B1 (blocking regression):** a persistent
post-ack `markPublished` failure is no longer **parked** (which kept `published_at IS NULL` and so, under
per-key head-of-line, permanently wedged the key — contradicting the very goal MN2 raised). Because the
effect was already acked/delivered, exhausting the cap now **force-marks the row published**
(REQ-F004-011), which both stops the re-delivery loop **and** genuinely lets the key resume (a published
row is not eligible, REQ-F004-041/042); parking is now reserved exclusively for **never-acked poison
rows**, which also closes N2's `parked_at` conflation. **MJ-A (major gap):** `ordering_key` is now
required non-null for **every** row — the migration **backfills it for all pre-existing rows** (the
pre-F-004 backlog REQ-F004-015 replays) from each stored envelope, and enqueue populates it at INSERT;
"lazily on first drain" (circular) is removed, and eligibility defensively treats any NULL key as
`__unkeyed__` (REQ-F004-029/015/041).

Rev 6 (resolves spec-review `docs/spec-reviews/spec-review-F004-rev5.md`, 2026-07-08) closes the deeper contradiction
the rev-5 B1 fix left open. **B1-new (blocking):** routing the post-ack cap on the *type of the final
failing attempt* (never-acked→park, ever-acked→force-publish) was undecidable from persisted state — both
cases leave `published_at IS NULL` and share one `attempt_count` — so a **mixed-history** row (acked, mark
failed, later a pre-ack failure trips the cap) could be **parked despite having been delivered**,
re-opening N2. Fix: REQ-F004-029 adds a durable **`acked_at`** marker (set best-effort on every ack), and
REQ-F004-011 routes the cap decision **solely on `acked_at`** — `acked_at` set → force-mark published
(never parked, even for mixed histories); `acked_at` NULL → park — so `parked_at` now unambiguously means
never-delivered poison, and REQ-F004-014 is scoped to never-acked rows. **MJ-B:** the "repeated crash in
the post-ack window" is reframed as a **dedupe + supervision** concern (it persists no state, so the
attempt cap neither can nor needs to bound it); the cap now bounds only persistent, process-alive post-ack
write failures. Notes: `store-unwritable` added to the `/ready` reason codes for a relay that cannot land
`acked_at`/`published_at` (N-b, REQ-F004-044); `attempt_count` explicitly does **not** reset on ack (N-c).

Rev 5 (resolves spec-review `docs/spec-reviews/spec-review-F004-rev4.md`, 2026-07-08) — superseded in part by rev 6
above for the post-ack mechanism. Notes: the boot-refuse rationale is corrected to the real hazard —
the in-proc bus marks rows **published without delivering**, so a later switch to `bus` never re-drains
them: silent loss (N1, REQ-F004-021/039); two-writer `SQLITE_BUSY` contention gets a `busy_timeout` +
retry posture, with transient busy on post-ack `markPublished` explicitly not counting toward the cap
(N3, REQ-F004-020); the REQ-F004-017 single-delivery test is scoped to the held-lease/single-instance
nominal path, distinct from the tolerated crash-overlap window (N4); and a prefix-matching event missing
its target id field falls back to `__unkeyed__` rather than a literal `ws:undefined` (N5, §3). No REQ ids
were renumbered or deleted.

Rev 7 (folds in the resolved delivery-transport decision, 2026-07-19) resolves the last open axis of
REQ-F004-030: the GTM delivery transport is **HTTP-to-a-known-peer** (`HttpPeerTransport` POSTing each
drained envelope to configured peers), **not** a message broker, and a real broker is a **post-GTM,
drop-in `EventTransport` adapter**. The core swap-ability guarantee is now pinned by a **two-layer
transport seam** (new §4.4, REQ-F004-049): a transport-agnostic drain/orchestration layer written once
(polling, per-key ordering, retry/backoff, mark-published, park, metrics) behind a **narrow
`EventTransport` interface** selected the way `getEventBus` already switches on `EVENT_BUS_MODE`, so a
future `BrokerTransport` is a new class + one config branch with **zero churn** to producers, the emitter,
the envelope, the outbox write, routes, or services (REQ-F004-050). Fan-out ack semantics
(REQ-F004-051 — publish only after **every** peer accepts; partial failure re-drives only un-acked peers;
`published_at` keeps its single meaning and the outbox schema is unchanged when the transport is later
swapped), peer-endpoint config (REQ-F004-052, extending the `EVENT_BUS_URL` convention), the
broker-swap-invariant consumer contract (REQ-F004-053 — dedupe + reorder-tolerance baked in now), and the
per-app relay instantiation note (REQ-F004-054; the customer-web-app twin is out of scope, tracked by its
own F-004) are added. Swap-ability is locked by tests: a **fake/second `EventTransport`** exercises the
broker swap in miniature (REQ-F004-049), plus crash/restart backfill (REQ-F004-011/015), poison-event
parking (REQ-F004-014), **multi-peer fan-out ack** (REQ-F004-051), and **idempotency + reorder tolerance**
(REQ-F004-053). Genuinely-open, non-gating post-GTM items (concrete broker choice; any future consumer's
exactly-once/global-ordering need; broker-era re-tuning of retention/backfill) are recorded under
REQ-F004-030 without reopening the ratified GTM decisions. New ids REQ-F004-049..054 were **appended**;
no existing REQ id or § was renumbered or deleted (REQ-F004-022/030 were edited in place with rev-7
cross-references).

Rev 8 (resolves the rev-7 adversarial-review BLOCK — 4 blocking findings, two human-ruled, 2026-07-19)
edits existing REQs in place; **no id or § renumbered, none added**:
- **Fix 1 — baseline ordering (human ruling).** `admin.baseline_prompt.*` (emitted with
  `target: { baseline: 'singleton' }`, `baseline.service.ts`) previously fell to `__unkeyed__`, leaving the
  causal pair `updated → applied` unordered. It now gets a **dedicated `baseline` singleton ordering key**
  — deliberately **distinct** from the `instance` key used by `admin.raw_env.*`, so baseline writes stay
  mutually ordered without being false-serialized against raw-env config writes. Applied to the §3
  derivation table, REQ-F004-029's derivation test, and §9 REQ-F004-031.
- **Fix 2 — catalog count corrected.** The real `bff/src/events/catalog.ts` has **21 event names across 8
  families** (the six core families + `admin.baseline_prompt.*` + `admin.feature_toggle.*`). Corrected the
  stale "18 event names / six families" everywhere (REQ-F004-002, §3, REQ-F004-029 test, §9 REQ-F004-031),
  and added both extra families to the §3 table: `admin.baseline_prompt.*`→`baseline` (Fix 1) and
  `admin.feature_toggle.*`→`__unkeyed__` (**intentional** per F-005's own `catalog.ts:69-70` note /
  REQ-F005-052, `target: { featureKey }`, no cross-event ordering requirement).
- **Fix 3 — stateful fan-out re-drive (human ruling).** REQ-F004-051 now specifies `HttpPeerTransport` is
  **stateful across orchestration-driven re-drives**: (a) partial failure rejects and leaves the row
  `published_at IS NULL` so the backoff re-invokes `deliver()` with the same `deliveryId`; (b) the
  transport keeps an **in-memory per-`deliveryId` ack map** and re-POSTs **only un-acked peers**; (c) the
  entry is **evicted** when the row is fully acked (published) or parked/dead-lettered, bounding memory.
- **Fix 4 — config shapes pinned.** REQ-F004-052 now pins **`EVENT_BUS_URL` as a comma-delimited list**
  (comma delimiter, whitespace trimmed, empty entries dropped — mirroring `WEB_ORIGINS`) giving the N-peer
  fan-out a deterministic source, and adds a **separate** selector **`EVENT_BUS_TRANSPORT` ∈ {http,broker},
  default `http`, evaluated only when `EVENT_BUS_MODE=bus`** — the single config branch the future
  `BrokerTransport` swaps behind (REQ-F004-049/050), on an axis **orthogonal** to `EVENT_BUS_MODE`
  (transport ≠ mode). REQ-F004-049/050 cross-references updated to name the selector.
The catalog-count assertion (REQ-F004-002: 21 names / 8 families) and the baseline-ordering assertion
(REQ-F004-029/031: `admin.baseline_prompt.*`→`baseline`) now match the grounded `catalog.ts` and
`baseline.service.ts`, so both tests pass against the real catalog.

Rev 9 (resolves a fresh standalone adversarial BLOCK — 3 blocking findings + 6 notes, 2026-07-19) edits
existing REQs in place; **no id or § renumbered, none added**. The blocking findings were internal-
consistency fixes (no product ruling required); all were applied verbatim to the reviewer's recommended
resolution:
- **Blocking 1 — shutdown model contradicted the parallel-delivery model (REQ-F004-020 vs REQ-F004-017/027).**
  REQ-F004-020's graceful drain was written for a **single** in-flight delivery, but the relay runs **N
  concurrent** deliveries across distinct keys (REQ-F004-027) to meet the ≥50 ev/s SLO. REQ-F004-020 now
  drains the **SET** of in-flight deliveries: on shutdown, stop selecting, then await **every** in-flight
  delivery up to one shared bounded timeout, marking each that acks and abandoning (leaving `published_at`
  NULL) any that do not — per-row independent outcomes; the test now seeds **multiple** concurrent
  in-flight deliveries.
- **Blocking 2 — fan-out permanent-peer rejection timing (REQ-F004-051 vs REQ-F004-047/014).** REQ-F004-051
  said a permanent peer rejection parks "after the bound" (the transient path). Corrected: a **permanent**
  rejection from **any not-yet-acked peer** makes `deliver()` reject as permanent and the row is **parked
  immediately** (no backoff retries, REQ-F004-047/014); "after the bound" is reserved for **transient**
  peer failures only. New test added.
- **Blocking 3 — `EVENT_BUS_TRANSPORT=broker` had no defined GTM behavior (REQ-F004-052).** `broker` stays
  a documented value of the closed set but has no implementation in this build, so the GTM relay now
  **hard-refuses to boot** with "broker transport not available in this build" (mirroring REQ-F004-045).
  The "selects `BrokerTransport`" test is explicitly marked **post-GTM / broker-era** and does **not** gate
  this deliverable.
- **Notes folded in:** N1 (REQ-F004-013 — a persistent post-ack mark failure advances `next_attempt_at`
  under the same backoff schedule); N2 (REQ-F004-013 — cap edge is **inclusive at the Nth failure**, stated
  with the constant); N3 (REQ-F004-014/025/051 — a **partially-delivered park** is a distinct metric signal
  from a never-delivered park; `parked_at` = never-**fully**-acked); N4 (REQ-F004-029 — a
  malformed/unparseable stored envelope backfills to `__unkeyed__`, never NULL, migration never aborts);
  N5 (REQ-F004-026 — named `/ready` threshold config keys `EVENT_BUS_BACKLOG_THRESHOLD` /
  `EVENT_BUS_LAG_THRESHOLD_MS` with provisional documented defaults 1000 rows / 30000 ms); N6 (§3 — prefix
  match MUST include the trailing `.` separator so `admin.workspace_user.*` is not misparsed as
  `admin.workspace.*` and stripped of membership ordering). No note required a human product ruling.
Consistency check: the shutdown-set model (REQ-F004-020) now agrees with the parallel-delivery SLO
(REQ-F004-027) and concurrent-drain-tick assumption (REQ-F004-017); the fan-out permanent-park path
(REQ-F004-051) now agrees with the immediate-park rule (REQ-F004-047/014); and `broker` refuse-to-boot
(REQ-F004-052) agrees with the closed-set hard-refuse posture (REQ-F004-045/046). `acked_at`-routed cap
(REQ-F004-011) is unchanged and remains consistent with the clarified `parked_at` = never-**fully**-acked
wording (REQ-F004-014/025).

Rev 10 (round-2 re-review returned PASS WITH NOTES — no blocking findings; this is a **clarity/edge-only**
pass, 2026-07-19). **No requirement's MUST semantics changed and nothing was renumbered** — every edit is
terminology, an edge-comparison pin, or a citation fix. Touched REQ ids: REQ-F004-052, REQ-F004-025,
REQ-F004-020, REQ-F004-026, REQ-F004-051.
1. **REQ-F004-052(3) — `broker` refuses to boot in ALL environments (human ruling).** Pinned the dev
   posture: `EVENT_BUS_TRANSPORT=broker` (and any out-of-set value) hard-refuses in **both dev and
   production** — deliberately **not** the env-split boots-soft-in-dev posture of REQ-F004-045. Rationale
   recorded: a missing URL is recoverable (the transport exists and can start delivering once configured),
   but there is **structurally no `BrokerTransport` to instantiate** in this build, so a dev "boot but
   never ready" state is pointless. GTM test updated to assert refuse-in-all-environments (dev-soft arm
   dropped for the broker case).
2. **REQ-F004-025 test — term overload fixed.** "permanently failing … after max attempts" reworded to
   "**repeatedly transiently-failing** … after max transient attempts", so the never-delivered-park test
   no longer collides with the load-bearing **permanent** classification (which means park-immediately,
   REQ-F004-043(c)/051(d)).
3. **REQ-F004-020 — abandon-at-shutdown does not advance `attempt_count`.** Added: an in-flight delivery
   abandoned at the shutdown bounded timeout is neither an ack nor a failure, so it leaves the row's retry
   bookkeeping (`attempt_count`/`next_attempt_at`/`last_error`) unchanged — a restart-during-delivery does
   **not** erode the REQ-F004-013/014 retry budget. Test updated.
4. **REQ-F004-026 — `/ready` boundary edge pinned.** Comparison made explicit and deterministic:
   **`backlog ≥ EVENT_BUS_BACKLOG_THRESHOLD` OR `lag ≥ EVENT_BUS_LAG_THRESHOLD_MS` ⇒ not-ready** (at-or-over
   is degraded); ready requires **both strictly below**. Removed the ambiguous "over"/exclusive wording;
   test asserts the equal-to boundary is already not-ready.
5. **Cross-reference fix.** The permanent-signal citations `REQ-F004-047c` (which has no lettered
   sub-parts) were corrected to **REQ-F004-043(c)** — where the permanent-vs-transient transport signal is
   defined — in REQ-F004-051(d), the REQ-F004-051 permanent-park test, and the REQ-F004-025 test (plain
   REQ-F004-047 retained where the reference is to the *classification* step).
6. **`/ready` defaults — kept provisional (human ruling).** `EVENT_BUS_BACKLOG_THRESHOLD=1000` /
   `EVENT_BUS_LAG_THRESHOLD_MS=30000` remain **documented provisional constants of record, operator-tunable**
   (REQ-F004-026); the human accepted them as provisional — no value change.
Consistency confirmed: the broker all-env refuse-to-boot (REQ-F004-052) is intentionally distinct from —
and does not contradict — REQ-F004-045's URL env-split (different failure class: unrecoverable-missing-code
vs recoverable-missing-config); the corrected `REQ-F004-043(c)` citations point at the actual definition of
the permanent signal (REQ-F004-043); and the abandon-does-not-advance-`attempt_count` clause is consistent
with REQ-F004-011's `acked_at`-routed cap and REQ-F004-020's at-least-once + dedupe restart safety. No MUST
was added, removed, or weakened in rev 10.

Rev 11 (pins a previously-unspecified classification the qa-engineer flagged; human ruled the standard
webhook convention, 2026-07-19). **Adds ONE new requirement, REQ-F004-055; no existing REQ renumbered and
no existing MUST changed** — this only fills a genuine gap (the concrete HTTP-response → permanent/transient
mapping inside `HttpPeerTransport` was unpinned). REQ-F004-055 (§4.4, in the `HttpPeerTransport` area) pins,
as a **transport-specific wire concern kept OUT of the drainer per the REQ-F004-049 seam** and surfaced via
the REQ-F004-043(c) permanent-vs-transient signal: **2xx → ack**; **transient** = network/connection-level
failures (connection refused, timeout, DNS failure, socket reset) + **all 5xx** + **408** + **429**
(→ retry with backoff up to the max-attempt bound, then park, REQ-F004-013/014); **permanent** = all other
4xx (400/401/403/404/422), any 3xx, and any other unexpected non-2xx (→ immediate park, REQ-F004-047/051(d)).
The mapping is **total** (every outcome classified). **Fan-out composition** is cross-referenced both ways
with REQ-F004-051: a permanent response from any not-yet-acked peer ⇒ whole `deliver()` rejects permanent
(immediate park, REQ-F004-051(d)); no permanent but ≥1 transient ⇒ `deliver()` rejects transient and
re-drives only the un-acked peers (REQ-F004-051(a)/(b)); ack only when every peer is 2xx. REQ-F004-047's
rev-2 provisional "treat-all-as-transient when the transport gives no explicit signal" default is noted as
**superseded for the GTM HTTP transport** by this explicit total classification (and still governs any
signal-less transport). Cross-refs touched: §4.4 REQ-F004-051 (bullets (a)/(d) now cite REQ-F004-055),
§6.2 REQ-F004-047 (notes the HTTP supersession), §10 traceability table (new row). Seam preserved: HTTP
status-code constants live only in `HttpPeerTransport`, never in the drain/orchestration module
(REQ-F004-049), asserted by a static-check test. No MUST was added to, removed from, or weakened in any
existing requirement in rev 11.
