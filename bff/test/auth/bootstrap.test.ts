// auth/bootstrap.ts — seedFirstAccount (REQ-019a). config.ts is a load-time singleton, so
// each scenario that varies ADMIN_BOOTSTRAP_USERNAME/TOKEN or the emptiness of the staff
// store needs its own fresh module graph (vi.resetModules()) AND its own private DB file —
// otherwise an earlier test's seeded row (or cached config) would leak into a later one.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let currentDbPath: string | undefined;
let currentTmpDir: string | undefined;

// Boots a fresh module graph against a brand-new tmp DB, with the given bootstrap env vars
// applied (undefined => the var is deleted, not just left alone).
async function freshBootstrap(env: {
  username?: string;
  token?: string;
}): Promise<{
  seedFirstAccount: typeof import('../../src/auth/bootstrap.js').seedFirstAccount;
  staffRepo: typeof import('../../src/store/repositories/staff.repo.js').staffRepo;
  db: typeof import('../../src/store/db.js').db;
}> {
  currentTmpDir = mkdtempSync(join(tmpdir(), 'bootstrap-test-'));
  currentDbPath = join(currentTmpDir, 'console.db');
  process.env['DB_PATH'] = currentDbPath;

  if (env.username === undefined) delete process.env['ADMIN_BOOTSTRAP_USERNAME'];
  else process.env['ADMIN_BOOTSTRAP_USERNAME'] = env.username;

  if (env.token === undefined) delete process.env['ADMIN_BOOTSTRAP_TOKEN'];
  else process.env['ADMIN_BOOTSTRAP_TOKEN'] = env.token;

  vi.resetModules();
  const { seedFirstAccount } = await import('../../src/auth/bootstrap.js');
  const { staffRepo } = await import('../../src/store/repositories/staff.repo.js');
  const { db } = await import('../../src/store/db.js');
  return { seedFirstAccount, staffRepo, db };
}

afterEach(() => {
  if (currentDbPath) {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = currentDbPath + suffix;
      if (existsSync(p)) rmSync(p);
    }
  }
  if (currentTmpDir && existsSync(currentTmpDir)) rmSync(currentTmpDir, { recursive: true, force: true });
  currentDbPath = undefined;
  currentTmpDir = undefined;
});

describe('seedFirstAccount — empty store + bootstrap vars set', () => {
  it('seeds exactly one account with must_set_password=1 and mfa_enrolled=0', async () => {
    const { seedFirstAccount, staffRepo } = await freshBootstrap({
      username: 'admin',
      token: 'bootstrap-token-value',
    });

    await seedFirstAccount();

    expect(staffRepo.count()).toBe(1);
    const row = staffRepo.findByUsername('admin');
    expect(row).toBeDefined();
    expect(row!.must_set_password).toBe(1);
    expect(row!.mfa_enrolled).toBe(0);
    expect(row!.disabled).toBe(0);
    expect(row!.password_hash).not.toBeNull();
    expect(row!.password_hash).not.toBe('bootstrap-token-value'); // hashed, not plaintext
  });
});

describe('seedFirstAccount — non-empty store (REQ-019a: never overwrites)', () => {
  it('seeds nothing when the store already has an account, even with bootstrap vars unset', async () => {
    const { seedFirstAccount, staffRepo } = await freshBootstrap({ username: undefined, token: undefined });

    staffRepo.insert({
      id: randomUUID(),
      username: 'existing-op',
      password_hash: 'some-hash',
      totp_secret: null,
      mfa_enrolled: 0,
      disabled: 0,
      must_set_password: 0,
      created_at: new Date().toISOString(),
    });

    await expect(seedFirstAccount()).resolves.toBeUndefined();
    expect(staffRepo.count()).toBe(1); // unchanged — no second account seeded
    expect(staffRepo.findByUsername('existing-op')).toBeDefined();
  });

  it('does not throw even when only one bootstrap var is set (non-empty store)', async () => {
    const { seedFirstAccount, staffRepo } = await freshBootstrap({ username: 'admin', token: undefined });
    staffRepo.insert({
      id: randomUUID(),
      username: 'existing-op',
      password_hash: 'some-hash',
      totp_secret: null,
      mfa_enrolled: 0,
      disabled: 0,
      must_set_password: 0,
      created_at: new Date().toISOString(),
    });

    await expect(seedFirstAccount()).resolves.toBeUndefined();
    expect(staffRepo.count()).toBe(1);
  });
});

describe('seedFirstAccount — empty store + bootstrap vars UNSET (first-boot error)', () => {
  it('throws a clear first-boot error naming both required env vars', async () => {
    const { seedFirstAccount } = await freshBootstrap({ username: undefined, token: undefined });

    await expect(seedFirstAccount()).rejects.toThrow(
      /ADMIN_BOOTSTRAP_USERNAME.*ADMIN_BOOTSTRAP_TOKEN/s,
    );
  });

  it('throws when only ADMIN_BOOTSTRAP_USERNAME is set (token still missing)', async () => {
    const { seedFirstAccount, staffRepo } = await freshBootstrap({ username: 'admin', token: undefined });
    await expect(seedFirstAccount()).rejects.toThrow();
    expect(staffRepo.count()).toBe(0);
  });

  it('throws when only ADMIN_BOOTSTRAP_TOKEN is set (username still missing)', async () => {
    const { seedFirstAccount, staffRepo } = await freshBootstrap({ username: undefined, token: 'tok' });
    await expect(seedFirstAccount()).rejects.toThrow();
    expect(staffRepo.count()).toBe(0);
  });

  it('does not leave a partial account behind after the throw', async () => {
    const { seedFirstAccount, staffRepo } = await freshBootstrap({ username: undefined, token: undefined });
    await expect(seedFirstAccount()).rejects.toThrow();
    expect(staffRepo.count()).toBe(0);
  });
});
