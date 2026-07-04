# AnythingLLM Administration Surface — Grounding Reference

Captured from the live AnythingLLM instance running for this project (server `~/anything-llm/server`,
API base `http://localhost:3001`, developer API surface `/api/v1`). This document is the factual
basis for the admin-console specification. All field names, endpoints, and values below were read
directly from the running instance's Prisma schema, Swagger `openapi.json`, `utils/helpers/updateENV.js`,
and live API responses on 2026-07-03.

> The admin console must **never** call AnythingLLM directly from the browser. All calls go through a
> Backend-for-Frontend (BFF) that injects the AnythingLLM API key server-side. This mirrors the existing
> customer app's architecture and key-custody rule.

---

## 1. Deployment model

- **One AnythingLLM installation serves exactly one customer**, with **multiple users** belonging to that customer.
- The admin console is a **staff (operator) tool** — used by our own staff to administer a given customer's
  installation. Each deployment of the admin console targets one customer's AnythingLLM instance.
- The instance currently runs in **single-user mode** (`MultiUserMode: false`). Enabling multi-user mode is
  itself an administrable setting (see §5) and is a prerequisite for per-user management.

## 2. Division of responsibility (two apps against the same instance)

| Function | Customer-facing app | Staff admin console (this spec) |
|---|---|---|
| Chat with workspaces | ✅ | — |
| Customer manages their **own** users (invite/add/remove) | ✅ | ✅ (staff can also fully manage) |
| Workspace settings (model, prompt, temperature, topN, …) | ❌ | ✅ |
| Create / delete workspaces | ❌ | ✅ |
| LLM / embedding provider & model config (instance-wide) | ❌ | ✅ |
| Vector DB, agent skills, TTS/STT, auth, telemetry (instance-wide) | ❌ | ✅ |

**Confirmed product decisions:**
- Audience: **staff operators only.**
- Workspace settings: **staff-only.**
- User management in the admin console: **full** (create/invite/edit/remove users and roles).
- Instance-wide settings scope for v1: **full instance admin** — every setting the native AnythingLLM
  admin UI exposes (all ~186 env keys, enumerated in §5).
- Staff authentication to the admin console: **app login, BFF-managed.** The console has its own staff
  login; the BFF holds the AnythingLLM API key server-side. Staff auth is independent of the customer's
  AnythingLLM user store.

## 3. Per-workspace settings

Source: `workspaces` table (Prisma). Editable via `POST /api/v1/workspace/{slug}/update`.
Created via `POST /api/v1/workspace/new`; deleted via `DELETE /api/v1/workspace/{slug}`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | Display name |
| `slug` | string (unique) | — | URL id; set on create |
| `chatProvider` | string? | null | LLM provider for this workspace (e.g. `ollama`); null = inherit system default |
| `chatModel` | string? | null | Model tag (e.g. `gemma4:31b`); null = inherit system default |
| `chatMode` | string | `chat` | `chat` or `query` |
| `openAiTemp` | float? | null | Temperature |
| `openAiHistory` | int | 20 | Chat history window |
| `openAiPrompt` | string? | null | **System prompt for the workspace** |
| `similarityThreshold` | float? | 0.25 | Vector match threshold |
| `topN` | int? | 4 | Max context snippets |
| `agentProvider` | string? | null | LLM provider for @agent |
| `agentModel` | string? | null | Model for @agent |
| `queryRefusalResponse` | string? | null | Message when query mode finds nothing |
| `vectorSearchMode` | string? | `default` | |
| `pfpFilename` | string? | null | Workspace profile picture |

Related workspace endpoints: `GET /v1/workspaces`, `GET /v1/workspace/{slug}`,
`POST /v1/workspace/{slug}/update-embeddings` (attach/detach documents),
`POST /v1/workspace/{slug}/update-pin`, `GET /v1/workspace/{slug}/chats`,
threads under `/v1/workspace/{slug}/thread/...`.

## 4. Users, roles, invites, API keys

Roles (source `models/user.js`): **`default`**, **`admin`**, **`manager`**.

`users` table fields of interest: `username` (unique), `password`, `role` (default `default`),
`suspended` (0/1), `dailyMessageLimit` (int?), `bio`, `pfpFilename`, `seen_recovery_codes`, timestamps.

`invites`: `code` (unique), `status` (default `pending`), `claimedBy`, `workspaceIds` (csv), `createdBy`.

`api_keys`: `name`, `secret` (unique), `createdBy`.

`workspace_users`: join of `user_id` ↔ `workspace_id` (which users may access which workspace).

Admin/user API endpoints (require multi-user mode + admin/manager role):
- `GET /v1/admin/is-multi-user-mode`
- `GET /v1/admin/users`, `POST /v1/admin/users/new`, `POST /v1/admin/users/{id}`, `DELETE /v1/admin/users/{id}`
- `GET /v1/admin/invites`, `POST /v1/admin/invite/new`, `DELETE /v1/admin/invite/{id}`
- `GET /v1/admin/workspaces/{workspaceId}/users`, `POST /v1/admin/workspaces/{workspaceId}/update-users`,
  `POST /v1/admin/workspaces/{workspaceSlug}/manage-users`
- `POST /v1/admin/workspace-chats` (chat history/oversight)
- `POST /v1/admin/preferences`
- `GET /v1/users`, `GET /v1/users/{id}/issue-auth-token`

## 5. Instance-wide settings

Read: `GET /v1/system` (returns a `settings` object; secrets are returned as booleans indicating
"is set", never the value). Also `GET /v1/system/env-dump`, `GET /v1/system/vector-count`.
Write: `POST /v1/system/update-env` (accepts the keys below). Danger ops:
`DELETE /v1/system/remove-documents`, `GET /v1/system/export-chats`.

The `update-env` handler accepts **186 keys**. Grouped:

### 5.1 LLM provider selection
`LLMProvider`, `ModelRouterId`

### 5.2 LLM provider credentials/config (one group per provider)
- OpenAI: `OpenAiKey`, `OpenAiModelPref`
- Azure OpenAI: `AzureOpenAiEndpoint`, `AzureOpenAiKey`, `AzureOpenAiModelPref`, `AzureOpenAiTokenLimit`, `AzureOpenAiEmbeddingModelPref`, `AzureOpenAiModelType`
- Anthropic: `AnthropicApiKey`, `AnthropicModelPref`, `AnthropicCacheControl`
- Gemini: `GeminiLLMApiKey`, `GeminiLLMModelPref`, `GeminiSafetySetting`
- LM Studio: `LMStudioBasePath`, `LMStudioModelPref`, `LMStudioTokenLimit`, `LMStudioAuthToken`
- LocalAI: `LocalAiBasePath`, `LocalAiModelPref`, `LocalAiTokenLimit`, `LocalAiApiKey`
- **Ollama** (active): `OllamaLLMBasePath`, `OllamaLLMModelPref`, `OllamaLLMTokenLimit`, `OllamaLLMKeepAliveSeconds`, `OllamaLLMAuthToken`
- Mistral: `MistralApiKey`, `MistralModelPref`
- KoboldCPP: `KoboldCPPBasePath`, `KoboldCPPModelPref`, `KoboldCPPTokenLimit`, `KoboldCPPMaxTokens`
- TextGenWebUI: `TextGenWebUIBasePath`, `TextGenWebUITokenLimit`, `TextGenWebUIAPIKey`
- LiteLLM: `LiteLLMModelPref`, `LiteLLMTokenLimit`, `LiteLLMBasePath`, `LiteLLMApiKey`
- Generic OpenAI: `GenericOpenAiBasePath`, `GenericOpenAiModelPref`, `GenericOpenAiTokenLimit`, `GenericOpenAiKey`, `GenericOpenAiMaxTokens`
- AWS Bedrock: `AwsBedrockLLMApiKey`, `AwsBedrockLLMRegion`, `AwsBedrockLLMModel`, `AwsBedrockLLMTokenLimit`
- TogetherAI: `TogetherAiApiKey`, `TogetherAiModelPref`
- FireworksAI: `FireworksAiLLMApiKey`, `FireworksAiLLMModelPref`
- Perplexity: `PerplexityApiKey`, `PerplexityModelPref`
- OpenRouter: `OpenRouterApiKey`, `OpenRouterModelPref`, `OpenRouterTimeout`
- Novita: `NovitaLLMApiKey`, `NovitaLLMModelPref`, `NovitaLLMTimeout`
- Groq: `GroqApiKey`, `GroqModelPref`
- Cohere: `CohereApiKey`, `CohereModelPref`
- DeepSeek: `DeepSeekApiKey`, `DeepSeekModelPref`
- Minimax: `MinimaxApiKey`, `MinimaxModelPref`
- Cerebras: `CerebrasApiKey`, `CerebrasModelPref`
- APIpie: `ApipieLLMApiKey`, `ApipieLLMModelPref`
- xAI: `XAIApiKey`, `XAIModelPref`
- Nvidia NIM: `NvidiaNimLLMBasePath`, `NvidiaNimLLMModelPref`
- PPIO: `PPIOApiKey`, `PPIOModelPref`
- Moonshot: `MoonshotAiApiKey`, `MoonshotAiModelPref`
- Foundry: `FoundryBasePath`, `FoundryModelPref`, `FoundryModelTokenLimit`
- CometAPI: `CometApiLLMApiKey`, `CometApiLLMModelPref`, `CometApiLLMTimeout`
- Z.AI: `ZAiApiKey`, `ZAiModelPref`
- Gitee AI: `GiteeAIApiKey`, `GiteeAIModelPref`, `GiteeAITokenLimit`
- Docker Model Runner: `DockerModelRunnerBasePath`, `DockerModelRunnerModelPref`, `DockerModelRunnerModelTokenLimit`
- PrivateMode: `PrivateModeBasePath`, `PrivateModeModelPref`
- SambaNova: `SambaNovaLLMApiKey`, `SambaNovaLLMModelPref`
- Lemonade: `LemonadeLLMBasePath`, `LemonadeLLMApiKey`, `LemonadeLLMModelPref`, `LemonadeLLMModelTokenLimit`

### 5.3 Embedding
`EmbeddingEngine`, `EmbeddingBasePath`, `EmbeddingModelPref`, `EmbeddingModelMaxChunkLength`,
`EmbeddingOutputDimensions`, `OllamaEmbeddingBatchSize`, `GeminiEmbeddingApiKey`,
`GenericOpenAiEmbeddingApiKey`, `GenericOpenAiEmbeddingMaxConcurrentChunks`,
`GenericOpenAiEmbeddingPassagePrefix`, `GenericOpenAiEmbeddingQueryPrefix`, `VoyageAiApiKey`
(active: `EmbeddingEngine=ollama`, `EmbeddingModelPref=nomic-embed-text:v1.5`)

### 5.4 Vector database
`VectorDB` (active: `lancedb`), `ChromaEndpoint`, `ChromaApiHeader`, `ChromaApiKey`, `ChromaCloudApiKey`,
`ChromaCloudTenant`, `ChromaCloudDatabase`, `WeaviateEndpoint`, `WeaviateApiKey`, `QdrantEndpoint`,
`QdrantApiKey`, `PineConeKey`, `PineConeIndex`, `MilvusAddress`, `MilvusUsername`, `MilvusPassword`,
`ZillizEndpoint`, `ZillizApiToken`, `AstraDBApplicationToken`, `AstraDBEndpoint`,
`PGVectorConnectionString`, `PGVectorTableName`

### 5.5 Agent skills
`AgentSerpApiKey`, `AgentSerpApiEngine`, `AgentSearchApiKey`, `AgentSearchApiEngine`, `AgentSerperApiKey`,
`AgentBingSearchApiKey`, `AgentBaiduSearchApiKey`, `AgentSerplyApiKey`, `AgentSearXNGApiUrl`,
`AgentTavilyApiKey`, `AgentExaApiKey`, `AgentPerplexityApiKey`, `AgentBraveApiKey`, `AgentCrwApiKey`,
`AgentCrwApiUrl`, `AgentSkillMaxToolCalls`, `AgentSkillRerankerEnabled`, `AgentSkillRerankerTopN`

### 5.6 Text-to-speech
`TextToSpeechProvider`, `TTSOpenAIKey`, `TTSOpenAIVoiceModel`, `TTSElevenLabsKey`, `TTSElevenLabsVoiceModel`,
`TTSPiperTTSVoiceModel`, `TTSOpenAICompatibleKey`, `TTSOpenAICompatibleModel`, `TTSOpenAICompatibleVoiceModel`,
`TTSOpenAICompatibleEndpoint`, `TTSKokoroEndpoint`, `TTSKokoroKey`, `TTSKokoroVoiceModel`

### 5.7 Speech-to-text / transcription
`SpeechToTextProvider`, `STTOpenAIModel`, `STTLemonadeBasePath`, `STTLemonadeModelPref`, `STTDeepgramApiKey`,
`STTDeepgramModel`, `STTOpenAICompatibleKey`, `STTOpenAICompatibleModel`, `STTOpenAICompatibleEndpoint`,
`STTGroqApiKey`, `STTGroqModel`, `WhisperProvider`, `WhisperModelPref`

### 5.8 Security & system
`AuthToken`, `JWTSecret`, `DisableTelemetry` (and multi-user mode toggle via the admin flow).
Live system flags observed: `RequiresAuth`, `AuthToken`, `JWTSecret`, `MultiUserMode`, `MemoryEnabled`,
`MemoryAutoExtraction`, `DisableTelemetry`, `HasExistingEmbeddings`, `HasCachedEmbeddings`.

> **Secret handling:** `GET /v1/system` returns secret-bearing keys as booleans (`true`/`false` = set/unset),
> never the plaintext. The admin UI must reflect "set / not set" state and allow overwrite without
> displaying stored secrets.

## 6. Existing customer-app architecture to mirror

- Two-package layout: `bff/` (Fastify + TypeScript, injects API key, port 3002) and `web/`
  (React + TypeScript + Vite, port 5173; Vite proxies `/api/*` to the BFF).
- BFF pattern: each browser-exposed route strips to a clean path (`/api/workspaces`,
  `/api/workspace/:slug/update`), forwards to `/api/v1/...` upstream with `Authorization: Bearer <key>`,
  and maps upstream 403/400/errors to sane statuses.
- Config via `requireEnv` in `bff/src/config.ts`: `ANYTHINGLLM_BASE_URL`, `ANYTHINGLLM_API_KEY`, `PORT`.
