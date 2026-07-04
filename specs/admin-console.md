# AnythingLLM Administration Console — Specification v1

Status: Draft rev 3 (spec-review resolutions applied) — for implementation and QA
Grounding reference: `docs/anythingllm-surface.md` (authoritative; captured from the live
instance on 2026-07-03). Every functional requirement below cites the concrete endpoint(s)
and/or field(s) from that document.
Change history: rev 1 initial draft; rev 2 folded resolved decisions OQ-1..OQ-6 (§12);
rev 3 applied spec-review resolutions BL-1..NI-3 (§13).

Section numbers (§1, §1.1, …) and requirement IDs (REQ-###) are **stable**. Downstream tests
cite them. Never renumber or reuse an ID; append new sections/IDs or mark items **DEPRECATED**.

> **Verified API-auth facts** (from AnythingLLM source, treated as ground truth in this rev):
> `POST /system/enable-multi-user` and `GET /system/api-keys` require SESSION auth
> (`validatedRequest`), NOT the developer API key — they are **unreachable** by our BFF (which
> holds only the API key). All `/v1/admin/*` user/invite/membership routes DO accept the API key
> but only function once multi-user mode is already ON. `GET /v1/workspaces` returns each
> workspace's numeric `id`; `GET /v1/documents` lists documents.

---

## §1 Overview

### §1.1 Purpose
The AnythingLLM Administration Console (the "console") is an internal, staff-operated web
application for administering a **single** customer's self-hosted AnythingLLM installation. It
exposes the administrative surface of the native AnythingLLM admin UI reachable via the
developer API key: workspace management, user/role/invite management, and all instance-wide
settings (grounding §3–§5). Capabilities that AnythingLLM gates behind session auth (API-key
administration, enabling multi-user mode) are out of scope for the BFF — see §11.

### §1.2 Deployment model
- REQ-001 — Each console deployment targets exactly one AnythingLLM instance, configured by
  `ANYTHINGLLM_BASE_URL` and `ANYTHINGLLM_API_KEY` on the BFF (grounding §6, mirrors
  `bff/src/config.ts` `requireEnv`). No multi-tenant isolation is implemented within a
  deployment. *Test:* boot the BFF without either variable → process exits with a missing-env
  error; boot with both → `/health` returns `{ ok: true }`.
- REQ-002 — The console assumes one instance == one customer with multiple end-users
  (grounding §1). Cross-instance switching at runtime is out of scope (§11).

### §1.3 Two-app division of responsibility
- REQ-003 — The console owns, and the customer-facing chat app does NOT expose: workspace
  settings editing, workspace create/delete, and all instance-wide settings (grounding §2
  table). *Test:* every capability in §5 and §7 is reachable in the console.
- REQ-004 — The console provides FULL user management (create/invite/edit/remove users, set
  roles), overlapping intentionally with the customer app (grounding §2). Coexistence rules in
  §9 apply.

---

## §2 Definitions & Glossary

- **BFF** — Backend-for-Frontend: Fastify + TypeScript service that injects the AnythingLLM API
  key and proxies to `/api/v1`. Mirrors `front-end-custom/bff`.
- **Web** — React + TypeScript + Vite front-end. Mirrors `front-end-custom/web`.
- **Upstream** — the AnythingLLM instance at `ANYTHINGLLM_BASE_URL`, developer API `/api/v1`.
- **Staff / operator** — an authenticated user of THIS console. Distinct from AnythingLLM
  end-users (grounding §1, §4).
- **End-user** — a user record in the customer's AnythingLLM `users` table (grounding §4).
- **Secret-bearing setting** — an env key whose value `GET /v1/system` returns as a boolean
  (set/unset), never plaintext (grounding §5, §5.8 note).
- **Effective provider** (MA-5) — for a given model field, the workspace's own `chatProvider`
  (or `agentProvider` for agent fields) if set, otherwise the system `LLMProvider` (grounding
  §3, §5.1). Live-Ollama model discovery (dropdown, §7.10) applies when the effective provider is
  `ollama`; otherwise the field is validated free-text.
- **Authorized staff** (BL-4) — any authenticated staff operator (there is a single role,
  REQ-010). Staff-lifecycle actions are permitted to any authorized staff, subject to the
  self-/last-account guardrails in REQ-018a.
- **Dangerous operation** — an action that can destroy data or invalidate embeddings/access;
  enumerated in §8.

---

## §3 Actors & Authentication

### §3.1 Actors
- REQ-010 — There is exactly one actor role in v1: **staff operator**. Staff authentication is
  independent of the customer's AnythingLLM user store (grounding §1, §2 confirmed decisions).

### §3.2 Console authentication — local credential store + mandatory TOTP MFA (resolves OQ-1)
Staff auth is **local, BFF-owned** (NOT SSO/OIDC): the BFF maintains its own staff-account store
with securely hashed passwords, and every login additionally requires a TOTP second factor. This
account store is entirely independent of the AnythingLLM `users` table and API key.

- REQ-011 — The console has its own login. The BFF authenticates staff against a local staff
  account store and establishes a session; the browser never receives the AnythingLLM API key.
  *Test:* inspect every network response reaching the browser and every served JS bundle — none
  contains the value of `ANYTHINGLLM_API_KEY`.
- REQ-012 — All BFF routes except the login/MFA route(s) and `/health` require a valid staff
  session. *Test:* calling any `/api/*` admin route without a session cookie/token returns
  `401`.
- REQ-013 — The AnythingLLM API key is held only in BFF process configuration and is attached
  server-side as `Authorization: Bearer <key>` on every upstream call (mirrors `authHeaders()`
  in `bff/src/index.ts`). *Test:* a captured upstream request bears the header; the same header
  is absent from any browser-originated request.
- REQ-014 — Staff session expiry and logout are supported. On expiry or logout, subsequent
  `/api/*` calls return `401` and the web app routes to login. *Test:* invalidate the session →
  next admin call yields `401` and a redirect to `/login`.
- REQ-015 — Staff passwords are stored only as a salted hash using a memory-hard/adaptive
  algorithm (argon2id preferred, bcrypt acceptable); plaintext passwords are never stored or
  logged. *Test:* the stored credential record contains an argon2/bcrypt hash string, not the
  plaintext; a wrong password yields `401`.
- REQ-016 — **TOTP MFA is mandatory for every staff account.** Login is a two-step flow:
  (1) username + password verification, then (2) a valid TOTP code (RFC 6238, 30s window,
  authenticator app). A session is issued only after BOTH factors pass. *Test:* correct password
  with a missing/invalid TOTP code does not issue a session (`401`); correct password + valid
  code does.
- REQ-017 — **MFA enrollment on first login.** On a staff account's first successful password
  login before a TOTP secret exists, the console forces TOTP enrollment (display secret/QR,
  confirm with a valid code) before granting any admin access, and issues one-time recovery
  codes. *Test:* a freshly created account cannot reach `/api/*` admin routes until enrollment
  completes.
- REQ-018 — **Staff account lifecycle.** Any authorized staff (§2) can, for staff accounts:
  create, disable/re-enable (a disabled account cannot log in), delete, and password reset.
  Disabling is reversible and distinct from deletion. *Test:* a disabled staff account is refused
  at step (1) with `401`; re-enabling restores login.
- REQ-018a — **Lifecycle guardrails (BL-4).** An operator MUST NOT be able to disable or delete
  (a) their own currently-authenticated account, or (b) the LAST remaining enabled staff account.
  Attempts are rejected by the BFF (`409`/`403` with an explanatory `message`) and never applied.
  Every staff-lifecycle action (create/disable/re-enable/delete/password-reset) and every MFA
  reset is audited per REQ-093/093a. *Test:* an operator disabling their own account is rejected;
  disabling the only enabled account is rejected; each successful lifecycle action produces one
  audit entry.
- REQ-019 — **MFA reset & recovery.** Staff can authenticate with a one-time recovery code when
  the authenticator is unavailable (each recovery code is single-use), and any authorized staff
  (§2) can reset another account's TOTP enrollment (forcing re-enrollment per REQ-017); the
  self-/last-account guardrails of REQ-018a do not restrict MFA reset. Recovery codes and TOTP
  secrets are stored hashed/encrypted, never in plaintext logs, and every MFA reset is audited.
  *Test:* a recovery code logs in once then is rejected on reuse; a reset TOTP forces
  re-enrollment and produces an audit entry.
- REQ-019a — **First staff-account bootstrap (BL-5).** On a fresh deployment with an empty staff
  store, the BFF seeds exactly ONE initial staff account from startup configuration: username
  from `ADMIN_BOOTSTRAP_USERNAME` and a one-time setup credential from `ADMIN_BOOTSTRAP_TOKEN`
  (both required env vars via `requireEnv`, mirroring `bff/src/config.ts`). The bootstrap account
  MUST, on first login, set a new password (invalidating `ADMIN_BOOTSTRAP_TOKEN`) AND enroll MFA
  per REQ-017 before any admin access is granted. The seed runs only when the staff store is
  empty; it never overwrites existing accounts. No unauthenticated public "create first admin"
  web endpoint exists. *Test:* with an empty store and both env vars set, the bootstrap account
  can log in once with the token and is forced through password-set + MFA enrollment; with a
  non-empty store, no seed occurs; the setup token is rejected after first use.

---

## §4 Architecture

### §4.1 Package structure
- REQ-020 — The repo is two packages: `bff/` (Fastify + TypeScript) and `web/` (React +
  TypeScript + Vite), mirroring the customer app (grounding §6). Default ports: BFF `3002`, web
  dev server `5173`; Vite proxies `/api/*` to the BFF. *Test:* `web` dev config proxies
  `/api/*`; `bff` listens on `config.port` (default `3002`).

### §4.2 Route/client pairing (mandatory pattern)
- REQ-021 — Every browser-exposed capability MUST have (a) a BFF route that injects auth and
  maps upstream errors, and (b) a typed web client function calling only the BFF (relative
  `/api/*` path). The browser MUST NEVER call AnythingLLM directly. *Test:* static check — no
  `web/` source references `ANYTHINGLLM_BASE_URL` or an absolute upstream URL; every web client
  call targets `/api/*`.
- REQ-022 — BFF routes forward to the corresponding `/api/v1/...` upstream path, `slug`/`id`
  path params URL-encoded (mirrors `encodeURIComponent` usage in `bff/src/index.ts`). *Test:* a
  slug containing a space/`/` is encoded before reaching upstream.
- REQ-023 — Upstream error mapping (MA-3, NI-3). The BFF forwards the upstream status and returns
  a JSON `{ message }` body that the web app renders verbatim (REQ-097a). The console defines no
  streaming routes, so there is no streaming-specific mapping. Two distinct `403` cases MUST be
  disambiguated by the BFF:
  - **Key-rejection 403** (the developer API key is invalid/revoked): `403 { message: "AnythingLLM
    rejected the API key — check ANYTHINGLLM_API_KEY (server configuration)." }`.
  - **Authorization/precondition 403** (e.g. multi-user mode off, or the action needs a role the
    key lacks): `403 { message: "AnythingLLM refused this action: multi-user mode may be off or
    the operation is not permitted for this API key." }`.
  `400 → 400 { message }` (validation); other non-OK → upstream status with a `{ message }` body
  (default operator text per REQ-097). *Test:* stub the two `403` variants and assert distinct
  `message` bodies; stub `400/404/429/500` and assert the status is forwarded with a `{ message }`.
- REQ-024 — The BFF exposes `GET /health → { ok: true }` and does not require a session for it
  (mirrors existing BFF). *Test:* unauthenticated `GET /health` returns `200 { ok: true }`.

### §4.3 Typed contracts
- REQ-025 — Request/response shapes for every route are declared as TypeScript interfaces in
  `bff/src/types.ts` and mirrored in `web/src/types/`, derived from the field lists in grounding
  §3–§5. *Test:* type-check passes; a workspace update body only permits fields enumerated in
  §5.2.

---

## §5 Workspaces

Endpoints (grounding §3): `GET /api/v1/workspaces`, `GET /api/v1/workspace/{slug}`,
`POST /api/v1/workspace/new`, `POST /api/v1/workspace/{slug}/update`,
`DELETE /api/v1/workspace/{slug}`, `POST /api/v1/workspace/{slug}/update-embeddings`,
`POST /api/v1/workspace/{slug}/update-pin`.

### §5.1 Listing & viewing
- REQ-030 — The console lists all workspaces via BFF `GET /api/workspaces` → upstream
  `GET /v1/workspaces`, showing at minimum `name`, `slug`, and configured `chatProvider` /
  `chatModel` (grounding §3). *Test:* list renders one row per workspace returned upstream.
- REQ-031 — Selecting a workspace loads its full settings via BFF `GET /api/workspace/:slug` →
  upstream `GET /v1/workspace/{slug}` and displays every editable field in §5.2. *Test:* each
  field value matches the upstream response.

### §5.2 Editing settings
- REQ-032 — The console edits, via BFF `POST /api/workspace/:slug/update` → upstream
  `POST /v1/workspace/{slug}/update`, all per-workspace fields (grounding §3): `name`,
  `chatProvider`, `chatModel`, `chatMode` (`chat`|`query`), `openAiTemp`, `openAiHistory`,
  `openAiPrompt` (system prompt), `similarityThreshold`, `topN`, `agentProvider`, `agentModel`,
  `queryRefusalResponse`, `vectorSearchMode`, `pfpFilename`. *Test:* changing each field and
  saving results in the corresponding key in the upstream request body; re-fetch reflects it.
- REQ-033 — The update request body contains ONLY fields the operator changed; omitted fields
  are left untouched upstream (grounding §3 "only provided fields are changed"). *Test:* edit
  only `openAiTemp` → request body has exactly `{ openAiTemp }`.
- REQ-034 — `chatMode` selection is constrained to `chat` or `query` (grounding §3); the editor
  offers exactly those two options and never `automatic`. **Out-of-range incoming value (BL-3):**
  if a workspace's fetched `chatMode` is any value outside {`chat`,`query`} (e.g. `automatic` set
  by the customer app), the editor displays that value read-only/as-is, does NOT list it as a
  selectable option, and MUST NOT write `chatMode` back unless the operator explicitly changes it
  to `chat` or `query` (partial-write per REQ-033). *Test:* loading a workspace with
  `chatMode:"automatic"` shows it read-only; saving an unrelated field does not include
  `chatMode` in the request body; the selector still exposes only `chat` and `query`.
- REQ-035 — Numeric fields are validated before submit with pinned inclusive bounds (MA-6):
  `openAiTemp` — float, `0.0 ≤ x ≤ 2.0` (enforced upper cap 2.0); `openAiHistory` — integer
  `≥ 0`; `similarityThreshold` — float, `0.0 ≤ x ≤ 1.0` inclusive; `topN` — integer `≥ 1`.
  Invalid input is rejected client-side with a field error and not sent. *Test:* `topN = 0`
  blocks submit; `similarityThreshold = 1.5` blocks submit; `openAiTemp = 2.5` blocks submit;
  `similarityThreshold = 0.0` and `= 1.0` are accepted.
- REQ-036 — `null`/inherit semantics (MA-6): clearing a nullable field to inherit its default is
  performed by sending JSON `null` for that key (NOT an empty string) via
  `POST /v1/workspace/{slug}/update`; omitting a key entirely means "no change" (REQ-033). This
  applies to `chatProvider`/`chatModel`/`agentProvider`/`agentModel` and other nullable fields,
  per grounding §3 ("null = inherit system default"). *Test:* clearing `chatModel` sends
  `{ "chatModel": null }` and the workspace inherits the system default on re-fetch; an untouched
  `chatModel` is absent from the body.
- REQ-036a — **Model selection uses live Ollama discovery (resolves OQ-3; MA-5).** When the
  **effective provider** (§2) for a workspace model field is `ollama`, `chatModel` and
  `agentModel` are chosen from a dropdown populated from the live pulled-model list via the model
  discovery route (§7.10, REQ-075). For any other effective provider, the field is validated
  free-text (REQ-064a). If Ollama is unreachable, the field degrades gracefully to free-text with
  a surfaced warning (REQ-076). *Test:* with effective provider `ollama` and Ollama reachable,
  `chatModel` is a dropdown of pulled models; with a non-Ollama effective provider or Ollama
  unreachable, it is free-text.

### §5.3 Create & delete
- REQ-037 — The console creates a workspace via BFF `POST /api/workspace/new` → upstream
  `POST /v1/workspace/new` with at least a `name`; upstream assigns the unique `slug`
  (grounding §3). *Test:* creating "Support KB" returns a workspace with a non-empty `slug`.
- REQ-038 — Workspace deletion (BFF `DELETE /api/workspace/:slug` → upstream
  `DELETE /v1/workspace/{slug}`) is a **dangerous operation** governed by §8. *Test:* see
  REQ-081.

### §5.4 Documents & pins
- REQ-039 — The console can attach and detach workspace documents via BFF
  `POST /api/workspace/:slug/update-embeddings` → upstream
  `POST /v1/workspace/{slug}/update-embeddings` and pin/unpin via
  `POST /v1/workspace/{slug}/update-pin` (grounding §3). The selectable document list is sourced
  from BFF `GET /api/documents` → upstream `GET /v1/documents` (MI-5). `update-embeddings`
  supports both `adds` and `deletes` (attach/detach). Detaching/removing documents is a
  **dangerous operation** governed by §8. *Test:* the attach picker is populated from
  `GET /v1/documents`; attaching a doc adds it; detaching triggers the §8 confirmation.

---

## §6 Users, Roles, Invites

Roles (grounding §4): `default`, `admin`, `manager`. All `/v1/admin/*` user/invite/membership
routes accept the developer API key but only FUNCTION once multi-user mode is already ON
(verified fact, see header). Enabling multi-user mode is a session-auth-only operation that the
BFF cannot perform; it is an out-of-band prerequisite (BL-2, §6.1, §11). AnythingLLM API-key
administration (`GET /system/api-keys`) is likewise session-auth-only and out of scope (§11).

### §6.1 Multi-user-mode precondition & blocked state (BL-2)
- REQ-040 — Before rendering any §6 user-management view, the console detects multi-user state
  via BFF `GET /api/admin/is-multi-user-mode` → upstream `GET /v1/admin/is-multi-user-mode`. When
  multi-user mode is OFF, the console MUST block/disable ALL §6 user, invite, and
  workspace-membership UI and show a clear notice instructing the operator to enable multi-user
  mode **out-of-band in the native AnythingLLM UI** (the console cannot enable it — the enable
  route requires session auth). The console offers NO in-console "enable multi-user" action.
  *Test:* with `MultiUserMode:false`, the user/invite/membership controls are disabled and the
  out-of-band notice is shown; no request to any enable-multi-user route is issued; with
  `MultiUserMode:true`, the §6 UI is enabled.

### §6.2 Users
- REQ-041 — List users via BFF `GET /api/admin/users` → upstream `GET /v1/admin/users`, showing
  `username`, `role`, `suspended`, `dailyMessageLimit` (grounding §4). *Test:* one row per
  upstream user with those fields.
- REQ-042 — Create a user via BFF `POST /api/admin/users/new` → upstream
  `POST /v1/admin/users/new` with `username`, `password`, and `role` ∈ {`default`,`admin`,
  `manager`} (grounding §4). *Test:* role selector offers exactly those three values.
- REQ-043 — Edit a user via BFF `POST /api/admin/users/:id` → upstream
  `POST /v1/admin/users/{id}`, supporting `role`, `suspended` (0/1), and `dailyMessageLimit`
  (grounding §4). *Test:* suspending a user sets `suspended:1` upstream.
- REQ-044 — Delete a user via BFF `DELETE /api/admin/users/:id` → upstream
  `DELETE /v1/admin/users/{id}`; this is a **dangerous operation** governed by §8. *Test:* see
  REQ-082.

### §6.3 Invites
- REQ-045 — List invites via BFF `GET /api/admin/invites` → upstream `GET /v1/admin/invites`,
  showing `code`, `status` (default `pending`), `claimedBy`, `workspaceIds` (grounding §4).
  *Test:* each invite row shows code and status.
- REQ-046 — Create an invite via BFF `POST /api/admin/invite/new` → upstream
  `POST /v1/admin/invite/new`, optionally scoping to `workspaceIds` (csv) (grounding §4).
  *Test:* creating an invite with two workspaces stores both ids.
- REQ-047 — Delete/revoke an invite via BFF `DELETE /api/admin/invite/:id` → upstream
  `DELETE /v1/admin/invite/{id}` (grounding §4). *Test:* deleted invite disappears from list.

### §6.4 Workspace-user assignments
- REQ-048 — View which users may access a workspace via BFF
  `GET /api/admin/workspaces/:workspaceId/users` → upstream
  `GET /v1/admin/workspaces/{workspaceId}/users` (grounding §4, `workspace_users` join). The
  numeric `workspaceId` is obtained from `GET /v1/workspaces` (which returns each workspace's
  `id`). *Test:* list matches upstream membership.
- REQ-049 — **Normative membership endpoint (BL-1, MI-2).** Update workspace membership via BFF
  `POST /api/admin/workspaces/:slug/manage-users` → upstream
  `POST /v1/admin/workspaces/{workspaceSlug}/manage-users` with body `{ userIds: number[],
  reset: boolean }`. Semantics (verified): `reset:false` ADDS the given users to current
  membership; `reset:true` REPLACES membership with exactly the given users. This slug-keyed
  endpoint is the single normative path (no numeric-id `update-users` overwrite endpoint is
  used). *Test:* `manage-users` with `reset:false` and one `userId` adds that user without
  dropping existing members; `reset:true` with a set replaces membership with exactly that set.

### §6.5 API keys — out of scope (MA-1)
- REQ-050 — **RETIRED / moved to §11 (REQ-117).** AnythingLLM API-key administration is
  session-auth-only (`GET /system/api-keys` uses `validatedRequest`, not the developer API key)
  and is therefore unreachable by the BFF. API-key viewing/creation/rotation is a **non-goal**
  for v1 (§11 REQ-117). This ID is retained for traceability and MUST NOT be reused.

### §6.6 Oversight
- REQ-051 — Subject to the §6.1 multi-user precondition, the console may view workspace chat
  history for oversight via BFF proxy to upstream `POST /v1/admin/workspace-chats` (grounding §4).
  Chat EXPORT (`GET /v1/system/export-chats`) is a non-goal for v1 (§11 REQ-118). *Test:* the
  chat-oversight view issues the `workspace-chats` call and renders returned history; no
  export-chats route is exposed.

---

## §7 Instance-wide Settings

Read via BFF `GET /api/system` → upstream `GET /v1/system` (secrets returned as booleans;
grounding §5). Write via BFF `POST /api/system/update-env` → upstream
`POST /v1/system/update-env`. Diagnostics: `GET /v1/system/env-dump`,
`GET /v1/system/vector-count`.

The console MUST cover **every** category below and expose each category's active/representative
keys. The `update-env` handler accepts **186 keys** (grounding §5); the curated forms need not
surface one control per key but MUST provide full coverage of every category in §7.1–§7.8 and MUST
be able to write any accepted key they expose. Model-selection discovery is defined in §7.10 and
the guarded raw editor (which can write ANY accepted key) in §7.11.

### §7.0 Secret handling (applies to every category)
- REQ-060 — For every secret-bearing key, the UI shows a "**set** / **not set**" indicator
  derived from the boolean in `GET /v1/system`, never a plaintext value (grounding §5, §5.8
  note). *Test:* with `OpenAiKey` set upstream, the field shows "set" and no characters of the
  key.
- REQ-061 — Secrets support **overwrite-without-reveal**: staff may enter a new value that is
  sent via `POST /v1/system/update-env`, but the current stored value is never displayed or
  pre-filled. Submitting an empty secret field leaves the stored secret unchanged (no
  accidental clearing). *Test:* saving with a blank `OpenAiKey` field does not send `OpenAiKey`;
  entering a value sends exactly that key.
- REQ-062 — Secret values transit only browser → BFF → upstream `update-env`; they are never
  logged in plaintext by the BFF (§10). *Test:* BFF logs of an `update-env` containing a secret
  redact the value.

### §7.1 LLM provider selection
- REQ-063 — The console reads/writes `LLMProvider` and `ModelRouterId` (grounding §5.1). The
  active instance uses Ollama. Changing `LLMProvider` is a **dangerous operation** (§8, REQ-083).
  *Test:* selecting a provider writes `LLMProvider`; the change passes through the §8 guardrail.

### §7.2 LLM provider credentials/config (per provider)
- REQ-064 — The console exposes a per-provider configuration form for every provider group in
  grounding §5.2, writing that provider's keys via `update-env`. The console MUST cover all
  listed providers: OpenAI, Azure OpenAI, Anthropic, Gemini, LM Studio, LocalAI, **Ollama
  (active)**, Mistral, KoboldCPP, TextGenWebUI, LiteLLM, Generic OpenAI, AWS Bedrock, TogetherAI,
  FireworksAI, Perplexity, OpenRouter, Novita, Groq, Cohere, DeepSeek, Minimax, Cerebras, APIpie,
  xAI, Nvidia NIM, PPIO, Moonshot, Foundry, CometAPI, Z.AI, Gitee AI, Docker Model Runner,
  PrivateMode, SambaNova, Lemonade. *Test:* every provider in §5.2 is selectable and its
  config fields render.
- REQ-064a — **Non-Ollama model fields use validated free-text (resolves OQ-3).** For every
  non-Ollama provider, `*ModelPref`/model fields accept free-text model tags with format
  validation (non-empty, no whitespace-only, trimmed). *Test:* a blank or whitespace-only model
  tag blocks submit for a non-Ollama provider.
- REQ-065 — Representative active-provider coverage (Ollama): the console reads/writes
  `OllamaLLMBasePath`, `OllamaLLMModelPref`, `OllamaLLMTokenLimit`,
  `OllamaLLMKeepAliveSeconds`, and the secret `OllamaLLMAuthToken` (grounding §5.2).
  `OllamaLLMModelPref` is selected from the live pulled-model dropdown via §7.10 (REQ-075), with
  free-text fallback when Ollama is unreachable (REQ-076). *Test:* editing `OllamaLLMBasePath`
  sends exactly that key; `OllamaLLMAuthToken` obeys §7.0; `OllamaLLMModelPref` renders as a
  live-populated dropdown when Ollama is reachable.
- REQ-066 — Provider secret keys (e.g. `OpenAiKey`, `AnthropicApiKey`, `GeminiLLMApiKey`,
  `MistralApiKey`, `GroqApiKey`, `AwsBedrockLLMApiKey`, `OpenRouterApiKey`, and all other
  `*ApiKey`/`*Key`/`*AuthToken` fields in §5.2) are treated per §7.0. *Test:* each renders as
  set/not-set with overwrite-without-reveal.

### §7.3 Embedding
- REQ-067 — The console reads/writes the embedding group (grounding §5.3): `EmbeddingEngine`,
  `EmbeddingBasePath`, `EmbeddingModelPref`, `EmbeddingModelMaxChunkLength`,
  `EmbeddingOutputDimensions`, `OllamaEmbeddingBatchSize`, and secrets `GeminiEmbeddingApiKey`,
  `GenericOpenAiEmbeddingApiKey`, `VoyageAiApiKey`, plus
  `GenericOpenAiEmbeddingMaxConcurrentChunks`, `GenericOpenAiEmbeddingPassagePrefix`,
  `GenericOpenAiEmbeddingQueryPrefix`. Active: `EmbeddingEngine=ollama`,
  `EmbeddingModelPref=nomic-embed-text:v1.5`. When `EmbeddingEngine=ollama`, `EmbeddingModelPref`
  is selected from the live pulled-model dropdown via §7.10 (REQ-075) with free-text fallback
  (REQ-076); for non-Ollama embedding engines it is validated free-text (REQ-064a). Changing
  `EmbeddingEngine`/`EmbeddingModelPref` is a **dangerous operation** (§8, REQ-084). *Test:*
  changing `EmbeddingModelPref` passes through the embedding-change guardrail; with
  `EmbeddingEngine=ollama` and Ollama reachable, the field is a live dropdown.

### §7.4 Vector database
- REQ-068 — The console reads/writes the vector-DB group (grounding §5.4): `VectorDB` (active
  `lancedb`) plus per-backend config/secrets for Chroma (`ChromaEndpoint`, `ChromaApiHeader`,
  `ChromaApiKey`, `ChromaCloudApiKey`, `ChromaCloudTenant`, `ChromaCloudDatabase`), Weaviate
  (`WeaviateEndpoint`, `WeaviateApiKey`), Qdrant (`QdrantEndpoint`, `QdrantApiKey`), Pinecone
  (`PineConeKey`, `PineConeIndex`), Milvus (`MilvusAddress`, `MilvusUsername`, `MilvusPassword`),
  Zilliz (`ZillizEndpoint`, `ZillizApiToken`), AstraDB (`AstraDBApplicationToken`,
  `AstraDBEndpoint`), PGVector (`PGVectorConnectionString`, `PGVectorTableName`). Changing
  `VectorDB` is a **dangerous operation** (§8, REQ-084). *Test:* every backend's fields render;
  changing `VectorDB` requires the guardrail.

### §7.5 Agent skills
- REQ-069 — The console reads/writes the agent-skills group (grounding §5.5): search-provider
  secrets `AgentSerpApiKey`, `AgentSearchApiKey`, `AgentSerperApiKey`, `AgentBingSearchApiKey`,
  `AgentBaiduSearchApiKey`, `AgentSerplyApiKey`, `AgentTavilyApiKey`, `AgentExaApiKey`,
  `AgentPerplexityApiKey`, `AgentBraveApiKey`, `AgentCrwApiKey`; endpoints/engines
  `AgentSerpApiEngine`, `AgentSearchApiEngine`, `AgentSearXNGApiUrl`, `AgentCrwApiUrl`; and
  tuning `AgentSkillMaxToolCalls`, `AgentSkillRerankerEnabled`, `AgentSkillRerankerTopN`.
  Secrets obey §7.0. *Test:* toggling `AgentSkillRerankerEnabled` writes exactly that key.

### §7.6 Text-to-speech
- REQ-070 — The console reads/writes the TTS group (grounding §5.6): `TextToSpeechProvider`,
  `TTSOpenAIKey`, `TTSOpenAIVoiceModel`, `TTSElevenLabsKey`, `TTSElevenLabsVoiceModel`,
  `TTSPiperTTSVoiceModel`, `TTSOpenAICompatibleKey`, `TTSOpenAICompatibleModel`,
  `TTSOpenAICompatibleVoiceModel`, `TTSOpenAICompatibleEndpoint`, `TTSKokoroEndpoint`,
  `TTSKokoroKey`, `TTSKokoroVoiceModel`. Secrets obey §7.0. *Test:* selecting a TTS provider
  reveals that provider's fields.

### §7.7 Speech-to-text / transcription
- REQ-071 — The console reads/writes the STT group (grounding §5.7): `SpeechToTextProvider`,
  `STTOpenAIModel`, `STTLemonadeBasePath`, `STTLemonadeModelPref`, `STTDeepgramApiKey`,
  `STTDeepgramModel`, `STTOpenAICompatibleKey`, `STTOpenAICompatibleModel`,
  `STTOpenAICompatibleEndpoint`, `STTGroqApiKey`, `STTGroqModel`, `WhisperProvider`,
  `WhisperModelPref`. Secrets obey §7.0. *Test:* setting `STTDeepgramApiKey` obeys §7.0.

### §7.8 Security & system
- REQ-072 — The console reads/writes the security/system group (grounding §5.8): `AuthToken`,
  `JWTSecret` (secrets, §7.0), `DisableTelemetry`, and reflects live read-only flags
  `RequiresAuth`, `MultiUserMode`, `MemoryEnabled`, `MemoryAutoExtraction`,
  `HasExistingEmbeddings`, `HasCachedEmbeddings`. *Test:* `RequiresAuth`/`MultiUserMode` render
  from `GET /v1/system`; `DisableTelemetry` is writable.
- REQ-073 — **Multi-user mode is NOT toggled by the console (BL-2).** Enabling/disabling
  multi-user mode requires session auth (`POST /system/enable-multi-user`) and is unreachable by
  the BFF; it is an out-of-band prerequisite managed in the native AnythingLLM UI (§6.1). The
  console reads and displays `MultiUserMode` (REQ-072) but exposes no toggle. Changing
  `AuthToken`/`JWTSecret` via `update-env` remains a **dangerous operation** (§8, REQ-086).
  *Test:* the security settings view shows `MultiUserMode` read-only and offers no enable/disable
  control; no request to `enable-multi-user` is ever issued.

### §7.9 Diagnostics
- REQ-074 — The console surfaces `GET /v1/system/vector-count` and MAY surface
  `GET /v1/system/env-dump` for diagnostics (grounding §5). Any env-dump display MUST still mask
  secret-bearing values per §7.0. *Test:* vector count renders; env-dump view shows no plaintext
  secret.

### §7.10 Live model discovery (Ollama) (resolves OQ-3)
- REQ-075 — The BFF exposes a model-discovery route (e.g. `GET /api/models/ollama`) that fetches
  the pulled-model list from the Ollama instance at the configured `OllamaLLMBasePath` by calling
  Ollama's `GET /api/tags`, and a typed web client function that consumes it. The browser MUST
  NEVER call Ollama directly; discovery goes through the BFF (extends §4.2). *Test:* the web
  client calls only `/api/models/ollama`; the BFF issues the `/api/tags` request server-side; no
  browser request targets `OllamaLLMBasePath`.
- REQ-076 — **Graceful degradation.** If Ollama is unreachable, times out, or returns a non-OK
  response, the discovery route reports an error the web app maps to: fall back to validated
  free-text entry (REQ-064a) AND surface a non-blocking warning that the live model list is
  unavailable. Failure MUST NOT block editing/saving other fields. *Test:* with Ollama down, the
  model field renders as free-text with a visible warning, and other settings still save.
- REQ-077 — Model discovery applies to `chatModel`/`agentModel` (REQ-036a), `OllamaLLMModelPref`
  (REQ-065), and the Ollama embedding model (REQ-067) whenever the effective provider/engine is
  Ollama. For all non-Ollama providers, discovery is not attempted (REQ-064a governs). *Test:*
  switching a field's provider from Ollama to a non-Ollama provider disables the dropdown and
  reverts to free-text.

### §7.11 Guarded raw environment editor (resolves OQ-2)
Beyond the curated forms (§7.1–§7.8), the console provides an advanced editor that can read and
**write** arbitrary env keys accepted by `POST /v1/system/update-env`.

- REQ-078 — The raw editor is gated behind an explicit **"advanced mode" acknowledgement** before
  it is usable in a session. *Test:* the raw editor's write controls are inert until the operator
  acknowledges advanced mode.
- REQ-078a — **Raw editor read source (MA-2).** The raw editor reads current state as follows:
  non-secret current values come from the `settings` object of `GET /v1/system`; secret-bearing
  keys are shown as set/not-set (boolean) only, with overwrite-without-reveal (§7.0,
  REQ-060/061) — stored secret values are never displayed; keys accepted by `update-env` but not
  returned by any read endpoint are shown as "not returned / unknown" and are **write-only**. The
  masked `env-dump` remains read-only diagnostics (REQ-074). Writes go to
  `POST /v1/system/update-env`. *Test:* a secret key shows set/not-set never plaintext; a
  non-secret key shows its `GET /v1/system` value; a write-only key shows "not returned/unknown"
  and can still be written.
- REQ-078b — **Key whitelist enforcement (NI-1).** The raw editor validates every key against the
  exact accepted key set enumerated in grounding §5 (exactly 186 keys) — the single source of
  truth. Unknown keys are rejected client-side and by the BFF with `400` (reuses REQ-096) and
  never forwarded upstream. *Test:* submitting `NotARealKey` is rejected with `400` and does not
  reach upstream; every key in grounding §5 is accepted.
- REQ-078c — **Multi-key raw-write confirmation (MI-3).** Before a raw write proceeds, the editor
  displays a **masked diff** listing every key being written as `key → new state` (for secrets,
  the new state is shown masked as "will be set/overwritten", never the value; for non-secrets,
  the new value), and requires the operator to type a fixed confirmation token displayed on
  screen. The write is issued only on an exact token match (a dangerous operation under §8,
  REQ-088a). *Test:* the raw `update-env` call is not issued until the typed token matches the
  displayed token; the diff masks secret values.
- REQ-078d — Every raw-editor write is audit-logged (§10, REQ-093) with actor, key names (values
  redacted for secrets per REQ-062/094), timestamp, and outcome. *Test:* a raw write produces one
  audit entry listing the key names with secret values redacted.

---

## §8 Dangerous Operations & Guardrails

- REQ-080 — General rule: every operation classified as dangerous requires an explicit
  confirmation step that (a) names the exact target (workspace slug, username, provider,
  key/backend), (b) states the irreversible consequence, and (c) requires an affirmative action
  distinct from a single default-focused button (e.g. typed confirmation or an explicit
  "I understand" toggle). *Test:* the destructive call is not issued until the confirmation
  criterion is satisfied.
- REQ-081 — **Workspace delete** (`DELETE /v1/workspace/{slug}`, REQ-038): confirmation MUST
  require the operator to type the workspace `slug`. *Test:* mismatched slug keeps the delete
  button disabled; matching slug enables it and issues the delete.
- REQ-082 — **User delete** (`DELETE /v1/admin/users/{id}`, REQ-044): confirmation names the
  `username` and warns that the user loses access. *Test:* delete call fires only after
  confirmation.
- REQ-083 — **Change LLM provider** (`LLMProvider`, REQ-063): guardrail warns that chat behavior
  changes instance-wide and that workspaces inheriting the default are affected. *Test:*
  changing `LLMProvider` without confirming does not call `update-env`.
- REQ-084 — **Change embedding provider/model or vector DB** (`EmbeddingEngine`,
  `EmbeddingModelPref`, `VectorDB`; REQ-067, REQ-068): guardrail warns that existing embeddings
  may be **invalidated / incompatible** and re-embedding may be required, referencing
  `HasExistingEmbeddings` / vector-count where available. *Test:* the warning text is shown and
  the change is gated behind explicit confirmation.
- REQ-085 — **DEPRECATED (BL-2).** The former in-console "enable multi-user mode" guardrail is
  removed: the console performs no multi-user enable/disable (§7.8 REQ-073, §6.1 REQ-040).
  Multi-user mode is an out-of-band prerequisite. This ID is retained for traceability and MUST
  NOT be reused. (The prior "§7.3" cross-reference was erroneous; the security settings live in
  §7.8 — NI-2.)
- REQ-086 — **Change `AuthToken` / change `JWTSecret`** (§7.8, REQ-072/073): via `update-env`,
  guardrail warns of forced-logout / lockout risk for the customer app and any AnythingLLM
  sessions. (Multi-user disable is NOT a console action — BL-2, REQ-073.) *Test:* changing
  `AuthToken` or `JWTSecret` is gated behind explicit confirmation.
- REQ-087 — **Remove documents** (`DELETE /v1/system/remove-documents`, and workspace
  detach/`update-embeddings` per REQ-039): confirmation names affected scope and warns the vector
  data is deleted. *Test:* remove-documents call fires only after confirmation.
- REQ-088 — Every dangerous operation is recorded in the audit log (§10, REQ-093) with actor,
  target, timestamp, and outcome. *Test:* a confirmed workspace delete produces one audit entry.
- REQ-088a — **Raw environment write** (§7.11, REQ-078c): each raw `update-env` write is a
  dangerous operation requiring the masked-diff + fixed-confirmation-token step (REQ-078c),
  key-whitelist validation (REQ-078b), and audit logging (REQ-078d). *Test:* a raw write is not
  issued until the typed token matches the displayed token, and an unknown key is rejected before
  any confirmation.

---

## §9 Coexistence with the Customer App

Both this console and the customer-facing app operate against the **same** AnythingLLM instance
(grounding §2). This section governs shared concerns.

- REQ-090 — **MultiUserMode is shared instance state (read-only in this console).** The console
  reads current `MultiUserMode` from `GET /v1/system` / `GET /v1/admin/is-multi-user-mode` and
  reflects live upstream state (never a cached assumption), but does NOT toggle it (BL-2,
  REQ-073, REQ-040). Because enabling is out-of-band, coordination with the customer app about
  the mode is informational only. *Test:* the displayed `MultiUserMode` matches live upstream and
  no console control mutates it.
- REQ-091 — **Avoid clobbering concurrent edits.** For workspace and instance-settings edits,
  the console MUST submit only operator-changed fields (REQ-033, REQ-061) so it never overwrites
  fields it did not display, reducing the risk of reverting changes made via the customer app or
  native UI. *Test:* editing one workspace field never resends unrelated fields.
- REQ-092 — **Fresh-read before dangerous writes.** Before a dangerous instance-settings change
  (§8), the console re-reads `GET /v1/system` and shows the current value so the operator acts on
  live state. *Test:* opening the confirmation dialog triggers a fresh `GET /v1/system`.

---

## §10 Non-Functional Requirements

### §10.1 Security
- REQ-093 — The BFF maintains an **audit log** of all mutating operations (POST/DELETE proxies)
  recording actor (staff identity), method+route, target identifiers, timestamp, and
  success/failure. *Test:* a successful `update-env` and a failed one each produce an audit entry
  with outcome.
- REQ-093a — **Audit-log persistence (resolves OQ-5).** Audit records are written to BOTH
  structured stdout logs AND a BFF-local append-only audit store (append-only: existing entries
  are never mutated or deleted by the app), designed to be shippable to a central logging system
  later. Staff-auth events (login success/failure, MFA enrollment/reset, account create/disable,
  password reset per §3.2) are audited alongside upstream mutations. *Test:* a mutating operation
  appears in both stdout and the append-only store; an attempt to overwrite an existing store
  entry via the app is not possible.
- REQ-094 — Secrets (AnythingLLM API key, staff credentials/tokens, and any secret-bearing env
  value in transit) are never written to logs in plaintext (extends REQ-062). *Test:* grep of
  BFF logs after an `update-env` with a secret finds no plaintext secret.
- REQ-095 — CORS is environment-specific (MI-6): in **production** the BFF restricts allowed
  origins to the console's own configured web origin(s) — the customer app's permissive
  `origin:true` is NOT acceptable for an admin tool; in **development** a permissive origin
  (e.g. the Vite dev server, `origin:true`) is allowed for local workflow. The mode is selected
  by environment configuration, defaulting to the restrictive production policy when unset.
  *Test:* in production config a request from a disallowed origin is rejected; in dev config the
  local dev origin is accepted.
- REQ-096 — The BFF validates/whitelists inbound `update-env` keys against the exact accepted key
  set enumerated in grounding §5 (exactly 186 keys; the single source of truth, NI-1) before
  forwarding, rejecting unknown keys with `400`. *Test:* posting an unrecognized env key returns
  `400` and does not reach upstream.

### §10.2 Error handling
- REQ-097 — Upstream errors are mapped and surfaced to the operator with actionable messages
  (extends REQ-023, MA-3/MI-1):
  - `403` (key-rejection) → config-problem message naming `ANYTHINGLLM_API_KEY` (not operator
    input);
  - `403` (authorization/precondition) → message noting multi-user mode may be off or the action
    is not permitted for this key;
  - `400` → field-level validation feedback where derivable;
  - **default mapping for other statuses (MI-1):** `401` → "AnythingLLM authentication failed";
    `404` → "The requested AnythingLLM resource was not found"; `429` → "AnythingLLM is rate
    limiting — retry shortly" (retryable); `5xx` / network / any other non-OK → a generic
    retryable "AnythingLLM is unavailable or returned an error" state.
  *Test:* stubbed `401/403(key)/403(authz)/404/429/500` each render the corresponding operator
  message.
- REQ-097a — **Verbatim message rendering (MA-3).** The web app renders the BFF-provided
  `{ message }` string verbatim for the error banner/field (the BFF is the authority for operator
  text per REQ-023/097). *Test:* a BFF `403 { message: "…" }` appears character-for-character in
  the UI.
- REQ-098 — No partial-success ambiguity: if an `update-env` write returns non-OK, the UI states
  that the change was NOT saved and does not show the new value as persisted. *Test:* forced
  upstream failure leaves the field showing its prior state.

### §10.3 Observability
- REQ-099 — The BFF emits structured logs (mirrors Fastify logger in `bff/src/index.ts`) with a
  correlation id per request, and never logs secrets (REQ-094). *Test:* each request log line
  carries a request/correlation id.

### §10.4 Performance & limits
- REQ-100 — Read views (workspace list, user list, system settings) render within p95 < 1500 ms
  under a nominal single-instance load (≤ 200 workspaces, ≤ 500 users), assuming a responsive
  upstream. *Test:* measured p95 for `GET /api/workspaces` render is under threshold with seeded
  data.
- REQ-101 — The instance-settings screen loads `GET /v1/system` once per view open and batches an
  operator's edits into a single `POST /v1/system/update-env` submission. *Test:* saving five
  changed keys issues exactly one upstream `update-env` call.

---

## §11 Out of Scope (Non-Goals)

- REQ-110 — Multi-tenant isolation within a single deployment (one instance == one customer).
- REQ-111 — End-user chat / RAG conversation UI (owned by the customer app, grounding §2).
- REQ-112 — Runtime switching between multiple AnythingLLM instances from one console session.
- REQ-113 — Managing the AnythingLLM server process, OS, containers, backups, or upgrades.
- REQ-114 — Editing AnythingLLM source, migrations, or the Prisma schema.
- REQ-115 — Billing, licensing, or provider-account provisioning outside AnythingLLM.
- REQ-116 — Direct browser-to-AnythingLLM calls or exposing the API key to the browser (forbidden
  by §4).
- REQ-117 — **AnythingLLM API-key administration (MA-1).** Viewing/creating/rotating/deleting
  AnythingLLM API keys is out of scope for v1: `GET /system/api-keys` (and key mutation) require
  session auth (`validatedRequest`), which the BFF (developer-API-key only) cannot satisfy.
  Supersedes retired REQ-050.
- REQ-118 — **Chat export (MA-4).** `GET /v1/system/export-chats` is out of scope for v1
  (oversight viewing via `POST /v1/admin/workspace-chats` remains, REQ-051).
- REQ-119 — **User impersonation (MI-4).** Issuing end-user auth tokens via
  `GET /v1/users/{id}/issue-auth-token` is out of scope for v1.
- REQ-120 — **Enabling/disabling multi-user mode (BL-2).** `POST /system/enable-multi-user`
  requires session auth and is unreachable by the BFF; multi-user mode is an out-of-band
  prerequisite enabled in the native AnythingLLM UI (§6.1, §7.8 REQ-073).

---

## §12 Resolved Decisions

All prior open questions are RESOLVED by the product owner (2026-07-03). OQ-N ids are retained
for traceability; each decision is folded into the requirements cited below.

- OQ-1 — **Staff-auth mechanism: RESOLVED → local credential store + mandatory TOTP MFA (NOT
  SSO/OIDC).** The BFF owns a local staff-account store with securely hashed passwords
  (argon2id/bcrypt); every login requires a TOTP second factor (enrollment on first login,
  verification each login), with recovery codes and MFA reset. The AnythingLLM API key remains
  server-side and independent of staff auth. *Rationale:* self-contained per-deployment operation
  with no external IdP dependency, while MFA enforces strong operator authentication for a
  high-privilege tool. *Folded into:* §3.2 REQ-011, REQ-015–REQ-019.
- OQ-2 — **Raw env editing: RESOLVED → curated forms PLUS a guarded, WRITABLE raw editor**
  (upgraded beyond the earlier read-only default). Curated category forms remain the primary
  path; an advanced editor can read and write any accepted key, gated behind an advanced-mode
  acknowledgement, per-write typed confirmation, key-whitelist validation, secret masking with
  overwrite-without-reveal, and full audit logging. The masked read-only `env-dump` diagnostics
  view is retained. *Rationale:* operators need to reach any of the ~186 keys during support/
  break-glass work without a code change, while guardrails contain the blast radius. *Folded
  into:* §7.11 REQ-078–REQ-078d, §7.9 REQ-074, §8 REQ-088a, §10 REQ-096.
- OQ-3 — **Model discovery: RESOLVED → live Ollama discovery now.** Ollama model fields
  (workspace `chatModel`/`agentModel`, instance `OllamaLLMModelPref`, Ollama embedding model) are
  populated from the live pulled-model list via a BFF route calling Ollama `GET /api/tags` at the
  configured `OllamaLLMBasePath` (never from the browser). Non-Ollama providers use validated
  free-text; Ollama-unreachable degrades to free-text with a warning. *Rationale:* Ollama is the
  active provider and exposes a reliable tag list, eliminating typo-prone free-text for the common
  case while staying resilient. *Folded into:* §5.2 REQ-036a, §7.2 REQ-064a/REQ-065, §7.3
  REQ-067, §7.10 REQ-075–REQ-077.
- OQ-4 — **API-key scope: RESOLVED → view-only in v1, THEN superseded by spec review (MA-1).**
  The spec review verified that `GET /system/api-keys` requires session auth and is unreachable
  by the BFF, so even view-only is impossible with the developer API key. API-key administration
  is now a **non-goal** (§11 REQ-117); REQ-050 is retired. *Folded into:* §6.5 REQ-050 (retired),
  §11 REQ-117.
- OQ-5 — **Audit-log persistence: RESOLVED → stdout + BFF-local append-only store**, shippable to
  central logging later (adopts the recommended default). *Rationale:* durable local record plus
  standard log-shipping path without committing to a specific central platform in v1. *Folded
  into:* §10.1 REQ-093a.
- OQ-6 — **Concurrency/staleness: RESOLVED → fresh-read-before-write is sufficient for v1**; no
  ETag/optimistic-concurrency mechanism (AnythingLLM offers none in the grounded surface). Adopts
  the recommended default. *Rationale:* partial-field writes plus fresh reads adequately mitigate
  clobbering at expected operator concurrency. *Folded into:* §9 REQ-091, REQ-092 (unchanged).

---

## §13 Spec-review resolutions

Rev 3 applies the review at `docs/spec-review.md`. Verified API-auth facts (header) are treated
as ground truth. Each item below is addressed:

- **BL-1** — `manage-users` (slug, `{userIds[], reset}`) is the single normative membership
  endpoint; `update-users` ambiguity removed. → §6.4 REQ-049.
- **BL-2** — Multi-user enable/disable removed from the console (session-auth-only, out-of-band
  prerequisite); detection + blocked-state added. → §6.1 REQ-040, §7.8 REQ-073, §8 REQ-085
  (deprecated)/REQ-086, §9 REQ-090, §11 REQ-120.
- **BL-3** — Out-of-range incoming `chatMode` (e.g. `automatic`) shown read-only, never offered,
  never written unless explicitly changed. → §5.2 REQ-034.
- **BL-4** — Single role stands; "authorized staff" defined; self-/last-account guardrails +
  auditing added. → §2 glossary, §3.2 REQ-018a, REQ-019.
- **BL-5** — First staff-account bootstrap seeded from `ADMIN_BOOTSTRAP_USERNAME` /
  `ADMIN_BOOTSTRAP_TOKEN`, forced password-set + MFA enrollment on first login. → §3.2 REQ-019a.
- **MA-1** — API-key viewing unreachable (session auth) → moved to non-goals; REQ-050 retired. →
  §6.5 REQ-050, §11 REQ-117.
- **MA-2** — Raw editor read source specified (non-secret from `GET /v1/system` `settings`;
  secrets set/not-set; unread keys write-only "not returned/unknown"). → §7.11 REQ-078a.
- **MA-3** — Blanket `403` split into key-rejection vs authz/precondition with distinct messages;
  UI renders BFF `message` verbatim. → §4.2 REQ-023, §10.2 REQ-097/097a.
- **MA-4** — `export-chats` moved to non-goals; dangling REQ-051 export reference removed. →
  §6.6 REQ-051, §11 REQ-118.
- **MA-5** — "Effective provider" defined; Ollama discovery keyed on it. → §2 glossary, §5.2
  REQ-036a, §7.10 REQ-077.
- **MA-6** — Numeric bounds pinned (`similarityThreshold` [0,1], `openAiTemp` [0,2], `topN` ≥1
  int, `openAiHistory` ≥0 int); null-clearing = send JSON `null`, omission = no change. → §5.2
  REQ-035/036.
- **MI-1** — Default operator-message mapping for `401/404/429/other`. → §10.2 REQ-097.
- **MI-2** — Resolved with BL-1 (slug-keyed, no numeric workspaceId for membership writes). →
  §6.4 REQ-049.
- **MI-3** — Multi-key raw-write confirmation = masked diff + fixed typed token. → §7.11 REQ-078c,
  §8 REQ-088a.
- **MI-4** — Impersonation (`issue-auth-token`) → non-goal. → §11 REQ-119.
- **MI-5** — Workspace document list sourced from `GET /v1/documents`; attach+detach via
  `update-embeddings`. → §5.4 REQ-039.
- **MI-6** — Dev-mode permissive CORS vs restrictive production CORS. → §10.1 REQ-095.
- **NI-1** — "~186-key" replaced with the exact grounding §5 accepted set (exactly 186) as single
  source of truth. → §7.11 REQ-078b, §10.1 REQ-096.
- **NI-2** — REQ-085 cross-reference corrected (§7.8, not §7.3) and reframed given BL-2 removal.
  → §8 REQ-085.
- **NI-3** — Dead streaming `502` text removed from REQ-023 (console defines no streaming routes).
  → §4.2 REQ-023.
