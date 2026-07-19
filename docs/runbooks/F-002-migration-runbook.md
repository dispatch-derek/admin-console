# Runbook — F-002 baseline-prompt schema migration

Spec: `specs/F-002-customer-system-prompt.md` (rev 9) §4 Data Model
(REQ-F002-010/010a/010c/010d, REQ-F002-051).
Design: `docs/design/07-F002-baseline-prompt.md` §2.
Owning code: the idempotent `migrate()` / `rollbackF002()` in `bff/src/store/db.ts` (see the inline
comments there for the exact table/column definitions — not restated here).
Test: `bff/test/store/baseline-migration.test.ts`.

## Order of operations

This store has **no external migration runner**. Forward migrations are the idempotent `migrate()` in
`bff/src/store/db.ts`, run at every boot (and again by `buildApp()`).

Forward: nothing manual. Deploy the code; `migrate()` runs at boot and is a no-op on a store that
already has the F-002 tables. On a fresh store it creates them.

Rollback: from a Node context with the BFF env loaded, import and call `rollbackF002()`
(e.g. `node -e "import('./dist/store/db.js').then(m => m.rollbackF002())"` after `npm run build`, with
`DB_PATH` pointing at the target store), OR run the two `DROP TABLE IF EXISTS` statements against the
SQLite file directly. Then redeploy the pre-F-002 code so `migrate()` does not immediately re-create
the tables on the next boot.

## Locking / duration

- All operations are DDL on an embedded single-file SQLite store (WAL mode) sized for a single-tenant,
  ≤200-workspace deployment (REQ-F002-058). Both `CREATE TABLE IF NOT EXISTS` statements target empty
  tables, and `ADD COLUMN composition_mode TEXT` is an O(1) catalog-only change (no default to
  backfill). Expected duration: sub-millisecond.
- Locking: SQLite takes a brief write lock for the DDL transaction. The BFF is the sole writer of this
  file; the window is negligible. No expand/migrate/contract phasing is needed — this is purely
  additive and greenfield.

## Verification queries

After forward migration:

```sql
SELECT name FROM sqlite_master WHERE type='table'
  AND name IN ('baseline_prompt','workspace_baseline_state');   -- expect 2 rows
PRAGMA table_info(workspace_baseline_state);                    -- composition_mode present,
                                                                 -- type TEXT, notnull 0, dflt_value NULL
PRAGMA table_info(baseline_prompt);                             -- id is pk=1
```

`composition_mode`'s `dflt_value` MUST read **NULL** (not `'append'` or any literal): NULL is a real,
distinguishable state ("F-003 has not tracked this workspace"), not a stand-in for `'append'`. A row
inserted without naming `composition_mode` MUST read back NULL. Both are asserted in the test.

After rollback: the same `sqlite_master` query returns **0 rows**; `audit_log`, `workspace_map`, etc.
are untouched.

## Rollback procedure & data-loss note

- **Greenfield today:** there is no F-002 (or F-003) data in any environment yet, so running
  `rollbackF002()` now destroys nothing.
- **Once real data exists:** rollback drops console-owned baseline text and per-workspace tracking
  state (remainder + applied hashes + any F-003 `composition_mode`). It does **NOT** touch engine-side
  workspace prompts — the console never stores the live prompt as authoritative (REQ-F002-010a), so
  already-applied prompts remain on the engine; only the console's ability to recompose/detect drift
  is lost. Treat a post-data rollback as **destructive to tracking state** and gate it on explicit
  human confirmation (back up the SQLite file first). This is also called out in the `rollbackF002()`
  doc comment.

## Direction test evidence

`bff/test/store/baseline-migration.test.ts` exercises up → verify schema + data → down
(`rollbackF002`) → verify removal (F-002 tables gone, unrelated tables intact) → up again → verify
restoration (identical shape, singleton constraint, `composition_mode` still nullable/no-default).
Data-preservation across a re-run of `migrate()` is asserted (a seeded row survives the idempotent
additive ALTER).
