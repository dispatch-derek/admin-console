# AnythingLLM Administration Console — Specification v1

Status: Draft rev 5 (rev-4 spec-review resolutions applied) — for implementation and QA
Grounding reference: `docs/anythingllm-surface.md` (authoritative engine surface; captured from
the live instance on 2026-07-03). Every functional requirement below cites the concrete
engine endpoint(s)/field(s) it maps to.
Governing architecture: `docs/governing-architecture.md` (binding white-label strategy; source
`front-end-custom/web/plan/AnythingLLM_Customization_Strategy.pdf`). §4 and the event model
below conform to it.
Change history: rev 1 initial draft; rev 2 folded resolved decisions OQ-1..OQ-6 (§12);
rev 3 applied spec-review resolutions BL-1..NI-3 (§13); rev 4 aligned the architecture to the
governing white-label strategy — BFF as anti-corruption layer, product-verb API, engine shapes
confined to the BFF, verify-after-write, and an `admin.*` domain-event catalog (§14); rev 5
applied rev-4 spec-review resolutions BLK-1..NIT-2 — event cardinality, per-key-class verify
contract, §7 product settings map, and event-payload `verified` flag (§13.2).

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
- REQ-019a — **First staff-account bootstrap (BL-5; NIT-1 first-boot scoping).** On a fresh
  deployment with an empty staff store, the BFF seeds exactly ONE initial staff account from
  startup configuration: username from `ADMIN_BOOTSTRAP_USERNAME` and a one-time setup credential
  from `ADMIN_BOOTSTRAP_TOKEN`. These two variables are **required ONLY at first boot** (when the
  staff store is empty); once the account exists / the token is invalidated, they are OPTIONAL and
  their absence MUST NOT prevent startup — i.e. the BFF requires them conditionally (not via the
  unconditional `requireEnv` used for `ANYTHINGLLM_*`). The bootstrap account MUST, on first login,
  set a new password (invalidating `ADMIN_BOOTSTRAP_TOKEN`) AND enroll MFA per REQ-017 before any
  admin access is granted. The seed runs only when the staff store is empty; it never overwrites
  existing accounts. No unauthenticated public "create first admin" web endpoint exists. *Test:*
  with an empty store and both vars set, the bootstrap account logs in once with the token and is
  forced through password-set + MFA enrollment; with a non-empty store, no seed occurs and the
  BFF starts successfully even when both bootstrap vars are unset; the setup token is rejected
  after first use.

---

## §4 Architecture

This section conforms to `docs/governing-architecture.md`. The AnythingLLM engine is a **sealed,
replaceable dependency** reached ONLY through its `/api/v1/*` web API. The BFF is the
**anti-corruption layer**: the single piece of code that knows the engine exists, translating
between our stable product API and the engine's current (unstable, hidden) shapes.

### §4.1 Package structure
- REQ-020 — The repo is two packages: `bff/` (Fastify + TypeScript) and `web/` (React +
  TypeScript + Vite), mirroring the customer app (grounding §6). Default ports: BFF `3002`, web
  dev server `5173`; Vite proxies `/api/*` to the BFF. *Test:* `web` dev config proxies
  `/api/*`; `bff` listens on `config.port` (default `3002`).

### §4.2 The BFF as anti-corruption layer — per-call responsibility chain
- REQ-021 — The browser MUST NEVER call the engine directly and the frontend speaks ONLY our
  clean product API (relative `/api/*`); every browser-exposed capability has a BFF product route
  plus a typed web client function. *Test:* static check — no `web/` source references
  `ANYTHINGLLM_BASE_URL`, an absolute engine URL, or a `/v1/...` path; every web client call
  targets a product `/api/*` route.
- REQ-026 — **Sole broker.** The BFF is the only code that references engine URLs, `/api/v1`
  paths, or engine request/response shapes; no engine knowledge exists outside it. *Test:* engine
  path/field references appear only under `bff/src/` (engine-adapter module), never in `web/`.
- REQ-027 — **Per-call responsibility chain (ordered).** On EVERY product route the BFF performs,
  in order: (1) authenticate our staff user (§3.2) and establish the caller identity;
  (2) resolve identity → look up the target engine workspace **slug** (and any user handle) via
  our own mapping layer (§4.3) — engine slugs/ids are OPAQUE handles, never parsed or derived;
  (3) attach the server-side engine API key (`Authorization: Bearer`, REQ-013); (4) translate the
  product request into the engine's current `/api/v1` request shape; for a membership write the
  BFF ALSO snapshots current membership before the write (REQ-049, MAJ-4); (5) call the engine and
  re-shape the response back into our clean product model before returning it. Steps (6)
  verify-after-write and (7) emit-event apply to mutations (REQ-028, REQ-029). *Test:* a product
  read route with no session yields `401` (step 1); a captured engine request bears the API key
  (step 3) and engine field names (step 4); the response returned to the browser contains only
  product field names, no engine field names (step 5).
- REQ-028 — **Verify-after-write (step 6; applies to every mutating route), per key/operation
  class (BLK-2, MAJ-3).** After a write, the BFF attempts to re-read the relevant state and
  confirm the intended outcome before reporting success; the engine has known write-consistency
  gaps. Each mutation is marked with a `verified` boolean (carried on the emitted event and audit
  entry, REQ-029c/093):
  - **Observable state change** (workspace/user/invite/membership content, non-secret settings,
    secret set→unset or unset→set transitions observable via `GET /v1/system` booleans): the BFF
    re-reads and confirms the transition. Confirmed → `verified:true`. If the re-read shows the
    change absent → the route returns non-success (`{ message }`, "could not confirm the change
    was saved") and NO success event is emitted (REQ-029b).
  - **Secret overwrite where the value is unobservable** (rotating an already-set secret;
    `GET /v1/system` returns `true` both before and after — REQ-060/061): a 2xx engine write is
    treated as **best-effort success** and the mutation is marked `verified:false` (unverified).
    The event and audit entry ARE still emitted with the `unverified` marker (they are NOT
    suppressed).
  - **Write-only keys** not returned by any read endpoint (REQ-078a): **exempt from re-read**;
    success = 2xx engine write; mutation marked `verified:false`; event and audit entry emitted
    with the `unverified` marker.
  - **Delete operations** (MAJ-3): a `404`/absent re-read is the **confirmed-success** condition
    (`verified:true`); this delete-confirmation `404` MUST NOT be surfaced through the REQ-097
    `404`→error mapping.
  *Test:* a non-secret settings write whose re-read shows the change absent returns non-success and
  emits no event; a secret rotation returning 2xx emits its event with `verified:false`; a
  write-only-key write returning 2xx emits its event with `verified:false` and performs no re-read;
  a workspace delete whose re-read yields `404` reports success with `verified:true` and is not
  rendered as a 404 error.
- REQ-029 — **Emit a domain event (step 7).** After a mutation completes per REQ-028 (verified, or
  best-effort success marked `verified:false` for secret-overwrite / write-only cases), the BFF
  emits **one or more** `admin.*` domain events to the shared on-box event bus (§14) — **one event
  per state delta**. Per-operation cardinality (BLK-1): a workspace/user/invite create, update, or
  delete emits one lifecycle event; a user edit (REQ-043) emits `admin.user.updated` PLUS
  `admin.user.suspended` or `admin.user.reactivated` when the suspended flag toggles; a membership
  write (REQ-049) emits one `admin.workspace_user.assigned` per actually-added user and one
  `admin.workspace_user.unassigned` per actually-removed user; a curated settings write (REQ-063,
  §7) emits one `admin.instance.setting_changed` PLUS one `admin.instance.provider_changed` per
  changed provider selector. A verified no-op (nothing actually changed) emits no event. *Test:* a
  workspace update publishes one `admin.workspace.updated`; suspending a user publishes
  `admin.user.updated` + `admin.user.suspended`; a read route publishes none.

### §4.3 Boundary rules — engine shapes confined; opaque handles
- REQ-021a — **HARD RULE (release-blocking): no engine leakage into the frontend.** No engine
  field-name and no engine request-or-response shape may appear in `web/` (or any future
  feature-service) source. The frontend's types and payloads use ONLY our product vocabulary; the
  BFF owns the product↔engine field mapping — for workspaces the §5.2 REQ-032 table, and for
  instance settings the §7 product-settings map (REQ-062a). The scan applies to §7 too: engine env
  key names (e.g. `OllamaLLMModelPref`, `EmbeddingEngine`, `VectorDB`, any grounding §5 key) MUST
  NOT appear in `web/`. **One intentional exception:** the raw-env editor (§7.9/§7.11, REQ-078e)
  handles engine key names as opaque operator-supplied strings transported through the BFF (data,
  not compiled-in field references). *Test:* a static scan of `web/` finds none of the engine
  identifiers (e.g. `openAiTemp`, `openAiPrompt`, `openAiHistory`, `similarityThreshold`,
  `chatProvider`, `chatMode`, `topN`, `update-embeddings`, or any `*ModelPref`/env key from
  grounding §5), except opaque runtime strings in the raw-editor path (REQ-078e); such an
  occurrence elsewhere is a release-blocking defect.
- REQ-021b — **Opaque handles & identity mapping (MAJ-2).** Engine workspace slugs and user ids
  are opaque handles that our layer stores and looks up; the console MUST NOT parse, pattern-match,
  or synthesize them. **The engine is authoritative for workspace-membership *content*** — which
  users belong to which workspace is read from `GET /v1/admin/workspaces/{id}/users`, written via
  `manage-users`, and confirmed by re-read (§6.4). **Our layer owns ONLY the opaque
  handle↔slug/numeric-id mapping** (the product `:id` ↔ engine slug/numeric id), NOT the membership
  content itself. Because each box is single-tenant (one customer per install, §1.2), this mapping
  is minimal, but the principle holds: the console resolves handles from our mapping store and
  never derives engine identifiers from other values. *Test:* code review confirms the BFF looks
  slugs/ids up from our mapping layer and reads/writes membership content against the engine
  (never a local copy of membership).

### §4.4 Product-verb API & engine mapping
- REQ-022 — **Product verbs, not engine mirrors.** BFF routes are product-oriented resources/verbs
  (e.g. `POST /api/workspaces`, `PATCH /api/workspaces/:id/settings`, `POST /api/users`), NOT
  copies of engine paths. Our product API is the stable contract; the engine endpoint each product
  route currently maps to is documented ONLY inside the BFF adapter and in this spec's
  "Engine mapping (BFF-internal)" notes (§5–§7). The BFF is responsible for mapping product
  requests onto whatever the engine currently expects, URL-encoding opaque handles when composing
  engine paths. *Test:* the frontend calls only product routes; changing an engine path requires
  editing only the BFF adapter/mapping note, not the frontend or the product route contract.
- REQ-022a — **Contract tests.** The BFF anti-corruption layer is covered by contract tests
  against the pinned engine version, asserting each product route's translation (step 4) and
  re-shaping (step 5). *Test:* the contract-test suite runs against the pinned engine and fails if
  a product↔engine mapping drifts.

### §4.5 Error mapping
- REQ-023 — Engine error mapping (MA-3, NI-3). The BFF maps engine errors to product responses
  and returns a JSON `{ message }` body the web app renders verbatim (REQ-097a). The console
  defines no streaming routes, so there is no streaming-specific mapping. Two distinct `403`
  cases MUST be disambiguated by the BFF:
  - **Key-rejection 403** (the developer API key is invalid/revoked): `403 { message: "AnythingLLM
    rejected the API key — check ANYTHINGLLM_API_KEY (server configuration)." }`.
  - **Authorization/precondition 403** (e.g. multi-user mode off, or the action needs a role the
    key lacks): `403 { message: "AnythingLLM refused this action: multi-user mode may be off or
    the operation is not permitted for this API key." }`.
  `400 → 400 { message }` (validation); other non-OK → mapped status with a `{ message }` body
  (default operator text per REQ-097). *Test:* stub the two `403` variants and assert distinct
  `message` bodies; stub `400/404/429/500` and assert a mapped status with a `{ message }`.

### §4.6 Health check
- REQ-024 — The BFF exposes `GET /health → { ok: true }` and does not require a session for it
  (mirrors existing BFF). *Test:* unauthenticated `GET /health` returns `200 { ok: true }`.

### §4.7 Typed contracts
- REQ-025 — Product request/response shapes are declared as TypeScript interfaces shared with the
  web app (product vocabulary only); engine shapes are declared SEPARATELY in a BFF-internal
  engine-adapter module and never exported to `web/`. *Test:* type-check passes; `web/` imports
  only product types; the workspace-settings product type exposes product field names (§5.2), not
  engine field names.

---

## §5 Workspaces

Product API (frontend consumes these; §4.4). Workspaces are addressed by an opaque `:id` handle
(§4.3 REQ-021b) that the BFF resolves to the engine slug.

> **Engine mapping (BFF-internal, grounding §3):** `GET /api/workspaces` → `GET /v1/workspaces`;
> `GET /api/workspaces/:id` → `GET /v1/workspace/{slug}`; `POST /api/workspaces` →
> `POST /v1/workspace/new`; `PATCH /api/workspaces/:id/settings` →
> `POST /v1/workspace/{slug}/update`; `DELETE /api/workspaces/:id` →
> `DELETE /v1/workspace/{slug}`; `PUT /api/workspaces/:id/knowledge` →
> `POST /v1/workspace/{slug}/update-embeddings`; `POST /api/workspaces/:id/knowledge/pin` →
> `POST /v1/workspace/{slug}/update-pin`. These engine paths appear ONLY in the BFF adapter, never
> in `web/` (REQ-021a).

### §5.1 Listing & viewing
- REQ-030 — The console lists all workspaces via product route `GET /api/workspaces`, showing at
  minimum `displayName`, the opaque `id` handle, and the configured `llmProvider`/`llmModel`
  (product fields per REQ-032). *Test:* list renders one row per workspace; the BFF maps the
  engine `GET /v1/workspaces` result to product shape (no engine field names cross to `web/`).
- REQ-031 — Selecting a workspace loads its full product settings via `GET /api/workspaces/:id`
  and displays every editable field in §5.2. The BFF re-shapes the engine
  `GET /v1/workspace/{slug}` response into the product model. *Test:* each product field value
  corresponds to the engine value after mapping.

### §5.2 Editing settings
- REQ-032 — The console edits workspace settings via product route
  `PATCH /api/workspaces/:id/settings`. The frontend uses ONLY product field names; the BFF
  maps them to engine fields (grounding §3). **Product↔engine field map (BFF-internal):**
  `displayName`→`name`, `llmProvider`→`chatProvider`, `llmModel`→`chatModel`,
  `responseMode`→`chatMode` (`chat`|`query`), `temperature`→`openAiTemp`,
  `historyWindow`→`openAiHistory`, `systemPrompt`→`openAiPrompt`,
  `retrievalThreshold`→`similarityThreshold`, `retrievalTopN`→`topN`,
  `agentLlmProvider`→`agentProvider`, `agentLlmModel`→`agentModel`,
  `noResultsMessage`→`queryRefusalResponse`, `retrievalMode`→`vectorSearchMode`,
  `avatar`→`pfpFilename`. This is a mutating route: verify-after-write (REQ-028) re-reads the
  workspace and confirms the change, then emits `admin.workspace.updated` (§14). *Test:* changing
  each product field maps to the correct engine key in the engine request body; the response to
  the browser carries product field names only; a verified save emits one
  `admin.workspace.updated`.
- REQ-033 — The settings PATCH carries ONLY fields the operator changed; omitted product fields
  are left untouched (the BFF sends only the mapped engine keys, grounding §3 "only provided
  fields are changed"). *Test:* editing only `temperature` results in an engine body of exactly
  `{ openAiTemp }`.
- REQ-034 — `responseMode` selection is constrained to `chat` or `query` (engine `chatMode`,
  grounding §3); the editor offers exactly those two options and never `automatic`.
  **Out-of-range incoming value (BL-3):** if a workspace's fetched mode is any value outside
  {`chat`,`query`} (e.g. `automatic` set by the customer app), the editor displays that value
  read-only/as-is, does NOT list it as a selectable option, and MUST NOT write `responseMode`
  back unless the operator explicitly changes it to `chat` or `query` (partial-write per
  REQ-033). *Test:* loading a workspace whose engine `chatMode` is `automatic` shows it read-only;
  saving an unrelated field does not include `chatMode` in the engine body; the selector still
  exposes only `chat` and `query`.
- REQ-035 — Numeric fields are validated before submit with pinned inclusive bounds (MA-6),
  product names (engine names in parentheses): `temperature` (`openAiTemp`) — float,
  `0.0 ≤ x ≤ 2.0` (enforced upper cap 2.0); `historyWindow` (`openAiHistory`) — integer `≥ 0`;
  `retrievalThreshold` (`similarityThreshold`) — float, `0.0 ≤ x ≤ 1.0` inclusive; `retrievalTopN`
  (`topN`) — integer `≥ 1`. Invalid input is rejected client-side with a field error and not sent.
  *Test:* `retrievalTopN = 0` blocks submit; `retrievalThreshold = 1.5` blocks submit;
  `temperature = 2.5` blocks submit; `retrievalThreshold = 0.0` and `= 1.0` are accepted.
- REQ-036 — `null`/inherit semantics (MA-6): clearing a nullable product field to inherit its
  default is performed by sending JSON `null` for that field (NOT an empty string) on
  `PATCH /api/workspaces/:id/settings`; the BFF forwards `null` on the mapped engine key; omitting
  a field means "no change" (REQ-033). This applies to `llmProvider`/`llmModel`/`agentLlmProvider`/
  `agentLlmModel` (engine `chatProvider`/`chatModel`/`agentProvider`/`agentModel`) and other
  nullable fields, per grounding §3 ("null = inherit system default"). *Test:* clearing `llmModel`
  causes the engine body `{ "chatModel": null }` and the workspace inherits the system default on
  re-fetch; an untouched `llmModel` is absent from the body.
- REQ-036a — **Model selection uses live Ollama discovery (resolves OQ-3; MA-5).** When the
  **effective provider** (§2) for a workspace model field is `ollama`, `llmModel` and
  `agentLlmModel` are chosen from a dropdown populated from the live pulled-model list via the
  model discovery product route (§7.10, REQ-075). For any other effective provider, the field is
  validated free-text (REQ-064a). If Ollama is unreachable, the field degrades gracefully to
  free-text with a surfaced warning (REQ-076). *Test:* with effective provider `ollama` and Ollama
  reachable, `llmModel` is a dropdown of pulled models; with a non-Ollama effective provider or
  Ollama unreachable, it is free-text.
- REQ-036b — **`retrievalMode` value constraint (MIN-6).** `retrievalMode` (engine
  `vectorSearchMode`, grounding §3, default `default`) is a selector constrained to the enumerated
  allowed values `default` and `rerank`; an out-of-range fetched value is displayed read-only and
  not re-written unless explicitly changed (mirrors REQ-034). *Test:* the `retrievalMode` selector
  exposes exactly `default` and `rerank`; an unknown fetched value shows read-only.
- REQ-036c — **`avatar` edit mechanism (MIN-5).** Workspace avatar editing (engine `pfpFilename`)
  is a filename-string reference set via `PATCH /api/workspaces/:id/settings` (the value must be an
  already-present engine profile-picture filename); **binary avatar UPLOAD is out of scope for v1**
  (§11 REQ-121). The editor either offers no upload control or a disabled/"not in v1" affordance.
  *Test:* setting `avatar` to a filename maps to engine `pfpFilename`; no upload endpoint is
  exposed.

### §5.3 Create & delete
- REQ-037 — The console creates a workspace via product route `POST /api/workspaces` with at least
  a `displayName`; the engine (`POST /v1/workspace/new`, grounding §3) assigns the opaque slug.
  Mutating: verify-after-write (REQ-028) confirms the new workspace reads back, then emits
  `admin.workspace.created` (§14). **The BFF records BOTH the slug AND the numeric engine id in our
  mapping layer (MIN-4)** — performing a follow-up `GET /v1/workspaces` lookup if the create
  response omits the numeric id — so that membership operations immediately after create (REQ-048/
  049) can resolve the numeric id. The product `id` handle is returned to the caller. *Test:*
  creating "Support KB" returns a product workspace with a non-empty opaque `id`; a membership read
  issued immediately after create resolves the numeric engine id; a verified create emits one
  `admin.workspace.created`.
- REQ-038 — Workspace deletion via product route `DELETE /api/workspaces/:id` (engine
  `DELETE /v1/workspace/{slug}`) is a **dangerous operation** governed by §8. Verify-after-write
  confirms the workspace is gone: per REQ-028 (MAJ-3), a `404`/absent re-read is the
  confirmed-success signal (`verified:true`) and MUST NOT be surfaced as a REQ-097 `404` error;
  the BFF then removes the handle mapping and emits `admin.workspace.deleted` (§14). *Test:* see
  REQ-081; a delete whose re-read yields `404` reports success and emits one
  `admin.workspace.deleted` without a 404 error banner.

### §5.4 Documents & knowledge
- REQ-039 — The console attaches and detaches workspace documents via product route
  `PUT /api/workspaces/:id/knowledge` (engine `POST /v1/workspace/{slug}/update-embeddings`,
  supporting both adds and deletes) and pins/unpins via `POST /api/workspaces/:id/knowledge/pin`
  (engine `update-pin`), grounding §3. The selectable document list is sourced from product route
  `GET /api/documents` (engine `GET /v1/documents`, MI-5). Detaching/removing documents is a
  **dangerous operation** governed by §8. Two mutating operations with distinct verify + events
  (MAJ-1):
  - **attach/detach** — verify-after-write (REQ-028) re-reads workspace documents and confirms
    the add/remove, then emits `admin.workspace.documents_changed` (§14).
  - **pin/unpin** — verify-after-write re-reads the document **pin state** (not attach/detach) and
    confirms it, then emits `admin.workspace.knowledge_pinned` (on pin) or
    `admin.workspace.knowledge_unpinned` (on unpin), §14.
  *Test:* the attach picker is populated from `GET /api/documents`; attaching a doc adds it and,
  once verified, emits `admin.workspace.documents_changed`; pinning a doc re-reads pin state and
  emits `admin.workspace.knowledge_pinned`; detaching triggers the §8 confirmation.

---

## §6 Users, Roles, Invites

Roles (grounding §4): `default`, `admin`, `manager`. All `/v1/admin/*` user/invite/membership
routes accept the developer API key but only FUNCTION once multi-user mode is already ON
(verified fact, see header). Enabling multi-user mode is a session-auth-only operation that the
BFF cannot perform; it is an out-of-band prerequisite (BL-2, §6.1, §11). AnythingLLM API-key
administration (`GET /system/api-keys`) is likewise session-auth-only and out of scope (§11).

> **Engine mapping (BFF-internal, grounding §4):** `GET /api/multi-user-status` →
> `GET /v1/admin/is-multi-user-mode`; `GET /api/users` → `GET /v1/admin/users`; `POST /api/users`
> → `POST /v1/admin/users/new`; `PATCH /api/users/:id` → `POST /v1/admin/users/{id}`;
> `DELETE /api/users/:id` → `DELETE /v1/admin/users/{id}`; `GET /api/invites` →
> `GET /v1/admin/invites`; `POST /api/invites` → `POST /v1/admin/invite/new`;
> `DELETE /api/invites/:id` → `DELETE /v1/admin/invite/{id}`; `GET /api/workspaces/:id/members` →
> `GET /v1/admin/workspaces/{workspaceId}/users`; `POST /api/workspaces/:id/members` →
> `POST /v1/admin/workspaces/{workspaceSlug}/manage-users`; `GET /api/oversight/chats` →
> `POST /v1/admin/workspace-chats`. Engine int flags (e.g. `suspended` 0/1) are mapped to product
> booleans; engine paths appear ONLY in the BFF adapter (REQ-021a). The BFF resolves the opaque
> workspace `:id` to the engine numeric id / slug via our mapping layer (§4.3).

### §6.1 Multi-user-mode precondition & blocked state (BL-2)
- REQ-040 — Before rendering any §6 user-management view, the console detects multi-user state
  via product route `GET /api/multi-user-status` (engine `GET /v1/admin/is-multi-user-mode`). When
  multi-user mode is OFF, the console MUST block/disable ALL §6 user, invite, and
  workspace-membership UI and show a clear notice instructing the operator to enable multi-user
  mode **out-of-band in the native AnythingLLM UI** (the console cannot enable it — the enable
  route requires session auth). The console offers NO in-console "enable multi-user" action.
  *Test:* with multi-user OFF, the user/invite/membership controls are disabled and the
  out-of-band notice is shown; no request to any enable-multi-user route is issued; with multi-user
  ON, the §6 UI is enabled.

### §6.2 Users
- REQ-041 — List users via product route `GET /api/users`, showing product fields `username`,
  `role`, `suspended` (boolean, mapped from engine `suspended` 0/1), `dailyMessageLimit`
  (grounding §4). *Test:* one row per user with those product fields; no engine int flag reaches
  `web/`.
- REQ-042 — Create a user via product route `POST /api/users` with `username`, `password`, and
  `role` ∈ {`default`,`admin`,`manager`} (engine `POST /v1/admin/users/new`, grounding §4).
  Mutating: verify-after-write (REQ-028) confirms the user exists, then emits `admin.user.created`
  (§14). *Test:* role selector offers exactly those three values; a verified create emits one
  `admin.user.created`.
- REQ-043 — Edit a user via product route `PATCH /api/users/:id` (engine
  `POST /v1/admin/users/{id}`), supporting `role`, `suspended` (product boolean → engine 0/1),
  and `dailyMessageLimit` (grounding §4). Mutating: verify-after-write confirms the change, then
  emits `admin.user.updated`; additionally, toggling `suspended` true→ emits
  `admin.user.suspended` and false→ emits `admin.user.reactivated` (§14). *Test:* suspending a
  user sets engine `suspended:1` and, once verified, emits `admin.user.suspended`.
- REQ-044 — Delete a user via product route `DELETE /api/users/:id` (engine
  `DELETE /v1/admin/users/{id}`); a **dangerous operation** governed by §8. Verify-after-write
  confirms removal — a `404`/absent re-read is the confirmed-success signal (REQ-028, MAJ-3) and
  MUST NOT be surfaced as a REQ-097 `404` error — then emits `admin.user.deleted` (§14). *Test:*
  see REQ-082; a delete whose re-read yields `404` reports success and emits one
  `admin.user.deleted` without a 404 error banner.

### §6.3 Invites
- REQ-045 — List invites via product route `GET /api/invites`, showing `code`, `status` (default
  `pending`), `claimedBy`, and the scoped workspace handles (engine `GET /v1/admin/invites`,
  grounding §4). *Test:* each invite row shows code and status.
- REQ-046 — Create an invite via product route `POST /api/invites`, optionally scoping to
  workspace handles (BFF maps to engine `workspaceIds` csv on `POST /v1/admin/invite/new`,
  grounding §4). Mutating: verify-after-write confirms the invite exists, then emits
  `admin.invite.created` (§14). *Test:* creating an invite scoped to two workspaces stores both;
  a verified create emits one `admin.invite.created`.
- REQ-047 — Revoke an invite via product route `DELETE /api/invites/:id` (engine
  `DELETE /v1/admin/invite/{id}`, grounding §4). Mutating: verify-after-write confirms removal,
  then emits `admin.invite.revoked` (§14). *Test:* a revoked invite disappears from the list and
  emits one `admin.invite.revoked`.

### §6.4 Workspace-user assignments
- REQ-048 — View which users may access a workspace via product route
  `GET /api/workspaces/:id/members` (engine `GET /v1/admin/workspaces/{workspaceId}/users`,
  `workspace_users` join, grounding §4). The BFF resolves the opaque product `:id` to the engine
  numeric workspace id via our mapping layer (§4.3; the numeric id originates from
  `GET /v1/workspaces`). *Test:* list matches engine membership after mapping.
- REQ-049 — **Normative membership endpoint (BL-1, MI-2).** Update workspace membership via
  product route `POST /api/workspaces/:id/members`, which the BFF maps to engine
  `POST /v1/admin/workspaces/{workspaceSlug}/manage-users` with body `{ userIds: number[],
  reset: boolean }`. Semantics (verified): `reset:false` ADDS the given users to current
  membership; `reset:true` REPLACES membership with exactly the given users. This slug-keyed
  engine endpoint is the single normative path (no numeric-id `update-users` overwrite endpoint is
  used). Mutating with delta events (MAJ-4): the BFF **snapshots current membership BEFORE the
  write** (step 4, REQ-027), performs the write, then verify-after-write (REQ-028) re-reads
  membership and confirms it. It computes the ACTUAL delta against the snapshot and emits one
  `admin.workspace_user.assigned` per **actually-added** user and one
  `admin.workspace_user.unassigned` per **actually-removed** user (§14). A verified no-op — e.g.
  adding a user already present — produces NO event. *Test:* `reset:false` with one already-present
  `userId` adds nothing and emits no event; `reset:false` with one new `userId` adds that user
  without dropping existing members and emits exactly one `admin.workspace_user.assigned`;
  `reset:true` replaces membership with the given set and emits one event per actual add/remove.

### §6.5 API keys — out of scope (MA-1)
- REQ-050 — **RETIRED / moved to §11 (REQ-117).** AnythingLLM API-key administration is
  session-auth-only (`GET /system/api-keys` uses `validatedRequest`, not the developer API key)
  and is therefore unreachable by the BFF. API-key viewing/creation/rotation is a **non-goal**
  for v1 (§11 REQ-117). This ID is retained for traceability and MUST NOT be reused.

### §6.6 Oversight
- REQ-051 — Subject to the §6.1 multi-user precondition, the console may view workspace chat
  history for oversight via product route `GET /api/oversight/chats` (engine
  `POST /v1/admin/workspace-chats`, grounding §4). This is a read-only route (no verify-after-write,
  no event). Chat EXPORT (`GET /v1/system/export-chats`) is a non-goal for v1 (§11 REQ-118).
  *Test:* the chat-oversight view issues the oversight call and renders returned history; no
  export-chats route is exposed.

---

## §7 Instance-wide Settings

Product API: `GET /api/settings` (read), `PATCH /api/settings` (write curated categories),
`GET /api/settings/raw` and `PUT /api/settings/raw` (guarded raw editor, §7.11), plus diagnostics
`GET /api/diagnostics/*` and model discovery `GET /api/models/ollama` (§7.10).

> **Engine mapping (BFF-internal, grounding §5):** `GET /api/settings` → `GET /v1/system` (secrets
> as booleans); `PATCH /api/settings` and `PUT /api/settings/raw` → `POST /v1/system/update-env`;
> `GET /api/diagnostics/env` → `GET /v1/system/env-dump` (masked); `GET /api/diagnostics/vectors`
> → `GET /v1/system/vector-count`. Curated category forms present product-labeled controls; the
> BFF maps each control to the engine env key(s) below. Engine env-key names do NOT appear in
> `web/` for the curated forms (REQ-021a); the raw editor (§7.11) is the one sanctioned tool that
> transports engine keys, treated there as opaque operator-supplied strings (REQ-078e).

The console MUST cover **every** category below and expose each category's active/representative
keys. The `update-env` handler accepts **186 keys** (grounding §5); the curated forms need not
surface one control per key but MUST provide full coverage of every category in §7.1–§7.8 and MUST
be able to write any accepted key they expose. Model-selection discovery is defined in §7.10 and
the guarded raw editor (which can write ANY accepted key) in §7.11. Every settings write is
mutating: verify-after-write (REQ-028) re-reads `GET /v1/system` and confirms observable changes
(non-secret values, secret set/unset transitions) as `verified:true`; unobservable secret
overwrites and write-only keys are best-effort `verified:false` (BLK-2). On write success the BFF
emits one `admin.instance.setting_changed` (payload `categories[]`, MIN-3) plus one
`admin.instance.provider_changed` per changed provider selector, §14.

### §7.0 Secret handling (applies to every category)
- REQ-060 — For every secret-bearing key, the UI shows a "**set** / **not set**" indicator
  derived from the boolean in `GET /v1/system`, never a plaintext value (grounding §5, §5.8
  note). *Test:* with `OpenAiKey` set upstream, the field shows "set" and no characters of the
  key.
- REQ-061 — Secrets support **overwrite-without-reveal**: staff may enter a new value that is
  sent via `PATCH /api/settings` (engine `update-env`), but the current stored value is never
  displayed or pre-filled. Submitting an empty secret field leaves the stored secret unchanged (no
  accidental clearing). Because `GET /v1/system` returns only a set/unset boolean, **overwriting an
  already-set secret is unobservable** and is treated as best-effort success marked `verified:false`
  per REQ-028; a set→unset or unset→set transition IS observable and verified normally. *Test:*
  saving with a blank secret field does not send that key; entering a value sends exactly that key;
  rotating an already-set secret emits its event with `verified:false`.
- REQ-062 — Secret values transit only browser → BFF → engine `update-env`; they are never
  logged in plaintext by the BFF (§10) and are redacted in events (§14, REQ-029c). *Test:* BFF
  logs and events for an `update-env` containing a secret redact the value.

### §7.0a Product settings model & product↔engine key map (BLK-3, option A)
- REQ-062a — The BFF exposes a **product-shaped settings model**; the product↔engine key mapping
  for curated categories lives ENTIRELY in the BFF (analogous to REQ-032 for workspaces). `web/`
  references ONLY the product control ids below and NEVER engine env-key names (REQ-021a); the
  raw-env editor (§7.11, REQ-078e) is the sole exception, handling engine keys as opaque strings.
  Product control groups → representative/active engine keys (BFF-internal map; full coverage of
  every §7.1–§7.8 category required, not one row per key):
  - **`llm`** (§7.1–§7.2): `llm.provider`→`LLMProvider`, `llm.router`→`ModelRouterId`,
    `llm.ollama.baseUrl`→`OllamaLLMBasePath`, `llm.ollama.model`→`OllamaLLMModelPref` (active),
    `llm.ollama.tokenLimit`→`OllamaLLMTokenLimit`, `llm.ollama.keepAlive`→`OllamaLLMKeepAliveSeconds`,
    `llm.ollama.authToken`→`OllamaLLMAuthToken` (secret); each other provider group (grounding §5.2)
    maps `llm.<provider>.*` → that provider's engine keys.
  - **`embedding`** (§7.3): `embedding.engine`→`EmbeddingEngine` (active `ollama`),
    `embedding.model`→`EmbeddingModelPref` (active `nomic-embed-text:v1.5`),
    `embedding.baseUrl`→`EmbeddingBasePath`, plus the remaining grounding §5.3 keys under
    `embedding.*` (secrets flagged).
  - **`vectorDb`** (§7.4): `vectorDb.provider`→`VectorDB` (active `lancedb`); per-backend config
    under `vectorDb.<backend>.*` → grounding §5.4 keys (secrets flagged).
  - **`agentSkills`** (§7.5): `agentSkills.<skill>.apiKey`→ each `Agent*ApiKey` (secret),
    `agentSkills.rerankerEnabled`→`AgentSkillRerankerEnabled`,
    `agentSkills.rerankerTopN`→`AgentSkillRerankerTopN`,
    `agentSkills.maxToolCalls`→`AgentSkillMaxToolCalls`, plus remaining grounding §5.5 keys.
  - **`tts`** (§7.6): `tts.provider`→`TextToSpeechProvider`; per-provider fields under `tts.*` →
    grounding §5.6 keys (secrets flagged).
  - **`stt`** (§7.7): `stt.provider`→`SpeechToTextProvider`; per-provider fields under `stt.*` →
    grounding §5.7 keys (secrets flagged).
  - **`security`** (§7.8): `security.authToken`→`AuthToken` (secret),
    `security.jwtSecret`→`JWTSecret` (secret), `security.disableTelemetry`→`DisableTelemetry`,
    and read-only flags `security.multiUserMode`→`MultiUserMode`, `security.requiresAuth`→
    `RequiresAuth`, etc. (grounding §5.8).

  The **provider selectors** (for `admin.instance.provider_changed`, REQ-063) are exactly:
  `llm.provider`, `embedding.engine`, `vectorDb.provider`, `tts.provider`, `stt.provider`.
  *Test:* `PATCH /api/settings` accepts product control ids and the BFF maps them to the correct
  engine keys; a static scan of `web/` (excluding the raw-editor path) contains no engine env-key
  names; every §7.1–§7.8 category has a product control group.

### §7.1 LLM provider selection
- REQ-063 — The console reads/writes `llm.provider` (`LLMProvider`) and `llm.router`
  (`ModelRouterId`), grounding §5.1. The active instance uses Ollama. Changing `llm.provider` is a
  **dangerous operation** (§8, REQ-083). On a settings write, the BFF emits **one**
  `admin.instance.provider_changed` per **changed provider selector** (the five selectors in
  REQ-062a: `llm.provider`, `embedding.engine`, `vectorDb.provider`, `tts.provider`,
  `stt.provider`), in addition to `admin.instance.setting_changed` (§14, BLK-1/MIN-2). *Test:*
  changing `llm.provider` passes the §8 guardrail and emits one `admin.instance.provider_changed`;
  a batch changing `llm.provider` and `embedding.engine` emits two.

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
- REQ-077 — Model discovery applies to the workspace product fields `llmModel`/`agentLlmModel`
  (REQ-036a), the instance `llm.ollama.model` (engine `OllamaLLMModelPref`, REQ-065), and the
  Ollama `embedding.model` (REQ-067) whenever the effective provider/engine is Ollama. For all
  non-Ollama providers, discovery is not attempted (REQ-064a governs). *Test:* switching a field's
  provider from Ollama to a non-Ollama provider disables the dropdown and reverts to free-text.

### §7.11 Guarded raw environment editor (resolves OQ-2)
Beyond the curated forms (§7.1–§7.8), the console provides an advanced editor that can read and
**write** arbitrary env keys accepted by the engine `update-env` handler, reached via the product
routes `GET /api/settings/raw` and `PUT /api/settings/raw` (BFF maps to `GET /v1/system` /
`POST /v1/system/update-env`).

- REQ-078 — The raw editor is gated behind an explicit **"advanced mode" acknowledgement** before
  it is usable in a session. *Test:* the raw editor's write controls are inert until the operator
  acknowledges advanced mode.
- REQ-078e — **Engine keys as opaque strings (§4.3 reconciliation).** The raw editor is the one
  sanctioned surface where engine env-key names are visible; they are handled as opaque
  operator-entered/selected strings (data), NOT compiled-in frontend field references, and the
  frontend carries no engine request/response shape for them — it posts `{ key, value }` pairs to
  `PUT /api/settings/raw` and the BFF validates and maps them. This preserves REQ-021a (no engine
  shape leaks into frontend types/code). *Test:* the `web/` raw-editor code contains no hardcoded
  engine key identifiers; the key list it validates against is fetched from the BFF (grounding §5
  set, REQ-078b).
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
  redacted for secrets per REQ-062/094), timestamp, `verified`, and outcome; and on write success
  emits one `admin.raw_env.written` event carrying the key names touched (secret values redacted)
  and the `verified` flag (§14). Per the REQ-028 contract (BLK-2), raw writes to secret-overwrite
  or write-only keys are best-effort (2xx) and emit with `verified:false` (they are NOT suppressed
  for being unverifiable); observable-key writes emit with `verified:true` once confirmed. *Test:*
  a raw write to an observable key emits `admin.raw_env.written` with `verified:true`; a raw write
  to a write-only key emits it with `verified:false`; both audit entries redact secret values.

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
- REQ-087 — **Detach workspace documents** (workspace-scope vector deletion via
  detach/`update-embeddings`, REQ-039): confirmation names affected scope and warns the vector data
  for those documents is deleted. Instance-level `DELETE /v1/system/remove-documents` is NOT a
  console action (MAJ-5) — it is a §11 non-goal (REQ-122); workspace-scope deletion is covered by
  the detach path. *Test:* a document detach fires only after confirmation; no
  `remove-documents` route is exposed.
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
  **Scope note (NIT-2):** fresh-read-before-write targets *value-overwriting* edits where a stale
  view could clobber a concurrent change (instance settings, workspace settings). Workspace and
  user DELETE (REQ-038/044) intentionally do NOT require a fresh-read pre-step — deletion is not a
  value merge, and the typed-target confirmation (REQ-081/082) plus verify-after-write (a `404`
  re-read = confirmed success, REQ-028/MAJ-3) already guard it; a delete of an already-removed
  target simply verifies as success. *Test:* a workspace delete requires the typed-slug
  confirmation but no pre-delete `GET /v1/system`.
- REQ-092a — **Fresh-read-before-write vs verify-after-write are complementary, not duplicates.**
  Fresh-read-before-write (REQ-092) is a PRE-write guard against clobbering concurrent changes
  from the customer app / native UI (the operator confirms against current state). Verify-after-
  write (§4.2 REQ-028) is a POST-write confirmation that the engine actually persisted our change
  (guarding the engine's known write-consistency gaps) and is the precondition for emitting the
  success domain event (§14). Both apply to mutating operations; neither replaces the other.
  *Test:* a dangerous settings change performs a fresh read before the confirmation dialog AND a
  re-read after the write to confirm persistence before reporting success.

---

## §10 Non-Functional Requirements

### §10.1 Security
- REQ-093 — The BFF maintains an **audit log** of all mutating operations (POST/PATCH/PUT/DELETE
  routes) recording actor (staff identity), method+route, target identifiers, timestamp, the
  `verified` flag (REQ-028), and success/failure. *Test:* a successful `update-env` and a failed
  one each produce an audit entry with outcome and `verified` state.
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
  **Exception (MAJ-3):** a `404` observed on a DELETE verify-after-write re-read (REQ-028) is the
  confirmed-success signal, NOT an error — it MUST NOT be surfaced through this `404` mapping.
  *Test:* stubbed `401/403(key)/403(authz)/404/429/500` each render the corresponding operator
  message; a delete-confirmation `404` renders success, not the 404 error.
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
- REQ-101 — The instance-settings screen loads `GET /api/settings` once per view open and batches
  an operator's edits into a single `PATCH /api/settings` submission; the BFF issues one engine
  `POST /v1/system/update-env` write plus the verify-after-write re-read (REQ-028). Per BLK-1 the
  batch emits **one** `admin.instance.setting_changed` (with `categories[]`, MIN-3) PLUS one
  `admin.instance.provider_changed` per changed provider selector (REQ-063). *Test:* saving five
  changed keys spanning two categories issues exactly one engine `update-env` call (followed by the
  verification read) and emits one `admin.instance.setting_changed` carrying both categories; if a
  provider selector was among them, one `admin.instance.provider_changed` is also emitted.

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
- REQ-121 — **Binary avatar upload (MIN-5).** Uploading workspace/user profile-picture binaries is
  out of scope for v1; the console only sets `avatar` as an existing engine `pfpFilename` string
  reference (REQ-036c).
- REQ-122 — **Instance-level remove-documents (MAJ-5).** `DELETE /v1/system/remove-documents`
  (instance-wide vector deletion) is out of scope for v1; workspace-scope deletion is covered by
  the document detach path (REQ-039, REQ-087).

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
  (workspace product `llmModel`/`agentLlmModel`, instance `llm.ollama.model`, Ollama embedding
  model) are
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
  UI renders BFF `message` verbatim. → §4.5 REQ-023, §10.2 REQ-097/097a.
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
  → §4.5 REQ-023.

---

## §13.1 Governing-architecture conformance (rev 4)

Rev 4 aligns the spec to `docs/governing-architecture.md` (binding white-label strategy). No
previously resolved product decision (OQ-1..OQ-6, BL-1..NI-3) is reopened; this pass is purely
architectural. Changes:

- **BFF = anti-corruption layer** with the mandated ordered per-call responsibility chain
  (authenticate → resolve identity/slug → attach engine key → translate → call/re-shape →
  verify-after-write → emit event). → §4.2 REQ-021, REQ-026–REQ-029.
- **No engine shape in the frontend** (hard, release-blocking rule); engine field-names/shapes
  confined to the BFF adapter. → §4.3 REQ-021a, §4.7 REQ-025.
- **Opaque handles**: engine slugs/user ids are opaque; identity/user→workspace mapping lives in
  our layer. → §4.3 REQ-021b.
- **Product-verb API**: engine-mirroring routes replaced by product resources; engine endpoints
  documented only in BFF-internal mapping notes. → §4.4 REQ-022/022a; route reframing across
  §5–§7 (REQ-030–039, REQ-040–051, §7 intro/§7.11) with product↔engine field map (REQ-032).
- **Verify-after-write** obligation on every mutation, reconciled with fresh-read-before-write.
  → §4.2 REQ-028, §9 REQ-092a.
- **Domain-event catalog** on the shared on-box bus (`admin.*`), emitted only after a verified
  write; failed/unverified writes emit no success event. → §14.
- Reference to the governing doc added in the header and §4.

> Note: rev-5 (§13.2) revised the "emitted only after a verified write" stance for the
> unobservable secret-overwrite / write-only cases — those now emit with `verified:false` rather
> than being suppressed (BLK-2).

---

## §13.2 rev-5 spec-review resolutions

Rev 5 applies the review at `docs/spec-review-rev4.md`. No OQ-1..OQ-6, BL-1..NI-3, or rev-4
architecture-alignment decision is reopened. Each item:

- **BLK-1** (event cardinality) — REQ-029 changed from "exactly one" to "**one or more**", one
  event per state delta, with per-operation cardinality; REQ-029e and REQ-101 aligned. → §4.2
  REQ-029, §14 REQ-029e, §10.4 REQ-101, §7.1 REQ-063.
- **BLK-2** (verify feasibility for secrets/write-only) — REQ-028 now defines a per-key-class
  verify contract with a `verified` boolean: observable transitions verified; unobservable secret
  overwrites and write-only keys are best-effort 2xx marked `verified:false` and STILL emit their
  events. Reconciled across REQ-060/061, REQ-078a/d, REQ-029a/b/c (added `verified` to payload),
  REQ-093. → §4.2 REQ-028, §7.0 REQ-061, §7.11 REQ-078d, §14 REQ-029a–c, §10.1 REQ-093.
- **BLK-3** (§7 product vocabulary — option A) — added §7.0a REQ-062a: BFF-owned product settings
  model + product↔engine key map covering every §7.1–§7.8 category; REQ-021a scan extended to §7
  with the raw-editor (REQ-078e) as the sole opaque-string exception. → §7.0a REQ-062a, §4.3
  REQ-021a.
- **MAJ-1** (pin) — REQ-039 split into attach/detach (verify docs, `documents_changed`) and
  pin/unpin (verify pin state, `knowledge_pinned`/`_unpinned`); catalog updated. → §5.4 REQ-039,
  §14 catalog.
- **MAJ-2** (membership ownership) — REQ-021b reworded: engine is authoritative for membership
  content; our layer owns only the handle↔slug/id mapping. → §4.3 REQ-021b.
- **MAJ-3** (delete vs 404) — REQ-028 states a `404`/absent re-read is confirmed-success for
  deletes and must not be surfaced via REQ-097 404-mapping; REQ-038/044 aligned. → §4.2 REQ-028,
  §5.3 REQ-038, §6.2 REQ-044.
- **MAJ-4** (membership deltas) — REQ-027 step 4 adds a pre-write membership snapshot; REQ-049
  emits assigned/unassigned only for actual deltas; no-op adds emit nothing. → §4.2 REQ-027, §6.4
  REQ-049.
- **MAJ-5** (orphan remove-documents) — dropped from REQ-087; instance-level
  `remove-documents` made non-goal REQ-122. → §8 REQ-087, §11 REQ-122.
- **MIN-1** — REQ-077 / OQ-3 prose use product names `llmModel`/`agentLlmModel`. → §7.10 REQ-077,
  §12 OQ-3.
- **MIN-2** — one `provider_changed` per changed selector. → §7.1 REQ-063, §14.
- **MIN-3** — `setting_changed` payload uses `categories[]` + product-control ids. → §14 REQ-029c.
- **MIN-4** — REQ-037 records the numeric engine id (follow-up `GET /v1/workspaces` lookup) so
  membership ops post-create resolve it. → §5.3 REQ-037.
- **MIN-5** — avatar is a filename-string reference (REQ-036c); binary upload is non-goal REQ-121.
  → §5.2 REQ-036c, §11 REQ-121.
- **MIN-6** — `retrievalMode` constrained to `default`/`rerank` (REQ-036b). → §5.2 REQ-036b.
- **NIT-1** — `ADMIN_BOOTSTRAP_*` required only at first boot; optional thereafter. → §3.2
  REQ-019a.
- **NIT-2** — fresh-read-before-write scope note added; workspace/user delete intentionally
  exempt. → §9 REQ-092.

---

## §14 Event Catalog

Per boundary rule 2 of `docs/governing-architecture.md`, the console **synthesizes** domain events
at our boundary: we make the engine call, verify the result, then publish the event to **our own**
shared on-box event bus. We never hack the engine to emit and never listen to the engine directly.
All events use the `admin.*` namespace.

### §14.1 General event obligations
- REQ-029a — **Emit after a successful write, per the REQ-028 verify contract (BLK-2).** A success
  event is published when the write completes with either (a) verify-after-write confirming the
  outcome (`verified:true`), or (b) a best-effort 2xx write for the unobservable cases —
  secret-overwrite and write-only keys — marked `verified:false`. In both cases the event IS
  emitted; the `verified` flag distinguishes them. *Test:* a confirmed settings change emits its
  event with `verified:true`; a secret rotation returning 2xx emits its event with
  `verified:false`.
- REQ-029b — **No success event on failure or contradicted verification.** If a mutating call
  fails upstream, is rejected by a guardrail, or the verify re-read affirmatively shows the change
  DID NOT take effect (for observable cases), NO success event is emitted (a failure audit entry is
  still recorded per REQ-093). Note: an unobservable secret-overwrite / write-only write is NOT a
  "failed verification" — it emits with `verified:false` per REQ-029a. *Test:* a write that returns
  non-OK, or whose observable re-read shows the change absent, produces zero `admin.*` success
  events and one failure audit entry.
- REQ-029c — **Minimal payload, `verified` flag & redaction (BLK-2, MIN-3).** Every event carries
  at minimum: `event` (name), `actor` (staff user id, §3.2), `target` (opaque identifiers —
  workspace `id`, user `id`, invite `id`; for settings the touched product-control ids), `changes`
  (what changed; secret values ALWAYS redacted per REQ-062/094), `verified` (boolean, REQ-028), and
  `timestamp` (ISO-8601). For `admin.instance.setting_changed` the payload uses `categories` (an
  array of the §7.1–§7.8 categories touched, MIN-3) plus the touched product-control ids — never a
  single `category`. Payloads carry opaque handles/product ids, never parsed engine internals
  (§4.3). *Test:* a `admin.instance.setting_changed` for a secret key lists the product-control id
  with value redacted, carries `categories[]`, `verified`, actor and timestamp.
- REQ-029d — **Publication target.** Events publish to the shared on-box event bus so independent
  feature services may subscribe and react (event-sourced flow). *Test:* a subscriber on the bus
  receives the published event after a write.

### §14.2 Catalog
Each event below is emitted per REQ-029a (verified, or `verified:false` for the unobservable
secret-overwrite / write-only cases) for the cited requirement's operation. Every event carries
the `verified` flag (REQ-029c).

| Event | Emitted by (REQ) | Trigger | Payload highlights (beyond actor + timestamp + `verified`) |
|---|---|---|---|
| `admin.workspace.created` | REQ-037 | workspace create verified | workspace `id`, `displayName` |
| `admin.workspace.updated` | REQ-032 | settings change verified | workspace `id`, changed product fields |
| `admin.workspace.deleted` | REQ-038 | workspace delete verified (`404` re-read) | workspace `id` |
| `admin.workspace.documents_changed` | REQ-039 | attach/detach verified | workspace `id`, added/removed document refs |
| `admin.workspace.knowledge_pinned` | REQ-039 | pin verified (pin-state re-read) | workspace `id`, document ref |
| `admin.workspace.knowledge_unpinned` | REQ-039 | unpin verified (pin-state re-read) | workspace `id`, document ref |
| `admin.workspace_user.assigned` | REQ-049 | member ACTUALLY added (delta vs snapshot) | workspace `id`, user `id` |
| `admin.workspace_user.unassigned` | REQ-049 | member ACTUALLY removed (delta vs snapshot) | workspace `id`, user `id` |
| `admin.user.created` | REQ-042 | user create verified | user `id`, `username`, `role` |
| `admin.user.updated` | REQ-043 | user edit verified | user `id`, changed fields |
| `admin.user.suspended` | REQ-043 | `suspended` false→true verified | user `id` |
| `admin.user.reactivated` | REQ-043 | `suspended` true→false verified | user `id` |
| `admin.user.deleted` | REQ-044 | user delete verified (`404` re-read) | user `id` |
| `admin.invite.created` | REQ-046 | invite create verified | invite `id`, scoped workspace handles |
| `admin.invite.revoked` | REQ-047 | invite revoke verified | invite `id` |
| `admin.instance.setting_changed` | §7 intro / REQ-101 | curated settings write | `categories[]`, product-control ids touched (secrets redacted) |
| `admin.instance.provider_changed` | REQ-063 | one per changed provider selector | which selector, new provider |
| `admin.raw_env.written` | REQ-078d | raw editor write | key names touched (secrets redacted); `verified` often false |

- REQ-029e — **Coverage & cardinality.** Every mutating product route in §5–§7 maps to **one or
  more** catalog events (one per state delta, REQ-029); read-only routes (e.g.
  REQ-030/031/041/045/048/051, discovery §7.10, diagnostics §7.9) emit none. *Test:* each mutating
  route emits one or more of its cataloged events per REQ-029 cardinality; each read route emits
  none.
