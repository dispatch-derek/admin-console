# Security Review — Slice-2 Auth Surface

**Component:** AnythingLLM Admin Console BFF (Fastify 4, TypeScript/ESM, better-sqlite3, argon2, otplib)
**Scope:** local username/password auth, mandatory TOTP MFA, recovery codes, server-side sessions, session guard.
**Spec:** `specs/admin-console.md` rev 7. **Date:** 2026-07-04.
**Reviewed files:** `bff/src/auth/{bootstrap,crypto,mfa.service,session.service,staff.service}.ts`,
`bff/src/routes/auth.routes.ts`, `bff/src/server/{session-guard,plugins,errors}.ts`, `bff/src/config.ts`,
`bff/src/store/db.ts`, `bff/src/store/repositories/{staff,sessions,login-challenges,recovery-codes}.repo.ts`,
`bff/src/audit/audit.ts`.
**Method:** manual review + `npm audit` + `grep`. No semgrep/bandit available. Static only (no live/dynamic testing).

**Verdict:** BLOCK on one High (H-1). Remediation applied in the follow-up commit noted at the end.

---

## HIGH

### H-1 — No brute-force protection on any auth endpoint (password & TOTP guessing)
`bff/src/routes/auth.routes.ts` (login, mfa, enroll, recovery); no throttle/lockout anywhere.

- **Password brute force:** `/api/auth/login` had no throttle, lockout, or backoff — unlimited password attempts per account.
- **TOTP brute force (more serious):** after factor-1, a `mfa`-stage challenge accepts unlimited 6-digit TOTP
  guesses (~10⁶ space). A fresh challenge is mintable per `/login`, so the search was effectively unbounded —
  defeating the mandatory-MFA guarantee (REQ-016).
- **No TOTP replay protection:** a valid code stayed valid for its whole 30 s step with no single-use marking.
- Recovery-code endpoint likewise unthrottled (mitigated only by code entropy — see L-2).

**Impact:** authentication bypass over time; MFA bypass. **Severity: High.**

**Remediation (applied):** per-account failed-attempt lockout covering factor-1 **and** factor-2 failures
(`auth/lockout.service.ts`: 5 failures → 15-min lock, `staff.failed_attempts`/`locked_until`); a per-challenge
TOTP attempt cap (`login_challenges.attempts`, challenge destroyed after 5 bad codes); and TOTP replay/step-reuse
prevention via `authenticator.checkDelta` + a stored `staff.last_totp_step`. Per-IP rate-limiting at the reverse
proxy / ingress is recommended as an additional deployment-layer control.

---

## MEDIUM

### M-1 — Cookie `Secure` and CORS gated solely on `NODE_ENV==='production'` (fail-open)
`session-guard.ts` (`secure: NODE_ENV==='production'`); `plugins.ts` (`origin: … : true` + `credentials: true`).
If a prod deploy forgot `NODE_ENV=production`, the session cookie lost `Secure` (leak over HTTP) **and** CORS
reflected any origin with credentials (cross-origin session theft) — one env var as a single point of failure.
**Remediation (applied):** `secure` now driven by validated `config.cookieSecure` (defaults **true**; explicit
dev-only opt-out via `COOKIE_INSECURE=1`). CORS uses an explicit origin allowlist in **all** environments — never
`origin: true` with credentials — and config load **fails closed** if the allowlist is empty in production.

### M-2 — User/account enumeration via login timing side-channel
`auth.routes.ts` login/recovery: the not-found / no-password branch returned 401 without running argon2, while a
valid username paid a ~tens-of-ms verify — a measurable oracle for valid usernames.
**Remediation (applied):** the miss branch now runs `verifyDummyPassword` against a fixed dummy argon2 hash so all
paths take comparable time; response body unchanged (`Invalid credentials`).

### M-3 — No password strength/length policy
`auth.routes.ts` set-password accepted any truthy `newPassword` (a 1-char admin password was allowed).
**Remediation (applied):** `assertPasswordPolicy` enforces a ≥12-char minimum and rejects whitespace-only.

### M-4 — Vulnerable transitive dependency (`fast-uri`) via Fastify 4.x — RESOLVED
`npm audit` flagged `fast-uri <=3.1.1` (path traversal / host confusion) reached through `fastify@^4.28.1`.
**Remediation (applied, commit `f77a5bc`):** upgraded `fastify` 4.29 → 5.9, `@fastify/cors` 9 → 11, and
`@fastify/cookie` 9 → 11 (the Fastify 5 plugin line); `engines.node` → `>=20`. Fastify 5.9 pulls
`@fastify/ajv-compiler@^4` with a patched `fast-uri`, clearing GHSA-q3j6-qgpj-74h6 and GHSA-v39h-62p7-jpjc.
No application code changes were required; verified via typecheck, 216 tests, and a live boot smoke. The remaining
`npm audit` findings are all in the dev-only `vite`/`vitest`/`esbuild` chain (Vitest UI/dev-server, not shipped).

---

## LOW

- **L-1 — No idle timeout; stale sessions/challenges not GC'd.** Fixed 12 h TTL matches the spec's stated policy;
  idle-timeout + periodic sweep left as a future enhancement. *Not changed.*
- **L-2 — Recovery-code entropy 40 bits.** Bumped `randomBytes(5)` → `randomBytes(10)` (80-bit). *Applied.*
- **L-3 — Non-constant-time recovery hash compare.** The `list→find(===)` scan is replaced by a single indexed
  `UPDATE … WHERE code_hash=?` (L-4), removing both the scan and the timing surface. *Applied.*
- **L-4 — Recovery consumption not transactional; reset didn't clear in-flight challenges.**
  (a) `consumeRecoveryCode` is now a single atomic `UPDATE … WHERE used_at IS NULL` checked via `changes` (no TOCTOU).
  (b) `resetPassword`/`resetMfa` now also `loginChallengesRepo.deleteForStaff` and clear lockout state. *Applied.*
- **L-5 — Weak secret material accepted.** `config` now enforces a ≥32-char minimum on `SESSION_SECRET` and
  `SECRETS_ENC_KEY` at load. Bare-SHA-256 key derivation is acceptable for high-entropy input, now enforced. *Applied.*

---

## Verified good (informational)

- **SQL injection:** all repositories use better-sqlite3 prepared statements with bound params. Clean.
- **Audit-log injection:** `recordAudit` serializes via `JSON.stringify`; secret keys redacted; append-only enforced
  by DB triggers. Clean.
- **MFA cannot be bypassed / enrollment cannot be skipped:** a session issues only after factor-2; `stageFor` forces
  enroll when `mfa_enrolled=0`; challenge stage transitions are checked. Verified.
- **TOTP secrets encrypted at rest** (AES-256-GCM, random IV, auth tag) and never logged. Good.
- **Session token entropy:** 256-bit `randomBytes(32)`, signed httpOnly cookie, fresh id per login (no fixation). Good.
- **argon2:** `argon2id` at library defaults (m=64 MiB, t=3) — meets OWASP minimums.
- **Session guard** applies globally to `/api/*` minus an explicit public allowlist; disabled accounts rejected. Verified.
- **Lifecycle guardrails** (self / last-enabled) run inside DB transactions (TOCTOU-safe). Good.
- **CSRF:** `SameSite=Lax` + non-GET state-changing routes give reasonable protection; revisit if SameSite loosens.
- **Bootstrap:** seeds only an empty store, requires both env vars, forces set-password + enroll. Good.

## Not assessed
Runtime/dynamic testing; web/front-end handling of returned recovery codes/temp tokens (out of scope, BFF only);
full dependency tree beyond `npm audit` output.
