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
detail       TEXT             -- json; secret VALUES redacted (REQ-062/094), key names kept
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
{ event, actor, target: {opaque handles}, changes?, timestamp } // secrets redacted
```

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
| `admin.instance.setting_changed` | `{category}` | `{keys: string[]}` (secret values redacted; key names kept) | REQ-101 |
| `admin.instance.provider_changed` | `{selector}` | `{newProvider}` | REQ-063 |
| `admin.raw_env.written` | `{}` | `{keys: string[]}` (secret values redacted) | REQ-078d |

Rules: emitted only after `verifiedWrite` succeeds (REQ-029a); none on failure/unverified
(REQ-029b); every mutating route maps to ≥1 event, reads to none (REQ-029e); targets carry
opaque handles only, never parsed engine internals (REQ-021b).

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
```
