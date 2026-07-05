// Accepted `update-env` key whitelist + secret-key set (REQ-078b, REQ-096, REQ-060).
// SINGLE SOURCE OF TRUTH for which engine env keys the raw editor and curated settings
// write may forward, and which of those carry secret VALUES (redacted in logs/audit/
// events and never returned to the browser except as set/notSet booleans).
//
// The full 186-key accepted set is transcribed from docs/anythingllm-surface.md §5.1–§5.8,
// grouped with the same §5.x headings. A load-time count check (ACCEPTED_ENV_KEY_COUNT)
// fails fast on a transcription error (REQ-096/078b).

// Full accepted set — exactly 186 keys (grounding §5).
const ACCEPTED: readonly string[] = [
  // 5.1 LLM provider selection
  'LLMProvider',
  'ModelRouterId',
  // 5.2 LLM provider credentials/config (one group per provider)
  'OpenAiKey',
  'OpenAiModelPref',
  'AzureOpenAiEndpoint',
  'AzureOpenAiKey',
  'AzureOpenAiModelPref',
  'AzureOpenAiTokenLimit',
  'AzureOpenAiEmbeddingModelPref',
  'AzureOpenAiModelType',
  'AnthropicApiKey',
  'AnthropicModelPref',
  'AnthropicCacheControl',
  'GeminiLLMApiKey',
  'GeminiLLMModelPref',
  'GeminiSafetySetting',
  'LMStudioBasePath',
  'LMStudioModelPref',
  'LMStudioTokenLimit',
  'LMStudioAuthToken',
  'LocalAiBasePath',
  'LocalAiModelPref',
  'LocalAiTokenLimit',
  'LocalAiApiKey',
  'OllamaLLMBasePath',
  'OllamaLLMModelPref',
  'OllamaLLMTokenLimit',
  'OllamaLLMKeepAliveSeconds',
  'OllamaLLMAuthToken',
  'MistralApiKey',
  'MistralModelPref',
  'KoboldCPPBasePath',
  'KoboldCPPModelPref',
  'KoboldCPPTokenLimit',
  'KoboldCPPMaxTokens',
  'TextGenWebUIBasePath',
  'TextGenWebUITokenLimit',
  'TextGenWebUIAPIKey',
  'LiteLLMModelPref',
  'LiteLLMTokenLimit',
  'LiteLLMBasePath',
  'LiteLLMApiKey',
  'GenericOpenAiBasePath',
  'GenericOpenAiModelPref',
  'GenericOpenAiTokenLimit',
  'GenericOpenAiKey',
  'GenericOpenAiMaxTokens',
  'AwsBedrockLLMApiKey',
  'AwsBedrockLLMRegion',
  'AwsBedrockLLMModel',
  'AwsBedrockLLMTokenLimit',
  'TogetherAiApiKey',
  'TogetherAiModelPref',
  'FireworksAiLLMApiKey',
  'FireworksAiLLMModelPref',
  'PerplexityApiKey',
  'PerplexityModelPref',
  'OpenRouterApiKey',
  'OpenRouterModelPref',
  'OpenRouterTimeout',
  'NovitaLLMApiKey',
  'NovitaLLMModelPref',
  'NovitaLLMTimeout',
  'GroqApiKey',
  'GroqModelPref',
  'CohereApiKey',
  'CohereModelPref',
  'DeepSeekApiKey',
  'DeepSeekModelPref',
  'MinimaxApiKey',
  'MinimaxModelPref',
  'CerebrasApiKey',
  'CerebrasModelPref',
  'ApipieLLMApiKey',
  'ApipieLLMModelPref',
  'XAIApiKey',
  'XAIModelPref',
  'NvidiaNimLLMBasePath',
  'NvidiaNimLLMModelPref',
  'PPIOApiKey',
  'PPIOModelPref',
  'MoonshotAiApiKey',
  'MoonshotAiModelPref',
  'FoundryBasePath',
  'FoundryModelPref',
  'FoundryModelTokenLimit',
  'CometApiLLMApiKey',
  'CometApiLLMModelPref',
  'CometApiLLMTimeout',
  'ZAiApiKey',
  'ZAiModelPref',
  'GiteeAIApiKey',
  'GiteeAIModelPref',
  'GiteeAITokenLimit',
  'DockerModelRunnerBasePath',
  'DockerModelRunnerModelPref',
  'DockerModelRunnerModelTokenLimit',
  'PrivateModeBasePath',
  'PrivateModeModelPref',
  'SambaNovaLLMApiKey',
  'SambaNovaLLMModelPref',
  'LemonadeLLMBasePath',
  'LemonadeLLMApiKey',
  'LemonadeLLMModelPref',
  'LemonadeLLMModelTokenLimit',
  // 5.3 Embedding
  'EmbeddingEngine',
  'EmbeddingBasePath',
  'EmbeddingModelPref',
  'EmbeddingModelMaxChunkLength',
  'EmbeddingOutputDimensions',
  'OllamaEmbeddingBatchSize',
  'GeminiEmbeddingApiKey',
  'GenericOpenAiEmbeddingApiKey',
  'GenericOpenAiEmbeddingMaxConcurrentChunks',
  'GenericOpenAiEmbeddingPassagePrefix',
  'GenericOpenAiEmbeddingQueryPrefix',
  'VoyageAiApiKey',
  // 5.4 Vector database
  'VectorDB',
  'ChromaEndpoint',
  'ChromaApiHeader',
  'ChromaApiKey',
  'ChromaCloudApiKey',
  'ChromaCloudTenant',
  'ChromaCloudDatabase',
  'WeaviateEndpoint',
  'WeaviateApiKey',
  'QdrantEndpoint',
  'QdrantApiKey',
  'PineConeKey',
  'PineConeIndex',
  'MilvusAddress',
  'MilvusUsername',
  'MilvusPassword',
  'ZillizEndpoint',
  'ZillizApiToken',
  'AstraDBApplicationToken',
  'AstraDBEndpoint',
  'PGVectorConnectionString',
  'PGVectorTableName',
  // 5.5 Agent skills
  'AgentSerpApiKey',
  'AgentSerpApiEngine',
  'AgentSearchApiKey',
  'AgentSearchApiEngine',
  'AgentSerperApiKey',
  'AgentBingSearchApiKey',
  'AgentBaiduSearchApiKey',
  'AgentSerplyApiKey',
  'AgentSearXNGApiUrl',
  'AgentTavilyApiKey',
  'AgentExaApiKey',
  'AgentPerplexityApiKey',
  'AgentBraveApiKey',
  'AgentCrwApiKey',
  'AgentCrwApiUrl',
  'AgentSkillMaxToolCalls',
  'AgentSkillRerankerEnabled',
  'AgentSkillRerankerTopN',
  // 5.6 Text-to-speech
  'TextToSpeechProvider',
  'TTSOpenAIKey',
  'TTSOpenAIVoiceModel',
  'TTSElevenLabsKey',
  'TTSElevenLabsVoiceModel',
  'TTSPiperTTSVoiceModel',
  'TTSOpenAICompatibleKey',
  'TTSOpenAICompatibleModel',
  'TTSOpenAICompatibleVoiceModel',
  'TTSOpenAICompatibleEndpoint',
  'TTSKokoroEndpoint',
  'TTSKokoroKey',
  'TTSKokoroVoiceModel',
  // 5.7 Speech-to-text / transcription
  'SpeechToTextProvider',
  'STTOpenAIModel',
  'STTLemonadeBasePath',
  'STTLemonadeModelPref',
  'STTDeepgramApiKey',
  'STTDeepgramModel',
  'STTOpenAICompatibleKey',
  'STTOpenAICompatibleModel',
  'STTOpenAICompatibleEndpoint',
  'STTGroqApiKey',
  'STTGroqModel',
  'WhisperProvider',
  'WhisperModelPref',
  // 5.8 Security & system
  'AuthToken',
  'JWTSecret',
  'DisableTelemetry',
];

// Number of accepted `update-env` keys (grounding §5). The load-time invariant below
// turns any drift in ACCEPTED into an immediate, loud startup failure (REQ-096/078b).
export const ACCEPTED_ENV_KEY_COUNT = 186;
if (ACCEPTED.length !== ACCEPTED_ENV_KEY_COUNT) {
  throw new Error(
    `env-keys: ACCEPTED has ${ACCEPTED.length} keys, expected ${ACCEPTED_ENV_KEY_COUNT}`,
  );
}

// Read-only system flags (REQ-072): reflected from GET /v1/system for display in the
// `security` settings category, NEVER writable via update-env (not members of ACCEPTED).
export const READONLY_SYSTEM_FLAGS = [
  'RequiresAuth',
  'MultiUserMode',
  'MemoryEnabled',
  'MemoryAutoExtraction',
  'HasExistingEmbeddings',
  'HasCachedEmbeddings',
] as const;

// Secret-bearing keys (REQ-060/062/094): read back only as booleans, values redacted.
// A key carries a secret VALUE when it is a credential: any *ApiKey / *Key / *AuthToken /
// *ApiToken / *ApplicationToken, plus MilvusPassword, PGVectorConnectionString, JWTSecret,
// AuthToken. Non-secret: *TokenLimit/*Timeout/*Endpoint/*BasePath/*ModelPref/*Model,
// ChromaApiHeader, MilvusUsername, provider/DB selectors, and booleans.
function isSecretName(key: string): boolean {
  return (
    key.endsWith('ApiKey') ||
    key.endsWith('Key') ||
    key.endsWith('AuthToken') ||
    key.endsWith('ApiToken') ||
    key.endsWith('ApplicationToken') ||
    key === 'MilvusPassword' ||
    key === 'PGVectorConnectionString' ||
    key === 'JWTSecret'
  );
}

const SECRET: readonly string[] = ACCEPTED.filter(isSecretName);

export const ACCEPTED_ENV_KEYS: ReadonlySet<string> = new Set(ACCEPTED);
export const SECRET_ENV_KEYS: ReadonlySet<string> = new Set(SECRET);

// True if the engine env key carries a secret value (REQ-062/094 redaction).
export function isSecretKey(key: string): boolean {
  return SECRET_ENV_KEYS.has(key);
}
