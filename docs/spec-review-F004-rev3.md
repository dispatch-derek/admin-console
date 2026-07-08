# Adversarial Spec Review — F-004 Production-Ready Event Bus (rev-3 delta)

Spec reviewed: `specs/F-004-production-event-bus.md` (Draft **rev 3**, `REQ-F004-###` namespace)
Prior review: `docs/spec-review-F004.md` (rev 1/2 — already-resolved findings NOT re-raised)
Parent: `specs/admin-console.md` (v1, rev 7) — REQ-024 health, REQ-029* chain, §14 catalog
Grounding verified: `bff/src/events/catalog.ts`, `bus.ts`, `emitter.ts`,
`bff/src/store/repositories/outbox.repo.ts`, `bff/src/services/{user,workspace,settings}.service.ts`
Scope: the **rev-3 human-ruling deltas** (REQ-F004-031/042/032/033/038/039), not a full re-review.
Reviewer posture: adversarial, read-only on the spec.

Checks executed (8/8): misinterpretation attack, one-line-test, error-coverage sweep,
example-vs-prose reconciliation, definition audit, boundary audit, non-goal probe, cross-reference.

---

## Positive confirmations (rev-3 deltas that hold up)

- **No residual global-ordering / broker-exactly-once language.** Every occurrence of
  "exactly-once" / "global order" (lines 46, 133, 214, 290, 641) is a *disclaimer*
  ("**not** broker-enforced exactly-once", "MUST NOT assume global order"). The per-key +
  effectively-once reframe is internally consistent on this axis. No leftover at-least-once/
  no-order or global-order promise survives from rev 2.
- **Drain-selection / head-of-line / park agree for *keyed* rows.** §3 "Eligible row",
  REQ-F004-041 ("oldest undelivered row per `ordering_key`"), REQ-F004-042 (skip across / block
  within), and REQ-F004-014 (park stalls only its key) are mutually consistent **for events that
  map to a distinct entity key**. The added A1/A2-on-one-key + B1-on-another tests pin this.
- **Effectively-once has no *silent-drop* hole for distinct events.** The epoch-qualified
  `<outbox-epoch>:<row-id>` delivery id (REQ-F004-018/048) makes ids unique per row within a DB
  lifetime, so a *distinct* event cannot be wrongly deduped away. The B4 "never zero / delivered-
  or-isolated" reconciliation is preserved.
- **Hard-refuse vs runtime `/ready` split is cleanly staged** in principle: config misconfig at
  boot (REQ-F004-021/045/046), transport/backlog at runtime (REQ-F004-044); parent REQ-024
  `/health → {ok:true}` is explicitly left untouched (no parent-contract change). (But see MJ1 for
  the process-ownership ambiguity the topology split introduces.)

---

## Blocking findings

### BR1 — [CONTRADICTION] §3 `__unkeyed__` "unordered / no head-of-line" vs REQ-F004-041/042/014 single-shared-key eligibility+park
The ordering-key definition (§3, line 141-144) states `__unkeyed__` events are "treated as
**unordered** relative to other `__unkeyed__` events (**no per-key ordering guarantee** among them)".
But the eligibility/drain/park machinery keys on the **literal `ordering_key` string**:
- REQ-F004-041: "for each `ordering_key` only the **oldest** unpublished row is eligible, and a row
  is **not** eligible if an older row on its key is unpublished (whether mid-backoff or parked)".
- REQ-F004-014 park scope: a parked row "stalls only **ITS OWN ordering key**".

Every `__unkeyed__` row shares the *same* `ordering_key` value `'__unkeyed__'`. Under the mechanism,
that single shared value makes the whole `__unkeyed__` bucket a **strict-FIFO, head-of-line-blocked
partition**, and a single parked/poison `__unkeyed__` row (e.g. a malformed `admin.raw_env.written`)
**stalls every other `__unkeyed__` event** until resolved.

- **Reading A (§3 prose):** `__unkeyed__` events are independent; a stuck/parked one does **not**
  block the others (no HoL among them). Blast radius of a poison unkeyed row = 1 row.
- **Reading B (REQ-F004-041/042/014 mechanics):** `__unkeyed__` is one partition; only the oldest is
  eligible; a parked one stalls the entire bucket. Blast radius = all unkeyed rows.

Both are written on the page and an implementer can conform to either. This is not cosmetic: it
changes a **core failure-isolation guarantee** (poison blast radius) for exactly the events with no
natural key. **Resolution needed / human question:** should `__unkeyed__` rows (a) be exempt from the
per-key HoL/park rule (each independent — requires the eligibility query to special-case
`ordering_key = '__unkeyed__'` so they do NOT block one another), or (b) be a genuinely serialized
shared FIFO partition (then delete "unordered / no ordering guarantee" from §3)? Pick one and make
§3 and REQ-F004-041/042/014 agree.

### BR2 — [GAP/AMBIGUOUS] Ordering-key derivation is not total over the live event catalog
REQ-F004-031 and §3 (line 137-144) define the derivation for only **three** event-name families:
`admin.workspace.*` → `ws:<id>`, `admin.user.*` → `user:<id>`, `admin.instance.*` → singleton
`instance`, with the fallback "no natural entity id ⇒ `__unkeyed__`". The grounded catalog
(`catalog.ts`) and real emit sites contain **three more families that match none of these prefixes**:

| Event family | Actual `target` at emit site | Which `ordering_key`? |
|---|---|---|
| `admin.workspace_user.assigned/unassigned` | `{ workspace: <wsId>, user: <userId> }` (user.service.ts:351/359) — **two** ids, **no** `id` field | **unspecified** |
| `admin.invite.created/revoked` | `{ id: <inviteId> }` (user.service.ts:258, 273-ish) — has a natural id | **unspecified** (`invite:<id>`? or `__unkeyed__`?) |
| `admin.raw_env.written` | `{ keys: [...] }` (settings.service.ts:288/322) — **no** id | falls to `__unkeyed__` by the fallback, but is instance-scoped config (see NOTE MN4) |

Divergent readings that both claim compliance:
- `admin.workspace_user.*`: (A) key by workspace `ws:<w>`; (B) key by user `user:<u>`; (C) composite
  `ws:<w>+user:<u>`; (D) `__unkeyed__` (no single natural id). Four distinct partition schemes, each
  changing which events serialize and what a poison row stalls.
- `admin.invite.*`: (A) `invite:<id>` (it *has* a natural id, so the `__unkeyed__` fallback does not
  clearly apply); (B) `__unkeyed__` (no matching namespace rule). Two readings.

This makes REQ-F004-029's own acceptance test **untestable** for these families: it asserts an emitted
row gets "a non-null `ordering_key` **matching its target**" — but there is no defined "matching" key
for a `workspace_user`, `invite`, or `raw_env` target. **Resolution needed:** enumerate the
`ordering_key` for **all 6** catalog families (workspace, user, instance, **workspace_user, invite,
raw_env**), not 3, and state which target field supplies the id per family.

---

## Major findings

### MJ1 — [AMBIGUOUS/GAP] Rev-3 topology split (separate relay service) vs "the BFF refuses to boot" and "`/ready` sibling to `/health`"
REQ-F004-033 makes the relay a **separate supervised service**; the BFF only *enqueues*
(`OutboxRelayBus.publish` = INSERT only, `bus.ts:31-33`) and **never uses `EVENT_BUS_URL`** — only the
relay delivers. Yet the rev-3 boot/readiness requirements still speak of "**the BFF**":
- REQ-F004-045/021/039: "under `NODE_ENV=production` … `bus` with no `EVENT_BUS_URL` … the **BFF MUST
  refuse to start**." But the BFF has no delivery responsibility post-split; the process that needs
  the URL is the *relay*. **Reading A:** the BFF validates and refuses even though it never uses the
  URL. **Reading B:** the *relay service* is what refuses to boot on a missing URL; the BFF boots and
  keeps enqueuing. The tests ("the BFF process refuses to boot", "no HTTP listener") pick A, which is
  in tension with REQ-F004-033's rationale ("the relay has nowhere to deliver").
- REQ-F004-044: `/ready` is "a dedicated readiness probe endpoint … **sibling to `/health`**"
  (i.e. the BFF's HTTP server), and REQ-F004-021's test treats `/health` and `/ready` as the *same
  listener* ("neither `/health` nor `/ready` is served"). But `/ready` must report
  `transport-unreachable` (REQ-F004-044) — a fact known **only to the separate relay** that holds the
  transport connection. The BFF, sharing "only the durable `event_outbox` and the transport"
  (REQ-F004-020), can compute backlog/lag from the DB but **cannot observe transport reachability**.
  So either `/ready` lives on the relay (contradicting "sibling to `/health`" / same-listener tests),
  or it lives on the BFF and cannot produce the `transport-unreachable` reason it is required to
  produce.

**Resolution needed / human question:** state, post-REQ-F004-033, (1) which process hard-refuses on
`EVENT_BUS_MODE`/`EVENT_BUS_URL` misconfig (BFF, relay, or both), and (2) which process serves
`/ready` and how it observes transport reachability that lives in the other process (shared DB
heartbeat row? relay-owned `/ready`?). As written the two rulings (REQ-F004-033 vs -039/044) were not
reconciled.

### MJ2 — [AMBIGUOUS] Derivation says `ws:<workspaceId>` / `user:<userId>` but real targets have no such fields
§3 (line 138-140) and REQ-F004-031 frame the id as if a named target field:
`ws:<workspaceId>`, `user:<userId>`. The actual `target` is opaque
(`Record<string, string|number|string[]>`) and the real emit sites use a **uniform `{ id: ... }`**
for workspace/user/invite (workspace.service.ts:96, user.service.ts:117/162/211/258) — there is **no**
`target.workspaceId` or `target.userId` field anywhere, and membership uses `{ workspace, user }`
instead. Two readings:
- **Reading A:** dispatch on the **event name** prefix to choose the namespace, then read the id from
  `target.id` (and from `target.workspace`/`target.user` for membership). Works, but is nowhere
  stated.
- **Reading B (literal):** read a field literally named `workspaceId`/`userId` from `target`. That
  field is always `undefined`, so **every** workspace/user event's id resolves empty → they all fall
  into `__unkeyed__`, collapsing the entire per-key guarantee.

Both are defensible from the page. **Resolution:** state that the key is derived from the **event
name** (namespace) plus a named target field per family, and name that field (`target.id`, and
`target.workspace`/`target.user` for `admin.workspace_user.*`).

---

## Minor / Notes (non-blocking)

- **MN1 — [GAP] Lease option (b) has no TTL / renewal / fencing; the "at most one at any time"
  invariant is overstated.** REQ-F004-017(b) offers "a lease row/column, or a DB advisory lock" but
  specifies no lease duration, renewal cadence, or fencing token. A bare lease cannot guarantee the
  stated absolute ("at most **one** relay instance drains … **at any time**") across a lease-expiry /
  GC-pause gap: holder A stalls past expiry, B acquires and drains, A resumes and delivers +
  `markPublished` the same row. Correctness survives (same delivery id ⇒ consumer dedupe ⇒
  effectively-once), so this is non-blocking — but REQ-F004-017's test ("only one delivers a given row
  per successful pass") and the "at any time" invariant are stronger than a bare lease provides. State
  either that a lease-expiry overlap is tolerated (duplicate absorbed by dedupe) or require a fencing
  token; and give the lease a TTL/renewal so a crashed holder's lease is reclaimable.

- **MN2 — [GAP] "Transport acked but `markPublished` persistently fails" escapes retry/park.** Retry
  (REQ-F004-013) and park (REQ-F004-014) key on **delivery failure**. A row whose *delivery succeeds*
  (ack received) but whose `markPublished` persistently fails (DB write error / repeated crash in the
  post-ack window, REQ-F004-011) is neither a transient nor a permanent *delivery* failure, so it is
  never retried-to-park — it is re-drained forever (infinite same-delivery-id duplicates, absorbed by
  the consumer) **and permanently head-of-line-blocks its key** (the row never becomes published, and
  under REQ-F004-042 no newer same-key row can pass it). No isolation path covers this. Rare, but it is
  precisely the "path to an infinitely-duplicated event / permanently stalled key" the reframe should
  address. Consider an attempt-cap on post-ack mark failures, or note the mode as accepted risk.

- **MN3 — [NOTE] Separate relay service ↔ shared SQLite `event_outbox` is unaddressed.** The grounded
  store is local SQLite (`store/db.js`, better-sqlite3). REQ-F004-020 says the separate relay and the
  BFF "share only the durable `event_outbox`" — i.e. two processes against one SQLite file. The spec
  does not address cross-process SQLite access (file path, WAL, concurrent writers), and "a **DB
  advisory lock**" (REQ-F004-017b) is Postgres terminology with no native SQLite equivalent — for
  SQLite only the "lease row/column" option is realizable. Not a spec contradiction, but a grounding
  gap the implementer will hit; worth naming the shared-DB access model.

- **MN4 — [NOTE] `admin.raw_env.written` unordered (`__unkeyed__`) vs `admin.instance.*` singleton
  `instance` is an asymmetry for two instance-scoped families.** Raw-env writes and instance-setting
  changes both mutate on-box configuration, but the derivation routes `admin.instance.*` to a single
  ordered `instance` key while `admin.raw_env.written` (target `{keys}`) falls to unordered
  `__unkeyed__`. Two sequential raw-env writes to the same key would carry no ordering guarantee (and,
  per BR1 Reading B, would instead be serialized). Confirm this asymmetry is intended, or fold raw_env
  into the `instance` key.

- **MN5 — [NOTE] Membership events are not ordered relative to their user/workspace lifecycle events.**
  Whatever key `admin.workspace_user.*` lands on (BR2), it will differ from the `user:<id>` /`ws:<id>`
  key of the related `admin.user.*` / `admin.workspace.*` events, so causally-related events (e.g.
  create user → assign to workspace) are on different partitions and carry no relative order. This is
  legitimate under per-key semantics, but REQ-F004-031's framing "per workspace/user id" may lead a
  reader to over-assume; a one-line caveat would prevent it.

---

## Verdict

**BLOCK (revise).** The per-key reframe is internally consistent and the global/exactly-once cleanup is
complete for events that map to a distinct entity key — but two blocking items remain, both concentrated
where the rev-3 rulings meet the *actual* catalog and the *actual* topology:

1. **BR1** — `__unkeyed__` is described as unordered/no-HoL yet mechanically routed through one shared
   `ordering_key`, so a poison unkeyed row's blast radius (1 row vs the whole bucket) is contradictory.
2. **BR2** — the ordering-key derivation covers only 3 of the 6 live event families; `workspace_user`,
   `invite`, and `raw_env` targets have no defined key, making REQ-F004-029's own test undecidable.

Plus two Majors from the topology split left unreconciled (MJ1: which process boots-refuses / serves
`/ready` and how it sees transport reachability; MJ2: the derivation names target fields that do not
exist in the grounded envelopes). Resolve BR1/BR2 and clarify MJ1/MJ2 and the spec is
implementation-ready; MN1–MN5 are non-blocking.
