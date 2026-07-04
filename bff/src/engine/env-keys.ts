// Accepted `update-env` key whitelist + secret-key set (REQ-078b, REQ-096, REQ-060).
// SINGLE SOURCE OF TRUTH for which engine env keys the raw editor and curated settings
// write may forward, and which of those carry secret VALUES (redacted in logs/audit/
// events and never returned to the browser except as set/notSet booleans).
//
// TODO(slice-5): complete the full 186-key accepted set (REQ-078b/096). The set below is
// a REPRESENTATIVE starter drawn from docs/anythingllm-surface.md §5 — enough to exercise
// selection, secret redaction, and validation in slice 1. Do NOT treat it as complete.

// Representative accepted keys (provider selectors + a sample per group + system flags).
const ACCEPTED: readonly string[] = [
  // 5.1 LLM provider selection
  'LLMProvider',
  'ModelRouterId',
  // 5.2 LLM provider credentials/config (sample)
  'OpenAiKey',
  'OpenAiModelPref',
  'AnthropicApiKey',
  'AnthropicModelPref',
  'GeminiLLMApiKey',
  'GeminiLLMModelPref',
  'OllamaLLMBasePath',
  'OllamaLLMModelPref',
  'OllamaLLMTokenLimit',
  'OllamaLLMKeepAliveSeconds',
  'OllamaLLMAuthToken',
  'MistralApiKey',
  'GroqApiKey',
  'GenericOpenAiBasePath',
  'GenericOpenAiKey',
  // 5.3 Embedding
  'EmbeddingEngine',
  'EmbeddingBasePath',
  'EmbeddingModelPref',
  'GeminiEmbeddingApiKey',
  'GenericOpenAiEmbeddingApiKey',
  'VoyageAiApiKey',
  // 5.4 Vector database
  'VectorDB',
  'ChromaEndpoint',
  'ChromaApiKey',
  'WeaviateApiKey',
  'QdrantApiKey',
  'PineConeKey',
  'PGVectorConnectionString',
  // 5.5 Agent skills (sample)
  'AgentSerpApiKey',
  'AgentTavilyApiKey',
  'AgentBraveApiKey',
  'AgentSkillMaxToolCalls',
  // 5.6 Text-to-speech
  'TextToSpeechProvider',
  'TTSOpenAIKey',
  'TTSElevenLabsKey',
  // 5.7 Speech-to-text
  'SpeechToTextProvider',
  'STTOpenAICompatibleKey',
  'STTDeepgramApiKey',
  'STTGroqApiKey',
  // 5.8 Security & system
  'AuthToken',
  'JWTSecret',
  'DisableTelemetry',
];

// Secret-bearing keys (REQ-060/062/094): read back only as booleans, values redacted.
// A key is treated as secret when its value must never be logged or returned to web/.
const SECRET: readonly string[] = [
  'OpenAiKey',
  'AnthropicApiKey',
  'GeminiLLMApiKey',
  'OllamaLLMAuthToken',
  'MistralApiKey',
  'GroqApiKey',
  'GenericOpenAiKey',
  'GeminiEmbeddingApiKey',
  'GenericOpenAiEmbeddingApiKey',
  'VoyageAiApiKey',
  'ChromaApiKey',
  'WeaviateApiKey',
  'QdrantApiKey',
  'PineConeKey',
  'PGVectorConnectionString',
  'AgentSerpApiKey',
  'AgentTavilyApiKey',
  'AgentBraveApiKey',
  'TTSOpenAIKey',
  'TTSElevenLabsKey',
  'STTOpenAICompatibleKey',
  'STTDeepgramApiKey',
  'STTGroqApiKey',
  'AuthToken',
  'JWTSecret',
];

export const ACCEPTED_ENV_KEYS: ReadonlySet<string> = new Set(ACCEPTED);
export const SECRET_ENV_KEYS: ReadonlySet<string> = new Set(SECRET);

// True if the engine env key carries a secret value (REQ-062/094 redaction).
export function isSecretKey(key: string): boolean {
  return SECRET_ENV_KEYS.has(key);
}
