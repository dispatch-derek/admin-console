# Adversarial Spec Review — F-004 Production-Ready Event Bus (rev-4 delta)

Spec reviewed: `specs/F-004-production-event-bus.md` (Draft **rev 4**, `REQ-F004-###` namespace)
Prior review: `docs/spec-review-F004-rev3.md` (BR1/BR2 blocking; MJ1/MJ2 major; MN1–MN5 notes)
Parent: `specs/admin-console.md` (v1, rev 7) — REQ-024 health, REQ-029* chain, §14 catalog
Grounding re-verified this pass: `bff/src/events/catalog.ts` (18 names), `bus.ts:40` factory,
`bff/src/services/{user,workspace,settings}.service.ts` emit-site `target` shapes.
Scope: (1) verify each rev-3 finding is actually resolved; (2) fresh adversarial pass on the
changed areas (ordering-key derivation, `__unkeyed__` exemption, per-process boot split, MN1/MN2/MN3).
Checks executed (8/8): misinterpretation, one-line-test, error-coverage, example-vs-prose,
definition audit, boundary audit, non-goal probe, cross-reference.

---

## Part 1 — Verify-the-fixes (rev-3 findings)

- **BR1 (`__unkeyed__` independence) — RESOLVED.** The "independent / exempt from per-key
  head-of-line" ruling is now stated consistently in every place the mechanism is referenced:
  §3 "Ordering key" (l.157-163), §3 "Eligible row" special-case (l.164-173), §3 "Park/dead-letter"
  exception (l.189-191), REQ-F004-041 (l.279-284, with the concrete
  `AND (ordering_key = '__unkeyed__' OR NOT EXISTS(...))` SQL sketch), REQ-F004-042 (l.309-312),
  REQ-F004-014 (l.451-453), REQ-F004-016 (l.336), REQ-F004-029 (l.588/602), and §9 REQ-F004-031
  (l.738). Blast radius "exactly one row" appears everywhere. No residual Reading-B (single shared
  FIFO partition) wording survives. Consistent.

- **BR2 (derivation total over 6 families) — RESOLVED & GROUNDED.** All six live prefixes are now
  enumerated (§3 l.144-156; REQ-F004-031 l.735-737; REQ-F004-029 test l.601-603) and each named
  target field matches the actual emit sites I re-read: `admin.workspace.*` → `ws:<target.id>`
  (workspace.service.ts:205/246 use `{ id: productId }`, incl. documents_changed / knowledge_*),
  `admin.user.*` → `user:<target.id>` (user.service.ts:117), `admin.invite.*` → `invite:<target.id>`
  (user.service.ts:258/282), `admin.workspace_user.*` → `ws:<target.workspace>` (user.service.ts:351/359
  use `{ workspace, user }`), `admin.instance.*` and `admin.raw_env.*` → constant `instance`. All 18
  catalog names map to a prefix; the function is total for every grounded event.

- **MJ1 (topology/boot/ready split) — RESOLVED.** The per-process split is now stated the same way in
  REQ-F004-021 (l.550-573), REQ-F004-045 (l.606-622), REQ-F004-044 (l.657-681), and §9 REQ-F004-039
  (l.792-800): `EVENT_BUS_MODE` → **BFF** hard-refuses; `EVENT_BUS_URL` → **RELAY** hard-refuses while
  the BFF boots and keeps enqueuing; `/ready` is served by the **relay** and is explicitly **"not a
  sibling of the BFF's `/health`"** (l.664-665). I grepped the whole file for `sibling` / `refuse` /
  `/health` / `/ready`: no leftover clause makes the BFF refuse on missing URL, and no clause treats
  `/ready` as a BFF-listener sibling. The only other `sibling` token (l.13) is unrelated (REQ-ID
  namespacing).

- **MJ2 (target field names) — RESOLVED.** §3 (l.138-140) and REQ-F004-031 explicitly derive from the
  event **name** plus a **named** `target` field (`target.id`, `target.workspace`), and call out that
  no literal `target.workspaceId`/`target.userId` field exists. Matches grounding.

- **MN1 (lease TTL/renewal/fencing) — RESOLVED** (one loose test edge, see N4). REQ-F004-017 (l.352-359)
  now requires a **TTL + periodic renewal**, declares an expiry/GC-pause overlap **tolerated** (absorbed
  as a same-delivery-id re-delivery), reframes the invariant as **single-writer-of-`markPublished`-per-row
  backed by dedupe**, and makes a fencing token OPTIONAL. Internally coherent.

- **MN2 (post-ack `markPublished`-failure cap→park) — PARTIALLY RESOLVED; the fix introduced a new
  contradiction.** See **B1 (new)** below. The cap/attempt-increment half is added, but the claimed
  outcome ("its key resumes … never a permanently wedged key") conflicts with the spec's own head-of-line
  rule.

- **MN3 (two-process SQLite/WAL) — RESOLVED at the model level** (one residual gap, see N3).
  REQ-F004-020 (l.499-509) names the two-processes-one-file model, requires same path + WAL +
  single-drainer, and correctly retires the "DB advisory lock" phrasing for SQLite.

- **MN4 (raw_env → instance) — RESOLVED.** `admin.raw_env.*` now shares the `instance` key (§3 l.154-156;
  REQ-F004-031 l.736). MN5 (membership caveat) — RESOLVED; caveat added at §3 l.150-152.

---

## Part 2 — Fresh findings

### Blocking

#### B1 (new) — [CONTRADICTION] REQ-F004-011 post-ack park "its key resumes" vs REQ-F004-014/041/042 "a parked row stalls its key until resolved"
REQ-F004-011 (l.249-254) bounds a persistent post-ack `markPublished` failure by parking the row:
"after the cap the row is **parked** … so it stops re-delivering and **its key resumes** … **never a
permanently wedged key**." But a post-ack-parked row keeps `published_at IS NULL` (the mark *failed*)
and sets `parked_at`. Under the eligibility/head-of-line rules that is an "older **unpublished-or-parked**
row" on its key:
- REQ-F004-041 (l.275-277): "a row is **not** eligible if an older row on its key is unpublished
  (whether mid-backoff or **parked**)."
- REQ-F004-014 (l.448-450): a parked row's key "subsequent rows are **held** … **until the parked row is
  resolved/replayed**."
- REQ-F004-042 (l.306-308): "parked: **until** the poison row is resolved/replaced/replayed."

So for any **keyed** row (e.g. `ws:5`), parking the post-ack-failed row **stalls that key until an
operator intervenes** — it does **not** "resume," and the key **is** wedged (pending manual
resolution), directly contradicting REQ-F004-011's two claims. Two divergent implementations both cite
the page:
- **Reading A (REQ-F004-011):** parking the post-ack row lets its key keep flowing.
- **Reading B (REQ-F004-014/041/042):** the parked row blocks its key's later rows until resolved.

These cannot both hold. This defeats the very goal MN2 raised (the "permanently stalled key"): parking
stops the infinite *re-delivery loop* but does **not** unwedge the key. Resolution requires the author to
pick a mechanism the head-of-line rule actually supports — e.g. on post-ack cap **mark the row published**
(its effect was acked, so `published_at` may be set, which both stops re-delivery *and* unblocks the key),
or explicitly **exempt** post-ack-parked rows from head-of-line, or drop the "its key resumes / never a
permanently wedged key" claim and accept the stall. As written, REQ-F004-011 and REQ-F004-014/041/042
conflict. **BLOCKING.**

### Major

#### MJ-A — [GAP/AMBIGUOUS] NULL `ordering_key` for pre-migration / lazily-populated backlog rows is unhandled by the eligibility query, undermining REQ-F004-015 backfill order
REQ-F004-029 (l.591) permits `ordering_key` to be "populated at enqueue **or lazily on first drain**,"
and the migration adds the column without a stated requirement to backfill it for rows already present.
The first-connection backfill (REQ-F004-015, l.483-487) explicitly replays the **pre-F-004 accumulated
backlog** — rows written by the grounded enqueue-only `OutboxRelayBus.publish` (`bus.ts:31-33`) **before
the `ordering_key` column existed**, so their `ordering_key` is NULL. The eligibility query
(REQ-F004-041) tests "no older row **shares the same `ordering_key`**" via a self-join/EXISTS on
`ordering_key`. Under SQL semantics `NULL = NULL` is not true, so:
- **Reading A:** every NULL-key row is independently eligible (behaves like `__unkeyed__`), so the entire
  pre-migration backlog is drained with **no per-key ordering** — contradicting REQ-F004-015's own test
  assertion "per-key order holds within each key" on first-connection backfill.
- **Reading B:** the relay must compute `ordering_key` from the stored envelope **before** running the
  eligibility query — but "lazily on first drain" is circular (the drain *selection* is what needs the
  key), and nothing requires the migration to backfill it.

The behavior on `ordering_key IS NULL` during eligibility, and whether the migration backfills existing
unpublished rows, is unspecified. Because it affects a headline §6.3 behavior (backfill) and REQ-F004-041,
this should be resolved (state that the migration/enqueue populates `ordering_key` for all rows from the
persisted envelope, and define eligibility on a NULL key).

### Notes (non-blocking)

- **N1 — [NOTE] REQ-F004-021/039 rationale mischaracterizes the grounded `InProcessBus`.** REQ-F004-021
  (l.553-555) justifies the BFF hard-refuse by claiming a non-`bus` mode "would **not durably enqueue** to
  `event_outbox` at all," and REQ-F004-039 (l.794) says it "silently runs the interim in-proc bus and
  **drops events**." Grounded `InProcessBus.publish` (`bus.ts:19-24`) **does** `outboxRepo.insert(...)`
  then `markPublished` immediately — it enqueues and marks published, it just never delivers to a real
  cross-process transport (only a zero-subscriber in-proc `EventEmitter`). The *requirement* (BFF refuses
  on non-`bus` in prod) is clear and testable regardless, but the stated rationale is inaccurate; more
  importantly the real hazard it should name is that inproc rows are **marked published without real
  delivery**, so a later switch to `bus` mode will **not** re-drain them (they already have `published_at`
  set) — a silent-loss mode the current wording obscures.

- **N2 — [NOTE] `parked_at` now carries two incompatible meanings.** REQ-F004-014 (l.446) defines a
  parked row as "delivered **zero times** but retained," whereas the MN2 post-ack park (REQ-F004-011
  l.253) is a row "whose effect **already delivered at-least-once** and deduped." The single `parked_at`
  marker and the parked-count alert metric (REQ-F004-025) conflate poison (never delivered) with
  post-ack-parked (delivered), so an operator cannot tell from the marker whether the event reached the
  consumer. Consider a distinguishing flag / reason. (Tightly coupled to B1.)

- **N3 — [NOTE] Two-writer SQLite contention (SQLITE_BUSY) is unaddressed; WAL only solves
  reader/writer.** REQ-F004-020 (l.502-504) claims WAL means "a reader/drainer and the enqueuing writer
  do not block each other," but the relay is also a **writer** (`markPublished`/park/`attempt_count`,
  l.501). SQLite still serializes writer-vs-writer, so the BFF INSERT and relay bookkeeping writes can
  return `SQLITE_BUSY`. No `busy_timeout`/retry policy is specified, and — with B1/MN2 in play — a
  transient `SQLITE_BUSY` on the post-ack `markPublished` could be misclassified as a mark failure and
  count toward the park cap, wrongly parking a delivered row. Name the write-contention posture.

- **N4 — [NOTE] REQ-F004-017 test vs its own overlap tolerance.** The test (l.362-366) asserts "**only
  one** delivers a given row per successful pass," while the overlap paragraph (l.356-359) tolerates two
  holders both delivering the same row across a lease-expiry/GC gap. These are nominal-path vs
  tolerated-exception and survive via dedupe, but the test's universal phrasing slightly overstates the
  guarantee; scoping it to "under a held lease / single instance" would remove the tension.

- **N5 — [NOTE] Totality edge: rule-matching event with a missing id field.** The derivation says
  `admin.workspace.*` → `ws:<target.id>` unconditionally, and separately routes events with "no natural
  id" to `__unkeyed__` (§3 l.157). It is unstated what happens to a **prefix-matching** event whose
  `target.id` is absent — literal `ws:undefined` (a shared blocking partition) vs `__unkeyed__`
  (independent). No observable divergence today (every grounded emit site populates the required field),
  so this is defensive only, but the "total function" framing invites the question.

---

## Verdict

**BLOCK (revise).** The rev-3 blocking pair (BR1 `__unkeyed__` independence, BR2 total derivation) and
both majors (MJ1 boot/ready topology split, MJ2 target field names) are genuinely and consistently
resolved and grounded against the real catalog and emit sites. However the **MN2 fix introduced a new
blocking contradiction (B1):** REQ-F004-011 claims a post-ack-parked row lets "its key resume," while the
spec's own head-of-line rules (REQ-F004-014/041/042) hold that any parked keyed row stalls its key until
manually resolved — so MN2's stated goal ("never a permanently wedged key") is not met by the chosen
mechanism. Resolve B1 (mark-published-on-post-ack-cap, or exempt-from-head-of-line, or correct the
wording), and address MJ-A (NULL `ordering_key` handling for the backfill/backlog that REQ-F004-015 must
replay in per-key order). N1–N5 are non-blocking.
