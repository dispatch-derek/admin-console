# Web App Architecture (React + TypeScript + Vite)

Greenfield frontend that speaks ONLY the product `/api/*` contract and contains no
knowledge that the engine exists (REQ-021/021a). Mirrors `front-end-custom/web`
conventions: `fetch` against relative paths, Vite proxying `/api/*` to the BFF, typed
API client, `type: module`.

## Layout (`web/src/`)

```
web/src/
  main.tsx                  React root.
  App.tsx                   Auth gate + top-level navigation between feature areas.
  router.tsx                Light route table (or in-app view switch as sibling does).

  api/
    client.ts               Typed product API functions (see below). Relative /api/* only.
    types.ts                Product types imported from the shared contract (REQ-025).
    errors.ts               Reads {message} from failed responses for verbatim display (REQ-097a).

  auth/
    AuthContext.tsx         Session state, /api/auth/me, login/logout, guards routes (REQ-012/014).
    LoginPage.tsx           Two-step: password → MFA / enroll / set-password stages (§3.2).
    EnrollMfa.tsx           QR/secret display, code confirm, recovery-code reveal (REQ-017).

  features/
    workspaces/             §5: list, detail/settings editor, create, delete, knowledge/docs.
      WorkspaceList.tsx, WorkspaceSettings.tsx, CreateWorkspace.tsx, KnowledgePanel.tsx
    users/                  §6: multi-user gate, users, invites, membership, oversight.
      MultiUserGate.tsx, UserList.tsx, InviteList.tsx, MembershipPanel.tsx, ChatOversight.tsx
    settings/               §7: curated category forms + secret fields + provider selectors.
      SettingsPage.tsx, category forms, SecretField.tsx, OllamaModelSelect.tsx
    raweditor/              §7.11: advanced-mode gate, key list, masked diff, typed confirm.
      RawEnvEditor.tsx, AdvancedModeGate.tsx, MaskedDiffConfirm.tsx
    diagnostics/            §7.9: vector count, masked env-dump.
      DiagnosticsPage.tsx

  components/
    DangerConfirm.tsx       Reusable typed-confirmation dialog for §8 dangerous ops.
    ErrorBanner.tsx         Renders BFF {message} verbatim (REQ-097a).
    SetNotSetBadge.tsx      Secret set/not-set indicator (REQ-060).
    FieldValidation.tsx     Client-side numeric bounds (REQ-035) + free-text model rules (REQ-064a).
```

## API client (`api/client.ts`)

Mirrors the sibling client style: relative paths, `fetch`, throw with the BFF `{message}`
on non-OK. One function per product route in `02-product-api.md`. Examples:

```ts
export async function listWorkspaces(): Promise<Workspace[]>;
export async function getWorkspace(id: string): Promise<WorkspaceSettings>;
export async function updateWorkspaceSettings(id: string, patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings>;
export async function deleteWorkspace(id: string): Promise<void>;
export async function getMultiUserStatus(): Promise<{ enabled: boolean }>;
export async function listOllamaModels(): Promise<{ models: OllamaModel[] } | { unavailable: true; message: string }>;
export async function getSettings(): Promise<SettingsView>;
export async function patchSettings(changes: Record<string, unknown>): Promise<SettingsView>;
export async function getRawEnv(): Promise<RawEnvEntry[]>;
export async function putRawEnv(entries: { key: string; value: string }[]): Promise<RawEnvEntry[]>;
```

All requests include credentials (session cookie). A 401 anywhere → `AuthContext` clears
state and routes to `/login` (REQ-014).

## Enforced frontend constraints

- **No engine leakage (REQ-021a):** all field names are product vocabulary; the settings
  and raw-editor code hold no compiled-in engine key identifiers — the raw editor's valid
  key list is fetched from the BFF (REQ-078b/078e). CI runs a static scan for engine
  identifiers and `/v1/` / absolute engine URLs (REQ-021, REQ-026 tests).
- **Client-side validation (REQ-035):** numeric bounds block submit before send;
  non-Ollama model fields validate non-empty/no-whitespace (REQ-064a).
- **Multi-user gate (REQ-040):** `MultiUserGate` calls `getMultiUserStatus()`; when OFF,
  all §6 controls are disabled with the out-of-band notice and no enable action.
- **Dangerous-op confirmations (§8):** `DangerConfirm` implements typed-target
  confirmation — workspace slug for delete (REQ-081), username for user delete (REQ-082),
  provider/embedding/auth-token warnings (REQ-083/084/086), masked diff + token for raw
  writes (REQ-078c). A dangerous settings dialog triggers a fresh `getSettings()` read
  first (REQ-092).
- **Verbatim errors (REQ-097a):** `ErrorBanner` prints the BFF `{message}` unchanged.
- **No-partial-success (REQ-098):** on a failed settings write the field keeps its prior
  value and the UI states the change was not saved.

## Read-view performance (REQ-100)

List views (workspaces, users, settings) are single fetches rendered directly; settings
batches all edits into one `PATCH /api/settings` (REQ-101). No client-side heavy compute;
p95 target is dominated by upstream latency.
