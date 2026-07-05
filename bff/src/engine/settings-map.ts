// BFF-internal product-control-id ↔ engine env-key map (REQ-062a). This is the ONE module
// that pairs the ENGINE-FREE product catalog (types/product-types.ts) with concrete engine
// env keys; engine key names live here + engine/env-keys.ts, never in web/ (REQ-021a). The
// load-time assertSettingsCoverage() guards the bijection so drift fails fast.

import { ACCEPTED_ENV_KEYS, READONLY_SYSTEM_FLAGS, isSecretKey } from './env-keys.js';
import { SETTINGS_CATALOG } from '../types/product-types.js';
import type { ProductControlId } from '../types/product-types.js';

// Every catalog id → its engine key. Writable ids map to an ACCEPTED update-env key; the
// read-only §7.8 flag ids map to their GET /v1/system flag name (for READS only).
export const CONTROL_TO_ENGINE_KEY: Record<ProductControlId, string> = {
  // §5.1 LLM provider selection
  'llm.provider': 'LLMProvider',
  'llm.router': 'ModelRouterId',
  // §5.2 LLM provider credentials/config (one group per provider)
  'llm.openai.apiKey': 'OpenAiKey',
  'llm.openai.model': 'OpenAiModelPref',
  'llm.azureOpenai.endpoint': 'AzureOpenAiEndpoint',
  'llm.azureOpenai.apiKey': 'AzureOpenAiKey',
  'llm.azureOpenai.model': 'AzureOpenAiModelPref',
  'llm.azureOpenai.tokenLimit': 'AzureOpenAiTokenLimit',
  'llm.azureOpenai.embeddingModel': 'AzureOpenAiEmbeddingModelPref',
  'llm.azureOpenai.modelType': 'AzureOpenAiModelType',
  'llm.anthropic.apiKey': 'AnthropicApiKey',
  'llm.anthropic.model': 'AnthropicModelPref',
  'llm.anthropic.cacheControl': 'AnthropicCacheControl',
  'llm.gemini.apiKey': 'GeminiLLMApiKey',
  'llm.gemini.model': 'GeminiLLMModelPref',
  'llm.gemini.safetySetting': 'GeminiSafetySetting',
  'llm.lmStudio.baseUrl': 'LMStudioBasePath',
  'llm.lmStudio.model': 'LMStudioModelPref',
  'llm.lmStudio.tokenLimit': 'LMStudioTokenLimit',
  'llm.lmStudio.authToken': 'LMStudioAuthToken',
  'llm.localAi.baseUrl': 'LocalAiBasePath',
  'llm.localAi.model': 'LocalAiModelPref',
  'llm.localAi.tokenLimit': 'LocalAiTokenLimit',
  'llm.localAi.apiKey': 'LocalAiApiKey',
  'llm.ollama.baseUrl': 'OllamaLLMBasePath',
  'llm.ollama.model': 'OllamaLLMModelPref',
  'llm.ollama.tokenLimit': 'OllamaLLMTokenLimit',
  'llm.ollama.keepAlive': 'OllamaLLMKeepAliveSeconds',
  'llm.ollama.authToken': 'OllamaLLMAuthToken',
  'llm.mistral.apiKey': 'MistralApiKey',
  'llm.mistral.model': 'MistralModelPref',
  'llm.koboldCpp.baseUrl': 'KoboldCPPBasePath',
  'llm.koboldCpp.model': 'KoboldCPPModelPref',
  'llm.koboldCpp.tokenLimit': 'KoboldCPPTokenLimit',
  'llm.koboldCpp.maxTokens': 'KoboldCPPMaxTokens',
  'llm.textGenWebUi.baseUrl': 'TextGenWebUIBasePath',
  'llm.textGenWebUi.tokenLimit': 'TextGenWebUITokenLimit',
  'llm.textGenWebUi.apiKey': 'TextGenWebUIAPIKey',
  'llm.liteLlm.model': 'LiteLLMModelPref',
  'llm.liteLlm.tokenLimit': 'LiteLLMTokenLimit',
  'llm.liteLlm.baseUrl': 'LiteLLMBasePath',
  'llm.liteLlm.apiKey': 'LiteLLMApiKey',
  'llm.genericOpenai.baseUrl': 'GenericOpenAiBasePath',
  'llm.genericOpenai.model': 'GenericOpenAiModelPref',
  'llm.genericOpenai.tokenLimit': 'GenericOpenAiTokenLimit',
  'llm.genericOpenai.apiKey': 'GenericOpenAiKey',
  'llm.genericOpenai.maxTokens': 'GenericOpenAiMaxTokens',
  'llm.awsBedrock.apiKey': 'AwsBedrockLLMApiKey',
  'llm.awsBedrock.region': 'AwsBedrockLLMRegion',
  'llm.awsBedrock.model': 'AwsBedrockLLMModel',
  'llm.awsBedrock.tokenLimit': 'AwsBedrockLLMTokenLimit',
  'llm.togetherAi.apiKey': 'TogetherAiApiKey',
  'llm.togetherAi.model': 'TogetherAiModelPref',
  'llm.fireworksAi.apiKey': 'FireworksAiLLMApiKey',
  'llm.fireworksAi.model': 'FireworksAiLLMModelPref',
  'llm.perplexity.apiKey': 'PerplexityApiKey',
  'llm.perplexity.model': 'PerplexityModelPref',
  'llm.openRouter.apiKey': 'OpenRouterApiKey',
  'llm.openRouter.model': 'OpenRouterModelPref',
  'llm.openRouter.timeout': 'OpenRouterTimeout',
  'llm.novita.apiKey': 'NovitaLLMApiKey',
  'llm.novita.model': 'NovitaLLMModelPref',
  'llm.novita.timeout': 'NovitaLLMTimeout',
  'llm.groq.apiKey': 'GroqApiKey',
  'llm.groq.model': 'GroqModelPref',
  'llm.cohere.apiKey': 'CohereApiKey',
  'llm.cohere.model': 'CohereModelPref',
  'llm.deepSeek.apiKey': 'DeepSeekApiKey',
  'llm.deepSeek.model': 'DeepSeekModelPref',
  'llm.minimax.apiKey': 'MinimaxApiKey',
  'llm.minimax.model': 'MinimaxModelPref',
  'llm.cerebras.apiKey': 'CerebrasApiKey',
  'llm.cerebras.model': 'CerebrasModelPref',
  'llm.apipie.apiKey': 'ApipieLLMApiKey',
  'llm.apipie.model': 'ApipieLLMModelPref',
  'llm.xai.apiKey': 'XAIApiKey',
  'llm.xai.model': 'XAIModelPref',
  'llm.nvidiaNim.baseUrl': 'NvidiaNimLLMBasePath',
  'llm.nvidiaNim.model': 'NvidiaNimLLMModelPref',
  'llm.ppio.apiKey': 'PPIOApiKey',
  'llm.ppio.model': 'PPIOModelPref',
  'llm.moonshot.apiKey': 'MoonshotAiApiKey',
  'llm.moonshot.model': 'MoonshotAiModelPref',
  'llm.foundry.baseUrl': 'FoundryBasePath',
  'llm.foundry.model': 'FoundryModelPref',
  'llm.foundry.tokenLimit': 'FoundryModelTokenLimit',
  'llm.cometApi.apiKey': 'CometApiLLMApiKey',
  'llm.cometApi.model': 'CometApiLLMModelPref',
  'llm.cometApi.timeout': 'CometApiLLMTimeout',
  'llm.zai.apiKey': 'ZAiApiKey',
  'llm.zai.model': 'ZAiModelPref',
  'llm.giteeAi.apiKey': 'GiteeAIApiKey',
  'llm.giteeAi.model': 'GiteeAIModelPref',
  'llm.giteeAi.tokenLimit': 'GiteeAITokenLimit',
  'llm.dockerModelRunner.baseUrl': 'DockerModelRunnerBasePath',
  'llm.dockerModelRunner.model': 'DockerModelRunnerModelPref',
  'llm.dockerModelRunner.tokenLimit': 'DockerModelRunnerModelTokenLimit',
  'llm.privateMode.baseUrl': 'PrivateModeBasePath',
  'llm.privateMode.model': 'PrivateModeModelPref',
  'llm.sambaNova.apiKey': 'SambaNovaLLMApiKey',
  'llm.sambaNova.model': 'SambaNovaLLMModelPref',
  'llm.lemonade.baseUrl': 'LemonadeLLMBasePath',
  'llm.lemonade.apiKey': 'LemonadeLLMApiKey',
  'llm.lemonade.model': 'LemonadeLLMModelPref',
  'llm.lemonade.tokenLimit': 'LemonadeLLMModelTokenLimit',
  // §5.3 Embedding
  'embedding.engine': 'EmbeddingEngine',
  'embedding.baseUrl': 'EmbeddingBasePath',
  'embedding.model': 'EmbeddingModelPref',
  'embedding.maxChunkLength': 'EmbeddingModelMaxChunkLength',
  'embedding.outputDimensions': 'EmbeddingOutputDimensions',
  'embedding.ollama.batchSize': 'OllamaEmbeddingBatchSize',
  'embedding.gemini.apiKey': 'GeminiEmbeddingApiKey',
  'embedding.genericOpenai.apiKey': 'GenericOpenAiEmbeddingApiKey',
  'embedding.genericOpenai.maxConcurrentChunks': 'GenericOpenAiEmbeddingMaxConcurrentChunks',
  'embedding.genericOpenai.passagePrefix': 'GenericOpenAiEmbeddingPassagePrefix',
  'embedding.genericOpenai.queryPrefix': 'GenericOpenAiEmbeddingQueryPrefix',
  'embedding.voyageAi.apiKey': 'VoyageAiApiKey',
  // §5.4 Vector database
  'vectorDb.provider': 'VectorDB',
  'vectorDb.chroma.endpoint': 'ChromaEndpoint',
  'vectorDb.chroma.apiHeader': 'ChromaApiHeader',
  'vectorDb.chroma.apiKey': 'ChromaApiKey',
  'vectorDb.chromaCloud.apiKey': 'ChromaCloudApiKey',
  'vectorDb.chromaCloud.tenant': 'ChromaCloudTenant',
  'vectorDb.chromaCloud.database': 'ChromaCloudDatabase',
  'vectorDb.weaviate.endpoint': 'WeaviateEndpoint',
  'vectorDb.weaviate.apiKey': 'WeaviateApiKey',
  'vectorDb.qdrant.endpoint': 'QdrantEndpoint',
  'vectorDb.qdrant.apiKey': 'QdrantApiKey',
  'vectorDb.pinecone.apiKey': 'PineConeKey',
  'vectorDb.pinecone.index': 'PineConeIndex',
  'vectorDb.milvus.address': 'MilvusAddress',
  'vectorDb.milvus.username': 'MilvusUsername',
  'vectorDb.milvus.password': 'MilvusPassword',
  'vectorDb.zilliz.endpoint': 'ZillizEndpoint',
  'vectorDb.zilliz.apiToken': 'ZillizApiToken',
  'vectorDb.astraDb.applicationToken': 'AstraDBApplicationToken',
  'vectorDb.astraDb.endpoint': 'AstraDBEndpoint',
  'vectorDb.pgVector.connectionString': 'PGVectorConnectionString',
  'vectorDb.pgVector.tableName': 'PGVectorTableName',
  // §5.5 Agent skills
  'agentSkills.serp.apiKey': 'AgentSerpApiKey',
  'agentSkills.serp.engine': 'AgentSerpApiEngine',
  'agentSkills.searchApi.apiKey': 'AgentSearchApiKey',
  'agentSkills.searchApi.engine': 'AgentSearchApiEngine',
  'agentSkills.serper.apiKey': 'AgentSerperApiKey',
  'agentSkills.bing.apiKey': 'AgentBingSearchApiKey',
  'agentSkills.baidu.apiKey': 'AgentBaiduSearchApiKey',
  'agentSkills.serply.apiKey': 'AgentSerplyApiKey',
  'agentSkills.searxng.apiUrl': 'AgentSearXNGApiUrl',
  'agentSkills.tavily.apiKey': 'AgentTavilyApiKey',
  'agentSkills.exa.apiKey': 'AgentExaApiKey',
  'agentSkills.perplexity.apiKey': 'AgentPerplexityApiKey',
  'agentSkills.brave.apiKey': 'AgentBraveApiKey',
  'agentSkills.crw.apiKey': 'AgentCrwApiKey',
  'agentSkills.crw.apiUrl': 'AgentCrwApiUrl',
  'agentSkills.maxToolCalls': 'AgentSkillMaxToolCalls',
  'agentSkills.rerankerEnabled': 'AgentSkillRerankerEnabled',
  'agentSkills.rerankerTopN': 'AgentSkillRerankerTopN',
  // §5.6 Text-to-speech
  'tts.provider': 'TextToSpeechProvider',
  'tts.openai.apiKey': 'TTSOpenAIKey',
  'tts.openai.voiceModel': 'TTSOpenAIVoiceModel',
  'tts.elevenLabs.apiKey': 'TTSElevenLabsKey',
  'tts.elevenLabs.voiceModel': 'TTSElevenLabsVoiceModel',
  'tts.piper.voiceModel': 'TTSPiperTTSVoiceModel',
  'tts.openAiCompatible.apiKey': 'TTSOpenAICompatibleKey',
  'tts.openAiCompatible.model': 'TTSOpenAICompatibleModel',
  'tts.openAiCompatible.voiceModel': 'TTSOpenAICompatibleVoiceModel',
  'tts.openAiCompatible.endpoint': 'TTSOpenAICompatibleEndpoint',
  'tts.kokoro.endpoint': 'TTSKokoroEndpoint',
  'tts.kokoro.apiKey': 'TTSKokoroKey',
  'tts.kokoro.voiceModel': 'TTSKokoroVoiceModel',
  // §5.7 Speech-to-text / transcription
  'stt.provider': 'SpeechToTextProvider',
  'stt.openai.model': 'STTOpenAIModel',
  'stt.lemonade.baseUrl': 'STTLemonadeBasePath',
  'stt.lemonade.model': 'STTLemonadeModelPref',
  'stt.deepgram.apiKey': 'STTDeepgramApiKey',
  'stt.deepgram.model': 'STTDeepgramModel',
  'stt.openAiCompatible.apiKey': 'STTOpenAICompatibleKey',
  'stt.openAiCompatible.model': 'STTOpenAICompatibleModel',
  'stt.openAiCompatible.endpoint': 'STTOpenAICompatibleEndpoint',
  'stt.groq.apiKey': 'STTGroqApiKey',
  'stt.groq.model': 'STTGroqModel',
  'stt.whisper.provider': 'WhisperProvider',
  'stt.whisper.model': 'WhisperModelPref',
  // §5.8 Security & system
  'security.authToken': 'AuthToken',
  'security.jwtSecret': 'JWTSecret',
  'security.disableTelemetry': 'DisableTelemetry',
  // §5.8 read-only system flags (REQ-072): mapped for READS only, never written
  'security.requiresAuth': 'RequiresAuth',
  'security.multiUserMode': 'MultiUserMode',
  'security.memoryEnabled': 'MemoryEnabled',
  'security.memoryAutoExtraction': 'MemoryAutoExtraction',
  'security.hasExistingEmbeddings': 'HasExistingEmbeddings',
  'security.hasCachedEmbeddings': 'HasCachedEmbeddings',
};

// Reverse map (engine key → product-control id), built once from the forward map.
export const ENGINE_KEY_TO_CONTROL: Record<string, ProductControlId> = Object.fromEntries(
  (Object.entries(CONTROL_TO_ENGINE_KEY) as [ProductControlId, string][]).map(
    ([id, key]) => [key, id],
  ),
) as Record<string, ProductControlId>;

// The five provider selectors that additionally emit admin.instance.provider_changed
// (REQ-062a/063). NOTE: llm.router is a 'select' control but NOT a provider selector.
export const PROVIDER_SELECTORS: ProductControlId[] = [
  'llm.provider',
  'embedding.engine',
  'vectorDb.provider',
  'tts.provider',
  'stt.provider',
];

// Load-time coverage guard (REQ-062a/096). Throws — failing startup loudly — if the product
// catalog and the engine key sets ever drift apart. Unit-testable.
export function assertSettingsCoverage(): void {
  const readOnlyIds = new Set<string>(
    SETTINGS_CATALOG.filter((c) => 'readOnly' in c && c.readOnly === true).map((c) => c.id),
  );
  const flagSet = new Set<string>(READONLY_SYSTEM_FLAGS);
  const writableEngineKeys = new Set<string>();

  for (const control of SETTINGS_CATALOG) {
    const engineKey = CONTROL_TO_ENGINE_KEY[control.id];
    if (engineKey === undefined) {
      throw new Error(`settings coverage: control '${control.id}' has no engine mapping`);
    }
    const isReadOnly = readOnlyIds.has(control.id);
    if (isReadOnly) {
      if (!flagSet.has(engineKey)) {
        throw new Error(
          `settings coverage: read-only control '${control.id}' maps to '${engineKey}' which is not a system flag`,
        );
      }
    } else {
      if (!ACCEPTED_ENV_KEYS.has(engineKey)) {
        throw new Error(
          `settings coverage: control '${control.id}' maps to unaccepted engine key '${engineKey}'`,
        );
      }
      if (writableEngineKeys.has(engineKey)) {
        throw new Error(`settings coverage: engine key '${engineKey}' mapped more than once`);
      }
      writableEngineKeys.add(engineKey);
    }
    // Secret flag must agree with the engine key's secret classification.
    if (control.secret !== isSecretKey(engineKey)) {
      throw new Error(
        `settings coverage: control '${control.id}' secret=${control.secret} disagrees with isSecretKey('${engineKey}')`,
      );
    }
  }

  if (writableEngineKeys.size !== ACCEPTED_ENV_KEYS.size) {
    throw new Error(
      `settings coverage: ${writableEngineKeys.size} writable keys mapped, expected ${ACCEPTED_ENV_KEYS.size}`,
    );
  }
  for (const key of ACCEPTED_ENV_KEYS) {
    if (!writableEngineKeys.has(key)) {
      throw new Error(`settings coverage: accepted engine key '${key}' is not covered by any control`);
    }
  }
}

// Run once at module load so any drift fails fast (REQ-062a).
assertSettingsCoverage();
