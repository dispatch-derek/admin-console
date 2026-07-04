# Product API Contract

The console's OWN clean API — the stable contract `web/` consumes. Product vocabulary
only; NO engine field names cross this boundary (REQ-021a). For each route: method, path,
request/response (product types), the engine `/api/v1` call(s) it maps to (BFF-internal),
and whether it mutates (→ verify-after-write + which `admin.*` event, §14).

All routes are under `/api`. All except auth/login steps and `/health` require a valid
staff session cookie (REQ-012). Error bodies are always `{ message: string }` rendered
verbatim by the web app (REQ-097a).

## Shared product types (excerpt — `bff/src/types/product-types.ts`, shared with web/)

```ts
export interface Workspace {
  id: string;                 // opaque product handle (REQ-021b)
  displayName: string;
  llmProvider: string | null; // engine chatProvider
  llmModel: string | null;    // engine chatModel
}
export interface WorkspaceSettings extends Workspace {
  responseMode: 'chat' | 'query' | string; // out-of-range value shown read-only (REQ-034)
  temperature: number | null;              // openAiTemp   [0,2]
  historyWindow: number;                   // openAiHistory >=0
  systemPrompt: string | null;             // openAiPrompt
  retrievalThreshold: number | null;       // similarityThreshold [0,1]
  retrievalTopN: number;                   // topN >=1
  agentLlmProvider: string | null;         // agentProvider
  agentLlmModel: string | null;            // agentModel
  noResultsMessage: string | null;         // queryRefusalResponse
  retrievalMode: string | null;            // vectorSearchMode
  avatar: string | null;                   // pfpFilename
}
// PATCH body: Partial<WorkspaceSettings> minus id; null = inherit, omitted = no change (REQ-033/036)

export interface User {
  id: string; username: string;
  role: 'default' | 'admin' | 'manager';
  suspended: boolean;                      // engine 0/1 (REQ-041)
  dailyMessageLimit: number | null;
}
export interface Invite {
  id: string; code: string;
  status: string; claimedBy: string | null;
  workspaceIds: string[];                  // scoped product workspace handles
}
export interface DocumentRef { id: string; title: string; }
export interface SettingsView {            // GET /api/settings, product-labeled
  categories: SettingCategory[];           // each control carries a product label + set/notSet for secrets
}
export interface RawEnvEntry {
  key: string;                             // opaque operator string (REQ-078e)
  state: 'value' | 'set' | 'notSet' | 'unknown';
  value?: string;                          // present only for non-secret 'value' state
}
export interface OllamaModel { name: string; }
export interface ErrorBody { message: string; }
```

## Auth & staff routes (§3.2)

| Method / path | Req | Resp | Engine call | Mutates → event |
|---|---|---|---|---|
| `POST /api/auth/login` | `{username,password}` | `{stage:'mfa'|'enroll'|'setPassword', challengeId}` or session set | none (local store) | no |
| `POST /api/auth/mfa` | `{challengeId, code}` | session cookie set, `{staff}` | none | no (login audited) |
| `POST /api/auth/enroll` | `{challengeId, code}` | `{recoveryCodes[]}` + session | none | no (audited REQ-017) |
| `POST /api/auth/set-password` | `{challengeId, newPassword}` | next stage | none | no (bootstrap REQ-019a) |
| `POST /api/auth/recovery` | `{username, password, recoveryCode}` | session or enroll stage | none | no (REQ-019) |
| `POST /api/auth/logout` | — | 204 | none | no |
| `GET /api/auth/me` | — | `{staff}` | none | no |
| `GET /api/staff` | — | `Staff[]` | none | no |
| `POST /api/staff` | `{username,role?}` | `Staff` | none | audited (REQ-018) |
| `PATCH /api/staff/:id` | `{disabled?}` | `Staff` | none | audited; guardrails REQ-018a |
| `DELETE /api/staff/:id` | — | 204 | none | audited; guardrails REQ-018a |
| `POST /api/staff/:id/reset-password` | — | `{tempToken}` | none | audited |
| `POST /api/staff/:id/reset-mfa` | — | 204 | none | audited (REQ-019) |

Staff routes touch only the BFF store, not the engine; they emit audit entries, not
`admin.*` events (those are engine-domain events).

## Workspaces (§5)

| Method / path | Req | Resp | Engine call | Mutates → event |
|---|---|---|---|---|
| `GET /api/workspaces` | — | `Workspace[]` | `GET /v1/workspaces` | no (REQ-030) |
| `GET /api/workspaces/:id` | — | `WorkspaceSettings` | `GET /v1/workspace/{slug}` | no (REQ-031) |
| `POST /api/workspaces` | `{displayName}` | `Workspace` | `POST /v1/workspace/new` | yes → `admin.workspace.created` (REQ-037) |
| `PATCH /api/workspaces/:id/settings` | `Partial<WorkspaceSettings>` | `WorkspaceSettings` | `POST /v1/workspace/{slug}/update` | yes → `admin.workspace.updated` (REQ-032) |
| `DELETE /api/workspaces/:id` | — | 204 | `DELETE /v1/workspace/{slug}` | yes → `admin.workspace.deleted` (REQ-038, §8 REQ-081) |
| `GET /api/documents` | — | `DocumentRef[]` | `GET /v1/documents` | no (REQ-039) |
| `PUT /api/workspaces/:id/knowledge` | `{adds:string[],deletes:string[]}` | `WorkspaceSettings` | `POST /v1/workspace/{slug}/update-embeddings` | yes → `admin.workspace.documents_changed` (REQ-039) |
| `POST /api/workspaces/:id/knowledge/pin` | `{documentId,pinned}` | 200 | `POST /v1/workspace/{slug}/update-pin` | yes → `admin.workspace.documents_changed` (REQ-039) |

Field mapping for PATCH is the REQ-032 table, applied in `engine/mappers.ts`. Only
changed fields are sent (REQ-033); JSON `null` = inherit (REQ-036); `responseMode`
out-of-range value is never written unless explicitly changed (REQ-034).

## Users, invites, membership (§6)

Guarded by the multi-user precondition (REQ-040): the web app calls
`GET /api/multi-user-status` first and disables all §6 UI when OFF.

| Method / path | Req | Resp | Engine call | Mutates → event |
|---|---|---|---|---|
| `GET /api/multi-user-status` | — | `{enabled:boolean}` | `GET /v1/admin/is-multi-user-mode` | no (REQ-040) |
| `GET /api/users` | — | `User[]` | `GET /v1/admin/users` | no (REQ-041) |
| `POST /api/users` | `{username,password,role}` | `User` | `POST /v1/admin/users/new` | yes → `admin.user.created` (REQ-042) |
| `PATCH /api/users/:id` | `{role?,suspended?,dailyMessageLimit?}` | `User` | `POST /v1/admin/users/{id}` | yes → `admin.user.updated` (+`suspended`/`reactivated`) (REQ-043) |
| `DELETE /api/users/:id` | — | 204 | `DELETE /v1/admin/users/{id}` | yes → `admin.user.deleted` (REQ-044, §8 REQ-082) |
| `GET /api/invites` | — | `Invite[]` | `GET /v1/admin/invites` | no (REQ-045) |
| `POST /api/invites` | `{workspaceIds?:string[]}` | `Invite` | `POST /v1/admin/invite/new` | yes → `admin.invite.created` (REQ-046) |
| `DELETE /api/invites/:id` | — | 204 | `DELETE /v1/admin/invite/{id}` | yes → `admin.invite.revoked` (REQ-047) |
| `GET /api/workspaces/:id/members` | — | `User[]` | `GET /v1/admin/workspaces/{workspaceId}/users` | no (REQ-048) |
| `POST /api/workspaces/:id/members` | `{userIds:string[], reset:boolean}` | `User[]` | `POST /v1/admin/workspaces/{workspaceSlug}/manage-users` | yes → `admin.workspace_user.assigned`/`unassigned` per delta (REQ-049) |
| `GET /api/oversight/chats` | query params | `EngineChatPage`-shaped product page | `POST /v1/admin/workspace-chats` | no (REQ-051) |

Membership: the BFF resolves `:id` → numeric id (for the members read) and → slug (for
the `manage-users` write) via `identity/workspace-map` (REQ-048/049). It diffs the
verified membership against the prior set to emit one assigned/unassigned event per user.

## Instance settings, raw editor, diagnostics, discovery (§7)

| Method / path | Req | Resp | Engine call | Mutates → event |
|---|---|---|---|---|
| `GET /api/settings` | — | `SettingsView` | `GET /v1/system` | no (REQ-060) |
| `PATCH /api/settings` | `{changes: Record<label,value>}` | `SettingsView` | `POST /v1/system/update-env` | yes → `admin.instance.setting_changed` (+`provider_changed`) (REQ-101, REQ-063) |
| `GET /api/settings/raw` | — | `RawEnvEntry[]` | `GET /v1/system` (+ key set from `env-keys.ts`) | no (REQ-078a) |
| `PUT /api/settings/raw` | `{entries:{key,value}[]}` | `RawEnvEntry[]` | `POST /v1/system/update-env` | yes → `admin.raw_env.written` (REQ-078d, §8 REQ-088a) |
| `GET /api/diagnostics/vectors` | — | `{count:number}` | `GET /v1/system/vector-count` | no (REQ-074) |
| `GET /api/diagnostics/env` | — | masked `Record<string,string>` | `GET /v1/system/env-dump` | no (REQ-074) |
| `GET /api/models/ollama` | `?basePath?` | `{models:OllamaModel[]}` or `{unavailable:true,message}` | Ollama `GET /api/tags` | no (REQ-075/076) |

Curated `PATCH /api/settings` maps product-labeled controls to engine env keys inside the
BFF; the label→key map is BFF-internal (REQ-021a). The write is validated against the
186-key whitelist (`env-keys.ts`, REQ-096). Secret fields obey overwrite-without-reveal:
a blank field is dropped from the patch (REQ-061). Provider-selector changes
(`LLMProvider`, `EmbeddingEngine`, `VectorDB`, `TextToSpeechProvider`,
`SpeechToTextProvider`) additionally emit `admin.instance.provider_changed` (REQ-063).

Raw editor: keys are opaque operator strings validated against `env-keys.ts` both
client- and server-side (REQ-078b/078e); unknown keys → 400. The masked diff + typed
token gate is a UI concern (REQ-078c) enforced before `PUT`; the BFF still re-validates.

## Health

`GET /health → { ok: true }`, no session (REQ-024).

## Engine mapping is BFF-only

Changing an engine path/field requires editing only `engine/adapter.ts` +
`engine/mappers.ts`; the product route contract and `web/` are untouched (REQ-022).
