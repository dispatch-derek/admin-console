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
  adminBootstrapUsername: requireEnv('ADMIN_BOOTSTRAP_USERNAME'), // REQ-019a
  adminBootstrapToken: requireEnv('ADMIN_BOOTSTRAP_TOKEN'), // REQ-019a
  sessionSecret: requireEnv('SESSION_SECRET'), // cookie signing
  secretsKey: requireEnv('SECRETS_ENC_KEY'), // encrypt totp secrets at rest
  dbPath: process.env['DB_PATH'] ?? 'data/console.db',
  corsMode: process.env['NODE_ENV'] === 'production' ? 'strict' : 'permissive', // REQ-095
  webOrigins: (process.env['WEB_ORIGINS'] ?? '').split(',').filter(Boolean), // REQ-095 strict allowlist
  eventBusMode: process.env['EVENT_BUS_MODE'] ?? 'inproc', // 04c
  eventBusUrl: process.env['EVENT_BUS_URL'],
} as const;
