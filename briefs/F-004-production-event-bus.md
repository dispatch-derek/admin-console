# F-004: Production-Ready Event Bus (Replace the In-Process Bus)

*Build out durable, at-least-once event delivery to a real on-box bus, retiring the interim in-process EventEmitter as the delivery mechanism.*

## Problem
The console emits `admin.*` domain events after every verified mutation (§14, REQ-029), but the delivery mechanism shipped today is interim. `EVENT_BUS_MODE` defaults to `inproc` (`bff/src/events/bus.ts` `InProcessBus`), which publishes over a Node `EventEmitter` — in-process only, no cross-process subscribers, no delivery guarantee beyond the current process, and the emitted events currently have no real consumers. The durable path exists only as a transactional outbox (`event_outbox` table, `outbox.repo.ts`) plus a **stub** `OutboxRelayBus` that enqueues rows but never drains them: its own comment says the background relay to "the real on-box bus" is "a later slice," and that slice was never built. So there is durability of the *record* but no production *delivery*: no relay worker, no connection to a real bus, no retry/backoff, no ordering or dead-letter handling, no delivery observability. Any downstream system that needs these events (audit pipelines, notifications, cross-service reactions) cannot reliably receive them. The in-proc bus is explicitly a development/interim mechanism standing in for production infrastructure.

*(Note: evidence is the structural state of the code — an interim `inproc` default, a stubbed relay, an unfinished "later slice" — plus conviction that production deployment needs real delivery. No operational incident/analytics signal was gathered; no discovery scan was run. Honest thinness, not a hidden gap.)*

## Affected Users
Not end-users and not the console's staff operators directly — this is infrastructure beneath them. The direct consumers are **downstream/backend systems** that subscribe to `admin.*` events (audit/compliance pipelines, alerting, and any cross-service automation reacting to workspace/user/settings changes), and the **operations/engineering** staff who run and rely on the console in production. The reach is "every domain event the console emits" — the mutation event stream is a core cross-cutting spine (design `04-cross-cutting.md` §c), so the capability underpins all event-driven behavior rather than one screen.

## Business Rationale
Stated as falsifiable claims:
- **Production-readiness / correctness of the event contract:** the console advertises a durable `admin.*` event spine (REQ-029/029d), but in `inproc` mode that contract is not actually fulfilled to any external subscriber. Shipping to production on the interim bus means the advertised guarantee is unmet. Falsifiable by attempting to consume events from a second process/service today (cannot) versus after F-004 (can, at-least-once).
- **Auditability / compliance:** if audit or compliance depends on reliably receiving mutation events, at-least-once delivery with retry is a prerequisite, not a nicety. Falsifiable by testing event loss across a crash/restart between emit and delivery.
- **Operational cost avoidance:** the longer the console runs in production on the in-proc stand-in, the more event-driven consumers get built against a delivery mechanism that must later be swapped underneath them. Falsifiable by counting consumers coupled to the interim path over time.

## Timing
Tied to the **October 2026 go-to-market** (~3 months out from 2026-07-07) as a production-readiness gate: the in-proc bus is acceptable for development but is an interim mechanism not intended for the production deployment the GTM implies. The design already anticipated this (`docs/design/04-cross-cutting.md`, `06-risks.md`) — the outbox + relay pattern was chosen specifically so events "back-fill once the bus appears," deferring the real delivery to a later slice that F-004 now represents.

## Existing Evidence
Pointers only — leads to re-verify at scoring time, not established fact:
- **Interim bus + stubbed relay (internal):** `bff/src/events/bus.ts` — `InProcessBus` (default, EventEmitter) and `OutboxRelayBus` (enqueue-only stub; comment: "A background outbox relay (a later slice) drains rows with published_at IS NULL to the real on-box bus"). Selected by `config.eventBusMode` (`bff/src/config.ts` — `EVENT_BUS_MODE` default `inproc`, `EVENT_BUS_URL`).
- **Durable outbox already present (internal):** `bff/src/store/repositories/outbox.repo.ts` (`event_outbox` table; `insert`/`markPublished`/`listUnpublished`) — the transactional outbox is built; only the relay/drain worker and the real-bus transport are missing. `event_outbox` row written in the same DB txn as the verify result.
- **Event contract / catalog (internal):** `bff/src/events/emitter.ts` (`emitAdminEvent` → `getEventBus().publish()`), `bff/src/events/catalog.ts` (`AdminEventEnvelope`, `admin.*` event set). REQ-029/029c/029d/029f and §14 in `specs/admin-console.md`; the on-box bus design in `docs/design/04-cross-cutting.md` §c and risk notes in `06-risks.md`.
- **Design intent (internal):** the two-mode `EventBus` abstraction and outbox-relay pattern were a deliberate design choice to make this swap non-disruptive — the interface (`EventBus.publish`) is already the seam F-004 builds behind.
- **Not gathered:** no production incident, delivery-failure, or consumer-demand signal — no discovery scan was run for this brief.

## Proposed Direction
*(Non-binding sketch.)* Build the production delivery path behind the existing `EventBus` seam: a background **outbox relay** that drains `event_outbox` rows where `published_at IS NULL`, delivers them to a real on-box/durable bus (transport TBD — e.g. a broker reachable at `EVENT_BUS_URL`), marks them published on success, and retries with backoff on failure so events back-fill after an outage. This makes `bus` mode (`OutboxRelayBus` + relay) the production configuration and demotes `inproc` to development-only. Scope includes the delivery guarantee (at-least-once), retry/backoff and failure isolation (a poisoned event must not block the queue — dead-letter or park), ordering guarantees (if required), idempotency guidance for consumers (at-least-once implies possible duplicates), and delivery observability (relay lag, unpublished-row count, failure counts). The concrete broker/transport, whether ordering is required, and the deployment topology of the relay (in-process worker vs separate process) are left open for design.

## Out of Scope
- The **event contract itself** — the `admin.*` catalog, envelope shape, cardinality (REQ-029 "one or more"), and redaction (REQ-029c) are defined and built; F-004 changes *delivery*, not *what is emitted*.
- The **transactional outbox write** (`event_outbox` insert in the verify txn) — already implemented; F-004 consumes it, it does not rebuild it.
- Any change to the web app — `web/` cannot and does not read the on-box bus (REQ-029d); it reads mutation results over HTTP. No F-004 change touches the frontend.
- Building downstream **consumers** (audit pipeline, alerting) — F-004 delivers events reliably; what subscribes to them is separate work.
- Choosing/standing up the physical broker infrastructure if that is an ops/platform decision rather than a console code change (flag at scoring: may be a dependency, not in-scope build).

## Open Questions
- **Target transport/broker:** what is "the real on-box bus" concretely (a specific broker, a socket protocol, a platform service)? Is `EVENT_BUS_URL` pointing at something that already exists, or must it be provisioned (a dependency outside this feature)?
- **Delivery semantics:** at-least-once is the assumed floor — is exactly-once or strict ordering required by any consumer? If ordering matters, per-key or global?
- **Failure handling:** dead-letter queue vs park-and-alert for poison events; retry/backoff policy; max attempts before parking.
- **Relay topology & lifecycle:** in-process background worker within the BFF, or a separate process/service? How is it supervised, and what happens on BFF restart mid-drain?
- **Observability & SLO:** what relay-lag / unpublished-backlog / failure metrics are needed, and is there a delivery-latency target?
- **Outbox retention:** once `published_at` is set, are rows pruned, archived, or retained for replay/audit?
- **Consumer readiness:** are there real subscribers waiting for this now, or is F-004 platform-enabling ahead of demand (affects urgency framing at scoring)?
- **Backfill semantics:** on first connection of a new bus, how far back do accumulated unpublished rows replay, and is that always desired?
