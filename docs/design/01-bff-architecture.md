# BFF Architecture — the Anti-Corruption Layer

The BFF is the only code that knows the engine exists. This doc defines its internal
layers, the file layout, and the two internal interfaces the spec singles out: the
**engine adapter** (the only place engine `/api/v1` shapes live) and the **event
emitter**. It also specifies the generic **verify-after-write** mechanism.

Satisfies: §4 (REQ-020–REQ-029f), plus the enforcement points for §10 NFRs.

## Layered module map (`bff/src/`)

Each product route flows top-to-bottom through the ordered chain of REQ-027. Modules
below a line may not import from modules above it (dependency direction is downward).

```
bff/src/
  index.ts                 App bootstrap: Fastify, plugins, route registration, listen.
  config.ts                requireEnv() config (REQ-001, REQ-019a, REQ-095). See §config.
  server/
    plugins.ts             cors (REQ-095), cookie, correlation-id + logger (REQ-099), error handler.
    errors.ts              AppError + engine→product status/message mapping (REQ-023, REQ-097).
    session-guard.ts       preHandler: require valid staff session on all /api/* except auth+health (REQ-012).

  routes/                  ── product-verb HTTP layer (REQ-022). Thin: validate, call service, shape reply.
    auth.routes.ts         login, MFA, enrollment, recovery, staff lifecycle (§3.2).
    workspaces.routes.ts   §5 product routes.
    users.routes.ts        §6.1–§6.4 product routes.
    settings.routes.ts     §7 curated settings + raw editor + diagnostics + model discovery.
    oversight.routes.ts    §6.6 read-only chat oversight.
    health.routes.ts       GET /health (REQ-024).

  services/                ── product orchestration: runs the REQ-027 chain per route.
    workspace.service.ts   resolve id→slug, call adapter, verify-after-write, emit event, audit.
    user.service.ts
    settings.service.ts
    oversight.service.ts
    verify.ts              generic verify-after-write runner (see §verify-after-write).

  auth/                    ── staff auth domain (independent of the engine).
    staff.service.ts       password verify, lifecycle, guardrails (REQ-015, REQ-018, REQ-018a).
    mfa.service.ts         TOTP enroll/verify, recovery codes, reset (REQ-016, REQ-017, REQ-019).
    session.service.ts     create/lookup/expire sessions (REQ-014).
    bootstrap.ts           first-account seed from env (REQ-019a).

  identity/                ── boundary rule 3: our own mapping, opaque handles.
    workspace-map.ts       product id ↔ engine slug + numeric id lookup (REQ-021b, §6.4).

  engine/                  ── boundary: ONLY module that references /api/v1 + engine field names.
    adapter.ts             typed engine client (see §engine adapter). REQ-013, REQ-026.
    engine-types.ts        engine request/response shapes. NEVER exported to web/ (REQ-025).
    mappers.ts             product↔engine field translation (REQ-032 table, etc.).
    env-keys.ts            the exact 186 accepted update-env keys + secret-key set (REQ-078b, REQ-096).
    ollama.ts              Ollama /api/tags discovery client (REQ-075).

  events/                  ── boundary rule 2.
    bus.ts                 abstract EventBus interface + in-process + outbox impls (see §event emitter).
    emitter.ts             emitAdminEvent(): build envelope, redact, publish (REQ-029, REQ-029c).
    catalog.ts             admin.* event names + payload types (§14).

  audit/
    audit.ts               append-only audit sink: stdout + store (REQ-093, REQ-093a, REQ-094).

  store/                   ── SQLite persistence (see 03-data-models.md).
    db.ts                  better-sqlite3 handle, migrations, WAL.
    repositories/          staff, sessions, audit, workspace-map, outbox repositories.

  types/
    product-types.ts       product request/response interfaces SHARED with web/ (REQ-025).
```

`web/` imports only `types/product-types.ts` (published as a shared type package or a
copied declaration). `engine/*` is never importable from `web/`.

## The per-call responsibility chain (REQ-027)

Every mutating product route service runs, in order:

1. **Authenticate** — `session-guard` has already attached `req.staff` (id, username);
   route rejects with 401 if absent (REQ-012).
2. **Resolve identity → engine handle** — `identity/workspace-map` turns the opaque
   product `:id` into the engine slug and/or numeric id (REQ-021b). Handles are looked
   up, never parsed.
3. **Attach engine key** — done inside `engine/adapter` (`authHeaders()`, REQ-013).
4. **Translate** — `engine/mappers` converts the product request body into the engine's
   current request shape (partial writes only, REQ-033).
5. **Call + re-shape** — adapter calls the engine, mappers re-shape the response into the
   product model. Reads stop here.
6. **Verify-after-write** — `services/verify.ts` re-reads and confirms (REQ-028).
7. **Emit event(s)** — `events/emitter` publishes **one or more** `admin.*` events, one per
   state delta (REQ-029/029e): most routes emit one; membership emits one assigned/unassigned
   per user (REQ-049); a batched settings write emits one `setting_changed` plus one
   `provider_changed` per changed selector (REQ-101/063). `audit/audit` records the outcome
   (REQ-093). On failure at 6, no success event, failure audit only (REQ-029b) — EXCEPT the
   batched settings write, which is not all-or-nothing suppressed on a 2xx engine write
   (REQ-029f, see verify note below).

Read routes run steps 1–5 only (REQ-027 test).

## Engine adapter interface (`engine/adapter.ts`)

The single typed gateway to `/api/v1`. Every method returns engine-shaped data; callers
in `services/` immediately hand it to `mappers`. No route or web file imports this.

```ts
// engine-types.ts holds EngineWorkspace, EngineUser, EngineInvite, EngineSystem, etc.
export interface EngineAdapter {
  // Workspaces (§5 mapping note)
  listWorkspaces(): Promise<EngineWorkspace[]>;                    // GET /v1/workspaces
  getWorkspace(slug: string): Promise<EngineWorkspace | null>;    // GET /v1/workspace/{slug}
  createWorkspace(body: EngineNewWorkspace): Promise<EngineWorkspace>; // POST /v1/workspace/new
  updateWorkspace(slug: string, body: Partial<EngineWorkspaceUpdate>): Promise<void>; // .../update
  deleteWorkspace(slug: string): Promise<void>;                   // DELETE /v1/workspace/{slug}
  updateEmbeddings(slug: string, adds: string[], deletes: string[]): Promise<void>; // update-embeddings
  updatePin(slug: string, docPath: string, pinned: boolean): Promise<void>;         // update-pin
  listDocuments(): Promise<EngineDocument[]>;                     // GET /v1/documents

  // Users / invites / membership (§6 mapping note) — require multi-user ON
  isMultiUserMode(): Promise<boolean>;                            // GET /v1/admin/is-multi-user-mode
  listUsers(): Promise<EngineUser[]>;                             // GET /v1/admin/users
  createUser(body: EngineNewUser): Promise<EngineUser>;           // POST /v1/admin/users/new
  updateUser(id: number, body: Partial<EngineUserUpdate>): Promise<void>; // POST /v1/admin/users/{id}
  deleteUser(id: number): Promise<void>;                          // DELETE /v1/admin/users/{id}
  listInvites(): Promise<EngineInvite[]>;                         // GET /v1/admin/invites
  createInvite(workspaceIds?: number[]): Promise<EngineInvite>;   // POST /v1/admin/invite/new
  deleteInvite(id: number): Promise<void>;                        // DELETE /v1/admin/invite/{id}
  listWorkspaceMembers(workspaceId: number): Promise<EngineUser[]>; // .../{workspaceId}/users
  manageWorkspaceUsers(slug: string, userIds: number[], reset: boolean): Promise<void>; // manage-users
  workspaceChats(query: EngineChatQuery): Promise<EngineChatPage>; // POST /v1/admin/workspace-chats

  // System settings (§7 mapping note)
  getSystem(): Promise<EngineSystem>;                             // GET /v1/system (secrets as booleans)
  updateEnv(patch: Record<string, string | number | boolean | null>): Promise<void>; // update-env
  envDump(): Promise<Record<string, string>>;                    // GET /v1/system/env-dump (masked)
  vectorCount(): Promise<number>;                                 // GET /v1/system/vector-count

  // Ollama discovery (via ollama.ts, not /api/v1)
  ollamaTags(basePath: string): Promise<OllamaModel[]>;           // GET {basePath}/api/tags
}
```

Adapter responsibilities: attach `Authorization: Bearer <key>` (REQ-013),
URL-encode opaque handles when composing paths (REQ-022), and throw a typed
`EngineError { status, body }` that `server/errors.ts` maps (REQ-023, REQ-097). It does
NOT verify, emit, or audit — that is the service layer's job.

## Verify-after-write mechanism (REQ-028, REQ-092a)

Generic runner: perform the write, then re-read and assert an outcome predicate before
returning success. Fresh-read-before-write (REQ-092) is a separate pre-write read owned
by the route/UI; verify is the post-write confirmation.

```ts
// services/verify.ts
export async function verifiedWrite<T>(opts: {
  write: () => Promise<void>;
  reread: () => Promise<T>;                 // re-fetch the relevant engine state
  confirm: (state: T) => boolean;           // predicate: did the intended change land?
  onUnconfirmed?: string;                   // message when confirm() is false
}): Promise<T>;                             // resolves with verified state, or throws AppError(409)
```

Per-mutation confirmation predicates:

| Mutation | reread | confirm predicate |
|---|---|---|
| workspace update (REQ-032) | `getWorkspace(slug)` | every changed engine field equals submitted value |
| workspace create (REQ-037) | `getWorkspace(newSlug)` | workspace exists and displayName matches |
| workspace delete (REQ-038) | `getWorkspace(slug)` | returns null / not found |
| documents change (REQ-039) | `getWorkspace(slug)` docs | adds present, deletes absent |
| membership (REQ-049) | `listWorkspaceMembers(id)` | set matches intended (reset) or superset (add) |
| user create (REQ-042) | `listUsers()` | username present with role |
| user update (REQ-043) | `listUsers()` | changed fields match |
| user delete (REQ-044) | `listUsers()` | username absent |
| invite create/revoke (REQ-046/047) | `listInvites()` | present / absent |
| settings write (REQ-101) | `getSystem()` | PER control: observable key equals value / secret key now set → `true`; observable change absent → `false`; secret-overwrite & write-only → best-effort `false` (not re-read). Produces a per-control-id map, not a scalar (REQ-029f) |
| raw env write (REQ-078d) | `getSystem()` | per submitted key: observable → equals value; write-only → best-effort `false` (scalar per key) |

If `confirm` is false, a **single-delta** mutation returns a non-success `{ message }`
("could not confirm the change was saved"), emits NO event (REQ-029b), and writes a failure
audit entry.

**Batched settings-write exception (REQ-029f, REQ-029b batch exception).** The curated
`PATCH /api/settings` write is NOT run through the all-or-nothing `verifiedWrite` throw path.
On a 2xx engine write the service builds the per-control-id `verified` map (observable keys
re-read; secret-overwrite/write-only recorded best-effort `false`) and STILL emits
`admin.instance.setting_changed` even if some observable keys re-read `false` — suppressing
it would hide secret/write-only keys in the same call that persisted. Each changed provider
selector emits its own `admin.instance.provider_changed` carrying its scalar `verified`,
emitted with `verified:false` when its re-read shows no change (R-2). The map is returned to
the web app in the `SettingsWriteResult` HTTP response (REQ-101/098b, R-3). Only a non-OK
engine write suppresses both events (REQ-029b) and returns the no-partial-success state
(REQ-098). The batched audit entry records the per-control-id map (REQ-093).

Note: secret keys read back only as booleans (set/unset), so their verify predicate is
"is now set", not value equality (REQ-060, REQ-078a). An already-set secret overwritten
(rotated) reads `true` both before and after, so it is unobservable → best-effort `false`.

## Event emitter interface (`events/emitter.ts`, `events/bus.ts`)

Called only by services, only after `verifiedWrite` resolves. See `03-data-models.md`
for the event schemas and `04-cross-cutting.md` for the bus/outbox design.

```ts
export interface AdminEventEnvelope<P = unknown> {
  event: AdminEventName;      // e.g. 'admin.workspace.updated' (catalog.ts)
  actor: string;              // staff user id (REQ-029c)
  target: Record<string, string | number | string[]>; // opaque handles / product-control ids (REQ-021b)
  changes?: P;                // secret values redacted (REQ-029c, REQ-062)
  verified: boolean | Record<string, boolean>; // scalar per mutation/key, EXCEPT setting_changed = per-control-id map (REQ-028/029c/029f)
  timestamp: string;          // ISO-8601
}

export interface EventBus {
  publish(env: AdminEventEnvelope): Promise<void>;
}

// emitter builds the envelope, runs redaction, writes the outbox row in the same
// transaction as the verify result, then publishes to the configured EventBus.
export function emitAdminEvent<P>(
  name: AdminEventName, actor: string,
  target: AdminEventEnvelope['target'],
  verified: boolean | Record<string, boolean>, // map only for setting_changed (REQ-029f)
  changes?: P,
): Promise<void>;
```

## Contract tests (REQ-022a)

The adapter + mappers are covered by contract tests against the pinned engine version,
asserting translation (step 4) and re-shaping (step 5) per product route. These live in
`bff/` test scope (implementer builds them; not designed here) and are the guard against
engine drift.
