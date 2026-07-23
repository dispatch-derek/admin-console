// REQ-F010-022 — F-010 introduces NO added round-trip and NO new PERSISTED (outbox/DB) state.
// The round-trip half (still exactly one POST per peer per delivery) is covered behaviorally in
// bff/test/relay/http-peer-transport.f010.test.ts; this file covers the DB-schema half: no new
// column on event_outbox, no new table for credential storage. Mirrors the schema-introspection
// convention of bff/test/store/f004-outbox-migration.test.ts (PRAGMA table_info / sqlite_master).

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const dbPath = process.env['DB_PATH'] as string;
const { db, migrate } = await import('../../src/store/db.js');

interface ColInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
function columns(table: string): ColInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColInfo[];
}
function tableNames(): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe('REQ-F010-022 — no new persisted (outbox/DB) state is introduced by F-010', () => {
  it('event_outbox has EXACTLY the pre-F-010 (F-004-baseline) column set — no new column added for the credential', () => {
    migrate();
    const cols = columns('event_outbox')
      .map((c) => c.name)
      .sort();
    const EXPECTED = [
      'id',
      'ts',
      'envelope',
      'published_at',
      'ordering_key',
      'attempt_count',
      'next_attempt_at',
      'last_error',
      'parked_at',
      'acked_at',
    ].sort();
    expect(cols).toEqual(EXPECTED);
  });

  it('no plausible credential-storing table is introduced', () => {
    migrate();
    const names = tableNames();
    for (const forbidden of ['credentials', 'peer_credentials', 'event_bus_credentials', 'auth_tokens', 'peer_auth']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
});
