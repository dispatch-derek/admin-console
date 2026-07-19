// Seeds/reads a real SQLite outbox DB file, matching the F-004 `event_outbox` / `outbox_meta`
// contract documented in docs/runbooks/F-004-migration-runbook.md and bff/src/store/db.ts's CREATE TABLE block.
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

  rowExists(id: number): boolean {
    return this.row(id) !== undefined;
  }

  // ── store-unwritable journey support ──────────────────────────────────────────────────────────
  // The relay's own real write-probe (bff/src/store/repositories/outbox.repo.ts `isWritable()`) is
  // `UPDATE outbox_meta SET epoch = epoch WHERE id = 1` -- it succeeds iff that statement does not
  // throw. Dropping the table it targets, FROM THIS SEPARATE CONNECTION while the relay's own
  // connection stays open (same DB file, WAL mode -- both connections coexist normally), makes the
  // relay's next probe throw "no such table: outbox_meta" deterministically and instantly (no lock
  // contention / busy-timeout wait, unlike simulating this via a held write lock; and no OS-level
  // read-only-file gymnastics, which would instead fail relay/db.ts's `new Database(path)` itself at
  // process boot rather than surfacing as a live, recoverable 503 -- see boot-config test for that
  // failure mode). Restorable via restoreOutboxMeta() so the same test can also prove recovery.
  breakStoreWritability(): void {
    this.db.exec(`DROP TABLE outbox_meta`);
  }

  restoreOutboxMeta(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox_meta (
        id    INTEGER PRIMARY KEY CHECK (id = 1),
        epoch TEXT NOT NULL
      );
    `);
    this.db.prepare(`INSERT OR IGNORE INTO outbox_meta (id, epoch) VALUES (1, ?)`).run(this.epoch);
  }

  close(): void {
    this.db.close();
  }
}
