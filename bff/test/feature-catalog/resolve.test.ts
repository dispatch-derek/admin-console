// White-box unit tests for the F-005 pure effective-state resolver
// (src/feature-catalog/resolve.ts, REQ-F005-017/018/020/025). The spec's own self-check note names
// this predicate as the highest-divergence-risk logic in the whole feature, so it gets a dedicated,
// exhaustive, dependency-free test file: resolveEffective() takes no store/catalog/HTTP dependency,
// so every case below is a pure function call with no mocking required.

import { describe, it, expect } from 'vitest';
import { resolveEffective } from '../../src/feature-catalog/resolve.js';
import type { FeatureToggleRow } from '../../src/store/repositories/feature-toggle.repo.js';

function row(overrides: Partial<FeatureToggleRow> = {}): FeatureToggleRow {
  return {
    feature_key: 'k',
    enabled: 1,
    updated_at: '2026-07-12T00:00:00.000Z',
    updated_by: 'staff-1',
    ...overrides,
  };
}

describe('resolveEffective — no override row: falls through to the catalog default', () => {
  it('defaultEnabled=false, no override → effective false, hasOverride false', () => {
    expect(resolveEffective(false, undefined)).toEqual({ enabled: false, hasOverride: false });
  });

  it('defaultEnabled=true, no override → effective true, hasOverride false', () => {
    expect(resolveEffective(true, undefined)).toEqual({ enabled: true, hasOverride: false });
  });
});

describe('resolveEffective — override present: override ALWAYS wins over the default', () => {
  it('override enabled=1 (true), default false → effective true', () => {
    expect(resolveEffective(false, row({ enabled: 1 }))).toEqual({ enabled: true, hasOverride: true });
  });

  it('override enabled=1 (true), default true → effective true (still hasOverride:true, not folded into "no override")', () => {
    expect(resolveEffective(true, row({ enabled: 1 }))).toEqual({ enabled: true, hasOverride: true });
  });

  it('override enabled=0 (false), default true → effective false (override wins over a true default)', () => {
    expect(resolveEffective(true, row({ enabled: 0 }))).toEqual({ enabled: false, hasOverride: true });
  });

  it('override enabled=0 (false), default false → effective false, hasOverride true (falsy-but-explicit override is distinguishable from "no override")', () => {
    expect(resolveEffective(false, row({ enabled: 0 }))).toEqual({ enabled: false, hasOverride: true });
  });
});

describe('resolveEffective — REQ-F005-013: a later default change never overrides an existing override', () => {
  it('an override captured against one default value is unaffected by calling with a different default', () => {
    const overrideRow = row({ enabled: 0 });
    const beforeRedeploy = resolveEffective(false, overrideRow);
    const afterRedeploy = resolveEffective(true, overrideRow); // catalog default flips
    expect(beforeRedeploy.enabled).toBe(false);
    expect(afterRedeploy.enabled).toBe(false); // override still wins, unchanged
    expect(afterRedeploy.hasOverride).toBe(true);
  });
});

describe('resolveEffective — defensive robustness against non-canonical stored values', () => {
  it('a row.enabled value other than strict 0/1 (e.g. corrupted data = 2) resolves via strict === 1 comparison (false, not truthy-coerced)', () => {
    // The implementation does `overrideRow.enabled === 1`, a strict equality check — this locks in
    // that any non-canonical INTEGER value in the column (which SQLite's loose typing would not
    // itself prevent) is treated as "not the enabled sentinel" rather than JS-truthy-coerced.
    expect(resolveEffective(true, row({ enabled: 2 }))).toEqual({ enabled: false, hasOverride: true });
  });

  it('a negative row.enabled value also resolves to effective false via the same strict check', () => {
    expect(resolveEffective(true, row({ enabled: -1 }))).toEqual({ enabled: false, hasOverride: true });
  });
});

describe('resolveEffective — return shape', () => {
  it('always returns exactly the two documented keys', () => {
    const result = resolveEffective(false, undefined);
    expect(Object.keys(result).sort()).toEqual(['enabled', 'hasOverride']);
  });

  it('the featureKey/timestamps on the row are irrelevant to the resolver — it is a pure function of (default, enabled)', () => {
    const a = resolveEffective(true, row({ feature_key: 'x', updated_at: 't1', updated_by: 'u1', enabled: 1 }));
    const b = resolveEffective(true, row({ feature_key: 'y', updated_at: 't2', updated_by: 'u2', enabled: 1 }));
    expect(a).toEqual(b);
  });
});
