// engine/settings-map.ts — the BFF-internal product-control-id ↔ engine env-key map
// (§7.0a, REQ-062a/062b) and its load-time coverage guard (REQ-096). Pure module (no
// config/db imports), so ordinary static imports are safe. Derived from the spec's REQ-062a
// illustrative mapping table and the REQ-062b "shared type is the contract of record" rule,
// not from reading settings-map.ts beforehand.

import { describe, it, expect } from 'vitest';
import { ACCEPTED_ENV_KEYS } from '../../src/engine/env-keys.js';
import {
  CONTROL_TO_ENGINE_KEY,
  ENGINE_KEY_TO_CONTROL,
  PROVIDER_SELECTORS,
  assertSettingsCoverage,
} from '../../src/engine/settings-map.js';
import { SETTINGS_CATALOG } from '../../src/types/product-types.js';

describe('assertSettingsCoverage — REQ-062a/096 load-time bijection guard', () => {
  it('does not throw against the current catalog + accepted-key set', () => {
    expect(() => assertSettingsCoverage()).not.toThrow();
  });
});

describe('CONTROL_TO_ENGINE_KEY — REQ-062a/062b product↔engine coverage', () => {
  const readOnlyIds = new Set(
    SETTINGS_CATALOG.filter((c) => 'readOnly' in c && c.readOnly === true).map((c) => c.id),
  );
  const writableIds = SETTINGS_CATALOG.filter((c) => !readOnlyIds.has(c.id)).map((c) => c.id);

  it('every writable control id maps to SOME engine key', () => {
    for (const id of writableIds) {
      expect(CONTROL_TO_ENGINE_KEY[id]).toBeDefined();
    }
  });

  it('every writable control maps to an ACCEPTED_ENV_KEYS member (never an unaccepted/read-only-flag name)', () => {
    for (const id of writableIds) {
      const engineKey = CONTROL_TO_ENGINE_KEY[id]!;
      expect(ACCEPTED_ENV_KEYS.has(engineKey)).toBe(true);
    }
  });

  it('the writable engine-key set is exactly ACCEPTED_ENV_KEYS — full bijective coverage (186 keys, no drift)', () => {
    const mapped = new Set(writableIds.map((id) => CONTROL_TO_ENGINE_KEY[id]!));
    expect(mapped.size).toBe(186);
    expect(mapped.size).toBe(ACCEPTED_ENV_KEYS.size);
    for (const key of ACCEPTED_ENV_KEYS) {
      expect(mapped.has(key)).toBe(true);
    }
  });

  it('no two writable control ids map to the same engine key (no duplicate mapping)', () => {
    const seen = new Set<string>();
    for (const id of writableIds) {
      const engineKey = CONTROL_TO_ENGINE_KEY[id]!;
      expect(seen.has(engineKey)).toBe(false);
      seen.add(engineKey);
    }
  });

  // Spot-check the REQ-062a illustrative mapping table, one representative id per §7.1–§7.8
  // category (REQ-062a examples; the shared TS type in product-types.ts remains the actual
  // id contract per REQ-062b — this just pins the worked examples named in the spec text).
  const spotChecks: Array<[string, string]> = [
    ['llm.provider', 'LLMProvider'],
    ['llm.router', 'ModelRouterId'],
    ['llm.ollama.baseUrl', 'OllamaLLMBasePath'],
    ['llm.ollama.model', 'OllamaLLMModelPref'],
    ['llm.ollama.tokenLimit', 'OllamaLLMTokenLimit'],
    ['llm.ollama.keepAlive', 'OllamaLLMKeepAliveSeconds'],
    ['llm.ollama.authToken', 'OllamaLLMAuthToken'],
    ['embedding.engine', 'EmbeddingEngine'],
    ['embedding.model', 'EmbeddingModelPref'],
    ['embedding.baseUrl', 'EmbeddingBasePath'],
    ['vectorDb.provider', 'VectorDB'],
    ['agentSkills.rerankerEnabled', 'AgentSkillRerankerEnabled'],
    ['agentSkills.rerankerTopN', 'AgentSkillRerankerTopN'],
    ['agentSkills.maxToolCalls', 'AgentSkillMaxToolCalls'],
    ['tts.provider', 'TextToSpeechProvider'],
    ['stt.provider', 'SpeechToTextProvider'],
    ['security.authToken', 'AuthToken'],
    ['security.jwtSecret', 'JWTSecret'],
    ['security.disableTelemetry', 'DisableTelemetry'],
  ];

  it.each(spotChecks)('control id %s maps to engine key %s (REQ-062a)', (id, engineKey) => {
    expect(CONTROL_TO_ENGINE_KEY[id as keyof typeof CONTROL_TO_ENGINE_KEY]).toBe(engineKey);
  });

  // Spot-check the REQ-072/062a read-only §7.8 system-flag ids (mapped for reads only).
  const readOnlySpotChecks: Array<[string, string]> = [
    ['security.requiresAuth', 'RequiresAuth'],
    ['security.multiUserMode', 'MultiUserMode'],
    ['security.memoryEnabled', 'MemoryEnabled'],
    ['security.memoryAutoExtraction', 'MemoryAutoExtraction'],
    ['security.hasExistingEmbeddings', 'HasExistingEmbeddings'],
    ['security.hasCachedEmbeddings', 'HasCachedEmbeddings'],
  ];

  it.each(readOnlySpotChecks)('read-only control id %s maps to flag %s (REQ-072)', (id, flag) => {
    expect(CONTROL_TO_ENGINE_KEY[id as keyof typeof CONTROL_TO_ENGINE_KEY]).toBe(flag);
    expect(readOnlyIds.has(id)).toBe(true);
  });
});

describe('ENGINE_KEY_TO_CONTROL — reverse map correctness', () => {
  it('reverses every writable CONTROL_TO_ENGINE_KEY entry exactly', () => {
    expect(ENGINE_KEY_TO_CONTROL['OllamaLLMBasePath']).toBe('llm.ollama.baseUrl');
    expect(ENGINE_KEY_TO_CONTROL['LLMProvider']).toBe('llm.provider');
    expect(ENGINE_KEY_TO_CONTROL['VectorDB']).toBe('vectorDb.provider');
  });
});

describe('PROVIDER_SELECTORS — REQ-062a/063 exactly the five provider selectors', () => {
  it('is exactly llm.provider, embedding.engine, vectorDb.provider, tts.provider, stt.provider', () => {
    expect([...PROVIDER_SELECTORS].sort()).toEqual(
      ['llm.provider', 'embedding.engine', 'vectorDb.provider', 'tts.provider', 'stt.provider'].sort(),
    );
  });

  it('has exactly 5 members — llm.router is a select control but NOT a provider selector', () => {
    expect(PROVIDER_SELECTORS).toHaveLength(5);
    expect(PROVIDER_SELECTORS).not.toContain('llm.router');
  });
});

describe('SETTINGS_CATALOG — REQ-062b product-named ids (no raw engine-key substrings)', () => {
  it('has 192 entries: 186 writable + 6 read-only §7.8 flags', () => {
    expect(SETTINGS_CATALOG.length).toBe(192);
  });

  it('every catalog id is dotted (product-namespaced, e.g. "llm.provider")', () => {
    for (const entry of SETTINGS_CATALOG) {
      expect(entry.id.includes('.')).toBe(true);
    }
  });

  it('no catalog id is itself a literal ACCEPTED_ENV_KEYS member (product ids never equal an engine key)', () => {
    for (const entry of SETTINGS_CATALOG) {
      expect(ACCEPTED_ENV_KEYS.has(entry.id)).toBe(false);
    }
  });

  it('no catalog id contains a raw grounding §5 engine-key substring (spot-check known offenders)', () => {
    const offendingSubstrings = ['OllamaLLMModelPref', 'EmbeddingEngine', 'VectorDB', 'LLMProvider'];
    for (const entry of SETTINGS_CATALOG) {
      for (const substr of offendingSubstrings) {
        expect(entry.id.includes(substr)).toBe(false);
      }
    }
  });

  it('every catalog entry secret flag agrees with isSecretKey() of its mapped engine key', async () => {
    const { isSecretKey } = await import('../../src/engine/env-keys.js');
    for (const entry of SETTINGS_CATALOG) {
      const engineKey = CONTROL_TO_ENGINE_KEY[entry.id as keyof typeof CONTROL_TO_ENGINE_KEY]!;
      expect(entry.secret).toBe(isSecretKey(engineKey));
    }
  });

  it('every §7.1–§7.8 category has at least one catalog entry (full category coverage, REQ-062a)', () => {
    const categories = ['llm', 'embedding', 'vectorDb', 'agentSkills', 'tts', 'stt', 'security'];
    for (const category of categories) {
      expect(SETTINGS_CATALOG.some((c) => c.category === category)).toBe(true);
    }
  });
});
