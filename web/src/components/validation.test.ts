import { describe, it, expect } from 'vitest';
import {
  validateNumeric,
  validateModelFreeText,
  WORKSPACE_NUMERIC_RULES,
} from './validation';

// Smoke coverage for the REQ-035 pinned numeric bounds and REQ-064a free-text model rule.
describe('validateNumeric', () => {
  it('blocks retrievalTopN = 0 (min 1)', () => {
    expect(validateNumeric('0', WORKSPACE_NUMERIC_RULES.retrievalTopN)).not.toBeNull();
  });

  it('accepts retrievalThreshold at the inclusive bounds 0 and 1', () => {
    expect(validateNumeric('0', WORKSPACE_NUMERIC_RULES.retrievalThreshold)).toBeNull();
    expect(validateNumeric('1', WORKSPACE_NUMERIC_RULES.retrievalThreshold)).toBeNull();
  });

  it('blocks temperature = 2.5 (max 2)', () => {
    expect(validateNumeric('2.5', WORKSPACE_NUMERIC_RULES.temperature)).not.toBeNull();
  });

  it('blocks a non-integer historyWindow', () => {
    expect(validateNumeric('1.5', WORKSPACE_NUMERIC_RULES.historyWindow)).not.toBeNull();
  });
});

describe('validateModelFreeText', () => {
  it('rejects whitespace and empty values', () => {
    expect(validateModelFreeText('')).not.toBeNull();
    expect(validateModelFreeText('a b')).not.toBeNull();
  });

  it('accepts a plain model name', () => {
    expect(validateModelFreeText('llama3')).toBeNull();
  });

  // SPEC REQ-064a: a blank/whitespace-only non-Ollama model tag is rejected.
  it('rejects a whitespace-only value', () => {
    expect(validateModelFreeText('   ')).not.toBeNull();
  });
});

// SPEC REQ-035 — pinned inclusive numeric bounds, boundary + out-of-range coverage per field.
describe('validateNumeric — REQ-035 boundary coverage', () => {
  it('accepts temperature at both inclusive bounds 0 and 2', () => {
    expect(validateNumeric('0', WORKSPACE_NUMERIC_RULES.temperature)).toBeNull();
    expect(validateNumeric('2', WORKSPACE_NUMERIC_RULES.temperature)).toBeNull();
  });

  it('rejects temperature below 0', () => {
    expect(validateNumeric('-0.1', WORKSPACE_NUMERIC_RULES.temperature)).not.toBeNull();
  });

  it('rejects temperature above 2', () => {
    expect(validateNumeric('2.01', WORKSPACE_NUMERIC_RULES.temperature)).not.toBeNull();
  });

  it('rejects a non-integer historyWindow', () => {
    expect(validateNumeric('3.2', WORKSPACE_NUMERIC_RULES.historyWindow)).not.toBeNull();
  });

  it('rejects a negative historyWindow', () => {
    expect(validateNumeric('-1', WORKSPACE_NUMERIC_RULES.historyWindow)).not.toBeNull();
  });

  it('accepts historyWindow = 0 (inclusive lower bound)', () => {
    expect(validateNumeric('0', WORKSPACE_NUMERIC_RULES.historyWindow)).toBeNull();
  });

  it('rejects retrievalThreshold outside [0,1]', () => {
    expect(validateNumeric('-0.01', WORKSPACE_NUMERIC_RULES.retrievalThreshold)).not.toBeNull();
    expect(validateNumeric('1.01', WORKSPACE_NUMERIC_RULES.retrievalThreshold)).not.toBeNull();
  });

  it('rejects retrievalTopN below 1, including negative values', () => {
    expect(validateNumeric('0', WORKSPACE_NUMERIC_RULES.retrievalTopN)).not.toBeNull();
    expect(validateNumeric('-3', WORKSPACE_NUMERIC_RULES.retrievalTopN)).not.toBeNull();
  });

  it('accepts retrievalTopN = 1 (inclusive lower bound)', () => {
    expect(validateNumeric('1', WORKSPACE_NUMERIC_RULES.retrievalTopN)).toBeNull();
  });

  it('rejects a non-numeric value and a blank value', () => {
    expect(validateNumeric('abc', WORKSPACE_NUMERIC_RULES.temperature)).not.toBeNull();
    expect(validateNumeric('   ', WORKSPACE_NUMERIC_RULES.temperature)).not.toBeNull();
  });
});
