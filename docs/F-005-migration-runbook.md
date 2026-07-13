# Runbook — F-005 feature-toggle schema migration

Spec: `specs/F-005-per-customer-feature-toggle-console.md` (Draft rev 3, ratified) §4 Data Model
(REQ-F005-012..015, REQ-F005-018/021/023/025).
Design: `docs/design/08-F005-feature-toggle-console.md` §2.
Owning code: the idempotent `migrate()` / `rollbackF005()` in `bff/src/store/db.ts` (see the inline
comments there for the exact table definition — not restated here).
Test: `bff/test/store/feature-toggle-migration.test.ts`.

## What this migration adds

One table, `feature_toggle_state` — one row per feature the operator has EXPLICITLY set (an override).
It is console-OWNED data (boundary rule 3); F-005 makes NO engine call (REQ-F005-003), so this store
is the sole system of record for "which features are enabled for this customer."

- PK is the stable global catalog `feature_key` (no install-local surrogate), the minimal
  forward-compat measure of REQ-F005-015/050. No tenant id is introduced.
- `feature_key` is opaque and matched byte-for-byte: plain `TEXT PRIMARY KEY`, **no `COLLATE NOCASE`,
  no normalization** (REQ-F005-018/028).
- No FK to any catalog table — **there is no catalog table** (the catalog is an in-memory,
  deployment-provided manifest, never persisted, REQ-F005-013). Orphan overrides (key no longer in
  the catalog) are RETAINED, never auto-deleted (REQ-F005-014/025).
- Last-writer-wins upsert is supported by the PK: the repo writes via
  `INSERT ... ON CONFLICT(feature_key) DO UPDATE` (REQ-F005-021).

**Audit/history is NOT in this table** and needs NO schema change: it reuses the existing append-only
`audit_log` (parent REQ-093/093a) verbatim. Confirmed present in `migrate()` with columns
`(id, ts, actor, action, target, outcome, detail)` and guarded by the `audit_log_no_update` /
`audit_log_no_delete` triggers; F-005 adds no column, index, or trigger to it. If a future change
needs a field `audit_log` does not have, that is a separate migration — not part of F-005.

## Order of operations

This store has **no external migration runner**. Forward migrations are the idempotent `migrate()` in
`bff/src/store/db.ts`, run at every boot (and again by `buildApp()`).

Forward: nothing manual. Deploy the code; `migrate()` runs at boot and is a no-op on a store that
already has `feature_toggle_state`. On a fresh store it creates the table. This is a purely additive,
single-phase change — no expand/migrate/contract phasing is needed (nothing is rewritten, no existing
table or column is touched, no backfill runs).

Rollback: from a Node context with the BFF env loaded, import and call `rollbackF005()`
(e.g. `node -e "import('./dist/store/db.js').then(m => m.rollbackF005())"` after `npm run build`, with
`DB_PATH` pointing at the target store), OR run `DROP TABLE IF EXISTS feature_toggle_state;` against
the SQLite file directly. Then redeploy the pre-F-005 code so `migrate()` does not immediately
re-create the table on the next boot.

## Locking / duration

- The forward change is a single `CREATE TABLE IF NOT EXISTS` on an embedded single-file SQLite store
  (WAL mode) sized for a single-tenant appliance (perf N: ≤500 declared features / ≤500 override rows,
  REQ-F005-040). It targets an empty table with no default to backfill and no index beyond the implicit
  PK. Expected duration: sub-millisecond.
- Locking: SQLite takes a brief write lock for the one DDL transaction. The BFF is the sole writer of
  this file; the window is negligible. Runtime toggle writes are single-row upserts/deletes — no
  full-table rewrite, no long lock.

## Verification queries

After forward migration:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='feature_toggle_state';  -- expect 1 row
PRAGMA table_info(feature_toggle_state);
-- expect exactly: feature_key TEXT pk=1 | enabled INTEGER notnull=1 | updated_at TEXT notnull=1 |
--                 updated_by TEXT notnull=1
```

`feature_key` MUST read as the primary key (`pk=1`) and there MUST be no `COLLATE NOCASE` on it: two
keys differing only in case are distinct rows (asserted in the test). A read for a key with no row
returns nothing = "no override" → the feature resolves to its catalog default (REQ-F005-017).

After rollback: the `sqlite_master` query returns **0 rows**; `audit_log`, `workspace_map`,
`baseline_prompt`, `workspace_baseline_state`, `staff`, `event_outbox` are untouched, and the
`audit_log` append-only triggers still fire.

## Rollback procedure & data-loss note (IRREVERSIBLE — human-gated)

Dropping `feature_toggle_state` is the feature's one **IRREVERSIBLE** step.

- **Greenfield today:** no environment holds F-005 overrides yet, so running `rollbackF005()` now
  destroys nothing.
- **Once real overrides exist:** the drop destroys ALL operator-set enablement overrides — the
  console's system of record for per-customer feature enablement (REQ-F005-001) — including retained
  orphan rows kept for audit/billing lineage (REQ-F005-014). There is **no engine copy to recover
  from** (F-005 makes no engine call, REQ-F005-003); after the drop, effective state silently reverts
  to catalog defaults for every feature. The `audit_log` history of who-set-what-when SURVIVES (it is a
  separate append-only table), so the change record is not lost — but the live override STATE is.
- Treat a post-data rollback as **destructive to override state** and gate it on explicit human
  confirmation: **back up the SQLite file first** (copy `DB_PATH` plus its `-wal`/`-shm` sidecars while
  the BFF is stopped), confirm the intent, then run the drop. This is also called out in the
  `rollbackF005()` doc comment.

## Direction test evidence

`bff/test/store/feature-toggle-migration.test.ts` exercises up → verify schema + data → down
(`rollbackF005`) → verify removal → up again → verify restoration, on a real tmp SQLite store:

- up: table created; exact columns + `feature_key` PK + NOT NULL constraints; no-row = no override;
  parameterized LWW upsert keeps one row and the last writer wins; raw duplicate INSERT is
  PK-rejected; case-differing and URL-reserved-byte keys stay distinct/verbatim (byte-for-byte,
  REQ-F005-018/028); delete removes a row and is an idempotent no-op when absent.
- idempotency: re-running `migrate()` twice does not throw and preserves a seeded row.
- down → up: `rollbackF005()` drops only `feature_toggle_state`, leaves `audit_log` (rows + append-only
  guard) and every other table intact, and is idempotent; `migrate()` afterwards restores the identical
  shape and the table is writable/PK-constrained again.

All 11 assertions GREEN; the full 47-test store suite stays GREEN alongside them.
