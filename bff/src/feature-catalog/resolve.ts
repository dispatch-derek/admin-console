// F-005 pure effective-state resolver (REQ-F005-017/018/020/025). Kept as its own tested function
// because the spec's self-check names effective-state resolution as its highest divergence-risk
// predicate. Deterministic: an override ALWAYS wins over the current catalog default; a later change
// to the default never overrides an existing override (REQ-F005-013). A feature present in the
// catalog with no override row resolves to the default with hasOverride:false.

import type { FeatureToggleRow } from '../store/repositories/feature-toggle.repo.js';

export function resolveEffective(
  defaultEnabled: boolean,
  overrideRow: FeatureToggleRow | undefined,
): { enabled: boolean; hasOverride: boolean } {
  if (overrideRow) return { enabled: overrideRow.enabled === 1, hasOverride: true };
  return { enabled: defaultEnabled, hasOverride: false };
}
