// Append-only audit sink (REQ-093, REQ-093a, REQ-094, REQ-099). One function writes an
// audit_log row (INSERT-only; DB trigger also blocks mutation) AND mirrors a structured
// line to stdout. Secret VALUES in `detail` are redacted (REQ-062/094); key names kept.

import { auditRepo } from '../store/repositories/audit.repo.js';
import { redactSecrets } from '../engine/mappers.js';

export interface AuditEntry {
  actor: string | null; // staff id, or 'system'/'anonymous' for pre-auth events
  action: string; // method+route or auth event name
  outcome: 'success' | 'failure';
  // Opaque identifier(s), always an object; JSON-stringified into the column. Every service passes
  // the identifier as a Record (e.g. { id }, { keys }, { featureKey }) so the audit row and its
  // paired domain event represent the same identifier the same way.
  target?: Record<string, unknown> | null;
  detail?: unknown; // json; carries the `verified` result (scalar or per-control-id map)
}

// The single audit write path. Records one immutable row and mirrors it to structured
// stdout so on-box log shipping captures every mutating action + staff-auth event.
export function recordAudit(entry: AuditEntry): void {
  const ts = new Date().toISOString();
  const detail = entry.detail === undefined ? null : redactSecrets(entry.detail);
  const target = entry.target ?? null;
  const targetColumn = target === null ? null : JSON.stringify(target);

  auditRepo.insert({
    ts,
    actor: entry.actor,
    action: entry.action,
    target: targetColumn,
    outcome: entry.outcome,
    detail: detail === null ? null : JSON.stringify(detail),
  });

  // Structured stdout mirror (REQ-099). Redacted before it ever leaves the process.
  process.stdout.write(
    JSON.stringify({
      log: 'audit',
      ts,
      actor: entry.actor,
      action: entry.action,
      outcome: entry.outcome,
      target,
      detail,
    }) + '\n',
  );
}
