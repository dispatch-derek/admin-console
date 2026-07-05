// Config via requireEnv (mirrors sibling bff/src/config.ts). See 04-cross-cutting.md §h.
// Missing required vars throw at load → process exits at startup (REQ-001, REQ-019a).

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// A required secret that must also carry enough entropy to be safe (sec review L-5): a short
// SESSION_SECRET weakens cookie signing and a short SECRETS_ENC_KEY yields a weak AES key.
function requireSecret(name: string): string {
  const value = requireEnv(name);
  if (value.length < MIN_SECRET_LEN) {
    throw new Error(`Environment variable ${name} must be at least ${MIN_SECRET_LEN} characters`);
  }
  return value;
}

const MIN_SECRET_LEN = 32;
const isProduction = process.env['NODE_ENV'] === 'production';
const webOrigins = (process.env['WEB_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// CORS origins are ALWAYS an explicit allowlist — never reflect-any (`origin: true`), which
// combined with credentials would allow any site to ride a staff session (sec review M-1).
// In production an unset allowlist means no cross-origin is permitted (fail closed); in dev
// we default to the common Vite/CRA localhost origins for convenience.
const DEV_DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];
const corsOrigins = webOrigins.length ? webOrigins : isProduction ? [] : DEV_DEFAULT_ORIGINS;

export const config = {
  anythingLLMBaseUrl: requireEnv('ANYTHINGLLM_BASE_URL').replace(/\/$/, ''), // REQ-001
  anythingLLMApiKey: requireEnv('ANYTHINGLLM_API_KEY'), // REQ-001, REQ-013
  port: parseInt(process.env['PORT'] ?? '3002', 10), // REQ-020
  // REQ-019a: required ONLY at first boot (empty staff store). Once an account exists they
  // are optional and their absence MUST NOT block startup — so read (not requireEnv) here;
  // bootstrap.ts enforces their presence conditionally when it actually needs to seed.
  adminBootstrapUsername: process.env['ADMIN_BOOTSTRAP_USERNAME'],
  adminBootstrapToken: process.env['ADMIN_BOOTSTRAP_TOKEN'],
  sessionSecret: requireSecret('SESSION_SECRET'), // cookie signing (>= 32 chars)
  secretsKey: requireSecret('SECRETS_ENC_KEY'), // encrypt totp secrets at rest (>= 32 chars)
  dbPath: process.env['DB_PATH'] ?? 'data/console.db',
  isProduction,
  // Session cookie Secure flag: default true (fail closed); an explicit dev-only opt-out via
  // COOKIE_INSECURE=1 allows plain-HTTP local dev. Production is ALWAYS secure (sec review M-1).
  cookieSecure: isProduction ? true : process.env['COOKIE_INSECURE'] !== '1',
  corsMode: isProduction ? 'strict' : 'permissive', // REQ-095
  webOrigins, // REQ-095 strict allowlist (raw parsed value)
  corsOrigins, // REQ-095 — the effective allowlist handed to @fastify/cors (never `true`)
  eventBusMode: process.env['EVENT_BUS_MODE'] ?? 'inproc', // 04c
  eventBusUrl: process.env['EVENT_BUS_URL'],
} as const;
