# Runbook — F-004 `event_outbox` delivery-bookkeeping migration

Spec: `specs/F-004-production-event-bus.md` (rev 10) — REQ-F004-029/038/048/011/013/014.
Design: `docs/design/09-F004-production-event-bus.md` §3.
Migration lives inline in `bff/src/store/db.ts` (this repo has no external migration runner;
forward = the idempotent `migrate()` run at boot, rollback = the `rollbackF004()` function —
same convention as `rollbackF002`/`rollbackF005`). Tests: `bff/test/store/f004-outbox-migration.test.ts`.

## What the forward migration does (in `migrate()`, in order)

1. Opens the DB with `PRAGMA busy_timeout = 5000` (added next to `journal_mode = WAL`).
2. `event_outbox`: adds 6 columns — `ordering_key TEXT`, `attempt_count INTEGER NOT NULL DEFAULT 0`,
   `next_attempt_at TEXT`, `last_error TEXT`, `parked_at TEXT`, `acked_at TEXT`. Added both in the
   `CREATE TABLE` (fresh DBs) and in the PRAGMA-guarded additive-ALTER list (existing DBs) — the
   `staff.failed_attempts` pattern.
3. Creates `outbox_meta(id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL)` and seeds one row
   with a generated UUID via `INSERT OR IGNORE` (the delivery-id epoch, REQ-F004-048). Idempotent —
   generated once, never overwritten.
4. Creates partial index `idx_outbox_eligible ON event_outbox(ordering_key, id) WHERE published_at
   IS NULL AND parked_at IS NULL`.
5. Backfills `ordering_key` for every row whose value is NULL (the pre-F-004 backlog), in batches of
   500, by parsing each stored `envelope` and applying the §3 derivation. Malformed/unparseable
   envelope or missing target field → `'__unkeyed__'`. Never leaves NULL, never aborts on a bad row.

`migrate()` is idempotent and safe to re-run on every boot.

## Order of operations for deploy (expand/contract; app stays up)

The schema change is **additive and online-safe**. Recommended phasing:

1. **Phase 1 — schema (this migration).** Deploy the `db.ts` change. On BFF boot `migrate()` adds
   the columns/table/index and backfills `ordering_key`. The BFF keeps enqueuing exactly as before
   (new bookkeeping columns take their defaults; `ordering_key` is backfilled). No reader/writer yet
   depends on the new columns, so this phase is safe to ship alone and to roll back.
2. **Phase 2 — enqueue writes the key (implementer, app code).** `OutboxRelayBus.publish` starts
   computing `ordering_key` at INSERT via the new `bff/src/events/ordering-key.ts`. Until this lands,
   new rows get `ordering_key = NULL` and are treated as `'__unkeyed__'` by readers (defensive), so
   there is no correctness gap — only reduced ordering for rows inserted between Phase 1 and Phase 2.
   Re-running `migrate()` (a boot) backfills any NULLs left by pre-Phase-2 inserts.
3. **Phase 3 — the relay drains** using `selectEligible` + the epoch. No further schema change.

## Locking / duration notes

- **ADD COLUMN** (steps 2): metadata-only in SQLite, O(1), takes a brief write lock. Not a table
  rewrite even for `attempt_count NOT NULL DEFAULT 0` (SQLite fills the default logically).
- **CREATE INDEX** (step 4): builds over the **partial** working set (unpublished, non-parked rows)
  only, so cost scales with the *undelivered* backlog, not total table size. Brief write lock.
- **`ordering_key` backfill** (step 5): the one data-transforming step. Batched at 500 rows per
  transaction so no single write lock is held for the whole table — important because the BFF and
  the relay are two writers on this file (`busy_timeout` covers contention). Duration driver = number
  of rows with NULL `ordering_key` (the pre-F-004 unpublished + retained-published backlog). At the
  REQ-F004-027 ≥10k backfill scale this is a few thousand small UPDATEs; expect sub-second to low
  seconds. Restart-safe: guarded on `ordering_key IS NULL`, so a partial run resumes cleanly.
- Whole migration runs at BFF startup before it serves traffic; there is no separate maintenance
  window required for a nominal single-instance deployment.

## Verification queries (after forward migration)

```sql
-- All six columns present:
PRAGMA table_info(event_outbox);
-- Epoch seeded exactly once, non-empty:
SELECT id, length(epoch) > 0 AS ok FROM outbox_meta;          -- expect (1, 1)
-- Backfill complete — MUST be zero:
SELECT COUNT(*) AS null_keys FROM event_outbox WHERE ordering_key IS NULL;   -- expect 0
-- Partial index present:
SELECT sql FROM sqlite_master WHERE name = 'idx_outbox_eligible';
-- Spot-check derivation (workspace_user keys on the workspace, not misparsed as workspace.*):
SELECT ordering_key, COUNT(*) FROM event_outbox GROUP BY ordering_key ORDER BY 2 DESC;
```

## Rollback procedure (`rollbackF004()`)

Reverses via a **table rebuild** (not `ALTER … DROP COLUMN`, which is fragile across repeated
up→down→up cycles — it rewrites the stored CREATE text and can raise "incomplete input"):
1. `DROP INDEX idx_outbox_eligible`.
2. Rebuild `event_outbox` to its original 4 columns (`id, ts, envelope, published_at`), copying every
   row and its **explicit id**; AUTOINCREMENT high-water mark preserved so new ids never recycle.
3. `DROP TABLE outbox_meta`.

Envelopes and `published_at` are never touched — **no emitted event is lost**. Idempotent.

### IRREVERSIBLE data-loss — HUMAN-GATED on a live DB

On a store where the **relay has run**, rollback destroys delivery state that cannot be
reconstructed. Do NOT run it on a live DB without explicit human confirmation and a file backup:

- `parked_at` / `attempt_count` / `last_error` — which rows are poison and their retry history.
- **`outbox_meta.epoch`** — dropping it, then the next `migrate()` (up), generates a **new** epoch, so
  delivery ids `"<epoch>:<row-id>"` change and consumers (which dedupe on the delivery id,
  REQ-F004-018) can re-process already-handled rows. If you must round-trip, back up the epoch first
  and re-seed the **same** value instead of letting up mint a fresh one:
  ```sql
  SELECT epoch FROM outbox_meta;                              -- save this BEFORE rollback
  -- after the next up: overwrite the freshly-minted epoch with the saved one
  UPDATE outbox_meta SET epoch = '<saved-epoch>' WHERE id = 1;
  ```
- `ordering_key` is the only dropped column that survives a round trip losslessly (re-derived from the
  envelope on the next up).

On a **greenfield** DB (relay not yet deployed: all `attempt_count = 0`, no parked rows, epoch
unused) rollback destroys nothing operational.

## Application changes required from the implementer (owned by the implementer, NOT this migration)

The migration only evolves the schema. The following app-code changes must land to use it:

1. **Create `bff/src/events/ordering-key.ts`** — the pure, total `deriveOrderingKey(envelope)` per
   design §3.3. The migration's one-time backfill **inlines a faithful copy** of this derivation in
   `db.ts` (`deriveOrderingKeyForBackfill`) because the module does not exist yet and this agent owns
   migrations, not app modules. **Keep the two byte-consistent** — if they diverge, pre-F-004 rows
   (keyed by the migration) and post-F-004 rows (keyed by the module) partition differently and the
   relay's per-key ordering silently breaks. Preferably make the module the single source of truth.
2. **`OutboxRelayBus.publish` (`bff/src/events/bus.ts`)** — compute `ordering_key` via
   `deriveOrderingKey` and pass it to `insert` (INSERT path only; still no delivery).
3. **`outbox.repo.ts`** — `insert()` must accept + write `ordering_key`; add the reader/writer methods
   the relay needs (`selectEligible`, `markAcked`, `recordFailure`, `park`, `forcePublish`, lag/backlog
   reads, and read `outbox_meta.epoch`). `listUnpublished` stays for tests only, never the drain source.
4. **Readers must treat a NULL `ordering_key` as `'__unkeyed__'`** (defensive; the migration
   guarantees non-null, but the eligibility query per design §3.4 already special-cases
   `ordering_key = '__unkeyed__' OR ordering_key IS NULL`).
5. **Delivery id** — the relay composes `"<outbox_meta.epoch>:<row-id>"` (REQ-F004-018/048); read the
   epoch once from `outbox_meta`.
6. **`busy_timeout` on the relay connection** — this migration sets `PRAGMA busy_timeout = 5000` on the
   **BFF** connection only. The separate relay process (`bff/src/relay/*`) opens its own connection and
   **must set the same pragma** — it is per-connection, not stored in the file.
