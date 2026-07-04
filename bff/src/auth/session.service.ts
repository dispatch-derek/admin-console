// Session lifecycle (REQ-011, REQ-014, REQ-016). A session row is the server-side record;
// its random 256-bit id lives in a signed httpOnly cookie. A session is created ONLY after
// both auth factors pass (see auth.routes). Expiry policy: a fixed 12h TTL from creation;
// the guard treats now > expires_at as no session (deletes the stale row).

import { randomBytes } from 'node:crypto';
import { sessionsRepo } from '../store/repositories/sessions.repo.js';
import { staffRepo } from '../store/repositories/staff.repo.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // fixed 12h

export interface SessionStaff {
  id: string;
  username: string;
}

// Create a session for a fully-authenticated staff account; returns the token id.
export function createSession(staffId: string): string {
  const id = randomBytes(32).toString('hex'); // 256-bit
  const now = new Date();
  sessionsRepo.insert({
    id,
    staff_id: staffId,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  });
  return id;
}

// Validate a session token: reject when missing, expired, or the owning account is gone/
// disabled. On expiry, delete the stale row. Returns the authenticated staff or null.
export function resolveSession(sessionId: string): SessionStaff | null {
  const row = sessionsRepo.findById(sessionId);
  if (!row) return null;
  if (Date.now() > Date.parse(row.expires_at)) {
    sessionsRepo.delete(row.id);
    return null;
  }
  const staff = staffRepo.findById(row.staff_id);
  if (!staff || staff.disabled === 1) return null;
  return { id: staff.id, username: staff.username };
}

export function destroySession(sessionId: string): void {
  sessionsRepo.delete(sessionId);
}
