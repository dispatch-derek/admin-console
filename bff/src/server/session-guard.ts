// Session guard (REQ-012, REQ-014). A global onRequest hook that requires a valid staff
// session cookie on every /api/* route EXCEPT the pre-session login-flow steps (and
// /health, which is not under /api). On a valid session it attaches req.staff; on a
// missing/expired session it throws AppError(401) → the error handler renders {message} and
// the web app routes to /login.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { config } from '../config.js';
import { resolveSession, type SessionStaff } from '../auth/session.service.js';

export const SESSION_COOKIE = 'admin_session';

// Routes reachable WITHOUT a session: the login FSM steps + logout (idempotent cookie
// clear). Everything else under /api requires a session. /api/auth/me is intentionally
// NOT here — it requires a session.
const PUBLIC_API_PATHS = new Set<string>([
  '/api/auth/login',
  '/api/auth/set-password',
  '/api/auth/enroll',
  '/api/auth/mfa',
  '/api/auth/recovery',
  '/api/auth/logout',
]);

declare module 'fastify' {
  interface FastifyRequest {
    staff: SessionStaff | null;
  }
}

// Cookie options for the session cookie (REQ-011): signed httpOnly lax cookie, scoped to the
// whole app. Secure is driven by validated config (defaults true; fail closed) rather than a
// bare NODE_ENV check, so a forgotten NODE_ENV can't silently drop the flag (sec review M-1).
export function sessionCookieOptions(): {
  httpOnly: true;
  signed: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
} {
  return {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  };
}

// Resolve the authenticated staff from the signed session cookie, or null.
export function readSessionStaff(req: FastifyRequest): SessionStaff | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return resolveSession(unsigned.value);
}

export function registerSessionGuard(app: FastifyInstance): void {
  app.decorateRequest('staff', null);
  app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (!path.startsWith('/api')) return; // /health and any non-api path
    if (PUBLIC_API_PATHS.has(path)) return; // pre-session login-flow steps
    const staff = readSessionStaff(req);
    if (!staff) throw new AppError(401, 'Not authenticated');
    req.staff = staff;
  });
}
