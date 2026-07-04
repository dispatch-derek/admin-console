# Data Models — BFF-Owned Store & Event Schemas

Everything the BFF persists in ITS OWN store (boundary rule 3): staff auth, sessions,
the append-only audit log, the identity mapping, and the event outbox. Plus the `admin.*`
event schemas (§14). The engine keeps its own data; we persist only what is ours.

## Store: embedded SQLite (`better-sqlite3`)

One file (`data/console.db`), WAL mode, migrations in `store/db.ts`. Synchronous API
suits Fastify handlers; atomic transactions let us write the verify result + outbox row +
audit row together. Appliance-appropriate: no separate DB process. Justification and
rejected alternatives are in `00-overview.md`.

Secrets at rest: password hashes (argon2id), TOTP secrets and recovery codes are
encrypted/hashed, never plaintext (REQ-015, REQ-019, REQ-094).

## Tables

### `staff` (REQ-010, REQ-015, REQ-018)
```
id             TEXT PK        -- uuid; used as event actor (REQ-029c)
username       TEXT UNIQUE NOT NULL
password_hash  TEXT           -- argon2id; NULL until bootstrap set-password (REQ-019a)
totp_secret    TEXT           -- encrypted; NULL until enrolled (REQ-017)
mfa_enrolled   INTEGER NOT NULL DEFAULT 0
disabled       INTEGER NOT NULL DEFAULT 0   -- REQ-018 disable/re-enable
must_set_password INTEGER NOT NULL DEFAULT 0 -- bootstrap first login (REQ-019a)
created_at     TEXT NOT NULL
```
Invariants: at least one enabled account with `mfa_enrolled=1` must remain — enforced in
`staff.service` for disable/delete (REQ-018a), not by a DB constraint. An operator cannot
disable/delete their own current account (REQ-018a).

### `recovery_codes` (REQ-019)
```
id TEXT PK, staff_id TEXT FK, code_hash TEXT NOT NULL, used_at TEXT NULL
```
Single-use: a login consumes one by setting `used_at`; reuse is rejected. Stored hashed.

### `sessions` (REQ-011, REQ-014)
```
id           TEXT PK        -- random 256-bit token; value lives in httpOnly cookie
staff_id     TEXT FK NOT NULL
created_at   TEXT NOT NULL
expires_at   TEXT NOT NULL  -- sliding or fixed; guard rejects when now > expires_at
```
Logout deletes the row; expiry check returns 401 → web routes to /login (REQ-014).

### `login_challenges` (transient two-step login state, §3.2)
```
id TEXT PK, staff_id TEXT FK, stage TEXT, expires_at TEXT
-- stage in {mfa, enroll, setPassword}; short TTL; deleted on completion
```
Holds the state between `POST /api/auth/login` and the MFA/enroll/set-password step so a
password-verified-but-not-MFA'd caller has no session (REQ-016).

### `workspace_map` (boundary rule 3, REQ-021b, §6.4)
```
product_id      TEXT PK        -- opaque handle we mint and expose
engine_slug     TEXT UNIQUE NOT NULL   -- opaque engine handle (never parsed)
engine_numeric_id INTEGER       -- from GET /v1/workspaces; for membership reads (REQ-048)
display_name    TEXT
created_at      TEXT
```
On create (REQ-037) we record the engine-assigned slug. On list/read we reconcile: any
engine workspace not in the map gets a row minted (handles imports/out-of-band creates).
`product_id` decouples our API from engine slug values. User→workspace assignment state is
queried live from the engine (`manage-users`/members) keyed through this map; we persist
the mapping, not a duplicate membership table (spec §6.4 reads membership from the engine).

### `audit_log` (REQ-093, REQ-093a) — append-only
```
id           INTEGER PK AUTOINCREMENT
ts           TEXT NOT NULL
actor        TEXT             -- staff id, or 'system'/'anonymous' for pre-auth events
action       TEXT NOT NULL    -- method+route or auth event name
target       TEXT             -- opaque identifiers (json)
outcome      TEXT NOT NULL    -- 'success' | 'failure'
detail       TEXT             -- json; secret VALUES redacted (REQ-062/094), key names kept; carries the `verified` result — a boolean for single-delta ops, the per-control-id map for a batched settings write (REQ-093, REQ-029f)
```
Append-only by discipline: the app only ever INSERTs; no UPDATE/DELETE code path exists,
and a runtime guard/trigger rejects mutation (REQ-093a test). Every mutating product
route and every staff-auth event (login success/failure, enroll, reset, lifecycle) writes
one row (REQ-093a). Also mirrored to structured stdout (REQ-099).

### `event_outbox` (transactional outbox — see 04-cross-cutting.md)
```
id INTEGER PK, ts TEXT, envelope TEXT NOT NULL (json), published_at TEXT NULL
```
Written in the same transaction as the verify result; a relay drains unpublished rows to
the real bus. Lets us satisfy REQ-029d even before the on-box bus exists.

## `admin.*` event schemas (§14)

Common envelope (REQ-029c) — see `events/emitter.ts` in `01-bff-architecture.md`:
```ts
{ event, actor, target: {opaque handles}, changes?, verified, timestamp } // secrets redacted
```
`verified` (REQ-028/029c) is a **boolean** for single-delta events, EXCEPT
`admin.instance.setting_changed`, whose `verified` is a **per-control-id map**
(product-control id → boolean), never a scalar (REQ-029f, see below).

Per-event payloads (all also carry actor + timestamp):

| Event | target | changes | REQ |
|---|---|---|---|
| `admin.workspace.created` | `{workspaceId}` | `{displayName}` | REQ-037 |
| `admin.workspace.updated` | `{workspaceId}` | `{fields: string[]}` (product field names, values non-secret) | REQ-032 |
| `admin.workspace.deleted` | `{workspaceId}` | — | REQ-038 |
| `admin.workspace.documents_changed` | `{workspaceId}` | `{added:string[], removed:string[]}` (doc refs) | REQ-039 |
| `admin.workspace_user.assigned` | `{workspaceId, userId}` | — | REQ-049 |
| `admin.workspace_user.unassigned` | `{workspaceId, userId}` | — | REQ-049 |
| `admin.user.created` | `{userId}` | `{username, role}` | REQ-042 |
| `admin.user.updated` | `{userId}` | `{fields: string[]}` | REQ-043 |
| `admin.user.suspended` | `{userId}` | — | REQ-043 |
| `admin.user.reactivated` | `{userId}` | — | REQ-043 |
| `admin.user.deleted` | `{userId}` | — | REQ-044 |
| `admin.invite.created` | `{inviteId}` | `{workspaceIds: string[]}` | REQ-046 |
| `admin.invite.revoked` | `{inviteId}` | — | REQ-047 |
| `admin.instance.setting_changed` | `{categories: string[], controlIds: string[]}` | `{categories: string[], controlIds: string[]}` (product-control ids, secret values redacted); `verified` is a **per-control-id map** (REQ-029c/029f) | §7 intro / REQ-101 / REQ-029c / REQ-029f |
| `admin.instance.provider_changed` | `{selector}` (product selector id: `llm.provider`/`embedding.engine`/`vectorDb.provider`/`tts.provider`/`stt.provider`, REQ-063) | `{newProvider}`; own scalar `verified` (REQ-029f) | REQ-063 / REQ-029f |
| `admin.raw_env.written` | `{}` | `{keys: string[]}` (opaque operator keys, secret values redacted); scalar `verified` | REQ-078d / REQ-078f |

Rules: emitted only after `verifiedWrite` succeeds (REQ-029a); none on failure/unverified
(REQ-029b); a mutation maps to **one or more** events, one per state delta (membership emits
one assigned/unassigned per user; a batched settings write emits one `setting_changed` plus
one `provider_changed` per changed selector), reads to none (REQ-029/029e); targets carry
opaque handles/product-control ids only, never parsed engine internals (REQ-021b).

**Batched curated settings write (`admin.instance.setting_changed`, REQ-029f/101).** The
curated `PATCH /api/settings` save is ONE engine `update-env` call that may mix key classes,
so its event is NOT all-or-nothing suppressed on a 2xx write (REQ-029b batch exception):
- `verified` is a **per-control-id map** (product-control id → boolean), never a single
  scalar (REQ-029c). Observable keys carry their re-read result (`true` confirmed / `false`
  change-absent); unobservable secret-overwrites and write-only keys carry best-effort
  `false` but STILL emit (auditable). A single observable key failing re-read records `false`
  in the map but MUST NOT suppress the event and hide secret/write-only keys that persisted.
- `admin.instance.provider_changed` is a distinct event, one per changed provider selector,
  each carrying its OWN scalar `verified`. On a 2xx batch a selector whose re-read shows no
  actual change is emitted with `verified:false` (emit-with-`false`, NOT suppressed — R-2).
- If the engine write returns non-OK (nothing persisted), REQ-029b applies and BOTH
  `setting_changed` and `provider_changed` are suppressed (failure audit only).

**Raw-editor scope (REQ-078f, N-4).** A raw-editor write emits ONLY `admin.raw_env.written`
— never `setting_changed`/`provider_changed`, even for curated-category or provider-selector
keys (e.g. a break-glass `LLMProvider` change), because raw writes are opaque `{key,value}`
pairs not mapped to product-control ids/categories. Bus consumers that must observe
break-glass provider/setting changes MUST subscribe to `admin.raw_env.written` in ADDITION
to the curated events; watching only the curated events misses raw-editor changes.

### Event name type (`events/catalog.ts`)
```ts
export type AdminEventName =
  | 'admin.workspace.created' | 'admin.workspace.updated' | 'admin.workspace.deleted'
  | 'admin.workspace.documents_changed'
  | 'admin.workspace_user.assigned' | 'admin.workspace_user.unassigned'
  | 'admin.user.created' | 'admin.user.updated' | 'admin.user.suspended'
  | 'admin.user.reactivated' | 'admin.user.deleted'
  | 'admin.invite.created' | 'admin.invite.revoked'
  | 'admin.instance.setting_changed' | 'admin.instance.provider_changed'
  | 'admin.raw_env.written';

// admin.instance.setting_changed payload (REQ-029c/029f/101, MIN-3): `verified` is a
// per-control-id MAP, never a scalar; product-control ids per the shared type (REQ-062b);
// secret values redacted.
export interface SettingChangedPayload {
  categories: string[];                // §7.1–§7.8 categories touched
  controlIds: string[];                // touched product-control ids (REQ-062b)
  verified: Record<string, boolean>;   // product-control id → verified (REQ-029f)
}

// admin.instance.provider_changed payload (REQ-063/029f): one per changed selector, own
// scalar `verified` (false when the 2xx re-read shows no actual change — R-2).
export interface ProviderChangedPayload {
  selector: string;                    // product selector id (REQ-063), e.g. 'llm.provider'
  newProvider: string;
  verified: boolean;
}
```
