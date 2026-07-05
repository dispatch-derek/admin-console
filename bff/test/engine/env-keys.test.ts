// engine/env-keys.ts — the accepted `update-env` key whitelist + secret-key classification
// (§7.0/§7.0a/§10.1, REQ-060/062/078b/096). Pure module (no config/db imports), so ordinary
// static imports are safe. These tests are derived from the spec's grounding §5 key list
// (docs/anythingllm-surface.md), not from reading env-keys.ts beforehand.

import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_ENV_KEYS,
  ACCEPTED_ENV_KEY_COUNT,
  READONLY_SYSTEM_FLAGS,
  SECRET_ENV_KEYS,
  isSecretKey,
} from '../../src/engine/env-keys.js';

describe('ACCEPTED_ENV_KEYS — REQ-078b/096 key whitelist (grounding §5, exactly 186 keys)', () => {
  it('has exactly 186 members', () => {
    expect(ACCEPTED_ENV_KEYS.size).toBe(186);
  });

  it('ACCEPTED_ENV_KEY_COUNT constant agrees with the set size', () => {
    expect(ACCEPTED_ENV_KEY_COUNT).toBe(186);
    expect(ACCEPTED_ENV_KEYS.size).toBe(ACCEPTED_ENV_KEY_COUNT);
  });

  // One representative key per grounding §5 group (§5.1–§5.8).
  const representative = [
    'LLMProvider', // §5.1
    'AzureOpenAiEndpoint', // §5.2
    'AwsBedrockLLMApiKey', // §5.2
    'LemonadeLLMBasePath', // §5.2
    'EmbeddingEngine', // §5.3
    'ChromaCloudTenant', // §5.4
    'MilvusPassword', // §5.4
    'AgentTavilyApiKey', // §5.5
    'TTSKokoroKey', // §5.6
    'STTGroqModel', // §5.7
    'JWTSecret', // §5.8
  ];

  it.each(representative)('accepts representative key %s (spans all 8 groups)', (key) => {
    expect(ACCEPTED_ENV_KEYS.has(key)).toBe(true);
  });

  it('rejects a fabricated key not in grounding §5', () => {
    expect(ACCEPTED_ENV_KEYS.has('NotARealKey')).toBe(false);
  });

  it('rejects the empty string and a lowercase variant of a real key (exact-match whitelist)', () => {
    expect(ACCEPTED_ENV_KEYS.has('')).toBe(false);
    expect(ACCEPTED_ENV_KEYS.has('llmprovider')).toBe(false);
  });
});

describe('SECRET_ENV_KEYS — REQ-060/062 secret-value classification', () => {
  const includedSecrets = [
    'OpenAiKey',
    'AnthropicApiKey',
    'JWTSecret',
    'AuthToken',
    'OllamaLLMAuthToken',
    'PGVectorConnectionString',
    'AgentBraveApiKey',
  ];

  it.each(includedSecrets)('classifies %s as a secret', (key) => {
    expect(SECRET_ENV_KEYS.has(key)).toBe(true);
    expect(isSecretKey(key)).toBe(true);
  });

  const excludedNonSecrets = [
    'OllamaLLMBasePath',
    'OllamaLLMTokenLimit',
    'VectorDB',
    'AgentSkillRerankerEnabled',
    'ChromaApiHeader',
    'MilvusUsername',
  ];

  it.each(excludedNonSecrets)('does NOT classify %s as a secret', (key) => {
    expect(SECRET_ENV_KEYS.has(key)).toBe(false);
    expect(isSecretKey(key)).toBe(false);
  });

  it('isSecretKey is false for a key not in the accepted set at all', () => {
    expect(isSecretKey('NotARealKey')).toBe(false);
  });

  it('every SECRET_ENV_KEYS member is also an ACCEPTED_ENV_KEYS member (secrets are a subset of accepted)', () => {
    for (const key of SECRET_ENV_KEYS) {
      expect(ACCEPTED_ENV_KEYS.has(key)).toBe(true);
    }
  });
});

describe('READONLY_SYSTEM_FLAGS — REQ-072 the six §7.8 read-only system flags', () => {
  it('has exactly the six flags named in REQ-072', () => {
    expect([...READONLY_SYSTEM_FLAGS].sort()).toEqual(
      [
        'RequiresAuth',
        'MultiUserMode',
        'MemoryEnabled',
        'MemoryAutoExtraction',
        'HasExistingEmbeddings',
        'HasCachedEmbeddings',
      ].sort(),
    );
  });

  it('no read-only flag is a member of ACCEPTED_ENV_KEYS — never writable via update-env', () => {
    for (const flag of READONLY_SYSTEM_FLAGS) {
      expect(ACCEPTED_ENV_KEYS.has(flag)).toBe(false);
    }
  });
});
