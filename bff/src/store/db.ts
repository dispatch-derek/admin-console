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
  `);

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

// Run migrations at module load so the schema exists BEFORE any repository module
// prepares its statements (better-sqlite3 prepares eagerly and throws on a missing
// table). Idempotent — buildApp() also calls migrate() per the design (index.ts).
migrate();
