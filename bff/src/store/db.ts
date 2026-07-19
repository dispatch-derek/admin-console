// better-sqlite3 handle + idempotent migrations (03-data-models.md). One file, WAL mode,
// synchronous API suited to Fastify handlers. Creates the parent dir if missing.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
// Resolve the shared DB path WITHOUT importing the secret-requiring BFF config (F-004
// REQ-F004-033/045): the separate relay process shares this DB and must open it with only
// DB_PATH set, never the BFF's ANYTHINGLLM_*/SESSION_SECRET/SECRETS_ENC_KEY. See db-path.ts.
import { dbPath } from './db-path.js';
// Shared derivation for the one-time ordering_key backfill below (REQ-F004-029/015). Safe to
// import here: ordering-key.ts is a pure, dependency-free leaf module (no imports of its own), so
// pulling it into the migration introduces no cycle and — unlike config.ts — cannot transitively
// drag secret-requiring env into the relay's boot chain (relay/index → outbox.repo → db.ts). See
// ordering-key.ts's header for the full single-source-of-truth rationale.
import { deriveOrderingKey } from '../events/ordering-key.js';

// Ensure the parent directory exists before opening the DB file.
mkdirSync(dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// F-004 (REQ-F004-020): two writers now share this file — the BFF and the separate outbox
// relay process. busy_timeout makes a writer BLOCK briefly on a held write lock instead of
// erroring SQLITE_BUSY immediately; a transient contention retries under the wait rather than
// failing. 5000ms is the design's transient-contention window (design §3.1 / §5).
// NOTE FOR IMPLEMENTER: the RELAY opens its OWN connection to this DB file (bff/src/relay/*);
// it MUST set this same `busy_timeout` pragma on that connection — this line only covers the
// BFF's handle. The pragma is per-connection, not stored in the file.
db.pragma('busy_timeout = 5000');

// ── F-004 one-time ordering_key backfill (REQ-F004-029/015) ─────────────────────────────────
// The ordering key derives from PARSING each stored envelope JSON (event name + a named target
// field), so it cannot be computed in pure SQL. deriveOrderingKey (imported above) is the single
// source of truth for this derivation, shared with the enqueue path (OutboxRelayBus.publish) — see
// ordering-key.ts's header for why the two must never diverge. This wrapper only adds the
// migration-specific concern: the backfill reads the envelope as a raw JSON string off disk, so it
// must parse it first, and a malformed/unparseable row must still resolve totally rather than abort
// the migration (REQ-F004-029 N4).
const UNKEYED = '__unkeyed__';

function deriveOrderingKeyForBackfill(envelopeJson: string): string {
  let env: unknown;
  try {
    env = JSON.parse(envelopeJson);
  } catch {
    return UNKEYED; // unparseable envelope → never abort, never NULL (REQ-F004-029 N4)
  }
  return deriveOrderingKey(env as { event?: unknown; target?: unknown });
}

// Backfill in BATCHES so a large pre-F-004 backlog (≥10k rows, REQ-F004-027) is not rewritten
// under one long-held write lock — important under two-writer BFF+relay contention
// (REQ-F004-020). Guarded on `ordering_key IS NULL`, so it is restart-safe (re-runnable after a
// partial failure), idempotent, and a no-op once complete.
function backfillOrderingKeys(): void {
  const selectBatch = db.prepare(
    `SELECT id, envelope FROM event_outbox WHERE ordering_key IS NULL ORDER BY id LIMIT 500`,
  );
  const update = db.prepare(
    `UPDATE event_outbox SET ordering_key = ? WHERE id = ? AND ordering_key IS NULL`,
  );
  const applyBatch = db.transaction((rows: Array<{ id: number; envelope: string }>) => {
    for (const r of rows) update.run(deriveOrderingKeyForBackfill(r.envelope), r.id);
  });
  for (;;) {
    const rows = selectBatch.all() as Array<{ id: number; envelope: string }>;
    if (rows.length === 0) break;
    applyBatch(rows);
  }
}

// Idempotent schema: every statement uses IF NOT EXISTS so migrate() is safe to
// re-run on every boot. Columns/types mirror 03-data-models.md exactly.
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      id                TEXT PRIMARY KEY,
      username          TEXT UNIQUE NOT NULL,
      password_hash     TEXT,
      totp_secret       TEXT,
      mfa_enrolled      INTEGER NOT NULL DEFAULT 0,
      disabled          INTEGER NOT NULL DEFAULT 0,
      must_set_password INTEGER NOT NULL DEFAULT 0,
      -- Brute-force lockout + TOTP replay guard (sec review H-1).
      failed_attempts   INTEGER NOT NULL DEFAULT 0,
      locked_until      TEXT,
      last_totp_step    INTEGER,
      created_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recovery_codes (
      id        TEXT PRIMARY KEY,
      staff_id  TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      used_at   TEXT,
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      staff_id   TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS login_challenges (
      id         TEXT PRIMARY KEY,
      staff_id   TEXT NOT NULL,
      stage      TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS workspace_map (
      product_id        TEXT PRIMARY KEY,
      engine_slug       TEXT UNIQUE NOT NULL,
      engine_numeric_id INTEGER,
      display_name      TEXT,
      created_at        TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      TEXT NOT NULL,
      actor   TEXT,
      action  TEXT NOT NULL,
      target  TEXT,
      outcome TEXT NOT NULL,
      detail  TEXT
    );

    CREATE TABLE IF NOT EXISTS event_outbox (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ts           TEXT NOT NULL,
      envelope     TEXT NOT NULL,
      published_at TEXT,
      -- F-004 delivery bookkeeping (REQ-F004-029/038). Declared here so a FRESH DB reaches the
      -- final shape via CREATE, AND repeated in the PRAGMA-guarded additive list below so a
      -- PRE-F-004 DB reaches the same shape via ALTER — mirroring the staff.failed_attempts
      -- pattern. This is DELIVERY state only: the transactional INSERT path (REQ-F004-005) and
      -- the frozen event contract (REQ-F004-004) are unchanged; new rows populate these at INSERT.
      ordering_key    TEXT,                       -- per-key partition (REQ-F004-031); backfilled non-null; a NULL is read as '__unkeyed__'
      attempt_count   INTEGER NOT NULL DEFAULT 0, -- delivery + persistent post-ack-mark failures; NOT reset on ack (REQ-F004-011/013)
      next_attempt_at TEXT,                       -- NULL ⇒ immediately eligible; else ISO time it becomes eligible again (REQ-F004-013/041)
      last_error      TEXT,                       -- last delivery/mark error; NO secret values (REQ-F004-013/028)
      parked_at       TEXT,                       -- non-null ⇒ isolated, never-fully-acked poison; excluded from eligibility (REQ-F004-014)
      acked_at        TEXT                        -- non-null ⇒ transport fully acked ≥ once; routes the post-ack cap (REQ-F004-011)
    );

    -- F-004 delivery-id epoch (REQ-F004-048). Singleton (CHECK id=1) holding a UUID generated
    -- ONCE per event_outbox provisioning, constant for the DB lifetime, so the transport delivery
    -- id "<epoch>:<row-id>" (REQ-F004-018) stays globally unique across a DB rebuild that recycles
    -- SQLite rowids. Seeded idempotently via INSERT OR IGNORE after this block.
    CREATE TABLE IF NOT EXISTS outbox_meta (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      epoch TEXT NOT NULL
    );

    -- F-002 customer-wide baseline system prompt (spec §4, REQ-F002-010/010a/010c/010d).
    -- Console-OWNED data (boundary rule 3, 03-data-models.md): the engine stays authoritative
    -- for the live workspace prompt; these tables hold only the baseline and the tracking
    -- state needed to recompose and detect drift. NO 'current_prompt' column is stored — the
    -- live prompt is always re-read from the engine (REQ-F002-010a).

    -- Singleton: at most one logical baseline (one deployment == one customer). The fixed PK
    -- ('singleton') plus upsert in the repo guarantees at-most-one row. No row / text NULL =
    -- baseline never defined or cleared (REQ-F002-046).
    CREATE TABLE IF NOT EXISTS baseline_prompt (
      id         TEXT PRIMARY KEY,   -- fixed singleton key (repo always uses 'singleton')
      text       TEXT,               -- the baseline; NULL = never defined / cleared
      updated_at TEXT,               -- ISO-8601
      updated_by TEXT                -- staff id (parent REQ-029c actor)
    );

    -- One row per workspace the console has applied to (opaque product handle PK).
    -- remainder / applied_* are F-002-owned (co-written by F-003's editor per REQ-F002-010d).
    -- composition_mode is added additively below (REQ-F002-010d) — schema-defined here but
    -- semantically F-003-owned and read-only for F-002; deliberately NOT in this CREATE so a
    -- fresh DB and an upgraded DB reach byte-identical shape via the same additive ALTER.
    CREATE TABLE IF NOT EXISTS workspace_baseline_state (
      workspace_id          TEXT PRIMARY KEY,  -- opaque product handle (parent REQ-021b)
      remainder             TEXT,              -- stored remainder; NULL/'' = no per-ws portion
      applied_composed_hash TEXT,              -- lowercase-hex SHA-256 of last-written composed (REQ-F002-010c)
      applied_baseline_hash TEXT,              -- lowercase-hex SHA-256 of baseline at last apply (REQ-F002-010c)
      applied_at            TEXT               -- ISO-8601
    );

    -- F-005 per-customer feature-toggle overrides (spec §4, REQ-F005-012..015; design
    -- docs/design/08-F005-feature-toggle-console.md §2). Console-OWNED data (boundary rule 3): this
    -- feature makes NO engine call — the store is the sole system of record.
    --
    -- ONE row per feature the operator has EXPLICITLY set (an override). The declared feature catalog
    -- (§5) is NEVER copied here as authoritative (REQ-F005-013): effective state is always computed
    -- from the CURRENT catalog + this override, never a cached snapshot. A feature with no row = "no
    -- override" → resolves to its catalog default (REQ-F005-017).
    --
    -- PK = the stable global catalog featureKey (REQ-F005-015/016/018), NOT an install-local surrogate
    -- id — the minimal forward-compat measure so this install's override set is a clean single-tenant
    -- slice a future central plane could aggregate without a data migration (REQ-F005-050). No tenant id.
    --
    -- feature_key is an OPAQUE string matched BYTE-FOR-BYTE (REQ-F005-018/028): plain TEXT PRIMARY KEY,
    -- deliberately NO COLLATE NOCASE and no normalization, so keys differing only in case/bytes are
    -- distinct rows. The repo writes it via INSERT ... ON CONFLICT(feature_key) DO UPDATE (last-writer-
    -- wins upsert, REQ-F005-021), which this exact PK supports.
    --
    -- NO foreign key to any catalog table — there IS no catalog table (the catalog is an in-memory,
    -- deployment-provided manifest, never persisted). An override whose key later leaves the catalog is
    -- an ORPHAN: it is RETAINED here (never auto-deleted), just excluded from the active list and counts
    -- (REQ-F005-014/025). History/audit is NOT in this table — it lives in the existing append-only
    -- audit_log (parent REQ-093/093a), reused verbatim with no schema change for this feature.
    CREATE TABLE IF NOT EXISTS feature_toggle_state (
      feature_key TEXT PRIMARY KEY,   -- stable global catalog featureKey; opaque, matched literally (REQ-F005-015/016/018)
      enabled     INTEGER NOT NULL,   -- 0/1 explicit operator override (REQ-F005-012)
      updated_at  TEXT NOT NULL,      -- ISO-8601 of the override write
      updated_by  TEXT NOT NULL       -- staff id (parent REQ-029c actor)
    );
  `);

  // Additive column migrations for databases created before these columns existed. SQLite
  // has no "ADD COLUMN IF NOT EXISTS", so guard on PRAGMA table_info. Fresh DBs already have
  // them from the CREATE TABLE above, so this is a no-op there. (sec review H-1)
  const additive: Array<[string, string, string]> = [
    ['staff', 'failed_attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['staff', 'locked_until', 'TEXT'],
    ['staff', 'last_totp_step', 'INTEGER'],
    ['login_challenges', 'attempts', 'INTEGER NOT NULL DEFAULT 0'],
    // F-002 REQ-F002-010d — the shared composition_mode column. Added with a bare `TEXT`
    // definition and NO SQL-level DEFAULT clause: NULL is a real, distinguishable state
    // ("F-003 has not tracked this workspace"), NOT a stand-in for 'append'. Every existing
    // row therefore stays NULL after this ALTER, and F-002 stays byte-identical to rev 3.
    // F-002 is the schema-definer but NEVER writes/defaults/normalizes this column (that is
    // F-003's ownership); it only reads it null-safely. Forward-compatible with F-003 landing
    // later: F-003 adds its own read/write/validate on the same column with no further
    // migration to this column's default behavior. DO NOT change this to `TEXT DEFAULT ...`.
    ['workspace_baseline_state', 'composition_mode', 'TEXT'],
    // F-004 delivery-bookkeeping columns for DBs created before F-004 (REQ-F004-029/038).
    // ordering_key is added NULLABLE here and then backfilled non-null below (it cannot carry a
    // SQL default — the value is derived per-row from the stored envelope). Adding
    // `attempt_count INTEGER NOT NULL DEFAULT 0` via ALTER back-fills every existing row with 0.
    ['event_outbox', 'ordering_key', 'TEXT'],
    ['event_outbox', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['event_outbox', 'next_attempt_at', 'TEXT'],
    ['event_outbox', 'last_error', 'TEXT'],
    ['event_outbox', 'parked_at', 'TEXT'],
    ['event_outbox', 'acked_at', 'TEXT'],
  ];
  for (const [table, column, definition] of additive) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // F-004: eligibility partial index over the LIVE working set (REQ-F004-029/041). Partial
  // (published_at IS NULL AND parked_at IS NULL) so it indexes only undelivered, non-parked
  // rows — keeping the relay's per-key "oldest undelivered row" selection cheap even against a
  // ≥10k backfill (REQ-F004-027). Created after the additive loop so ordering_key/parked_at exist.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_outbox_eligible
      ON event_outbox (ordering_key, id)
      WHERE published_at IS NULL AND parked_at IS NULL;
  `);

  // F-004 perf (REQ-F004-027/034). selectEligible was O(TOTAL table size), not O(backlog): retained
  // PUBLISHED rows (7-day retention) bloated the outer scan into a full-table SCAN, and the per-key
  // head-of-line subquery fell back to a rowid range scan — median 4.5ms @5k rows → 4851ms @205k.
  // The two additional partial indexes below make selectEligible index-driven and FLAT as published
  // rows accumulate (EXPLAIN: SCAN o USING INDEX idx_outbox_live_id + SEARCH e USING INDEX
  // idx_outbox_unpublished_key; no full-table scan). The eligibility QUERY is UNCHANGED — semantics
  // (per-key strict order, __unkeyed__ independence, parked-blocks-its-own-key) are preserved exactly.
  //  • idx_outbox_live_id: id-ordered over ONLY eligible (unpublished, non-parked) rows, so the outer
  //    drive scan (WHERE published_at IS NULL AND parked_at IS NULL, ORDER BY id ASC) touches just the
  //    live working set — no sort, no full-table scan.
  //  • idx_outbox_unpublished_key: (ordering_key, id) over UNPUBLISHED rows INCLUDING parked ones. Its
  //    partial predicate is `published_at IS NULL` ONLY (deliberately NOT parked_at), matching the
  //    subquery's `e.published_at IS NULL` exactly — so a parked older row is still found as a blocker
  //    and continues to stall its own key (REQ-F004-014/042). Adding parked_at here would let SQLite
  //    use the index but would DROP parked rows from the blocker set, silently breaking that ratified
  //    semantic; this predicate keeps correctness while still being index-driven.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_outbox_live_id
      ON event_outbox (id)
      WHERE published_at IS NULL AND parked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_outbox_unpublished_key
      ON event_outbox (ordering_key, id)
      WHERE published_at IS NULL;
  `);

  // F-004: seed the delivery-id epoch exactly once (REQ-F004-048). INSERT OR IGNORE is idempotent
  // — generated on the FIRST migrate() that runs this, then never changed (the CHECK(id=1) row is
  // the single source of truth for the DB's lifetime).
  db.prepare(`INSERT OR IGNORE INTO outbox_meta (id, epoch) VALUES (1, ?)`).run(randomUUID());

  // F-004: backfill ordering_key for every pre-existing row (REQ-F004-029/015 — the pre-F-004
  // unpublished backlog the first-connection replay must drain in per-key order). Runs AFTER the
  // additive ALTER added the column. Batched + guarded so it is restart-safe and idempotent, and
  // never leaves a NULL / never aborts on a malformed envelope. See backfillOrderingKeys().
  backfillOrderingKeys();

  // Append-only runtime guard for audit_log (REQ-093a): triggers raise on any
  // UPDATE/DELETE so no code path — accidental or otherwise — can mutate history.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
      BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
      BEFORE DELETE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  `);
}

// Down-migration (rollback) for the F-002 baseline-prompt schema (REQ-F002-010/010d).
// This codebase has no external migration runner: forward migrations are the idempotent
// `migrate()` above, run at boot. rollbackF002() is the matching DOWN direction — it removes
// exactly what the F-002 block of migrate() adds, and is what an operator runs to revert the
// F-002 schema change. It is idempotent (DROP ... IF EXISTS) and tested up→down→up.
//
// Scope: it drops BOTH F-002 tables. Dropping workspace_baseline_state necessarily drops the
// composition_mode column with it (SQLite cannot DROP a single column pre-3.35 without a
// table rebuild, and there is no partial-rollback requirement here — the whole F-002 schema
// is one unit). Because F-002 is greenfield (no data in any environment yet), this rollback
// destroys no production data today. Once real baseline/tracking data exists, running this is
// destructive to console-owned tracking state (NOT to engine prompts, which are never stored
// here) and must be gated on the operator confirmation described in the F-002 runbook.
export function rollbackF002(): void {
  db.exec(`
    DROP TABLE IF EXISTS workspace_baseline_state;
    DROP TABLE IF EXISTS baseline_prompt;
  `);
}

// Down-migration (rollback) for the F-005 feature-toggle schema (REQ-F005-012). Same convention as
// rollbackF002 above: this codebase has no external migration runner, so the DOWN direction is a
// documented function that removes exactly what the F-005 block of migrate() adds. It is idempotent
// (DROP … IF EXISTS) and tested up→down→up. It touches ONLY feature_toggle_state; audit_log,
// workspace_map, and every other table are left intact — F-005 added no column, index, or trigger
// anywhere else, and reuses audit_log verbatim with no schema change.
//
// DATA-LOSS NOTE — this is the feature's one IRREVERSIBLE step. Dropping feature_toggle_state destroys
// all operator-set enablement overrides (the console's SYSTEM OF RECORD for "which features are enabled
// for this customer," REQ-F005-001), INCLUDING retained orphan rows kept for audit/billing lineage
// (REQ-F005-014). There is no engine copy to recover from (F-005 makes no engine call, REQ-F005-003):
// once dropped, effective state silently reverts to catalog defaults for every feature. The audit_log
// history of who-set-what survives (it is a separate append-only table), but the live override state
// does not. On a store that holds real overrides, back up the SQLite file first and gate the drop on
// explicit human confirmation (see docs/F-005-migration-runbook.md). Greenfield today: no environment
// holds F-005 overrides yet, so running this now destroys nothing.
export function rollbackF005(): void {
  db.exec(`
    DROP TABLE IF EXISTS feature_toggle_state;
  `);
}

// Down-migration (rollback) for the F-004 event-bus delivery-bookkeeping schema
// (REQ-F004-029/038/048). Same convention as rollbackF002/F005: this codebase has no external
// migration runner, so the DOWN direction is a documented, idempotent function that removes
// EXACTLY what the F-004 block of migrate() adds. Tested up→down→up.
//
// Reverses via a TABLE REBUILD (not ALTER … DROP COLUMN) — deliberately:
//   1. DROP the eligibility partial index.
//   2. REBUILD event_outbox back to its original 4-column shape (id/ts/envelope/published_at),
//      copying every row and its EXPLICIT id. A rebuild is used instead of `ALTER TABLE … DROP
//      COLUMN` because DROP COLUMN rewrites the table's stored CREATE text; across repeated
//      up→down→up cycles (ADD COLUMN re-appends to the rewritten text, DROP COLUMN rewrites it
//      again) that accumulated text can become unparseable and SQLite raises "incomplete input".
//      The rebuild is deterministic and comment-immune. Ids are copied verbatim and AUTOINCREMENT
//      is preserved, so sqlite_sequence keeps the high-water mark — a later INSERT never reuses a
//      recycled id, keeping the delivery id "<epoch>:<row-id>" (REQ-F004-018) stable across a
//      round trip. event_outbox rows (the actual events) are fully PRESERVED — no emitted event
//      is lost.
//   3. DROP the outbox_meta epoch table.
//
// DATA-LOSS NOTE — IRREVERSIBLE bookkeeping/epoch loss; HUMAN-GATED on a live DB. On a store where
// the relay has run this destroys delivery state that cannot be reconstructed:
//   • parked_at / attempt_count / last_error — WHICH rows are poisoned and their retry history.
//     After rollback the relay can no longer distinguish a poison row from a fresh one.
//   • outbox_meta.epoch — dropping it and then re-running migrate() (up) generates a NEW epoch, so
//     every delivery id "<epoch>:<row-id>" CHANGES. Consumers dedupe on the delivery id
//     (REQ-F004-018), so already-processed rows can be RE-DELIVERED under new ids and processed
//     twice. If the epoch must be preserved across a temporary rollback, back it up first (see the
//     runbook) and re-seed the SAME value instead of letting up generate a fresh one.
//   • ordering_key is the ONE column that survives a round trip losslessly — the next up re-derives
//     it from each envelope, so no ordering information is permanently lost by dropping it.
// On a GREENFIELD DB (relay not yet deployed: all attempt_count=0, no parked rows, epoch unused)
// this destroys nothing operational. On a LIVE DB: back up the SQLite file first and gate on
// explicit human confirmation (migrations/NOTES-F004.md). Envelopes/published_at are NEVER touched,
// so this rollback NEVER loses an emitted event — only delivery bookkeeping.
export function rollbackF004(): void {
  const run = db.transaction(() => {
    // 1. Indexes first (the table rebuild in step 2 would drop them anyway, but drop explicitly to
    //    match the pattern and keep the reversal self-documenting). Includes the two F-004 perf
    //    indexes added for REQ-F004-027/034.
    db.exec(`
      DROP INDEX IF EXISTS idx_outbox_eligible;
      DROP INDEX IF EXISTS idx_outbox_live_id;
      DROP INDEX IF EXISTS idx_outbox_unpublished_key;
    `);
    // 2. Rebuild event_outbox to its original 4-column shape, preserving rows + ids. Idempotent:
    //    if the F-004 columns are already gone this simply recreates an identical 4-column table.
    db.exec(`
      DROP TABLE IF EXISTS event_outbox__f004_rollback;
      CREATE TABLE event_outbox__f004_rollback (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           TEXT NOT NULL,
        envelope     TEXT NOT NULL,
        published_at TEXT
      );
      INSERT INTO event_outbox__f004_rollback (id, ts, envelope, published_at)
        SELECT id, ts, envelope, published_at FROM event_outbox;
      DROP TABLE event_outbox;
      ALTER TABLE event_outbox__f004_rollback RENAME TO event_outbox;
    `);
    // 3. Drop the epoch singleton table.
    db.exec(`DROP TABLE IF EXISTS outbox_meta;`);
  });
  run();
}

// Run migrations at module load so the schema exists BEFORE any repository module
// prepares its statements (better-sqlite3 prepares eagerly and throws on a missing
// table). Idempotent — buildApp() also calls migrate() per the design (index.ts).
migrate();
