// Structural product types mirrored from the BFF shared contract (bff/src/types/product-types.ts,
// REQ-025). Product vocabulary ONLY — no engine field names, no engine key catalog. The web app
// is DATA-DRIVEN off the API responses (it renders whatever GET /api/settings returns), which is
// what keeps engine keys out of the frontend (REQ-021a). The SETTINGS_CATALOG literal, the
// ProductControlId union, and SettingsCatalogEntry are intentionally NOT copied here.

export interface Staff {
  id: string;
  username: string;
  mfaEnrolled: boolean;
  disabled: boolean;
  mustSetPassword: boolean;
  createdAt: string;
}

export interface Workspace {
  id: string;
  displayName: string;
  llmProvider: string | null;
  llmModel: string | null;
}

export interface WorkspaceSettings extends Workspace {
  responseMode: 'chat' | 'query' | string; // out-of-range value shown read-only (REQ-034)
  temperature: number | null; // [0,2]
  historyWindow: number; // >= 0
  systemPrompt: string | null;
  retrievalThreshold: number | null; // [0,1]
  retrievalTopN: number; // >= 1
  agentLlmProvider: string | null;
  agentLlmModel: string | null;
  noResultsMessage: string | null;
  retrievalMode: string | null; // validated free-text, default 'default' (REQ-036b)
  avatar: string | null; // existing filename ref only; binary upload out of scope (REQ-036c)
  documents: WorkspaceDocument[]; // currently-attached docs + pin state (REQ-039)
}

export interface User {
  id: string;
  username: string;
  role: 'default' | 'admin' | 'manager';
  suspended: boolean;
  dailyMessageLimit: number | null;
}

export interface Invite {
  id: string;
  code: string;
  status: string;
  claimedBy: string | null;
  workspaceIds: string[];
}

export interface DocumentRef {
  id: string;
  title: string;
}

export interface WorkspaceDocument extends DocumentRef {
  pinned: boolean;
}

export interface OversightChatPage {
  chats: unknown[];
  hasMore: boolean;
}

export type SettingControlType = 'text' | 'number' | 'boolean' | 'select' | 'secret';

export type SettingsCategoryId =
  | 'llm'
  | 'embedding'
  | 'vectorDb'
  | 'agentSkills'
  | 'tts'
  | 'stt'
  | 'security';

export interface SettingControl {
  id: string; // product-control id (opaque to the web; never an engine key)
  label: string;
  type: SettingControlType;
  secret: boolean;
  value?: string | number | boolean | null; // present for non-secret controls
  set?: boolean; // present only for secret controls
  readOnly?: boolean; // §7.8 read-only system flags (REQ-072)
  dangerous?: boolean; // §8 dangerous change (server-authoritative gate, REQ-083/084/086)
  options?: { value: string; label: string }[]; // when present, a 'select' renders a dropdown
}

export interface SettingCategory {
  id: string;
  label: string;
  controls: SettingControl[];
}

export interface SettingsView {
  categories: SettingCategory[];
}

export interface SettingsWriteResult extends SettingsView {
  verified: Record<string, boolean>; // product-control id -> verified (REQ-098a/098b)
  changedCategories: string[];
}

export interface RawEnvEntry {
  key: string; // opaque operator string (REQ-078e)
  state: 'value' | 'set' | 'notSet' | 'unknown';
  value?: string; // present only for non-secret 'value' state
}

export interface OllamaModel {
  name: string;
}

export interface OllamaModelsResult {
  available: boolean;
  models: OllamaModel[];
}

export interface ErrorBody {
  message: string;
}

// PATCH /api/settings body (REQ-101): a partial map of product-control id -> new value. The web
// binds to a plain record because it never knows the concrete engine-derived id set — it echoes
// back ids it read from GET /api/settings (REQ-021a).
export type SettingsPatch = Record<string, string | number | boolean | null>;

// --- Auth FSM response shapes (from bff/src/routes/auth.routes.ts) ---

export type LoginStageName = 'setPassword' | 'enroll' | 'mfa';

// POST /api/auth/login and /set-password land on a stage; 'enroll' additionally carries the
// TOTP enrollment material the client displays.
export interface LoginStage {
  stage: LoginStageName;
  challengeId: string;
  secret?: string;
  otpauthUri?: string;
  qr?: string;
}

export interface EnrollResult {
  recoveryCodes: string[];
  staff: Staff;
}

export interface SessionResult {
  staff: Staff;
}

// /recovery returns either a stage (still owes set-password/enroll) or a completed session.
export type StageOrSession = LoginStage | SessionResult;

export function isSessionResult(r: StageOrSession): r is SessionResult {
  return (r as SessionResult).staff !== undefined;
}

// --- F-002 Customer-Wide Baseline System Prompt (mirrored from product-types.ts §7.1) ----------
// Product vocabulary ONLY (REQ-F002-028/037): no engine field names cross this boundary. The web
// speaks exclusively to the /api/baseline-prompt* product routes.

export interface BaselinePrompt {
  text: string | null; // the baseline; null = never defined
  updatedAt: string | null; // ISO-8601
  updatedBy: string | null; // staff id (actor)
}

export type BaselineSyncState = 'synced' | 'stale' | 'overridden' | 'never-applied';
export type OperatorMode = 'prepend' | 'overwrite' | 'fill';
export type BaselineResolvedMode = 'prepend' | 'baseline-only' | 'overwrite' | 'fill';
export type OverrideResolution = 'preserve' | 'discard';
export type BaselineApplyOutcome = 'applied' | 'failed' | 'skipped' | 'diverged';

export interface BaselineWorkspaceStatus {
  workspaceId: string;
  displayName: string;
  syncState: BaselineSyncState;
  hasWorkspaceRemainder: boolean;
}

export interface BaselineStatusView {
  baseline: BaselinePrompt;
  workspaces: BaselineWorkspaceStatus[];
  counts: Record<BaselineSyncState, number>;
}

export interface BaselinePreviewItem {
  workspaceId: string;
  displayName: string;
  syncState: BaselineSyncState;
  resolvedMode: BaselineResolvedMode; // per-workspace resolved branch (REQ-F002-059)
  currentPrompt: string | null;
  currentPromptHash: string;
  composedPrompt: string | null; // null only for an overridden prepend item (candidates below)
  composedIfPreserve?: string; // overridden prepend only
  composedIfDiscard?: string; // overridden prepend only
  willChange: boolean;
  message?: string;
}

export interface BaselinePreview {
  affectedCount: number;
  unchangedCount: number;
  items: BaselinePreviewItem[];
  confirmToken: string; // opaque binding nonce — never displayed (REQ-F002-020/048)
  confirmationPhrase: string; // human-typeable danger phrase (REQ-F002-048)
}

export interface BaselineApplyResultItem {
  workspaceId: string;
  displayName: string;
  outcome: BaselineApplyOutcome;
  verified: boolean;
  message?: string;
}

export interface BaselineApplyResult {
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  divergedCount: number;
  items: BaselineApplyResultItem[];
}

export interface BaselineApplyRequest {
  confirmToken: string;
  typedConfirmation: string;
  mode: OperatorMode;
  overrides?: { workspaceId: string; resolution: OverrideResolution }[];
}
