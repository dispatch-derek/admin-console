// Config via requireEnv (mirrors sibling bff/src/config.ts). See 04-cross-cutting.md §h.
// Missing required vars throw at load → process exits at startup (REQ-001, REQ-019a).

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  anythingLLMBaseUrl: requireEnv('ANYTHINGLLM_BASE_URL').replace(/\/$/, ''), // REQ-001
  anythingLLMApiKey: requireEnv('ANYTHINGLLM_API_KEY'), // REQ-001, REQ-013
  port: parseInt(process.env['PORT'] ?? '3002', 10), // REQ-020
  // REQ-019a: required ONLY at first boot (empty staff store). Once an account exists they
  // are optional and their absence MUST NOT block startup — so read (not requireEnv) here;
  // bootstrap.ts enforces their presence conditionally when it actually needs to seed.
  adminBootstrapUsername: process.env['ADMIN_BOOTSTRAP_USERNAME'],
  adminBootstrapToken: process.env['ADMIN_BOOTSTRAP_TOKEN'],
  sessionSecret: requireEnv('SESSION_SECRET'), // cookie signing
  secretsKey: requireEnv('SECRETS_ENC_KEY'), // encrypt totp secrets at rest
  dbPath: process.env['DB_PATH'] ?? 'data/console.db',
  corsMode: process.env['NODE_ENV'] === 'production' ? 'strict' : 'permissive', // REQ-095
  webOrigins: (process.env['WEB_ORIGINS'] ?? '').split(',').filter(Boolean), // REQ-095 strict allowlist
  eventBusMode: process.env['EVENT_BUS_MODE'] ?? 'inproc', // 04c
  eventBusUrl: process.env['EVENT_BUS_URL'],
} as const;
