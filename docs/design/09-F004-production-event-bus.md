# F-004 Production-Ready Event Bus (Outbox Relay) — Design

Spec: `specs/F-004-production-event-bus.md` (Draft rev 10 — final, review-gated; every
`REQ-F004-###` is binding). Parent conventions: `specs/admin-console.md` v1 rev 7;
`docs/design/00-overview.md`, `01-bff-architecture.md`, `03-data-models.md`,
`04-cross-cutting.md` (§c), `06-risks.md` (R1). Grounding read at design time:
`bff/src/events/{bus,emitter,catalog}.ts`, `bff/src/store/repositories/outbox.repo.ts`,
`bff/src/store/db.ts`, `bff/src/config.ts`, `bff/src/index.ts`.

F-004 builds the **delivery** path only. It does **not** touch producers, `emitAdminEvent`,
the `AdminEventEnvelope`, the transactional outbox WRITE, or any route/service
(REQ-F004-004/005/006/022). This doc extends `04-cross-cutting.md` §c (which promised
"a relay drains the outbox … a later slice") and resolves `06-risks.md` R1's deferred
delivery mechanism into a concrete GTM design; it cross-references those rather than
restating them.

## Scale & simplicity tradeoffs (deliberately chosen)

- **One box, one customer, one SQLite file** (parent `00-overview.md`). The GTM transport
  is **HTTP POST to N known peers** (`HttpPeerTransport`), not a broker — no Kafka/NATS is
  stood up by F-004 (REQ-F004-050; `06-risks.md` R1). A broker is a future drop-in.
- **Single-instance relay, not a lease.** REQ-F004-017 permits either a single-instance
  deployment constraint **or** a DB lease; the RATIFIED default (REQ-F004-033) is the
  single-instance constraint, and there is **no native SQLite advisory lock** anyway
  (REQ-F004-020). GTM ships the single-instance form; the lease row is left as a documented
  future option (see §9, §10). This keeps the drainer a plain loop, not a distributed lock
  manager.
- **Park-in-place, no separate DLQ store** — a `parked_at` marker on the outbox row
  (REQ-F004-014/032). No sidecar table.
- **Bookkeeping is columns on `event_outbox`, not a sidecar** (REQ-F004-038).
- The two-layer transport seam (§1) is the **one** structural abstraction F-004 adds, and it
  is justified directly by REQ-F004-049 (prove broker-swap-ability now via a fake transport).
  Nothing deeper (no plugin registry, no generic pipeline framework) is introduced.

---

## 1. Module decomposition

The relay is a **separate, supervised process** (REQ-F004-020/033), packaged under a new
`bff/src/relay/` tree, sharing only the SQLite `event_outbox` file and the transport URL with
the BFF. It is built as **two layers with a hard boundary** (REQ-F004-049): a
transport-agnostic drain/orchestration layer that imports **only** the `EventTransport`
interface, and a transport implementation (`HttpPeerTransport`) that owns everything on the
wire. A static check MUST confirm the orchestration module imports no HTTP client, no peer
list, and not `HttpPeerTransport` (REQ-F004-049 no-leak test).

### 1.1 New / edited files

| File | Responsibility (one sentence) | Implements |
|---|---|---|
| `bff/src/relay/index.ts` (new) | Relay process entrypoint: validate relay config (hard-refuse per §5), open the shared store, construct the transport via the `EVENT_BUS_TRANSPORT` branch, start the drain loop + `/ready` server, install graceful-shutdown handlers. | REQ-F004-020/021/044/045/052 |
| `bff/src/relay/drainer.ts` (new) | **Transport-agnostic** orchestration: poll eligible rows, dispatch deliveries across keys with bounded concurrency, apply per-key head-of-line, drive retry/backoff, mark-published / `acked_at`, park, and feed metrics — all through the `EventTransport` interface only. | REQ-F004-010/011/012/013/014/016/041/042/047/049 |
| `bff/src/relay/transport.ts` (new) | The `EventTransport` interface + the `EVENT_BUS_TRANSPORT` factory (`http` → `HttpPeerTransport`; `broker` → hard-refuse in this build). | REQ-F004-049/050/052 |
| `bff/src/relay/http-peer-transport.ts` (new) | `HttpPeerTransport`: owns the peer list, POSTs each envelope to every peer, holds the per-`deliveryId` in-memory ack map, re-POSTs only un-acked peers, classifies permanent-vs-transient, resolves only on full fan-out. | REQ-F004-050/051/043/047 |
| `bff/src/relay/delivery-id.ts` (new) | Compose the stable delivery id `"<outbox-epoch>:<row-id>"` from the row id + the stored epoch. | REQ-F004-018/048 |
| `bff/src/relay/backoff.ts` (new) | The capped-exponential backoff schedule + `MAX_ATTEMPTS` constant of record (inclusive-at-N park). | REQ-F004-013/032 |
| `bff/src/relay/metrics.ts` (new) | In-process counters/gauges: relay lag, backlog, delivery/failure/attempt counts, never-delivered park, partially-delivered park, post-ack-cap; consumed by `/ready`. | REQ-F004-023/024/025/026 |
| `bff/src/relay/ready.ts` (new) | The relay-only `GET /ready` HTTP probe (200 ready / 503 `{reason}`). | REQ-F004-026/044 |
| `bff/src/events/ordering-key.ts` (new) | Pure, **total** `deriveOrderingKey(envelope)` implementing the §3 derivation table; shared by the enqueue path and the migration backfill. | REQ-F004-016/029/031 |
| `bff/src/store/repositories/outbox.repo.ts` (edit) | Add `selectEligible(now, limit)`, `markAcked(id, iso)`, `recordFailure(id, nextAttemptAt, err)`, `park(id, iso)`, `forcePublish(id, iso)`, `pruneShipped(before)`, lag/backlog reads, and read the epoch; **keep** `listUnpublished` for tests only (NOT the drain source). | REQ-F004-019/023/024/029/041 |
| `bff/src/events/bus.ts` (edit) | `OutboxRelayBus.publish` computes `ordering_key` via `deriveOrderingKey` and passes it to `insert` (INSERT path only; still no delivery). | REQ-F004-029 |
| `bff/src/store/db.ts` (edit) | Add the F-004 columns + indexes + `outbox_meta` epoch row to `migrate()` and the additive-ALTER list; backfill `ordering_key`; add a `busy_timeout` pragma. | REQ-F004-020/029/038/048 |
| `bff/src/config.ts` (edit) *(or a relay-scoped config, see §5 / open questions)* | Parse `EVENT_BUS_URL` as a trimmed comma list, add `EVENT_BUS_TRANSPORT`, `EVENT_BUS_BACKLOG_THRESHOLD`, `EVENT_BUS_LAG_THRESHOLD_MS`, and the production hard-refuse checks. | REQ-F004-021/026/045/046/052 |

**Migration authoring is a separate agent's job.** This doc specifies the **target** schema
(§3); the `store/db.ts` edit above is the shape that agent implements.

### 1.2 The seam boundary (REQ-F004-049 — the swap-ability guarantee)

```
                 event_outbox (SQLite, shared with BFF, WAL)
                        │  selectEligible / markPublished / park / acked
                        ▼
  ┌───────────────────────────────────────────────┐
  │  drainer.ts  (transport-AGNOSTIC, written once)│  polling, per-key order + head-of-line,
  │                                                │  retry/backoff, park, mark/acked, metrics
  └───────────────────────────────────────────────┘
                        │  EventTransport.deliver(envelope, deliveryId)  ← the ONLY seam
                        ▼
  ┌───────────────────────────────────────────────┐
  │  EventTransport (interface)                    │
  │   ├─ HttpPeerTransport  (GTM, this build)      │  peer list, POST, fan-out ack map, 2xx/perm map
  │   └─ BrokerTransport    (future, one branch)   │  ← added as a new class + EVENT_BUS_TRANSPORT=broker
  └───────────────────────────────────────────────┘
```

The drainer never sees a URL, an HTTP status, or a peer count. Swapping to a broker later is
one new class plus one `EVENT_BUS_TRANSPORT` branch — mirroring how `getEventBus` already
switches on `EVENT_BUS_MODE` (`bus.ts:38-43`), on an orthogonal axis (REQ-F004-049/050/052).
The swap is exercised **now** by substituting a fake in-memory `EventTransport` in the drain
suite (REQ-F004-049 test).

---

## 2. Interface contracts

### 2.1 `EventTransport` (the seam) — REQ-F004-049/043/047

```ts
export interface EventTransport {
  // Resolves on FULL positive ack (gates markPublished, REQ-F004-012).
  // Rejects with a classified error carrying transient-vs-permanent (REQ-F004-047).
  deliver(envelope: string /* opaque JSON bytes */, deliveryId: string): Promise<void>;
  // Called by the orchestration layer on a TERMINAL row outcome (published OR parked) so
  // the transport can evict per-deliveryId state (REQ-F004-051(c)). No-op for stateless transports.
  release?(deliveryId: string): void;
}

export class TransportError extends Error {
  readonly classification: 'transient' | 'permanent'; // REQ-F004-047
}
```

- `envelope` is the persisted `event_outbox.envelope` string delivered **byte-for-byte**; the
  transport MUST NOT reshape, re-redact, or drop fields (REQ-F004-002/028).
- Conforming transport (REQ-F004-043): (a) ack distinguishable from error/timeout/nack;
  (b) carries `deliveryId` as message metadata to the consumer (NOT in the envelope,
  REQ-F004-004); (c) permanent-vs-transient signal. **Default when the signal is absent:
  treat as transient** until `MAX_ATTEMPTS` (REQ-F004-047 fail-safe-toward-retry).

### 2.2 `HttpPeerTransport` — stateful fan-out (REQ-F004-051)

- Owns the peer list parsed from `EVENT_BUS_URL` (§5). `deliver` POSTs the envelope to every
  peer; the delivery id is carried as a message-metadata header (e.g. `X-Event-Delivery-Id`).
- **Ack map:** `Map<deliveryId, Set<peerAcked>>`, in memory, transport-internal, invisible to
  the drainer and to the schema (REQ-F004-051(b)). On a re-driven `deliver()` for the same
  `deliveryId`, only **not-yet-acked** peers are re-POSTed (REQ-F004-051(b)).
- **Resolve iff every peer 2xx** (REQ-F004-051). Partial failure → **reject** (row stays
  `published_at IS NULL`; backoff re-invokes `deliver` with the SAME id, REQ-F004-051(a)).
- **Permanent short-circuit:** any not-yet-acked peer returning a permanent rejection makes
  `deliver` reject as `permanent` → drainer parks immediately, no backoff (REQ-F004-051(d),
  REQ-F004-047/014). Transient peer failures take the capped-backoff path.
- **Eviction (bounded memory):** the entry is dropped when the drainer calls `release(id)` on a
  terminal outcome — fully acked (published) **or** parked (REQ-F004-051(c)). After a **process
  crash** the map is lost and the whole row re-drives to all peers on restart — a possible
  duplicate collapsed by consumer dedupe on the stable id (REQ-F004-051, REQ-F004-018).
- **Partial-delivered park is metric-only, not a row state** (REQ-F004-051(e)): a row parked
  while some peers already 2xx'd still has `acked_at IS NULL` (full ack requires the whole
  fan-out), so REQ-F004-011 correctly parks it; the distinction is surfaced by the
  partially-delivered-park counter (§6), not a new column.

### 2.3 Delivery id — REQ-F004-018/048

`deliveryId = "<outbox-epoch>:<row-id>"`. `<outbox-epoch>` is the singleton value stored once
per DB provisioning (§3, `outbox_meta`), constant for the DB lifetime; `<row-id>` is the
`event_outbox.id`. Identical across every re-delivery of a row (dedupe key); distinct across a
DB reset that recycles SQLite rowids. Lives only at the transport/message level.

### 2.4 Drainer lifecycle & graceful shutdown — REQ-F004-020

- **Start:** `relay/index.ts` runs under a process supervisor (systemd unit / container restart
  policy — the concrete supervisor is a deployment concern, REQ-F004-020) that keeps exactly
  one instance (the single-drainer constraint, REQ-F004-017). It validates config
  (hard-refuse, §5), opens the store, builds the transport, then starts the loop + `/ready`.
- **In-flight set:** the drainer keeps a `Set` of in-flight delivery promises (one per row
  currently handed to the transport), sized by the cross-key concurrency bound (§4).
- **Graceful shutdown (bounded drain over the SET):** on signal, (1) stop selecting new rows,
  release the lease if any; (2) `await` **all** in-flight deliveries against **one shared**
  bounded timeout. Per row: ack-before-timeout → `markPublished`; not-acked-at-timeout →
  **abandon** (leave `published_at` NULL). **Abandonment is neither ack nor failure** — it does
  **not** advance `attempt_count`/`next_attempt_at`/`last_error` (REQ-F004-020 rev-10), so
  repeated shutdown-during-delivery cannot push a row toward the park cap. Outcomes are per-row
  independent; the set is awaited concurrently, not serialized.
- **Restart mid-drain is safe by construction:** unacked in-flight → stays unpublished, re-drained;
  acked-but-unmarked → re-delivered with the same id, deduped (REQ-F004-011/018). Per-key order
  holds because re-drain still obeys head-of-line (REQ-F004-042).

---

## 3. Data model — target `event_outbox` schema (for the migration agent)

Current table (`db.ts:78-83`): `id`, `ts`, `envelope`, `published_at`. F-004 adds delivery
bookkeeping **as columns** (REQ-F004-029/038) plus a singleton epoch table. The transactional
INSERT semantics (REQ-F004-005) are unchanged — only new columns are populated at INSERT.

### 3.1 Exact schema delta

**`event_outbox` — add columns** (in both the `CREATE TABLE` and the PRAGMA-guarded additive
list, mirroring the `failed_attempts` pattern in `db.ts:148-168`):

| Column | Type / default | Meaning / invariant | REQ |
|---|---|---|---|
| `ordering_key` | `TEXT` (nullable at ALTER; **non-null for every row after backfill**) | Per-key partition from §3 derivation; `'__unkeyed__'` = independent. Defensive: a NULL is treated as `'__unkeyed__'`. | REQ-F004-029/031/038 |
| `attempt_count` | `INTEGER NOT NULL DEFAULT 0` | Failed-delivery **and** persistent post-ack-mark failures; **not** reset on ack. Parked when it reaches `MAX_ATTEMPTS` (inclusive-at-N). | REQ-F004-011/013 |
| `next_attempt_at` | `TEXT` (nullable) | NULL ⇒ immediately eligible; else ISO time the row becomes eligible again. | REQ-F004-013/041 |
| `last_error` | `TEXT` (nullable) | Last delivery/mark error (no secret values — REQ-F004-028). | REQ-F004-013/025 |
| `parked_at` | `TEXT` (nullable) | Non-null ⇒ isolated/terminal, **never-fully-acked** poison; excluded from eligibility. | REQ-F004-014 |
| `acked_at` | `TEXT` (nullable) | Non-null ⇒ transport **fully** acked ≥ once; routes the cap decision (set → force-publish; NULL → park). | REQ-F004-011/029 |

**`outbox_meta` — new singleton table** for the delivery-id epoch (REQ-F004-048):

```sql
CREATE TABLE IF NOT EXISTS outbox_meta (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  epoch TEXT NOT NULL          -- generated once (e.g. a UUID) at provisioning; constant for DB lifetime
);
-- seed once, idempotently:
INSERT OR IGNORE INTO outbox_meta (id, epoch) VALUES (1, <generated-uuid>);
```

**Indexes** (REQ-F004-029 "SHOULD be indexed with `id`"; supports the eligibility query at the
≥10k backfill scale, REQ-F004-027):

```sql
CREATE INDEX IF NOT EXISTS idx_outbox_eligible
  ON event_outbox (ordering_key, id)
  WHERE published_at IS NULL AND parked_at IS NULL;   -- partial index over the live working set
```

**`busy_timeout`** (REQ-F004-020 write-vs-write contention): both the BFF and the relay MUST
set `PRAGMA busy_timeout = <ms>` when opening the DB, so a `SQLITE_BUSY`/`SQLITE_LOCKED` blocks
briefly rather than erroring. This is an edit to `db.ts` (currently only `journal_mode = WAL`
is set, `db.ts:13`). WAL is already enabled.

### 3.2 `ordering_key` backfill (REQ-F004-029/015 — MJ-A)

The migration MUST populate `ordering_key` for **every** existing row (critically the pre-F-004
unpublished backlog the first-connection replay must drain in per-key order). It cannot be done
in pure SQL — the key derives from parsing each stored `envelope` JSON — so the migration, in
JS, selects rows with NULL `ordering_key`, applies `deriveOrderingKey`, and updates. It MUST
**never abort on a bad row and never leave a NULL**: an unparseable/invalid envelope falls back
to `'__unkeyed__'` (REQ-F004-029 rev-9/N4). The enqueue path (`OutboxRelayBus.publish`)
populates `ordering_key` at INSERT for all new rows.

### 3.3 Ordering-key derivation (§3 of spec — total over all 8 families)

`deriveOrderingKey(envelope)` matches on the **full dotted prefix including the trailing `.`**
(REQ-F004-029 / spec §3 N6 — `admin.workspace_user.` MUST NOT be misparsed as
`admin.workspace.`):

| Event-name prefix | Ordering key |
|---|---|
| `admin.workspace.` | `ws:<target.id>` |
| `admin.user.` | `user:<target.id>` |
| `admin.instance.` | `instance` (singleton) |
| `admin.workspace_user.` | `ws:<target.workspace>` (membership serializes on the workspace) |
| `admin.invite.` | `invite:<target.id>` |
| `admin.raw_env.` | `instance` (singleton; shares instance config partition) |
| `admin.baseline_prompt.` | `baseline` (dedicated singleton, distinct from `instance`) |
| `admin.feature_toggle.` | `__unkeyed__` (intentional per F-005) |
| no match, **or** matched-prefix-but-missing/empty target field | `__unkeyed__` (never `ws:undefined`) |

`__unkeyed__` rows are **independent** — never a shared blocking partition (ruling BR1).

### 3.4 Eligibility query (REQ-F004-041) — the drain source, NOT `listUnpublished`

```sql
SELECT * FROM event_outbox o
WHERE o.published_at IS NULL
  AND o.parked_at   IS NULL
  AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= @now)
  AND (
    o.ordering_key = '__unkeyed__' OR o.ordering_key IS NULL   -- unkeyed rows are independent (BR1 + defensive NULL)
    OR NOT EXISTS (                                            -- per-key head-of-line: only the oldest per key
      SELECT 1 FROM event_outbox e
      WHERE e.ordering_key = o.ordering_key
        AND e.published_at IS NULL                             -- an older mid-backoff OR parked row still blocks its key
        AND e.id < o.id
    )
  )
ORDER BY o.id ASC
LIMIT @batch;
```

The older-row test keys on `published_at IS NULL`, which includes parked rows (parked ⇒
`published_at NULL`), so a parked head correctly **stalls its own key** while other keys flow
(REQ-F004-042). `listUnpublished` is retained for tests/diagnostics only; a static check
confirms the relay never calls it (REQ-F004-010/041).

---

## 4. Concurrency & ordering model

- **Per-key in-order, cross-key parallel** (REQ-F004-016/017/027/031/042). The eligibility
  query returns at most the **oldest** undelivered row per real key, plus every `__unkeyed__`
  row. The drainer dispatches these **concurrently up to a bounded in-flight limit** (a relay
  constant, tuned to the ≥50 ev/s SLO), so distinct keys deliver in parallel; per-key order is
  guaranteed because a key's next row is not eligible until its current oldest publishes.
- **Within a key: block.** A mid-backoff or parked head holds its key's later rows
  (per-key head-of-line). **Across keys: skip.** A stuck key never delays others.
- **`__unkeyed__`: independent.** No unkeyed row blocks another; blast radius of a stuck/parked
  unkeyed row is exactly one row.
- **Single logical drainer per outbox** (REQ-F004-017/054). GTM enforces this with the
  single-instance deployment constraint (one supervised relay per app-outbox). Within the one
  process, two concurrent drain ticks MUST NOT both deliver a row and both `markPublished`: the
  in-flight set is keyed by row id so a row already dispatched is not re-selected in the same
  pass. `markPublished` is idempotent-in-effect (grounded `UPDATE … SET published_at`); an
  optional `WHERE published_at IS NULL` guard MAY make it a true no-op (REQ-F004-017 M7).
- **Throughput** (REQ-F004-027): p95 emit-to-ack < 5 s; sustain ≥ 50 ev/s with backlog trending
  to zero; clear a ≥ 10,000-row backfill without stalling. Per-key order does **not** cap
  throughput to a serial stream — parallelism is across keys.
- **Lease (future/optional, REQ-F004-017(b)/020):** if two relay instances ever run, a
  TTL'd, periodically-renewed **lease row** (not a Postgres advisory lock — none exists in
  SQLite) elects one drainer; a lease-expiry/GC-pause overlap is tolerated (at most a
  same-delivery-id duplicate, deduped), so correctness rests on single-writer-of-`markPublished`
  + dedupe, not distributed mutual exclusion. **GTM ships single-instance only.**

---

## 5. Config surface (REQ-F004-021/045/046/052)

Two orthogonal axes. `EVENT_BUS_MODE` is read by the **BFF** (selects its emitter);
`EVENT_BUS_URL` / `EVENT_BUS_TRANSPORT` / the thresholds are read by the **relay** only.

| Key | Shape / default | Consumer / behavior | REQ |
|---|---|---|---|
| `EVENT_BUS_MODE` | closed set `{inproc, bus}`, default `inproc` | **BFF.** Under `NODE_ENV=production` any non-`bus` value (literal `inproc`, unset, or a typo like `buss`) → **BFF refuses to boot**, non-zero exit naming `EVENT_BUS_MODE`. Dev may warn + default `inproc`. | REQ-F004-021/046/039 |
| `EVENT_BUS_URL` | **comma-delimited peer list** (comma delimiter, whitespace trimmed per entry, empty entries dropped — mirrors `WEB_ORIGINS`, `config.ts:22`) | **Relay only.** Peers for `HttpPeerTransport` fan-out. In production, `bus` mode + empty list → **relay refuses to boot** naming the missing URL; dev → boots, `/ready` not-ready `bus mode without EVENT_BUS_URL`. BFF is unaffected and keeps enqueuing (recoverable backlog). | REQ-F004-045/051/052 |
| `EVENT_BUS_TRANSPORT` | closed set `{http, broker}`, default `http`; evaluated **only when `EVENT_BUS_MODE=bus`**, **relay only** | `http` → `HttpPeerTransport`. `broker` → **hard-refuse to boot in BOTH dev AND production** ("broker transport not available in this build") — deliberately NOT the URL env-split, because there is structurally no `BrokerTransport` to instantiate. Out-of-set value → refuse likewise. | REQ-F004-050/052 |
| `EVENT_BUS_BACKLOG_THRESHOLD` | rows, default **1000** | Relay `/ready`: not-ready when `backlog ≥ threshold`. | REQ-F004-024/026 |
| `EVENT_BUS_LAG_THRESHOLD_MS` | ms, default **30000** | Relay `/ready`: not-ready when `lag ≥ threshold`. | REQ-F004-023/026 |

Backoff (`base`, `factor`, `cap`, `MAX_ATTEMPTS`), the cross-key concurrency bound,
`busy_timeout`, the shutdown drain timeout, the poll cadence, and the retention window are
**documented constants of record** (REQ-F004-013/019/027; cadence is implementation-defined per
REQ-F004-010/M8). The spec fixes their **shape** but not concrete values — see open questions.

**BFF vs relay config split (open question, §11).** `config.ts` currently `requireEnv`s
`ANYTHINGLLM_*`, `SESSION_SECRET`, `SECRETS_ENC_KEY` at module load — engine/auth vars the
relay process does not need. A separate relay entrypoint importing `config.ts` would fail on
those. The relay needs a **relay-scoped config** that requires only the DB path + `EVENT_BUS_*`.

**Security (REQ-F004-028):** `EVENT_BUS_URL` / transport creds are server-side only; the browser
never receives them. Envelopes are pre-redacted at emit; the relay MUST NOT re-expand or log
secret values (`last_error` and diagnostics follow parent REQ-094 hygiene).

---

## 6. Observability & `/ready` (REQ-F004-023/024/025/026/044)

Metrics exposed by `relay/metrics.ts`, consumed by `/ready` and available as diagnostics:

- **Relay lag** — age of the oldest unpublished, non-parked row (0 when empty). REQ-F004-023.
- **Backlog** — count of unpublished, non-parked rows. REQ-F004-024.
- **Delivery / failure / attempt counts.** REQ-F004-025.
- **Never-delivered park count** — rows parked with no peer ever accepting (transient exhaustion
  or permanent-first). REQ-F004-025.
- **Partially-delivered park count** — fan-out rows parked while ≥1 peer had already accepted
  (those peers hold dedupable copies; only un-acked peers need replay). Distinct signal, same
  `parked_at` row state. REQ-F004-025/051(e).
- **Post-ack-cap count** — rows delivered/acked but force-marked published after `markPublished`
  repeatedly failed (event reached the consumer; local bookkeeping was lossy; not a loss, not a
  park). REQ-F004-011/025.

**`GET /ready` (served by the RELAY, not the BFF)** — REQ-F004-044. The BFF's fixed
`GET /health → {ok:true}` (parent REQ-024) is **unchanged**. `/ready` reports only what the
process holding the transport can observe:

- **200 ready** iff transport reachable **AND** `backlog < EVENT_BUS_BACKLOG_THRESHOLD` **AND**
  `lag < EVENT_BUS_LAG_THRESHOLD_MS` (both **strictly below**; at-or-over is degraded).
- **503 not-ready/degraded** with a machine-readable `reason`: `transport-unreachable`,
  `bus mode without EVENT_BUS_URL`, `backlog-over-threshold`, `lag-over-threshold`,
  `store-unwritable` (relay cannot land `acked_at`/`published_at`, REQ-F004-011).

Startup misconfig is a per-process **refuse-to-boot** (§5), not a `/ready` state.

---

## 7. Data flow — one drain tick (main scenario)

1. **Emit (BFF, unchanged path + one addition):** `emitAdminEvent` → `OutboxRelayBus.publish`
   → `outboxRepo.insert(ts, envelope, orderingKey)` inside the verify txn. New: `orderingKey`
   = `deriveOrderingKey(envelope)`. No delivery here (REQ-F004-005/029).
2. **Select:** drainer runs `selectEligible(now, batch)` (§3.4) — oldest row per real key +
   all `__unkeyed__` rows, `id ASC`. REQ-F004-010/041.
3. **Dispatch (parallel across keys, bounded):** for each selected row not already in-flight,
   build `deliveryId` and call `transport.deliver(envelope, deliveryId)`; add to the in-flight
   set. REQ-F004-016/027.
4. **On resolve (full ack):** `markAcked(id, now)` (best-effort `acked_at`) then
   `markPublished(id, now)`; `transport.release(deliveryId)`. Row leaves the working set.
   REQ-F004-012/051(c).
5. **On reject — transient:** `recordFailure(id, next_attempt_at = now + backoff(attempt), err)`,
   `attempt_count++`. If `attempt_count` reaches `MAX_ATTEMPTS` → route by `acked_at`:
   set → `forcePublish` (post-ack-cap metric); NULL → `park` (never-delivered metric). Key stays
   blocked during backoff. REQ-F004-013/011/014.
6. **On reject — permanent:** `park(id, now)` immediately (no backoff), `acked_at`-NULL ⇒
   never/partially-delivered park; `transport.release`. Other keys keep flowing. REQ-F004-047/014.
7. **Loop / backfill:** repeat on cadence; when a previously-unreachable transport recovers, the
   accumulated backlog drains oldest-first, all rows, per-key order (REQ-F004-015/037).
8. **Prune (periodic):** delete published rows older than the retention window; **never** delete
   unpublished or parked rows regardless of age. REQ-F004-019/035.

---

## 8. Failure-mode table (REQ traceability)

| Failure mode | Handling | REQ |
|---|---|---|
| Crash/kill between emit and deliver (row committed, `published_at` NULL) | Row re-drained on restart; delivered ≥ once, never zero. | REQ-F004-011 |
| Crash **after** transport ack, **before** `markPublished` | Re-delivered with same delivery id; consumer dedupes. Persists no state → not bounded by cap; if deterministic, caught by supervision restart-loop alerting. | REQ-F004-011/018/020 |
| Persistent post-ack `markPublished` write failure (non-`SQLITE_BUSY`) | `attempt_count++`, `next_attempt_at` advanced on same backoff; at cap, `acked_at` set → `forcePublish` (post-ack-cap metric), key resumes. | REQ-F004-011/013/025 |
| `SQLITE_BUSY` / `SQLITE_LOCKED` (writer/writer contention) | `busy_timeout` blocking wait + retry; treated transient; does **not** increment `attempt_count`. | REQ-F004-020 |
| Transient delivery failure (error/timeout/nack/unreachable) | Backoff, `attempt_count++`, retried up to `MAX_ATTEMPTS`, then parked (never-delivered). Key stalls transiently. | REQ-F004-013/014/047 |
| Permanent rejection (malformed / transport says permanent) | Parked immediately, no backoff; other keys flow. | REQ-F004-014/047 |
| Fan-out: one peer permanently rejects after another already accepted | `deliver` rejects permanent → parked immediately, `acked_at` NULL; counted as **partially-delivered** park. | REQ-F004-051(d)(e)/014/025 |
| Poison event (repeated transient) | Parked at cap (never-delivered), retained/queryable/alerted, stalls only its key. | REQ-F004-014/025 |
| Transport unreachable / outage then recovery | Rows accumulate `published_at NULL`; on recovery, backfill all oldest-first, per-key order. | REQ-F004-012/015/037 |
| Relay crash mid-drain | Supervisor restarts; unacked → re-drained, acked-unmarked → deduped; state never corrupted. | REQ-F004-020 |
| Graceful shutdown with N in-flight | Stop selecting; await the SET to a shared timeout; each row published or abandoned (bookkeeping untouched); abandonment ≠ attempt. | REQ-F004-020 |
| Relay cannot land `acked_at`/`published_at` at all | `/ready` → 503 `store-unwritable`; not a single-key wedge. | REQ-F004-011/044 |
| `bus` prod with no `EVENT_BUS_URL` | Relay refuses to boot; BFF boots + keeps enqueuing (recoverable backlog). | REQ-F004-045 |
| Non-`bus` `EVENT_BUS_MODE` in prod | BFF refuses to boot (else mark-published-without-delivery ⇒ silent loss). | REQ-F004-021/039 |
| `EVENT_BUS_TRANSPORT=broker` (this build) | Relay refuses to boot in all envs ("broker transport not available"). | REQ-F004-052 |

---

## 9. Key decisions & alternatives rejected

- **Single-instance relay over a DB lease (GTM).** Alternatives: (a) DB advisory lock — no
  native SQLite equivalent (REQ-F004-020), rejected; (b) lease row with TTL — more moving parts
  than one nominal-load box needs, kept as a documented future option (§4). Single-instance is
  the RATIFIED default (REQ-F004-033) and adequate for parent single-instance load (REQ-100).
- **Fan-out state inside the transport, not the schema.** Keeping the per-`deliveryId` ack map
  in `HttpPeerTransport` (REQ-F004-051) means `published_at` keeps its single meaning ("handed
  off to the transport") and the outbox schema is **invariant across the broker swap** (a broker
  acks once, no peer list). Alternative — per-peer columns in `event_outbox` — was rejected: it
  would leak transport specifics into the schema and break the swap boundary (REQ-F004-049/051).
- **`acked_at` marker routes the post-ack cap.** Alternative — infer never-vs-ever-delivered
  from the failing attempt's type — is undecidable from persisted state for mixed histories and
  re-opens the `parked_at` conflation (spec rev-6 B1-new). A durable `acked_at` makes `parked_at`
  mean exclusively never-fully-acked poison (REQ-F004-011/014).
- **Park-in-place, no DLQ table.** Simpler for GTM; a parked row stays queryable/replayable in
  situ (REQ-F004-014/032). A separate DLQ store adds a table and a move step with no rev-1 payoff.
- **Bookkeeping columns, not a sidecar** (REQ-F004-038) — the eligibility query filters and
  orders on these fields; a join to a sidecar per drain tick is needless overhead at this scale.
- **Epoch-qualified delivery id at the transport level**, not an envelope id — avoids a frozen
  contract change (REQ-F004-004/036/048).

---

## 10. Risks & parts most likely to need revision

- **Per-key ordering / head-of-line / per-key park** (REQ-F004-016/042/014) are the
  highest-divergence-risk behaviors (spec self-check). The eligibility query in §3.4 is the
  single source of truth — a subtly wrong older-row clause silently loses ordering or wedges a
  key. Pin to the spec's seeded tests.
- **Prefix-match-with-trailing-dot** in `deriveOrderingKey` — a naive `startsWith` misparses
  `admin.workspace_user.*` (§3.3, REQ-F004-029 N6). Likely revisited if a new family is added.
- **Eligibility query performance at ≥10k backfill** — the per-key `NOT EXISTS` self-join over a
  large unpublished set; the partial index (§3.1) is the mitigation, but this is the spot to
  profile against the REQ-F004-027 backfill target.
- **Two-writer SQLite contention** — `busy_timeout` + transient-retry is the design, but the
  concrete timeout and observed `SQLITE_BUSY` rate under 50 ev/s are unproven (REQ-F004-020).
- **Relay/BFF config split and process packaging** — the largest un-grounded piece (§5, §11):
  the repo has one BFF entrypoint and a load-time `requireEnv` config; the separate relay needs
  its own entrypoint, config subset, and store bootstrap.
- **Provisional constants** (backoff, concurrency, thresholds, timeouts) are not pinned by the
  spec; expect tuning against the SLO.

---

## 11. Traceability (design element → REQ-F004-###)

| Design element (§) | REQ satisfied |
|---|---|
| Two-layer seam; drainer imports only `EventTransport` (§1.2, §2.1) | 049 |
| `HttpPeerTransport` GTM; broker future drop-in (§1, §2.2) | 050 |
| Fan-out ack map, re-POST un-acked, eviction, permanent short-circuit, partial-park (§2.2) | 051, 043, 047 |
| `deliver(envelope, deliveryId)` ack-gates markPublished; transient/permanent reject (§2.1) | 049, 012, 043, 047 |
| Conforming-transport contract (ack / id-carriage / perm-vs-transient) (§2.1) | 043 |
| Delivery id `"<epoch>:<row-id>"` (§2.3, §3.1) | 018, 048 |
| Drainer lifecycle, in-flight SET, bounded graceful shutdown, abandon≠attempt (§2.4) | 020 |
| Relay = separate supervised service; per-app outbox (§1, §2.4, §4) | 033, 020, 054 |
| Single-drainer (single-instance; lease future) (§4) | 017 |
| Eligible-row selection; not `listUnpublished` (§3.4) | 041, 010 |
| Per-key order in / skip across; head-of-line; `__unkeyed__` independent (§4) | 016, 042, 031 |
| Retry capped backoff, inclusive-at-N cap (§3.1, §5, §7) | 013, 032 |
| Park never-acked poison; per-key scope; force-publish if ever-acked (§7, §8) | 014, 011 |
| `acked_at`-routed post-ack cap; `store-unwritable` (§2.2, §3.1, §6, §8) | 011, 044 |
| Backfill replay-all oldest-first; ordering_key backfilled (§3.2, §7) | 015, 037, 029 |
| Schema columns + epoch + indexes + busy_timeout (§3) | 029, 038, 048, 020 |
| `ordering_key` derivation total over 8 families, trailing-dot match (§3.3) | 029, 031, 016 |
| Retention prune published; keep unpublished/parked (§7) | 019, 035 |
| Config: `EVENT_BUS_MODE` BFF hard-refuse; URL/TRANSPORT relay hard-refuse; thresholds (§5) | 021, 045, 046, 052, 039 |
| Broker selector all-env refuse (§5) | 052 |
| Observability metrics incl. split park + post-ack-cap (§6) | 023, 024, 025, 026 |
| `/ready` served by relay; `/health` untouched; boundary at-or-over (§6) | 044, 026 |
| Envelope byte-for-byte, no reshape; log hygiene (§2.1, §5) | 002, 028 |
| No producer/emitter/route/service/web change; envelope frozen (header, §1) | 004, 005, 006, 022 |
| Consumer contract broker-swap-invariant (dedupe + reorder tolerance) (§2.3, §4) | 053, 018, 016 |
| p95<5s, ≥50 ev/s, ≥10k backfill; parallel keys (§4) | 027, 034 |

Spec sections covered: §1–§10 (all `REQ-F004-001..054` map to a design element above or are
explicit non-goals in the header — REQ-F004-003/007/008/009/030/036/040 are scope/ruling
context carried by the header and §9, not new build surface).

---

## Open questions for the spec (flagged, NOT resolved here)

1. **Relay process packaging & config scope.** The spec mandates a *separate supervised
   service* (REQ-F004-020/033) but the repo has a single BFF entrypoint (`index.ts`) and a
   load-time `config.ts` that `requireEnv`s engine/auth secrets the relay does not use. The spec
   does not say whether the relay is a new entrypoint in the `bff` package sharing the store
   modules, its own package, and what its config module requires. Design assumes a new
   `bff/src/relay/index.ts` + a relay-scoped config, but the packaging/deployment unit and the
   supervisor are left to the implementer/ops — confirm this is intended.
2. **Concrete constants of record.** The spec fixes the **shape** of backoff (base, factor, cap,
   `MAX_ATTEMPTS`), the cross-key concurrency bound, `busy_timeout`, the shutdown drain timeout,
   the poll cadence, and the retention window, but gives concrete values only for the two
   `/ready` thresholds (1000 / 30000). The rest are "provisional documented constants" the
   implementer sets — confirm there is no pinned value expected for GTM acceptance.
3. **`markPublished` no-op guard.** REQ-F004-017/M7 leaves the `WHERE published_at IS NULL` guard
   **optional**. Under the single-writer model it is not required for correctness; confirm it is
   acceptable to omit (grounded `markPublished` overwrites unconditionally).
4. **`/ready` transport-reachability probe semantics.** REQ-F004-044 requires `/ready` to report
   `transport-unreachable`, but the spec does not define how the relay probes peer reachability
   between deliveries (active health-ping vs last-delivery-outcome). Design leaves this to the
   `HttpPeerTransport` implementation; confirm no specific probe contract is mandated.
