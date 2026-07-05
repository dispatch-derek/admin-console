// Client-side field validation (REQ-035, REQ-064a). Invalid input is rejected BEFORE submit with
// a field error and never sent to the BFF. Bounds are the pinned inclusive bounds from REQ-035.

export interface NumericRule {
  min?: number;
  max?: number;
  integer?: boolean;
}

// The four numeric workspace fields with their REQ-035 bounds (product names).
export const WORKSPACE_NUMERIC_RULES: Record<string, NumericRule> = {
  temperature: { min: 0, max: 2 }, // float [0,2]
  historyWindow: { min: 0, integer: true }, // integer >= 0
  retrievalThreshold: { min: 0, max: 1 }, // float [0,1]
  retrievalTopN: { min: 1, integer: true }, // integer >= 1
};

// Validate a numeric field value (as typed). Returns an error string, or null when valid.
export function validateNumeric(raw: string, rule: NumericRule): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 'A value is required';
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 'Must be a number';
  if (rule.integer && !Number.isInteger(n)) return 'Must be a whole number';
  if (rule.min !== undefined && n < rule.min) return `Must be at least ${rule.min}`;
  if (rule.max !== undefined && n > rule.max) return `Must be at most ${rule.max}`;
  return null;
}

// Non-Ollama model / free-text fields: non-empty, no whitespace-only, no interior whitespace
// (REQ-064a). Used for model fields when the effective provider is not Ollama.
export function validateModelFreeText(raw: string): string | null {
  if (raw.trim() === '') return 'A value is required';
  if (/\s/.test(raw)) return 'Must not contain whitespace';
  return null;
}

// retrievalMode free-text (REQ-036b): trimmed, non-empty, not whitespace-only.
export function validateRetrievalMode(raw: string): string | null {
  if (raw.trim() === '') return 'A value is required';
  return null;
}
