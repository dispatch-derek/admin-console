// routes/auth.routes.ts — the login FSM end-to-end (§3.2, 02-product-api.md). Exercised via
// buildApp() + app.inject() (no real listen/socket). Each test gets its own module graph
// (vi.resetModules()) and private tmp DB so staff/session/challenge state never leaks
// between tests. The key security property under test throughout is REQ-016: a session
// cookie is issued ONLY after BOTH factors (password + MFA/enroll/recovery) pass — never at
// login, set-password, or a failed second factor.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';

const SESSION_COOKIE = 'admin_session';
const BOOTSTRAP_USERNAME = 'admin';
const BOOTSTRAP_TOKEN = 'bootstrap-secret-token-123';

interface Ctx {
  app: FastifyInstance;
  staffRepo: typeof import('../../src/store/repositories/staff.repo.js').staffRepo;
  db: typeof import('../../src/store/db.js').db;
  hashPassword: typeof import('../../src/auth/crypto.js').hashPassword;
  encryptSecret: typeof import('../../src/auth/crypto.js').encryptSecret;
  generateRecoveryCodes: typeof import('../../src/auth/mfa.service.js').generateRecoveryCodes;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

async function freshApp(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'auth-routes-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = BOOTSTRAP_USERNAME;
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = BOOTSTRAP_TOKEN;
  process.env['LOG_LEVEL'] = 'silent'; // keep test output readable; buildApp() reads this

  vi.resetModules();
  const { buildApp } = await import('../../src/index.js');
  const { staffRepo } = await import('../../src/store/repositories/staff.repo.js');
  const { db } = await import('../../src/store/db.js');
  const { hashPassword, encryptSecret } = await import('../../src/auth/crypto.js');
  const { generateRecoveryCodes } = await import('../../src/auth/mfa.service.js');

  const app = await buildApp();
  return { app, staffRepo, db, hashPassword, encryptSecret, generateRecoveryCodes, tmpDir, dbPath };
}

// Seeds a fully-enrolled, ready-to-log-in account directly via the repo (white-box setup),
// bypassing the login FSM. Returns the plaintext password and TOTP secret for the test to
// use when driving the FSM.
async function seedEnrolledStaff(
  c: Ctx,
  opts: { username: string; password: string },
): Promise<{ id: string; secret: string }> {
  const secret = authenticator.generateSecret();
  const id = `staff-${opts.username}`;
  c.staffRepo.insert({
    id,
    username: opts.username,
    password_hash: await c.hashPassword(opts.password),
    totp_secret: c.encryptSecret(secret),
    mfa_enrolled: 1,
    disabled: 0,
    must_set_password: 0,
    created_at: new Date().toISOString(),
  });
  return { id, secret };
}

function extractSessionCookie(res: { cookies: { name: string; value: string }[] }): string | undefined {
  return res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
}

beforeEach(async () => {
  ctx = await freshApp();
});

afterEach(async () => {
  if (!ctx) return;
  await ctx.app.close();
  ctx.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = ctx.dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
  rmSync(ctx.tmpDir, { recursive: true, force: true });
  ctx = undefined;
});

describe('POST /api/auth/login — factor 1 (password)', () => {
  it('rejects a bad password with 401 and writes a failure audit row', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: 'wrong-password' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((cookie) => cookie.name === SESSION_COOKIE)).toBeUndefined();

    const rows = c.db
      .prepare(`SELECT * FROM audit_log WHERE action = 'auth.login' AND outcome = 'failure'`)
      .all();
    expect(rows).toHaveLength(1);
  });

  it('rejects a disabled account with 401', async () => {
    const c = ctx!;
    const admin = c.staffRepo.findByUsername(BOOTSTRAP_USERNAME)!;
    c.staffRepo.setDisabled(admin.id, true);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing username/password with 400', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown username with 401 (and audits with actor "anonymous")', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'no-such-user', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
    const row = c.db
      .prepare(`SELECT * FROM audit_log WHERE action = 'auth.login' AND outcome = 'failure'`)
      .all()[0] as { actor: string };
    expect(row.actor).toBe('anonymous');
  });
});

describe('login FSM — bootstrap account (must_set_password) → setPassword → enroll → session (REQ-016)', () => {
  it('login returns stage "setPassword" and issues NO session cookie', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stage).toBe('setPassword');
    expect(typeof body.challengeId).toBe('string');
    expect(extractSessionCookie(res)).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('set-password advances to "enroll" (mfa_enrolled=0) and still issues NO session cookie', async () => {
    const c = ctx!;
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    const { challengeId } = loginRes.json();

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId, newPassword: 'NewPassw0rd!' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stage).toBe('enroll');
    expect(typeof body.secret).toBe('string');
    expect(body.otpauthUri).toContain('otpauth://');
    expect(extractSessionCookie(res)).toBeUndefined();

    // The password really changed: old password no longer logs in, new one starts a fresh
    // challenge (must_set_password is now cleared).
    const oldPwLogin = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    expect(oldPwLogin.statusCode).toBe(401);

    const newPwLogin = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: 'NewPassw0rd!' },
    });
    expect(newPwLogin.statusCode).toBe(200);
    expect(newPwLogin.json().stage).toBe('enroll');
  });

  it('enroll with a valid TOTP code returns recovery codes AND sets a session cookie', async () => {
    const c = ctx!;
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    const { challengeId } = loginRes.json();

    const setPwRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId, newPassword: 'NewPassw0rd!' },
    });
    const { secret } = setPwRes.json();

    const code = authenticator.generate(secret);
    const enrollRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/enroll',
      payload: { challengeId, code },
    });

    expect(enrollRes.statusCode).toBe(200);
    const body = enrollRes.json();
    expect(Array.isArray(body.recoveryCodes)).toBe(true);
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.staff.mfaEnrolled).toBe(true);

    const sessionCookie = extractSessionCookie(enrollRes);
    expect(sessionCookie).toBeDefined();

    // The session is real and usable.
    const meRes = await c.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionCookie! },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().staff.username).toBe(BOOTSTRAP_USERNAME);
  });

  it('enroll with a WRONG code does not set a session and does not advance the challenge', async () => {
    const c = ctx!;
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    const { challengeId } = loginRes.json();
    await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId, newPassword: 'NewPassw0rd!' },
    });

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/enroll',
      payload: { challengeId, code: '000000' },
    });

    expect(res.statusCode).toBe(401);
    expect(extractSessionCookie(res)).toBeUndefined();

    // The account is still not enrolled.
    const admin = c.staffRepo.findByUsername(BOOTSTRAP_USERNAME)!;
    expect(admin.mfa_enrolled).toBe(0);
  });
});

describe('login FSM — already-enrolled account → stage "mfa" (REQ-016)', () => {
  it('login returns stage "mfa" with no session cookie', async () => {
    const c = ctx!;
    await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe('mfa');
    expect(extractSessionCookie(res)).toBeUndefined();
  });

  it('a wrong TOTP code does not set a session (subsequent /me with no cookie stays 401)', async () => {
    const c = ctx!;
    await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();

    const mfaRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code: '000000' },
    });

    expect(mfaRes.statusCode).toBe(401);
    expect(extractSessionCookie(mfaRes)).toBeUndefined();

    const meRes = await c.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(meRes.statusCode).toBe(401);
  });

  it('a valid TOTP code sets a session cookie and completes login', async () => {
    const c = ctx!;
    const { secret } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();

    const code = authenticator.generate(secret);
    const mfaRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code },
    });

    expect(mfaRes.statusCode).toBe(200);
    const sessionCookie = extractSessionCookie(mfaRes);
    expect(sessionCookie).toBeDefined();

    const meRes = await c.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionCookie! },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().staff.username).toBe('operator');
  });

  it('rejects a challenge used at the wrong FSM step (409)', async () => {
    const c = ctx!;
    await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();

    // This account is already enrolled and past set-password — the challenge is at 'mfa',
    // not 'enroll'.
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/enroll',
      payload: { challengeId, code: '123456' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an unknown/invalid challengeId with 401', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId: 'not-a-real-challenge', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects mfa completion for an account disabled mid-challenge', async () => {
    const c = ctx!;
    const { id } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();

    c.staffRepo.setDisabled(id, true);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/auth/me — requires a session', () => {
  it('401 without a session cookie', async () => {
    const c = ctx!;
    const res = await c.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('200 with a valid session cookie', async () => {
    const c = ctx!;
    const { secret } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();
    const mfaRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code: authenticator.generate(secret) },
    });
    const sessionCookie = extractSessionCookie(mfaRes)!;

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('a garbage/unsigned cookie value is rejected (401), not crashed on', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: 'not-a-signed-cookie' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/auth/logout — clears the session', () => {
  it('logs out and the session cookie no longer authenticates /me', async () => {
    const c = ctx!;
    const { secret } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();
    const mfaRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code: authenticator.generate(secret) },
    });
    const sessionCookie = extractSessionCookie(mfaRes)!;

    const logoutRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: sessionCookie },
    });
    expect(logoutRes.statusCode).toBe(204);

    const meRes = await c.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionCookie },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it('logout with no cookie at all is idempotent (204, not an error)', async () => {
    const c = ctx!;
    const res = await c.app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /api/auth/recovery — single-use recovery code in place of TOTP', () => {
  it('a valid recovery code substitutes for TOTP and logs in (session cookie set)', async () => {
    const c = ctx!;
    const { id } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const [code] = c.generateRecoveryCodes(id);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/recovery',
      payload: { username: 'operator', password: 'Sup3rSecret!', recoveryCode: code },
    });

    expect(res.statusCode).toBe(200);
    const sessionCookie = extractSessionCookie(res);
    expect(sessionCookie).toBeDefined();

    const meRes = await c.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionCookie! },
    });
    expect(meRes.statusCode).toBe(200);
  });

  it('the consumed recovery code cannot be reused', async () => {
    const c = ctx!;
    const { id } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const [code] = c.generateRecoveryCodes(id);

    const first = await c.app.inject({
      method: 'POST',
      url: '/api/auth/recovery',
      payload: { username: 'operator', password: 'Sup3rSecret!', recoveryCode: code },
    });
    expect(first.statusCode).toBe(200);

    const second = await c.app.inject({
      method: 'POST',
      url: '/api/auth/recovery',
      payload: { username: 'operator', password: 'Sup3rSecret!', recoveryCode: code },
    });
    expect(second.statusCode).toBe(401);
    expect(extractSessionCookie(second)).toBeUndefined();
  });

  it('rejects a wrong password even with a valid recovery code', async () => {
    const c = ctx!;
    const { id } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const [code] = c.generateRecoveryCodes(id);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/recovery',
      payload: { username: 'operator', password: 'wrong-password', recoveryCode: code },
    });
    expect(res.statusCode).toBe(401);
    expect(extractSessionCookie(res)).toBeUndefined();
  });
});

describe('POST /api/auth/login — brute-force lockout (sec review H-1)', () => {
  it('5 failed password attempts lock the account; the 6th attempt is 429 EVEN with the correct password', async () => {
    const c = ctx!;
    await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });

    for (let i = 0; i < 5; i++) {
      const res = await c.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'operator', password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
    }

    const sixth = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    expect(sixth.statusCode).toBe(429);
    expect(extractSessionCookie(sixth)).toBeUndefined();
  });

  it('a locked account is refused at /api/auth/mfa (429), even with a valid TOTP code', async () => {
    const c = ctx!;
    const { id, secret } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();

    // Simulate the account becoming locked (e.g. via concurrent failed attempts elsewhere)
    // between issuing the challenge and submitting the second factor.
    c.staffRepo.lock(id, new Date(Date.now() + 15 * 60 * 1000).toISOString());

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code: authenticator.generate(secret) },
    });
    expect(res.statusCode).toBe(429);
    expect(extractSessionCookie(res)).toBeUndefined();
  });

  it('a locked account is refused at /api/auth/recovery (429), even with correct password + recovery code', async () => {
    const c = ctx!;
    const { id } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const [code] = c.generateRecoveryCodes(id);
    c.staffRepo.lock(id, new Date(Date.now() + 15 * 60 * 1000).toISOString());

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/recovery',
      payload: { username: 'operator', password: 'Sup3rSecret!', recoveryCode: code },
    });
    expect(res.statusCode).toBe(429);
    expect(extractSessionCookie(res)).toBeUndefined();
  });

  it('a fully-successful login (password + TOTP) resets the failure counter', async () => {
    const c = ctx!;
    const { secret } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });

    // 4 failures — one short of the 5-attempt lock threshold.
    for (let i = 0; i < 4; i++) {
      const res = await c.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'operator', password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
    }

    // A full successful login clears the counter.
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();
    const mfaRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code: authenticator.generate(secret) },
    });
    expect(mfaRes.statusCode).toBe(200);

    const row = c.staffRepo.findByUsername('operator')!;
    expect(row.failed_attempts).toBe(0);
    expect(row.locked_until).toBeNull();

    // 4 more failures after the reset must NOT lock the account (proves the counter was
    // actually cleared, not merely left below threshold).
    for (let i = 0; i < 4; i++) {
      const res = await c.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'operator', password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
    }
    const stillOk = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    expect(stillOk.statusCode).toBe(200); // not 429 — the earlier reset held
  });

  it('failed TOTP codes at /api/auth/mfa count toward the SAME account lockout', async () => {
    const c = ctx!;
    await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();

    for (let i = 0; i < 5; i++) {
      const res = await c.app.inject({
        method: 'POST',
        url: '/api/auth/mfa',
        payload: { challengeId, code: '000000' },
      });
      expect(res.statusCode).toBe(401);
    }

    // The account itself (not just the challenge) is now locked: even a brand-new login
    // attempt with the correct password is refused.
    const loginAfter = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    expect(loginAfter.statusCode).toBe(429);
  });

  it('lockout expiry: once locked_until is in the past, a correct login succeeds again', async () => {
    const c = ctx!;
    await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });

    for (let i = 0; i < 5; i++) {
      await c.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'operator', password: 'wrong-password' },
      });
    }
    const locked = c.staffRepo.findByUsername('operator')!;
    expect(locked.locked_until).not.toBeNull();

    // Directly rewrite locked_until into the past, simulating the 15-minute window having
    // elapsed (no wall-clock sleep needed).
    c.db
      .prepare(`UPDATE staff SET locked_until = ? WHERE id = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), locked.id);

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe('mfa');
  });

  it('an unknown username never records/triggers lockout — repeated bad logins stay 401, never 429', async () => {
    const c = ctx!;
    for (let i = 0; i < 8; i++) {
      const res = await c.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'no-such-user', password: 'whatever' },
      });
      expect(res.statusCode).toBe(401);
    }
    // No staff row was ever created/locked for the unknown username.
    expect(c.staffRepo.findByUsername('no-such-user')).toBeUndefined();
  });
});

describe('POST /api/auth/mfa — per-challenge TOTP attempt cap (sec review H-1)', () => {
  it('after 5 bad codes the challenge is retired; a 6th submit gets 401 "Login challenge expired or invalid"', async () => {
    const c = ctx!;
    await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const { challengeId } = loginRes.json();

    for (let i = 0; i < 5; i++) {
      const res = await c.app.inject({
        method: 'POST',
        url: '/api/auth/mfa',
        payload: { challengeId, code: '000000' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe('Invalid authenticator code');
    }

    // The challenge row itself was deleted once the per-challenge cap was hit, so the 6th
    // submit against the SAME challengeId reports it as gone, not another bad-code failure.
    const sixth = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId, code: '000000' },
    });
    expect(sixth.statusCode).toBe(401);
    expect(sixth.json().message).toBe('Login challenge expired or invalid');
  });
});

describe('POST /api/auth/mfa — TOTP replay prevention (sec review H-1)', () => {
  it('a valid TOTP code that already logged in successfully cannot be replayed on a new login', async () => {
    const c = ctx!;
    const { secret } = await seedEnrolledStaff(c, { username: 'operator', password: 'Sup3rSecret!' });

    const firstLogin = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const code = authenticator.generate(secret);
    const firstMfa = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId: firstLogin.json().challengeId, code },
    });
    expect(firstMfa.statusCode).toBe(200);
    expect(extractSessionCookie(firstMfa)).toBeDefined();

    // Start a brand-new login (new challenge) and replay the SAME code.
    const secondLogin = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'Sup3rSecret!' },
    });
    const replay = await c.app.inject({
      method: 'POST',
      url: '/api/auth/mfa',
      payload: { challengeId: secondLogin.json().challengeId, code },
    });
    expect(replay.statusCode).toBe(401);
    expect(extractSessionCookie(replay)).toBeUndefined();
  });
});

describe('POST /api/auth/set-password — password policy (sec review M-3)', () => {
  it('rejects a newPassword shorter than 12 characters with 400 and does not advance the challenge', async () => {
    const c = ctx!;
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    const { challengeId } = loginRes.json();

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId, newPassword: 'short1234' }, // 9 chars
    });
    expect(res.statusCode).toBe(400);

    // The challenge is still usable at 'setPassword' — a subsequent valid password succeeds.
    const retry = await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId, newPassword: 'ValidPassw0rd!' },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().stage).toBe('enroll');
  });

  it('rejects a whitespace-only newPassword (trims to under the minimum) with 400', async () => {
    const c = ctx!;
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    const { challengeId } = loginRes.json();

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId, newPassword: '            ' }, // 12 spaces, trims to empty
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a newPassword that is exactly 12 characters long (boundary)', async () => {
    const c = ctx!;
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    const { challengeId } = loginRes.json();

    const res = await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId, newPassword: 'Twelve12char' }, // exactly 12 chars
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe('enroll');
  });
});

describe('REQ-016 — no session cookie is ever issued at a pre-MFA stage', () => {
  it('login and set-password never set a cookie across the full bootstrap flow', async () => {
    const c = ctx!;
    const loginRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_TOKEN },
    });
    expect(loginRes.headers['set-cookie']).toBeUndefined();

    const setPwRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { challengeId: loginRes.json().challengeId, newPassword: 'NewPassw0rd!' },
    });
    expect(setPwRes.headers['set-cookie']).toBeUndefined();

    // Only the final, successful second factor may set a cookie.
    const enrollRes = await c.app.inject({
      method: 'POST',
      url: '/api/auth/enroll',
      payload: {
        challengeId: loginRes.json().challengeId,
        code: authenticator.generate(setPwRes.json().secret),
      },
    });
    expect(enrollRes.headers['set-cookie']).toBeDefined();
  });
});
