// better-sqlite3 handle + idempotent migrations (03-data-models.md). One file, WAL mode,
// synchronous API suited to Fastify handlers. Creates the parent dir if missing.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

// Ensure the parent directory exists before opening the DB file.
mkdirSync(dirname(config.dbPath), { recursive: true });

export const db: Database.Database = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
      published_at TEXT
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
  ];
  for (const [table, column, definition] of additive) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

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

// Run migrations at module load so the schema exists BEFORE any repository module
// prepares its statements (better-sqlite3 prepares eagerly and throws on a missing
// table). Idempotent — buildApp() also calls migrate() per the design (index.ts).
migrate();
