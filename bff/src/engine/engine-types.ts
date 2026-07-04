// Engine request/response shapes for AnythingLLM `/api/v1` (REQ-025, REQ-026). These use
// ENGINE field names and live ONLY here — never exported to web/. Best-effort shapes from
// docs/anythingllm-surface.md; the adapter + mappers are the sole consumers. Contract
// tests (REQ-022a) guard these against engine drift.

// --- Workspaces (surface §3) ---

export interface EngineWorkspace {
  id: number; // numeric id from GET /v1/workspaces (for membership reads, REQ-048)
  name: string; // display name
  slug: string; // opaque URL id, set on create
  chatProvider: string | null;
  chatModel: string | null;
  chatMode: string; // 'chat' | 'query'
  openAiTemp: number | null;
  openAiHistory: number;
  openAiPrompt: string | null;
  similarityThreshold: number | null;
  topN: number | null;
  agentProvider: string | null;
  agentModel: string | null;
  queryRefusalResponse: string | null;
  vectorSearchMode: string | null;
  pfpFilename: string | null;
  documents?: EngineDocument[];
}

// POST /v1/workspace/new
export interface EngineNewWorkspace {
  name: string;
}

// Partial write body for POST /v1/workspace/{slug}/update — only changed fields sent.
export interface EngineWorkspaceUpdate {
  name: string;
  chatProvider: string | null;
  chatModel: string | null;
  chatMode: string;
  openAiTemp: number | null;
  openAiHistory: number;
  openAiPrompt: string | null;
  similarityThreshold: number | null;
  topN: number;
  agentProvider: string | null;
  agentModel: string | null;
  queryRefusalResponse: string | null;
  vectorSearchMode: string | null;
  pfpFilename: string | null;
}

// GET /v1/documents / workspace documents (best-effort; engine returns a file tree).
export interface EngineDocument {
  id?: string;
  name: string; // storage/doc reference
  title?: string;
  docpath?: string;
  pinned?: boolean;
  [k: string]: unknown;
}

// --- Users / invites / membership (surface §4) ---

export interface EngineUser {
  id: number;
  username: string;
  role: string; // 'default' | 'admin' | 'manager'
  suspended: number; // 0/1
  dailyMessageLimit: number | null;
  [k: string]: unknown;
}

// POST /v1/admin/users/new
export interface EngineNewUser {
  username: string;
  password: string;
  role: string;
}

// POST /v1/admin/users/{id} — partial.
export interface EngineUserUpdate {
  role: string;
  suspended: number; // 0/1
  dailyMessageLimit: number | null;
}

export interface EngineInvite {
  id: number;
  code: string;
  status: string; // default 'pending'
  claimedBy: string | null;
  workspaceIds: string | null; // csv on the engine
  createdBy?: number;
  [k: string]: unknown;
}

// POST /v1/admin/workspace-chats — oversight query.
export interface EngineChatQuery {
  offset?: number;
  limit?: number;
  workspaceId?: number;
  [k: string]: unknown;
}

export interface EngineChatPage {
  chats: unknown[];
  hasPages?: boolean;
  [k: string]: unknown;
}

// --- System settings (surface §5) ---

// GET /v1/system returns a settings object; secret-bearing keys are booleans (set/unset).
export interface EngineSystem {
  settings: Record<string, string | number | boolean | null>;
}

// --- Ollama discovery (surface §5.2; via ollama.ts, not /api/v1) ---

export interface OllamaModel {
  name: string;
  model?: string;
  [k: string]: unknown;
}
