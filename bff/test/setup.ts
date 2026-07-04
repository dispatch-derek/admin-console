// Global test setup (runs once per isolated test file, before that file's own imports
// resolve). config.ts and store/db.ts execute at import time — config.ts throws if a
// required var is missing, and db.ts opens config.dbPath and runs migrate() immediately.
// Seeding sane defaults here means test files that don't care about config values (e.g.
// verify.test.ts, errors.test.ts) never have to think about it; files that DO care
// (config.test.ts, db.test.ts, events/*.test.ts) override the relevant var(s) with plain
// `process.env.X = ...` BEFORE their own dynamic `import()` of the module under test.

import { afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['ANYTHINGLLM_BASE_URL'] ??= 'http://localhost:3001';
process.env['ANYTHINGLLM_API_KEY'] ??= 'test-api-key';
process.env['ADMIN_BOOTSTRAP_USERNAME'] ??= 'admin';
process.env['ADMIN_BOOTSTRAP_TOKEN'] ??= 'test-bootstrap-token';
// >= 32 chars: config.ts enforces a minimum secret length (sec review L-5).
process.env['SESSION_SECRET'] ??= 'test-session-secret-0123456789abcdef';
process.env['SECRETS_ENC_KEY'] ??= 'test-secrets-enc-key-0123456789abcdef';

// A fresh, unique tmp dir per test file so any module that imports store/db.ts at load
// time (e.g. events/bus.ts → outbox.repo.ts → db.ts) never touches the real project DB
// or another test file's DB. Most test files never actually open a DB (outbox.repo.js is
// mocked at the module boundary), so this directory is usually empty; we still remove it
// (and anything a test happened to write into it) once the file's tests are done.
const dir = mkdtempSync(join(tmpdir(), 'admin-console-bff-test-'));
process.env['DB_PATH'] ??= join(dir, 'console.db');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
