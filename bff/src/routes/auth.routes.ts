// Auth + staff routes (§3.2, 02-product-api.md). Implements the login FSM (login →
// setPassword/enroll/mfa), MFA enrollment, recovery-code login, logout, whoami, and staff
// lifecycle. A session is issued ONLY after both factors pass (REQ-016) — mid-flow state
// lives in login_challenges rows, never a session. Every login success/failure, enroll,
// reset, recovery use, and staff lifecycle op writes one audit entry (REQ-093a).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { AppError } from '../server/errors.js';
import { recordAudit } from '../audit/audit.js';
import { staffRepo, type StaffRow } from '../store/repositories/staff.repo.js';
import {
  loginChallengesRepo,
  type ChallengeStage,
  type LoginChallengeRow,
} from '../store/repositories/login-challenges.repo.js';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../auth/crypto.js';
import {
  beginEnrollment,
  completeEnrollment,
  verifyCodeForStaff,
  generateRecoveryCodes,
  consumeRecoveryCode,
} from '../auth/mfa.service.js';
import { assertNotLocked, recordFailedAttempt, clearFailedAttempts } from '../auth/lockout.service.js';
import { createSession, destroySession } from '../auth/session.service.js';
import {
  toStaff,
  listStaff,
  createStaff,
  setDisabled,
  deleteStaff,
  resetPassword,
  resetMfa,
} from '../auth/staff.service.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../server/session-guard.js';

const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 min
const MIN_PASSWORD_LENGTH = 12; // sec review M-3
const MAX_CHALLENGE_ATTEMPTS = 5; // per-challenge factor-2 code cap (sec review H-1)

// --- helpers ---

function body<T>(req: FastifyRequest): T {
  return (req.body ?? {}) as T;
}

// Reject weak operator-chosen passwords (sec review M-3). A 400 is a client error, not an
// auth failure, so it does not count toward lockout.
function assertPasswordPolicy(password: string): void {
  if (password.trim().length < MIN_PASSWORD_LENGTH) {
    throw new AppError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

function requireStaff(req: FastifyRequest): { id: string; username: string } {
  if (!req.staff) throw new AppError(401, 'Not authenticated');
  return req.staff;
}

function recordLoginFailure(staffId: string | null, username: string): void {
  recordAudit({
    actor: staffId ?? 'anonymous',
    action: 'auth.login',
    outcome: 'failure',
    target: { username },
  });
}

function createChallenge(staffId: string, stage: ChallengeStage): string {
  const id = randomBytes(32).toString('hex');
  loginChallengesRepo.insert({
    id,
    staff_id: staffId,
    stage,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  return id;
}

// Record a bad factor-2 code (sec review H-1): count it against the account (drives lockout)
// and against this challenge, retiring the challenge once its per-challenge cap is reached so
// the attacker must pass factor 1 again to get a fresh one.
function failChallenge(staffId: string, challengeId: string): void {
  recordFailedAttempt(staffId);
  const attempts = loginChallengesRepo.incrementAttempts(challengeId);
  if (attempts >= MAX_CHALLENGE_ATTEMPTS) loginChallengesRepo.delete(challengeId);
}

function loadChallenge(challengeId: string, stage: ChallengeStage): LoginChallengeRow {
  const row = loginChallengesRepo.findById(challengeId);
  if (!row || Date.now() > Date.parse(row.expires_at)) {
    throw new AppError(401, 'Login challenge expired or invalid');
  }
  if (row.stage !== stage) {
    throw new AppError(409, `Login is not at the ${stage} step`);
  }
  return row;
}

function setSessionCookie(reply: FastifyReply, staffId: string): void {
  const sid = createSession(staffId);
  reply.setCookie(SESSION_COOKIE, sid, sessionCookieOptions());
}

// Build the response for the stage a challenge lands on. For 'enroll' we generate + persist
// a pending TOTP secret and include the material the client displays (secret/QR).
async function stageResponse(
  staff: StaffRow,
  stage: ChallengeStage,
  challengeId: string,
): Promise<Record<string, unknown>> {
  if (stage === 'enroll') {
    const material = await beginEnrollment(staff);
    return { stage, challengeId, ...material };
  }
  return { stage, challengeId };
}

// Determine the FSM stage for a password-verified account.
function stageFor(staff: StaffRow): ChallengeStage {
  if (staff.must_set_password === 1) return 'setPassword';
  if (staff.mfa_enrolled === 0) return 'enroll';
  return 'mfa';
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/login — factor 1 (password). Issues a challenge, never a session.
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = body<{ username?: string; password?: string }>(req);
    if (!username || !password) throw new AppError(400, 'username and password are required');

    const staff = staffRepo.findByUsername(username);
    if (!staff || staff.disabled === 1 || !staff.password_hash) {
      // Burn equivalent argon2 work so an unknown/credential-less account is indistinguishable
      // from a wrong password by timing (sec review M-2).
      await verifyDummyPassword(password);
      recordLoginFailure(staff?.id ?? null, username);
      throw new AppError(401, 'Invalid credentials');
    }
    assertNotLocked(staff); // sec review H-1
    if (!(await verifyPassword(staff.password_hash, password))) {
      recordFailedAttempt(staff.id);
      recordLoginFailure(staff.id, username);
      throw new AppError(401, 'Invalid credentials');
    }

    const stage = stageFor(staff);
    const challengeId = createChallenge(staff.id, stage);
    recordAudit({ actor: staff.id, action: 'auth.login', outcome: 'success', detail: { stage } });
    return reply.send(await stageResponse(staff, stage, challengeId));
  });

  // POST /api/auth/set-password — bootstrap/reset first step; clears must_set_password and
  // advances to enroll (or mfa if already enrolled).
  app.post('/api/auth/set-password', async (req, reply) => {
    const { challengeId, newPassword } = body<{ challengeId?: string; newPassword?: string }>(req);
    if (!challengeId || !newPassword) {
      throw new AppError(400, 'challengeId and newPassword are required');
    }
    assertPasswordPolicy(newPassword); // sec review M-3
    const challenge = loadChallenge(challengeId, 'setPassword');
    const staff = staffRepo.findById(challenge.staff_id);
    if (!staff || staff.disabled === 1) throw new AppError(401, 'Account is not available');

    staffRepo.setPasswordHash(staff.id, await hashPassword(newPassword));
    const nextStage: ChallengeStage = staff.mfa_enrolled === 1 ? 'mfa' : 'enroll';
    loginChallengesRepo.setStage(challengeId, nextStage);
    recordAudit({ actor: staff.id, action: 'auth.set_password', outcome: 'success' });
    // Re-read: must_set_password is now cleared so stageResponse/enroll behaves correctly.
    const refreshed = staffRepo.findById(staff.id) as StaffRow;
    return reply.send(await stageResponse(refreshed, nextStage, challengeId));
  });

  // POST /api/auth/enroll — factor 2 enrollment. Verifies the code against the pending
  // secret, marks enrolled, issues recovery codes, and starts a session.
  app.post('/api/auth/enroll', async (req, reply) => {
    const { challengeId, code } = body<{ challengeId?: string; code?: string }>(req);
    if (!challengeId || !code) throw new AppError(400, 'challengeId and code are required');
    const challenge = loadChallenge(challengeId, 'enroll');
    const staff = staffRepo.findById(challenge.staff_id);
    if (!staff || staff.disabled === 1) throw new AppError(401, 'Account is not available');
    assertNotLocked(staff); // sec review H-1

    if (!completeEnrollment(staff, code)) {
      failChallenge(staff.id, challengeId); // sec review H-1
      recordAudit({ actor: staff.id, action: 'auth.enroll', outcome: 'failure' });
      throw new AppError(401, 'Invalid authenticator code');
    }
    const recoveryCodes = generateRecoveryCodes(staff.id);
    loginChallengesRepo.delete(challengeId);
    clearFailedAttempts(staff.id); // sec review H-1
    setSessionCookie(reply, staff.id);
    recordAudit({ actor: staff.id, action: 'auth.enroll', outcome: 'success' });
    const refreshed = staffRepo.findById(staff.id) as StaffRow;
    return reply.send({ recoveryCodes, staff: toStaff(refreshed) });
  });

  // POST /api/auth/mfa — factor 2 (TOTP) for an enrolled account → session.
  app.post('/api/auth/mfa', async (req, reply) => {
    const { challengeId, code } = body<{ challengeId?: string; code?: string }>(req);
    if (!challengeId || !code) throw new AppError(400, 'challengeId and code are required');
    const challenge = loadChallenge(challengeId, 'mfa');
    const staff = staffRepo.findById(challenge.staff_id);
    if (!staff || staff.disabled === 1) throw new AppError(401, 'Account is not available');
    assertNotLocked(staff); // sec review H-1

    if (!verifyCodeForStaff(staff, code)) {
      failChallenge(staff.id, challengeId); // sec review H-1
      recordAudit({ actor: staff.id, action: 'auth.mfa', outcome: 'failure' });
      throw new AppError(401, 'Invalid authenticator code');
    }
    loginChallengesRepo.delete(challengeId);
    clearFailedAttempts(staff.id); // sec review H-1
    setSessionCookie(reply, staff.id);
    recordAudit({ actor: staff.id, action: 'auth.mfa', outcome: 'success' });
    return reply.send({ staff: toStaff(staff) });
  });

  // POST /api/auth/recovery — single-use recovery code in place of TOTP. Requires the
  // password too. Consumes one code; on success → session (or the appropriate stage).
  app.post('/api/auth/recovery', async (req, reply) => {
    const { username, password, recoveryCode } = body<{
      username?: string;
      password?: string;
      recoveryCode?: string;
    }>(req);
    if (!username || !password || !recoveryCode) {
      throw new AppError(400, 'username, password and recoveryCode are required');
    }
    const staff = staffRepo.findByUsername(username);
    if (!staff || staff.disabled === 1 || !staff.password_hash) {
      await verifyDummyPassword(password); // sec review M-2 (timing)
      recordLoginFailure(staff?.id ?? null, username);
      throw new AppError(401, 'Invalid credentials');
    }
    assertNotLocked(staff); // sec review H-1
    if (!(await verifyPassword(staff.password_hash, password))) {
      recordFailedAttempt(staff.id);
      recordLoginFailure(staff.id, username);
      throw new AppError(401, 'Invalid credentials');
    }
    if (!consumeRecoveryCode(staff.id, recoveryCode)) {
      recordFailedAttempt(staff.id); // sec review H-1
      recordAudit({ actor: staff.id, action: 'auth.recovery', outcome: 'failure' });
      throw new AppError(401, 'Invalid recovery code');
    }
    clearFailedAttempts(staff.id); // sec review H-1
    recordAudit({ actor: staff.id, action: 'auth.recovery', outcome: 'success' });

    // Recovery replaces the TOTP factor. If the account still owes set-password/enroll,
    // route to that stage; otherwise issue a session.
    if (staff.must_set_password === 1) {
      const challengeId = createChallenge(staff.id, 'setPassword');
      return reply.send(await stageResponse(staff, 'setPassword', challengeId));
    }
    if (staff.mfa_enrolled === 0) {
      const challengeId = createChallenge(staff.id, 'enroll');
      return reply.send(await stageResponse(staff, 'enroll', challengeId));
    }
    setSessionCookie(reply, staff.id);
    return reply.send({ staff: toStaff(staff) });
  });

  // POST /api/auth/logout — delete session + clear cookie. Idempotent → 204.
  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) destroySession(unsigned.value);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  // GET /api/auth/me — current staff (requires session, enforced by the guard).
  app.get('/api/auth/me', async (req, reply) => {
    const current = requireStaff(req);
    const row = staffRepo.findById(current.id);
    if (!row) throw new AppError(401, 'Not authenticated');
    return reply.send({ staff: toStaff(row) });
  });

  // --- Staff lifecycle (all require a session; all audited) ---

  app.get('/api/staff', async (req, reply) => {
    requireStaff(req);
    return reply.send(listStaff());
  });

  app.post('/api/staff', async (req, reply) => {
    const actor = requireStaff(req);
    const { username } = body<{ username?: string; role?: string }>(req); // v1 has one role
    if (!username) throw new AppError(400, 'username is required');
    const staff = createStaff(username);
    recordAudit({
      actor: actor.id,
      action: 'staff.create',
      outcome: 'success',
      target: { id: staff.id, username: staff.username },
    });
    return reply.code(201).send(staff);
  });

  app.patch('/api/staff/:id', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    const { disabled } = body<{ disabled?: boolean }>(req);
    if (typeof disabled !== 'boolean') {
      throw new AppError(400, 'disabled (boolean) is required');
    }
    const staff = setDisabled(actor.id, id, disabled);
    recordAudit({
      actor: actor.id,
      action: disabled ? 'staff.disable' : 'staff.enable',
      outcome: 'success',
      target: { id },
    });
    return reply.send(staff);
  });

  app.delete('/api/staff/:id', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    deleteStaff(actor.id, id);
    recordAudit({ actor: actor.id, action: 'staff.delete', outcome: 'success', target: { id } });
    return reply.code(204).send();
  });

  app.post('/api/staff/:id/reset-password', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    const tempToken = await resetPassword(id);
    recordAudit({
      actor: actor.id,
      action: 'staff.reset_password',
      outcome: 'success',
      target: { id },
    });
    return reply.send({ tempToken });
  });

  app.post('/api/staff/:id/reset-mfa', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    resetMfa(id);
    recordAudit({ actor: actor.id, action: 'staff.reset_mfa', outcome: 'success', target: { id } });
    return reply.code(204).send();
  });
}
