// Live model discovery service (§7.10, REQ-075/076/077). The BFF proxies Ollama's GET
// /api/tags server-side (the browser never calls Ollama directly). Discovery degrades
// gracefully: it NEVER throws, so an unreachable model host can't block editing/saving any
// other setting (REQ-076) — an unavailable result maps to free-text entry + a warning.

import { engineAdapter as adapter } from '../engine/adapter.js';
import type { OllamaModelsResult } from '../types/product-types.js';

// GET /api/models/ollama — pulled-model list from the configured OllamaLLMBasePath (REQ-075).
// If no base path is configured, or Ollama is unreachable/times out/errors, returns
// { available:false, models:[] } (REQ-076).
export async function getOllamaModels(): Promise<OllamaModelsResult> {
  const { settings } = await adapter.getSystem();
  const basePath = settings['OllamaLLMBasePath'];
  if (typeof basePath !== 'string' || basePath.trim().length === 0) {
    return { available: false, models: [] };
  }
  try {
    const models = await adapter.ollamaTags(basePath);
    return { available: true, models: models.map((m) => ({ name: m.name })) };
  } catch {
    return { available: false, models: [] };
  }
}
