// Shared SQLite path resolution — DELIBERATELY secret-free (F-004 REQ-F004-033/045). The BFF and
// the SEPARATE relay process share the same event_outbox DB, so both must resolve the IDENTICAL
// path; but opening that DB must NOT transitively drag in the BFF's secret-requiring config.ts
// (which `requireEnv`s ANYTHINGLLM_*/SESSION_SECRET/SECRETS_ENC_KEY at import time). store/db.ts
// imports THIS module instead of config.ts, so the relay chain (relay/index → drainer → outbox.repo
// → db) boots with only DB_PATH + EVENT_BUS_* set. config.ts re-exports this same value so the two
// processes can never diverge on the path. Default matches the prior config.ts default exactly.
export const dbPath: string = process.env['DB_PATH'] ?? 'data/console.db';
