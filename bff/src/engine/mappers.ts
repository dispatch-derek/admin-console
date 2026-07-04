// Product↔engine field translation lives here (REQ-021a). For SLICE 1 this module holds
// only the shared redaction helpers used by the emitter + audit sink; the per-area
// translation tables arrive with their slices.
//
// TODO(slice-3): the workspace REQ-032 field-translation table (product WorkspaceSettings
//   ↔ engine EngineWorkspaceUpdate, partial-write + null-inherit semantics).
// TODO(slice-5): the curated-settings product-control-id → engine env-key map (REQ-062a),
//   secret overwrite-without-reveal handling (REQ-061), and RawEnvEntry state derivation.

import { isSecretKey } from './env-keys.js';

// The placeholder written in place of a secret VALUE (REQ-062/094). Key names are kept.
export const REDACTED = '[redacted]';

// Redact secret VALUES in a flat record keyed by engine env keys (e.g. an update-env
// patch, or a raw {key,value} set). Secret keys keep their name; their value → REDACTED.
export function redactEnvValues(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSecretKey(key) ? REDACTED : value;
  }
  return out;
}

// Redact secret VALUES anywhere in an arbitrary detail/changes structure by key name,
// recursing through plain objects and arrays (REQ-062/094). Used by audit + emitter so a
// secret value can never reach a log line, audit row, or event payload.
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redactSecrets(v);
    }
    return out;
  }
  return value;
}
