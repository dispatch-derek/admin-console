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
  documents: WorkspaceDocument[]; // currently-attached docs + pin state (REQ-039); read-only here, managed via the knowledge routes
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

// A document currently attached to a workspace (REQ-039), with its pin state — so the
// knowledge panel can show current attach/pin status, not just the global document picker.
export interface WorkspaceDocument extends DocumentRef {
  pinned: boolean;
}

// EngineChatPage-shaped read-only oversight page (REQ-051, design 02); chats are opaque
// history records passed through.
export interface OversightChatPage {
  chats: unknown[];
  hasMore: boolean;
}

// The kind of UI control a curated setting renders as (§7). 'secret' controls expose only
// set/notSet state; 'select' is a constrained selector (the six provider/router/engine/db
// selectors); 'number'/'boolean'/'text' are self-describing.
export type SettingControlType = 'text' | 'number' | 'boolean' | 'select' | 'secret';

// The §7.1–§7.8 curated-settings category ids (stable display order below).
export type SettingsCategoryId =
  | 'llm'
  | 'embedding'
  | 'vectorDb'
  | 'agentSkills'
  | 'tts'
  | 'stt'
  | 'security';

// A single curated control within a settings category (§7). Carries a product-control
// id + label + type; secret-bearing controls expose only set/notSet state, never the
// stored value (REQ-060, REQ-062b). Non-secret controls carry their current value; read-only
// controls (the §7.8 system flags, REQ-072) are displayed but never written.
export interface SettingControl {
  id: string; // product-control id (REQ-062b), e.g. 'llm.provider'
  label: string;
  type: SettingControlType;
  secret: boolean;
  value?: string | number | boolean | null; // present for non-secret controls
  set?: boolean; // present only for secret controls: is a value currently set?
  readOnly?: boolean; // true for the §7.8 read-only system flags (REQ-072)
  // true for §8 dangerous settings (provider/embedding-model/vector-db/auth-token/jwt changes,
  // REQ-083/084/086) — server-authoritative so the web gates confirmation on this flag.
  dangerous?: boolean;
  // Optional constrained value set for a 'select' control (product-named values + labels). When
  // present the web renders a dropdown; when absent a select degrades to validated free-text. The
  // BFF leaves this UNSET today (the accepted provider enum values are not grounded, REQ-036b/064a);
  // this is the forward hook for a future grounded discovery source.
  options?: { value: string; label: string }[];
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

// GET /api/models/ollama result (REQ-075/076). `available:false` (with an empty list) is the
// graceful-degradation signal the web app maps to free-text entry + a warning; discovery
// NEVER throws (REQ-076).
export interface OllamaModelsResult {
  available: boolean;
  models: OllamaModel[];
}

// A single entry in the curated product-settings catalog (REQ-062b, the contract of record).
// ENGINE-FREE: only product vocabulary appears here; the product↔engine key map lives in the
// BFF-internal engine/settings-map.ts (REQ-021a/062a).
export interface SettingsCatalogEntry {
  id: string; // product-control id (REQ-062b)
  category: SettingsCategoryId;
  label: string;
  type: SettingControlType;
  secret: boolean;
  readOnly?: boolean; // §7.8 read-only system flags (REQ-072)
}

// The curated product-settings catalog (REQ-062b). Exactly one entry per writable engine key
// (186, grounding §5.1–§5.8) PLUS one read-only entry per §7.8 system flag (6). This literal
// is the SINGLE normative contract of record for product-control ids; `as const satisfies`
// preserves the literal id union while enforcing the entry shape. Order is category-stable:
// llm, embedding, vectorDb, agentSkills, tts, stt, security.
export const SETTINGS_CATALOG = [
  // §5.1 LLM provider selection
  { id: 'llm.provider', category: 'llm', label: 'Llm — Provider', type: 'select', secret: false },
  { id: 'llm.router', category: 'llm', label: 'Llm — Router', type: 'select', secret: false },
  // §5.2 LLM provider credentials/config (one group per provider)
  { id: 'llm.openai.apiKey', category: 'llm', label: 'Llm — Openai — Api Key', type: 'secret', secret: true },
  { id: 'llm.openai.model', category: 'llm', label: 'Llm — Openai — Model', type: 'text', secret: false },
  { id: 'llm.azureOpenai.endpoint', category: 'llm', label: 'Llm — Azure Openai — Endpoint', type: 'text', secret: false },
  { id: 'llm.azureOpenai.apiKey', category: 'llm', label: 'Llm — Azure Openai — Api Key', type: 'secret', secret: true },
  { id: 'llm.azureOpenai.model', category: 'llm', label: 'Llm — Azure Openai — Model', type: 'text', secret: false },
  { id: 'llm.azureOpenai.tokenLimit', category: 'llm', label: 'Llm — Azure Openai — Token Limit', type: 'number', secret: false },
  { id: 'llm.azureOpenai.embeddingModel', category: 'llm', label: 'Llm — Azure Openai — Embedding Model', type: 'text', secret: false },
  { id: 'llm.azureOpenai.modelType', category: 'llm', label: 'Llm — Azure Openai — Model Type', type: 'text', secret: false },
  { id: 'llm.anthropic.apiKey', category: 'llm', label: 'Llm — Anthropic — Api Key', type: 'secret', secret: true },
  { id: 'llm.anthropic.model', category: 'llm', label: 'Llm — Anthropic — Model', type: 'text', secret: false },
  { id: 'llm.anthropic.cacheControl', category: 'llm', label: 'Llm — Anthropic — Cache Control', type: 'text', secret: false },
  { id: 'llm.gemini.apiKey', category: 'llm', label: 'Llm — Gemini — Api Key', type: 'secret', secret: true },
  { id: 'llm.gemini.model', category: 'llm', label: 'Llm — Gemini — Model', type: 'text', secret: false },
  { id: 'llm.gemini.safetySetting', category: 'llm', label: 'Llm — Gemini — Safety Setting', type: 'text', secret: false },
  { id: 'llm.lmStudio.baseUrl', category: 'llm', label: 'Llm — Lm Studio — Base Url', type: 'text', secret: false },
  { id: 'llm.lmStudio.model', category: 'llm', label: 'Llm — Lm Studio — Model', type: 'text', secret: false },
  { id: 'llm.lmStudio.tokenLimit', category: 'llm', label: 'Llm — Lm Studio — Token Limit', type: 'number', secret: false },
  { id: 'llm.lmStudio.authToken', category: 'llm', label: 'Llm — Lm Studio — Auth Token', type: 'secret', secret: true },
  { id: 'llm.localAi.baseUrl', category: 'llm', label: 'Llm — Local Ai — Base Url', type: 'text', secret: false },
  { id: 'llm.localAi.model', category: 'llm', label: 'Llm — Local Ai — Model', type: 'text', secret: false },
  { id: 'llm.localAi.tokenLimit', category: 'llm', label: 'Llm — Local Ai — Token Limit', type: 'number', secret: false },
  { id: 'llm.localAi.apiKey', category: 'llm', label: 'Llm — Local Ai — Api Key', type: 'secret', secret: true },
  { id: 'llm.ollama.baseUrl', category: 'llm', label: 'Llm — Ollama — Base Url', type: 'text', secret: false },
  { id: 'llm.ollama.model', category: 'llm', label: 'Llm — Ollama — Model', type: 'text', secret: false },
  { id: 'llm.ollama.tokenLimit', category: 'llm', label: 'Llm — Ollama — Token Limit', type: 'number', secret: false },
  { id: 'llm.ollama.keepAlive', category: 'llm', label: 'Llm — Ollama — Keep Alive', type: 'number', secret: false },
  { id: 'llm.ollama.authToken', category: 'llm', label: 'Llm — Ollama — Auth Token', type: 'secret', secret: true },
  { id: 'llm.mistral.apiKey', category: 'llm', label: 'Llm — Mistral — Api Key', type: 'secret', secret: true },
  { id: 'llm.mistral.model', category: 'llm', label: 'Llm — Mistral — Model', type: 'text', secret: false },
  { id: 'llm.koboldCpp.baseUrl', category: 'llm', label: 'Llm — Kobold Cpp — Base Url', type: 'text', secret: false },
  { id: 'llm.koboldCpp.model', category: 'llm', label: 'Llm — Kobold Cpp — Model', type: 'text', secret: false },
  { id: 'llm.koboldCpp.tokenLimit', category: 'llm', label: 'Llm — Kobold Cpp — Token Limit', type: 'number', secret: false },
  { id: 'llm.koboldCpp.maxTokens', category: 'llm', label: 'Llm — Kobold Cpp — Max Tokens', type: 'number', secret: false },
  { id: 'llm.textGenWebUi.baseUrl', category: 'llm', label: 'Llm — Text Gen Web Ui — Base Url', type: 'text', secret: false },
  { id: 'llm.textGenWebUi.tokenLimit', category: 'llm', label: 'Llm — Text Gen Web Ui — Token Limit', type: 'number', secret: false },
  { id: 'llm.textGenWebUi.apiKey', category: 'llm', label: 'Llm — Text Gen Web Ui — Api Key', type: 'secret', secret: true },
  { id: 'llm.liteLlm.model', category: 'llm', label: 'Llm — Lite Llm — Model', type: 'text', secret: false },
  { id: 'llm.liteLlm.tokenLimit', category: 'llm', label: 'Llm — Lite Llm — Token Limit', type: 'number', secret: false },
  { id: 'llm.liteLlm.baseUrl', category: 'llm', label: 'Llm — Lite Llm — Base Url', type: 'text', secret: false },
  { id: 'llm.liteLlm.apiKey', category: 'llm', label: 'Llm — Lite Llm — Api Key', type: 'secret', secret: true },
  { id: 'llm.genericOpenai.baseUrl', category: 'llm', label: 'Llm — Generic Openai — Base Url', type: 'text', secret: false },
  { id: 'llm.genericOpenai.model', category: 'llm', label: 'Llm — Generic Openai — Model', type: 'text', secret: false },
  { id: 'llm.genericOpenai.tokenLimit', category: 'llm', label: 'Llm — Generic Openai — Token Limit', type: 'number', secret: false },
  { id: 'llm.genericOpenai.apiKey', category: 'llm', label: 'Llm — Generic Openai — Api Key', type: 'secret', secret: true },
  { id: 'llm.genericOpenai.maxTokens', category: 'llm', label: 'Llm — Generic Openai — Max Tokens', type: 'number', secret: false },
  { id: 'llm.awsBedrock.apiKey', category: 'llm', label: 'Llm — Aws Bedrock — Api Key', type: 'secret', secret: true },
  { id: 'llm.awsBedrock.region', category: 'llm', label: 'Llm — Aws Bedrock — Region', type: 'text', secret: false },
  { id: 'llm.awsBedrock.model', category: 'llm', label: 'Llm — Aws Bedrock — Model', type: 'text', secret: false },
  { id: 'llm.awsBedrock.tokenLimit', category: 'llm', label: 'Llm — Aws Bedrock — Token Limit', type: 'number', secret: false },
  { id: 'llm.togetherAi.apiKey', category: 'llm', label: 'Llm — Together Ai — Api Key', type: 'secret', secret: true },
  { id: 'llm.togetherAi.model', category: 'llm', label: 'Llm — Together Ai — Model', type: 'text', secret: false },
  { id: 'llm.fireworksAi.apiKey', category: 'llm', label: 'Llm — Fireworks Ai — Api Key', type: 'secret', secret: true },
  { id: 'llm.fireworksAi.model', category: 'llm', label: 'Llm — Fireworks Ai — Model', type: 'text', secret: false },
  { id: 'llm.perplexity.apiKey', category: 'llm', label: 'Llm — Perplexity — Api Key', type: 'secret', secret: true },
  { id: 'llm.perplexity.model', category: 'llm', label: 'Llm — Perplexity — Model', type: 'text', secret: false },
  { id: 'llm.openRouter.apiKey', category: 'llm', label: 'Llm — Open Router — Api Key', type: 'secret', secret: true },
  { id: 'llm.openRouter.model', category: 'llm', label: 'Llm — Open Router — Model', type: 'text', secret: false },
  { id: 'llm.openRouter.timeout', category: 'llm', label: 'Llm — Open Router — Timeout', type: 'number', secret: false },
  { id: 'llm.novita.apiKey', category: 'llm', label: 'Llm — Novita — Api Key', type: 'secret', secret: true },
  { id: 'llm.novita.model', category: 'llm', label: 'Llm — Novita — Model', type: 'text', secret: false },
  { id: 'llm.novita.timeout', category: 'llm', label: 'Llm — Novita — Timeout', type: 'number', secret: false },
  { id: 'llm.groq.apiKey', category: 'llm', label: 'Llm — Groq — Api Key', type: 'secret', secret: true },
  { id: 'llm.groq.model', category: 'llm', label: 'Llm — Groq — Model', type: 'text', secret: false },
  { id: 'llm.cohere.apiKey', category: 'llm', label: 'Llm — Cohere — Api Key', type: 'secret', secret: true },
  { id: 'llm.cohere.model', category: 'llm', label: 'Llm — Cohere — Model', type: 'text', secret: false },
  { id: 'llm.deepSeek.apiKey', category: 'llm', label: 'Llm — Deep Seek — Api Key', type: 'secret', secret: true },
  { id: 'llm.deepSeek.model', category: 'llm', label: 'Llm — Deep Seek — Model', type: 'text', secret: false },
  { id: 'llm.minimax.apiKey', category: 'llm', label: 'Llm — Minimax — Api Key', type: 'secret', secret: true },
  { id: 'llm.minimax.model', category: 'llm', label: 'Llm — Minimax — Model', type: 'text', secret: false },
  { id: 'llm.cerebras.apiKey', category: 'llm', label: 'Llm — Cerebras — Api Key', type: 'secret', secret: true },
  { id: 'llm.cerebras.model', category: 'llm', label: 'Llm — Cerebras — Model', type: 'text', secret: false },
  { id: 'llm.apipie.apiKey', category: 'llm', label: 'Llm — Apipie — Api Key', type: 'secret', secret: true },
  { id: 'llm.apipie.model', category: 'llm', label: 'Llm — Apipie — Model', type: 'text', secret: false },
  { id: 'llm.xai.apiKey', category: 'llm', label: 'Llm — Xai — Api Key', type: 'secret', secret: true },
  { id: 'llm.xai.model', category: 'llm', label: 'Llm — Xai — Model', type: 'text', secret: false },
  { id: 'llm.nvidiaNim.baseUrl', category: 'llm', label: 'Llm — Nvidia Nim — Base Url', type: 'text', secret: false },
  { id: 'llm.nvidiaNim.model', category: 'llm', label: 'Llm — Nvidia Nim — Model', type: 'text', secret: false },
  { id: 'llm.ppio.apiKey', category: 'llm', label: 'Llm — Ppio — Api Key', type: 'secret', secret: true },
  { id: 'llm.ppio.model', category: 'llm', label: 'Llm — Ppio — Model', type: 'text', secret: false },
  { id: 'llm.moonshot.apiKey', category: 'llm', label: 'Llm — Moonshot — Api Key', type: 'secret', secret: true },
  { id: 'llm.moonshot.model', category: 'llm', label: 'Llm — Moonshot — Model', type: 'text', secret: false },
  { id: 'llm.foundry.baseUrl', category: 'llm', label: 'Llm — Foundry — Base Url', type: 'text', secret: false },
  { id: 'llm.foundry.model', category: 'llm', label: 'Llm — Foundry — Model', type: 'text', secret: false },
  { id: 'llm.foundry.tokenLimit', category: 'llm', label: 'Llm — Foundry — Token Limit', type: 'number', secret: false },
  { id: 'llm.cometApi.apiKey', category: 'llm', label: 'Llm — Comet Api — Api Key', type: 'secret', secret: true },
  { id: 'llm.cometApi.model', category: 'llm', label: 'Llm — Comet Api — Model', type: 'text', secret: false },
  { id: 'llm.cometApi.timeout', category: 'llm', label: 'Llm — Comet Api — Timeout', type: 'number', secret: false },
  { id: 'llm.zai.apiKey', category: 'llm', label: 'Llm — Zai — Api Key', type: 'secret', secret: true },
  { id: 'llm.zai.model', category: 'llm', label: 'Llm — Zai — Model', type: 'text', secret: false },
  { id: 'llm.giteeAi.apiKey', category: 'llm', label: 'Llm — Gitee Ai — Api Key', type: 'secret', secret: true },
  { id: 'llm.giteeAi.model', category: 'llm', label: 'Llm — Gitee Ai — Model', type: 'text', secret: false },
  { id: 'llm.giteeAi.tokenLimit', category: 'llm', label: 'Llm — Gitee Ai — Token Limit', type: 'number', secret: false },
  { id: 'llm.dockerModelRunner.baseUrl', category: 'llm', label: 'Llm — Docker Model Runner — Base Url', type: 'text', secret: false },
  { id: 'llm.dockerModelRunner.model', category: 'llm', label: 'Llm — Docker Model Runner — Model', type: 'text', secret: false },
  { id: 'llm.dockerModelRunner.tokenLimit', category: 'llm', label: 'Llm — Docker Model Runner — Token Limit', type: 'number', secret: false },
  { id: 'llm.privateMode.baseUrl', category: 'llm', label: 'Llm — Private Mode — Base Url', type: 'text', secret: false },
  { id: 'llm.privateMode.model', category: 'llm', label: 'Llm — Private Mode — Model', type: 'text', secret: false },
  { id: 'llm.sambaNova.apiKey', category: 'llm', label: 'Llm — Samba Nova — Api Key', type: 'secret', secret: true },
  { id: 'llm.sambaNova.model', category: 'llm', label: 'Llm — Samba Nova — Model', type: 'text', secret: false },
  { id: 'llm.lemonade.baseUrl', category: 'llm', label: 'Llm — Lemonade — Base Url', type: 'text', secret: false },
  { id: 'llm.lemonade.apiKey', category: 'llm', label: 'Llm — Lemonade — Api Key', type: 'secret', secret: true },
  { id: 'llm.lemonade.model', category: 'llm', label: 'Llm — Lemonade — Model', type: 'text', secret: false },
  { id: 'llm.lemonade.tokenLimit', category: 'llm', label: 'Llm — Lemonade — Token Limit', type: 'number', secret: false },
  // §5.3 Embedding
  { id: 'embedding.engine', category: 'embedding', label: 'Embedding — Engine', type: 'select', secret: false },
  { id: 'embedding.baseUrl', category: 'embedding', label: 'Embedding — Base Url', type: 'text', secret: false },
  { id: 'embedding.model', category: 'embedding', label: 'Embedding — Model', type: 'text', secret: false },
  { id: 'embedding.maxChunkLength', category: 'embedding', label: 'Embedding — Max Chunk Length', type: 'number', secret: false },
  { id: 'embedding.outputDimensions', category: 'embedding', label: 'Embedding — Output Dimensions', type: 'number', secret: false },
  { id: 'embedding.ollama.batchSize', category: 'embedding', label: 'Embedding — Ollama — Batch Size', type: 'number', secret: false },
  { id: 'embedding.gemini.apiKey', category: 'embedding', label: 'Embedding — Gemini — Api Key', type: 'secret', secret: true },
  { id: 'embedding.genericOpenai.apiKey', category: 'embedding', label: 'Embedding — Generic Openai — Api Key', type: 'secret', secret: true },
  { id: 'embedding.genericOpenai.maxConcurrentChunks', category: 'embedding', label: 'Embedding — Generic Openai — Max Concurrent Chunks', type: 'number', secret: false },
  { id: 'embedding.genericOpenai.passagePrefix', category: 'embedding', label: 'Embedding — Generic Openai — Passage Prefix', type: 'text', secret: false },
  { id: 'embedding.genericOpenai.queryPrefix', category: 'embedding', label: 'Embedding — Generic Openai — Query Prefix', type: 'text', secret: false },
  { id: 'embedding.voyageAi.apiKey', category: 'embedding', label: 'Embedding — Voyage Ai — Api Key', type: 'secret', secret: true },
  // §5.4 Vector database
  { id: 'vectorDb.provider', category: 'vectorDb', label: 'Vector Db — Provider', type: 'select', secret: false },
  { id: 'vectorDb.chroma.endpoint', category: 'vectorDb', label: 'Vector Db — Chroma — Endpoint', type: 'text', secret: false },
  { id: 'vectorDb.chroma.apiHeader', category: 'vectorDb', label: 'Vector Db — Chroma — Api Header', type: 'text', secret: false },
  { id: 'vectorDb.chroma.apiKey', category: 'vectorDb', label: 'Vector Db — Chroma — Api Key', type: 'secret', secret: true },
  { id: 'vectorDb.chromaCloud.apiKey', category: 'vectorDb', label: 'Vector Db — Chroma Cloud — Api Key', type: 'secret', secret: true },
  { id: 'vectorDb.chromaCloud.tenant', category: 'vectorDb', label: 'Vector Db — Chroma Cloud — Tenant', type: 'text', secret: false },
  { id: 'vectorDb.chromaCloud.database', category: 'vectorDb', label: 'Vector Db — Chroma Cloud — Database', type: 'text', secret: false },
  { id: 'vectorDb.weaviate.endpoint', category: 'vectorDb', label: 'Vector Db — Weaviate — Endpoint', type: 'text', secret: false },
  { id: 'vectorDb.weaviate.apiKey', category: 'vectorDb', label: 'Vector Db — Weaviate — Api Key', type: 'secret', secret: true },
  { id: 'vectorDb.qdrant.endpoint', category: 'vectorDb', label: 'Vector Db — Qdrant — Endpoint', type: 'text', secret: false },
  { id: 'vectorDb.qdrant.apiKey', category: 'vectorDb', label: 'Vector Db — Qdrant — Api Key', type: 'secret', secret: true },
  { id: 'vectorDb.pinecone.apiKey', category: 'vectorDb', label: 'Vector Db — Pinecone — Api Key', type: 'secret', secret: true },
  { id: 'vectorDb.pinecone.index', category: 'vectorDb', label: 'Vector Db — Pinecone — Index', type: 'text', secret: false },
  { id: 'vectorDb.milvus.address', category: 'vectorDb', label: 'Vector Db — Milvus — Address', type: 'text', secret: false },
  { id: 'vectorDb.milvus.username', category: 'vectorDb', label: 'Vector Db — Milvus — Username', type: 'text', secret: false },
  { id: 'vectorDb.milvus.password', category: 'vectorDb', label: 'Vector Db — Milvus — Password', type: 'secret', secret: true },
  { id: 'vectorDb.zilliz.endpoint', category: 'vectorDb', label: 'Vector Db — Zilliz — Endpoint', type: 'text', secret: false },
  { id: 'vectorDb.zilliz.apiToken', category: 'vectorDb', label: 'Vector Db — Zilliz — Api Token', type: 'secret', secret: true },
  { id: 'vectorDb.astraDb.applicationToken', category: 'vectorDb', label: 'Vector Db — Astra Db — Application Token', type: 'secret', secret: true },
  { id: 'vectorDb.astraDb.endpoint', category: 'vectorDb', label: 'Vector Db — Astra Db — Endpoint', type: 'text', secret: false },
  { id: 'vectorDb.pgVector.connectionString', category: 'vectorDb', label: 'Vector Db — Pg Vector — Connection String', type: 'secret', secret: true },
  { id: 'vectorDb.pgVector.tableName', category: 'vectorDb', label: 'Vector Db — Pg Vector — Table Name', type: 'text', secret: false },
  // §5.5 Agent skills
  { id: 'agentSkills.serp.apiKey', category: 'agentSkills', label: 'Agent Skills — Serp — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.serp.engine', category: 'agentSkills', label: 'Agent Skills — Serp — Engine', type: 'text', secret: false },
  { id: 'agentSkills.searchApi.apiKey', category: 'agentSkills', label: 'Agent Skills — Search Api — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.searchApi.engine', category: 'agentSkills', label: 'Agent Skills — Search Api — Engine', type: 'text', secret: false },
  { id: 'agentSkills.serper.apiKey', category: 'agentSkills', label: 'Agent Skills — Serper — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.bing.apiKey', category: 'agentSkills', label: 'Agent Skills — Bing — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.baidu.apiKey', category: 'agentSkills', label: 'Agent Skills — Baidu — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.serply.apiKey', category: 'agentSkills', label: 'Agent Skills — Serply — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.searxng.apiUrl', category: 'agentSkills', label: 'Agent Skills — Searxng — Api Url', type: 'text', secret: false },
  { id: 'agentSkills.tavily.apiKey', category: 'agentSkills', label: 'Agent Skills — Tavily — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.exa.apiKey', category: 'agentSkills', label: 'Agent Skills — Exa — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.perplexity.apiKey', category: 'agentSkills', label: 'Agent Skills — Perplexity — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.brave.apiKey', category: 'agentSkills', label: 'Agent Skills — Brave — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.crw.apiKey', category: 'agentSkills', label: 'Agent Skills — Crw — Api Key', type: 'secret', secret: true },
  { id: 'agentSkills.crw.apiUrl', category: 'agentSkills', label: 'Agent Skills — Crw — Api Url', type: 'text', secret: false },
  { id: 'agentSkills.maxToolCalls', category: 'agentSkills', label: 'Agent Skills — Max Tool Calls', type: 'number', secret: false },
  { id: 'agentSkills.rerankerEnabled', category: 'agentSkills', label: 'Agent Skills — Reranker Enabled', type: 'boolean', secret: false },
  { id: 'agentSkills.rerankerTopN', category: 'agentSkills', label: 'Agent Skills — Reranker Top N', type: 'number', secret: false },
  // §5.6 Text-to-speech
  { id: 'tts.provider', category: 'tts', label: 'Tts — Provider', type: 'select', secret: false },
  { id: 'tts.openai.apiKey', category: 'tts', label: 'Tts — Openai — Api Key', type: 'secret', secret: true },
  { id: 'tts.openai.voiceModel', category: 'tts', label: 'Tts — Openai — Voice Model', type: 'text', secret: false },
  { id: 'tts.elevenLabs.apiKey', category: 'tts', label: 'Tts — Eleven Labs — Api Key', type: 'secret', secret: true },
  { id: 'tts.elevenLabs.voiceModel', category: 'tts', label: 'Tts — Eleven Labs — Voice Model', type: 'text', secret: false },
  { id: 'tts.piper.voiceModel', category: 'tts', label: 'Tts — Piper — Voice Model', type: 'text', secret: false },
  { id: 'tts.openAiCompatible.apiKey', category: 'tts', label: 'Tts — Open Ai Compatible — Api Key', type: 'secret', secret: true },
  { id: 'tts.openAiCompatible.model', category: 'tts', label: 'Tts — Open Ai Compatible — Model', type: 'text', secret: false },
  { id: 'tts.openAiCompatible.voiceModel', category: 'tts', label: 'Tts — Open Ai Compatible — Voice Model', type: 'text', secret: false },
  { id: 'tts.openAiCompatible.endpoint', category: 'tts', label: 'Tts — Open Ai Compatible — Endpoint', type: 'text', secret: false },
  { id: 'tts.kokoro.endpoint', category: 'tts', label: 'Tts — Kokoro — Endpoint', type: 'text', secret: false },
  { id: 'tts.kokoro.apiKey', category: 'tts', label: 'Tts — Kokoro — Api Key', type: 'secret', secret: true },
  { id: 'tts.kokoro.voiceModel', category: 'tts', label: 'Tts — Kokoro — Voice Model', type: 'text', secret: false },
  // §5.7 Speech-to-text / transcription
  { id: 'stt.provider', category: 'stt', label: 'Stt — Provider', type: 'select', secret: false },
  { id: 'stt.openai.model', category: 'stt', label: 'Stt — Openai — Model', type: 'text', secret: false },
  { id: 'stt.lemonade.baseUrl', category: 'stt', label: 'Stt — Lemonade — Base Url', type: 'text', secret: false },
  { id: 'stt.lemonade.model', category: 'stt', label: 'Stt — Lemonade — Model', type: 'text', secret: false },
  { id: 'stt.deepgram.apiKey', category: 'stt', label: 'Stt — Deepgram — Api Key', type: 'secret', secret: true },
  { id: 'stt.deepgram.model', category: 'stt', label: 'Stt — Deepgram — Model', type: 'text', secret: false },
  { id: 'stt.openAiCompatible.apiKey', category: 'stt', label: 'Stt — Open Ai Compatible — Api Key', type: 'secret', secret: true },
  { id: 'stt.openAiCompatible.model', category: 'stt', label: 'Stt — Open Ai Compatible — Model', type: 'text', secret: false },
  { id: 'stt.openAiCompatible.endpoint', category: 'stt', label: 'Stt — Open Ai Compatible — Endpoint', type: 'text', secret: false },
  { id: 'stt.groq.apiKey', category: 'stt', label: 'Stt — Groq — Api Key', type: 'secret', secret: true },
  { id: 'stt.groq.model', category: 'stt', label: 'Stt — Groq — Model', type: 'text', secret: false },
  { id: 'stt.whisper.provider', category: 'stt', label: 'Stt — Whisper — Provider', type: 'text', secret: false },
  { id: 'stt.whisper.model', category: 'stt', label: 'Stt — Whisper — Model', type: 'text', secret: false },
  // §5.8 Security & system
  { id: 'security.authToken', category: 'security', label: 'Security — Auth Token', type: 'secret', secret: true },
  { id: 'security.jwtSecret', category: 'security', label: 'Security — Jwt Secret', type: 'secret', secret: true },
  { id: 'security.disableTelemetry', category: 'security', label: 'Security — Disable Telemetry', type: 'boolean', secret: false },
  // §5.8 read-only system flags (REQ-072): reflected from GET /v1/system, never writable
  { id: 'security.requiresAuth', category: 'security', label: 'Security — Requires Auth', type: 'boolean', secret: false, readOnly: true },
  { id: 'security.multiUserMode', category: 'security', label: 'Security — Multi User Mode', type: 'boolean', secret: false, readOnly: true },
  { id: 'security.memoryEnabled', category: 'security', label: 'Security — Memory Enabled', type: 'boolean', secret: false, readOnly: true },
  { id: 'security.memoryAutoExtraction', category: 'security', label: 'Security — Memory Auto Extraction', type: 'boolean', secret: false, readOnly: true },
  { id: 'security.hasExistingEmbeddings', category: 'security', label: 'Security — Has Existing Embeddings', type: 'boolean', secret: false, readOnly: true },
  { id: 'security.hasCachedEmbeddings', category: 'security', label: 'Security — Has Cached Embeddings', type: 'boolean', secret: false, readOnly: true },
] as const satisfies readonly SettingsCatalogEntry[];

// The literal union of every product-control id (REQ-062b contract of record). All consumers
// — web/, the PATCH /api/settings body, and the admin.instance.setting_changed payload — bind
// to THIS union, never to an engine-derived guess.
export type ProductControlId = (typeof SETTINGS_CATALOG)[number]['id'];

// PATCH /api/settings body (REQ-101): a partial map of product-control id → new value. A
// present secret with an empty value means "no change" (REQ-061); omitted ids are untouched.
export type SettingsPatch = Partial<Record<ProductControlId, string | number | boolean | null>>;

export interface ErrorBody {
  message: string;
}
