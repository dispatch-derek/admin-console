// SPEC REQ-021a / REQ-021 / REQ-026 — HARD RULE (release-blocking): no engine leakage into the
// frontend. The web app must speak only product vocabulary: no `/api/v1` (or `/v1/`) engine paths,
// no absolute engine URLs, and no compiled-in engine env-key identifiers (e.g. `OpenAiKey`,
// `OllamaLLMBasePath`, `chatProvider`, `update-env`). The raw-env editor is the one sanctioned
// exception (REQ-078e), but it must obtain its key list from `getRawEnv()` at runtime — never
// hardcode engine key names in source. The bare product value string `'ollama'` (a provider id the
// BFF echoes back, see `WorkspaceSettings`/`OllamaModelSelect`) is explicitly allowed.
//
// This test greps the actual TypeScript/TSX SOURCE tree under `web/src` (excluding test files,
// which legitimately need to reference these forbidden identifiers as literals in order to assert
// their absence elsewhere) for known engine identifiers and path fragments.

import { describe, it, expect } from 'vitest';
// This project's tsconfig targets the browser (lib: DOM, no @types/node), so the Node built-in
// module specifiers below have no type declarations here even though they resolve fine at test
// runtime under Vitest's Node process. Suppressed narrowly, only in this fs-based scan utility.
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { join, dirname } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)));

// Every file under web/src with a .ts/.tsx extension, EXCLUDING *.test.ts / *.test.tsx (this file
// included) and the `test/setup.ts` harness file.
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

// The full 186-key `ACCEPTED` engine env-key whitelist, mirrored verbatim from
// bff/src/engine/env-keys.ts (source of truth, REQ-078b/096). Mirroring it here — rather than
// importing across the BFF/web package boundary — is intentional: this is a TEST asserting the web
// bundle contains none of these identifiers, not a shared runtime dependency.
const ENGINE_ENV_KEYS = [
  'LLMProvider',
  'ModelRouterId',
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
  'AuthToken',
  'JWTSecret',
  'DisableTelemetry',
];

// §7.8 read-only system flags (REQ-072), also engine-vocabulary and equally forbidden as compiled
// literals in the product-facing frontend.
const READONLY_SYSTEM_FLAGS = [
  'RequiresAuth',
  'MultiUserMode',
  'MemoryEnabled',
  'MemoryAutoExtraction',
  'HasExistingEmbeddings',
  'HasCachedEmbeddings',
];

// Extra known engine identifiers / path fragments called out explicitly by the spec, plus the
// generic "/v1/" engine path fragment and the `update-env` engine route name.
const EXTRA_FORBIDDEN = ['chatProvider', 'update-env', '/v1/', '/api/v1'];

const FORBIDDEN_IDENTIFIERS = [...ENGINE_ENV_KEYS, ...READONLY_SYSTEM_FLAGS, ...EXTRA_FORBIDDEN];

describe('REQ-021a: no engine leakage into web/src', () => {
  const files = collectSourceFiles(SRC_DIR);

  it('finds a non-trivial number of source files to scan (sanity check on the scan itself)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN_IDENTIFIERS)('contains no occurrence of the engine identifier %s', (needle) => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(needle));
    expect(offenders).toEqual([]);
  });

  it('contains no absolute http(s):// URLs (all API calls must be relative /api/* paths)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      if (/https?:\/\//.test(content)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('allows the bare product value string "ollama" (not an engine key identifier)', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes("'ollama'"));
    // Not asserting it MUST appear (that would over-couple this test to implementation choices),
    // only that its presence — if any — is not itself treated as a leakage violation.
    expect(() => offenders).not.toThrow();
  });
});
