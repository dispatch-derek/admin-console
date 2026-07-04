// audit_log repository (REQ-093, REQ-093a) — INSERT-only. The table is append-only by
// discipline AND by DB trigger (see db.ts): no UPDATE/DELETE code path exists here.
// Secret VALUES are redacted by the caller (audit/audit.ts) before rows land here.

import { db } from '../db.js';

export interface AuditRow {
  ts: string;
  actor: string | null;
  action: string;
  target: string | null; // json
  outcome: 'success' | 'failure';
  detail: string | null; // json; secret values redacted (REQ-062/094)
}

const insertStmt = db.prepare(
  `INSERT INTO audit_log (ts, actor, action, target, outcome, detail)
   VALUES (@ts, @actor, @action, @target, @outcome, @detail)`,
);

export const auditRepo = {
  // The only write path. No update/delete — history is immutable (REQ-093a).
  insert(row: AuditRow): void {
    insertStmt.run(row);
  },
};
