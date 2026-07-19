// Seeds/reads a real SQLite outbox DB file, matching the F-004 `event_outbox` / `outbox_meta`
// contract documented in migrations/NOTES-F004.md and bff/src/store/db.ts's CREATE TABLE block.
// Deliberately does NOT import bff/src/** (E2E tests exercise the relay only through its real,
// documented seams: a DB file on disk and HTTP) -- this is the "user"-facing contract a DB
// migration is allowed to add columns to but not silently rename/drop.
//
// When the relay child process boots it runs its own (bff/src/store/db.ts) migrate() against the
// same file, which is additive/idempotent, so pre-creating this minimal shape here and letting the
// relay's own migration run afterward is safe and mirrors a real upgrade.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SeedRow {
  ts?: string; // ISO timestamp; defaults to now
  envelope: string;
  orderingKey: string | null;
  publishedAt?: string | null;
  parkedAt?: string | null;
  nextAttemptAt?: string | null;
  attemptCount?: number;
  lastError?: string | null;
  ackedAt?: string | null;
}

export function makeEnvelope(event: string, target: Record<string, unknown>): string {
  return JSON.stringify({
    event,
    actor: 'e2e-test',
    target,
    changes: undefined,
    verified: true,
    timestamp: new Date().toISOString(),
    payload: undefined,
  });
}

export class OutboxTestDb {
  readonly path: string;
  readonly epoch: string;
  private readonly db: Database.Database;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_outbox (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ts              TEXT NOT NULL,
        envelope        TEXT NOT NULL,
        published_at    TEXT,
        ordering_key    TEXT,
        attempt_count   INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error      TEXT,
        parked_at       TEXT,
        acked_at        TEXT
      );
      CREATE TABLE IF NOT EXISTS outbox_meta (
        id    INTEGER PRIMARY KEY CHECK (id = 1),
        epoch TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_eligible
        ON event_outbox (ordering_key, id)
        WHERE published_at IS NULL AND parked_at IS NULL;
    `);
    this.db.prepare(`INSERT OR IGNORE INTO outbox_meta (id, epoch) VALUES (1, ?)`).run(randomUUID());
    this.epoch = (this.db.prepare(`SELECT epoch FROM outbox_meta WHERE id = 1`).get() as { epoch: string }).epoch;
  }

  seed(row: SeedRow): number {
    const info = this.db
      .prepare(
        `INSERT INTO event_outbox
           (ts, envelope, published_at, ordering_key, attempt_count, next_attempt_at, last_error, parked_at, acked_at)
         VALUES (@ts, @envelope, @published_at, @ordering_key, @attempt_count, @next_attempt_at, @last_error, @parked_at, @acked_at)`,
      )
      .run({
        ts: row.ts ?? new Date().toISOString(),
        envelope: row.envelope,
        published_at: row.publishedAt ?? null,
        ordering_key: row.orderingKey,
        attempt_count: row.attemptCount ?? 0,
        next_attempt_at: row.nextAttemptAt ?? null,
        last_error: row.lastError ?? null,
        parked_at: row.parkedAt ?? null,
        acked_at: row.ackedAt ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  deliveryId(rowId: number): string {
    return `${this.epoch}:${rowId}`;
  }

  row(id: number): Record<string, unknown> | undefined {
    return this.db.prepare(`SELECT * FROM event_outbox WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
  }

  allRows(): Array<Record<string, unknown>> {
    return this.db.prepare(`SELECT * FROM event_outbox ORDER BY id ASC`).all() as Array<
      Record<string, unknown>
    >;
  }

  unpublishedCount(): number {
    return (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE published_at IS NULL AND parked_at IS NULL`)
        .get() as { n: number }
    ).n;
  }

  close(): void {
    this.db.close();
  }
}
