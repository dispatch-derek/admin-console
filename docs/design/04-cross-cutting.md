# Cross-Cutting Designs

Covers the mechanisms the spec calls out across areas: (a) auth + mandatory TOTP MFA,
(b) verify-after-write (also in `01`), (c) event-emitter → bus boundary, (d) Ollama
discovery, (e) guarded raw-env editor, (f) secret handling, (g) error mapping + the two
403 cases, (h) config via requireEnv.

## (a) Local auth + mandatory TOTP MFA (§3.2)

State machine, all server-side; the browser only ever holds a session cookie or a
short-lived `challengeId`.

```
POST /api/auth/login {username,password}
  ├─ account disabled                 → 401 (REQ-018)
  ├─ password invalid                  → 401 + failure audit (REQ-015)
  ├─ must_set_password (bootstrap)     → challenge stage 'setPassword' (REQ-019a)
  ├─ not mfa_enrolled                  → challenge stage 'enroll' (REQ-017)
  └─ enrolled                          → challenge stage 'mfa' (REQ-016)

stage 'setPassword': POST /api/auth/set-password {challengeId,newPassword}
  → clear must_set_password, invalidate bootstrap token → advance to 'enroll'
stage 'enroll': server generates TOTP secret + QR; POST /api/auth/enroll {challengeId,code}
  → verify code, store totp_secret, set mfa_enrolled, issue recovery codes → session (REQ-017)
stage 'mfa': POST /api/auth/mfa {challengeId,code}
  → verify TOTP (30s window) → create session row + set cookie (REQ-016)
```

Session issued ONLY after both factors pass (REQ-016). `login_challenges` rows carry the
password-verified state so no session exists mid-flow. Session guard (`session-guard.ts`)
protects every `/api/*` route except the auth steps and `/health` (REQ-012); expiry/logout
→ 401 → web routes to `/login` (REQ-014).

**Bootstrap (REQ-019a):** on startup, if `staff` is empty, seed one account with
`username = ADMIN_BOOTSTRAP_USERNAME`, `password_hash =` hash of `ADMIN_BOOTSTRAP_TOKEN`,
`must_set_password = 1`, `mfa_enrolled = 0`. First login forces set-password (invalidating
the token) then MFA enrollment before any admin access. Seed never overwrites a non-empty
store; no public "create first admin" endpoint exists.

**MFA reset & recovery (REQ-019):** `POST /api/auth/recovery` accepts a single-use
recovery code (consumed on use) in place of TOTP. `POST /api/staff/:id/reset-mfa` clears
`totp_secret`/`mfa_enrolled`, forcing re-enrollment; self/last-account guardrails
(REQ-018a) do NOT restrict MFA reset. Every enroll/reset/recovery use is audited.

**Guardrails (REQ-018a):** `staff.service` rejects (409/403 `{message}`) disabling or
deleting (a) the caller's own current account, or (b) the last enabled account. Checked
inside a transaction to avoid a race that empties the store.

## (b) Verify-after-write

Generic `verifiedWrite` runner and the per-mutation confirm-predicate table are in
`01-bff-architecture.md`. Key point (REQ-092a): fresh-read-before-write (REQ-092, a UI
pre-write read to avoid clobbering) and verify-after-write (REQ-028, a post-write
re-read) are complementary; both run for dangerous settings changes.

## (c) Event-emitter → bus boundary (dependency + interim option)

**Assumption/dependency:** the shared on-box event bus (governing-arch event model) may
not exist yet on the appliance. We design against the abstract `EventBus` interface
(`events/bus.ts`, see `01`) and ship an interim implementation so the console is correct
regardless:

```
emitAdminEvent()
  → build + redact envelope
  → INSERT event_outbox row  ── same DB txn as the verify result (atomic)
  → EventBus.publish(env)
```

Two `EventBus` implementations behind config (`EVENT_BUS_MODE`):
- `inproc` (default when no bus configured): a Node `EventEmitter`; in-process
  subscribers can react now. The outbox row is the durable record and marks
  `published_at` on success.
- `bus` (when `EVENT_BUS_URL` is set): publishes to the real on-box bus. A background
  **outbox relay** drains rows with `published_at IS NULL` and retries — so events
  survive a crash between write and publish, and back-fill once the bus appears.

This satisfies REQ-029/029d today and needs only a new `EventBus` impl (not route or
service changes) when the bus lands. See `06-risks.md` for the open dependency.

## (d) Ollama model discovery (§7.10)

`GET /api/models/ollama` → BFF `engine/ollama.ts` calls Ollama `GET {OllamaLLMBasePath}/api/tags`
server-side (REQ-075). The browser never calls Ollama. On unreachable/timeout/non-OK, the
route returns `{ unavailable: true, message }` and the web app degrades the field to
validated free-text with a non-blocking warning (REQ-076); other fields still save.
Applies to workspace `llmModel`/`agentLlmModel`, `OllamaLLMModelPref`, and the Ollama
embedding model whenever the effective provider/engine is `ollama` (REQ-077, REQ-036a).
For non-Ollama providers, discovery is not attempted; free-text validation applies
(REQ-064a).

## (e) Guarded raw-env editor (§7.11)

- **Advanced-mode ack (REQ-078):** write controls inert until the operator acknowledges;
  UI state only.
- **Read source (REQ-078a):** `GET /api/settings/raw` maps `GET /v1/system` → `RawEnvEntry[]`:
  non-secret keys show `state:'value'` + value; secret keys show `state:'set'|'notSet'`
  (no value); keys accepted by `update-env` but not returned by any read show
  `state:'unknown'` and are write-only.
- **Keys as opaque strings (REQ-078e):** the web editor holds NO hardcoded engine key
  identifiers; it fetches the valid key set from the BFF and posts `{key,value}[]`.
- **Whitelist (REQ-078b/096):** validated against the exact 186-key set in
  `engine/env-keys.ts` (single source of truth), client- and server-side; unknown → 400,
  never forwarded.
- **Masked diff + typed token (REQ-078c, §8 REQ-088a):** before `PUT /api/settings/raw`
  the UI shows `key → new state` (secrets masked as "will be set/overwritten"; non-secrets
  show new value) and requires an exact typed confirmation token. BFF re-validates.
- **Audit + event (REQ-078d):** a verified write produces one audit entry and one
  `admin.raw_env.written` event, both listing key names with secret values redacted.

## (f) Secret handling (§7.0)

- Secret-bearing keys render "set / not set" from the `GET /v1/system` boolean, never
  plaintext (REQ-060). The BFF knows which keys are secret via a secret-key set in
  `engine/env-keys.ts`.
- **Overwrite-without-reveal (REQ-061):** stored values are never sent to the browser or
  pre-filled. A blank secret field is dropped from the patch (no accidental clear); a
  non-empty value is sent as exactly that key.
- Secret values transit browser → BFF → `update-env` only and are never logged in
  plaintext (REQ-062/094): the logger + audit `detail` redact known secret keys' values.

## (g) Error mapping + the two 403 cases (§4.5, §10.2)

`server/errors.ts` maps `EngineError` (thrown by the adapter) to a product status +
`{message}` the web renders verbatim (REQ-097a):

```ts
403 key-rejection    → 403 "AnythingLLM rejected the API key — check ANYTHINGLLM_API_KEY (server configuration)."
403 authz/precondition → 403 "AnythingLLM refused this action: multi-user mode may be off or the operation is not permitted for this API key."
400 → 400 {message}  (validation; field-level where derivable)
401 → "AnythingLLM authentication failed"
404 → "The requested AnythingLLM resource was not found"
429 → "AnythingLLM is rate limiting — retry shortly"  (retryable)
5xx/network/other → "AnythingLLM is unavailable or returned an error"  (retryable)
```

Disambiguating the two 403s (REQ-023, MA-3): the adapter inspects the engine response
body/shape — a key-auth rejection (invalid/revoked developer key) vs an
authorization/precondition refusal (multi-user off, or action not permitted for the key).
The mapping rule: a 403 on any route when the key is structurally rejected → key-rejection
message; a 403 tied to an operation that needs multi-user/role → precondition message.
Verify-after-write failures return a distinct 409 "could not confirm the change was saved"
(REQ-028), and a non-OK `update-env` yields the no-partial-success state (REQ-098).

## (h) Config via requireEnv (mirrors sibling `bff/src/config.ts`)

```ts
export const config = {
  anythingLLMBaseUrl: requireEnv('ANYTHINGLLM_BASE_URL').replace(/\/$/, ''), // REQ-001
  anythingLLMApiKey:  requireEnv('ANYTHINGLLM_API_KEY'),                     // REQ-001, REQ-013
  port: parseInt(process.env.PORT ?? '3002', 10),                            // REQ-020
  adminBootstrapUsername: requireEnv('ADMIN_BOOTSTRAP_USERNAME'),            // REQ-019a
  adminBootstrapToken:    requireEnv('ADMIN_BOOTSTRAP_TOKEN'),               // REQ-019a
  sessionSecret:  requireEnv('SESSION_SECRET'),                              // cookie signing
  secretsKey:     requireEnv('SECRETS_ENC_KEY'),                             // encrypt totp secrets at rest
  dbPath: process.env.DB_PATH ?? 'data/console.db',
  corsMode: process.env.NODE_ENV === 'production' ? 'strict' : 'permissive', // REQ-095
  webOrigins: (process.env.WEB_ORIGINS ?? '').split(',').filter(Boolean),    // REQ-095 strict allowlist
  eventBusMode: process.env.EVENT_BUS_MODE ?? 'inproc',                      // (c)
  eventBusUrl:  process.env.EVENT_BUS_URL,
} as const;
```

Missing `ANYTHINGLLM_*` or bootstrap vars → process exits at startup (REQ-001, REQ-019a
tests). CORS: strict allowlist in production (`webOrigins`), permissive in dev (REQ-095).
