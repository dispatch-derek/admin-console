// Product request/response interfaces SHARED with web/ (REQ-025). Product vocabulary
// ONLY — no engine field names cross this boundary (REQ-021a). This is the stable
// contract web/ consumes; see 02-product-api.md §"Shared product types".

// A staff operator account (§3.2). The BFF-owned auth identity, independent of the engine
// user store (REQ-010). Never carries password_hash/totp_secret across the API boundary.
export interface Staff {
  id: string;
  username: string;
  mfaEnrolled: boolean;
  disabled: boolean;
  mustSetPassword: boolean;
  createdAt: string;
}

export interface Workspace {
  id: string; // opaque product handle (REQ-021b)
  displayName: string;
  llmProvider: string | null; // engine chatProvider
  llmModel: string | null; // engine chatModel
}

export interface WorkspaceSettings extends Workspace {
  responseMode: 'chat' | 'query' | string; // out-of-range value shown read-only (REQ-034)
  temperature: number | null; // openAiTemp   [0,2]
  historyWindow: number; // openAiHistory >=0
  systemPrompt: string | null; // openAiPrompt
  retrievalThreshold: number | null; // similarityThreshold [0,1]
  retrievalTopN: number; // topN >=1
  agentLlmProvider: string | null; // agentProvider
  agentLlmModel: string | null; // agentModel
  noResultsMessage: string | null; // queryRefusalResponse
  retrievalMode: string | null; // vectorSearchMode; validated free-text (trimmed, non-empty), default 'default', NO enforced enum (REQ-036b)
  avatar: string | null; // pfpFilename; existing filename-string ref only, binary upload out of scope (REQ-036c, REQ-121)
}
// PATCH body: Partial<WorkspaceSettings> minus id; null = inherit, omitted = no change (REQ-033/036)

export interface User {
  id: string;
  username: string;
  role: 'default' | 'admin' | 'manager';
  suspended: boolean; // engine 0/1 (REQ-041)
  dailyMessageLimit: number | null;
}

export interface Invite {
  id: string;
  code: string;
  status: string;
  claimedBy: string | null;
  workspaceIds: string[]; // scoped product workspace handles
}

export interface DocumentRef {
  id: string;
  title: string;
}

// A single curated control within a settings category (§7). Carries a product-control
// id + label + type; secret-bearing controls expose only set/notSet state, never the
// stored value (REQ-060, REQ-062b). Non-secret controls carry their current value.
export interface SettingControl {
  id: string; // product-control id (REQ-062b), e.g. 'llm.provider'
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'secret';
  secret: boolean;
  value?: string | number | boolean | null; // present for non-secret controls
  set?: boolean; // present only for secret controls: is a value currently set?
}

export interface SettingCategory {
  id: string; // §7.1–§7.8 category id
  label: string;
  controls: SettingControl[];
}

export interface SettingsView {
  // GET /api/settings, product-labeled
  categories: SettingCategory[]; // each control carries a product-control id + label + set/notSet for secrets
}

// PATCH /api/settings response (REQ-101 HTTP-response contract, R-3): carries the
// per-control-id verify map the web app reads to render per-field verification state
// (REQ-098a/098b). Product-control ids are governed by the shared type (REQ-062b).
// This is the HTTP-response twin of the admin.instance.setting_changed payload (delivered
// over HTTP; web/ cannot read the on-box bus, REQ-029d).
export interface SettingsWriteResult extends SettingsView {
  verified: Record<string, boolean>; // product-control id → verified (REQ-029f); NOT a scalar
  changedCategories: string[]; // §7.1–§7.8 categories touched (MIN-3)
}

export interface RawEnvEntry {
  key: string; // opaque operator string (REQ-078e)
  state: 'value' | 'set' | 'notSet' | 'unknown';
  value?: string; // present only for non-secret 'value' state
}

export interface OllamaModel {
  name: string;
}

export interface ErrorBody {
  message: string;
}
