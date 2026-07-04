// event_outbox repository (transactional outbox — 04-cross-cutting.md §c). A row is
// written in the same transaction as the verify result; a relay drains unpublished rows
// to the real bus (REQ-029d). In inproc mode publish marks published_at immediately.

import { db } from '../db.js';

export interface OutboxRow {
  id: number;
  ts: string;
  envelope: string; // json AdminEventEnvelope
  published_at: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO event_outbox (ts, envelope, published_at)
   VALUES (@ts, @envelope, @published_at)`,
);
const markPublishedStmt = db.prepare(
  `UPDATE event_outbox SET published_at = ? WHERE id = ?`,
);
const listUnpublishedStmt = db.prepare(
  `SELECT * FROM event_outbox WHERE published_at IS NULL ORDER BY id ASC`,
);

export const outboxRepo = {
  // Returns the new row id so the caller can mark it published after a successful publish.
  insert(ts: string, envelope: string): number {
    const info = insertStmt.run({ ts, envelope, published_at: null });
    return Number(info.lastInsertRowid);
  },
  markPublished(id: number, publishedAt: string): void {
    markPublishedStmt.run(publishedAt, id);
  },
  listUnpublished(): OutboxRow[] {
    return listUnpublishedStmt.all() as OutboxRow[];
  },
};
