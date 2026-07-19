// Config via requireEnv (mirrors sibling bff/src/config.ts). See 04-cross-cutting.md §h.
// Missing required vars throw at load → process exits at startup (REQ-001, REQ-019a).

import { dbPath } from './store/db-path.js';

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
const anythingLLMBaseUrl = requireEnv('ANYTHINGLLM_BASE_URL').replace(/\/$/, ''); // REQ-001

// F-004 EVENT_BUS_MODE production hard-refuse (REQ-F004-021/039/046). The grounded factory
// (bus.ts) falls back to InProcessBus for any non-'bus' value — InProcessBus marks rows published
// WITHOUT delivering them (zero subscribers), so once switched to `bus` mode those already-published
// rows are excluded from the drain (REQ-F004-041) ⇒ silent, permanent event loss. So under
// NODE_ENV=production the mode MUST be exactly 'bus'; anything else (unset, literal 'inproc', a typo)
// makes the BFF refuse to boot. In development the same misconfig soft-defaults to 'inproc'.
const EVENT_BUS_MODES = ['inproc', 'bus'] as const;
const rawEventBusMode = process.env['EVENT_BUS_MODE'];
let eventBusMode: (typeof EVENT_BUS_MODES)[number];
if (isProduction) {
  if (rawEventBusMode !== 'bus') {
    throw new Error(
      `EVENT_BUS_MODE must be 'bus' in production (got ${rawEventBusMode ?? 'unset'}); ` +
        `any other value would mark events published without delivering them (silent loss).`,
    );
  }
  eventBusMode = 'bus';
} else {
  eventBusMode =
    rawEventBusMode && (EVENT_BUS_MODES as readonly string[]).includes(rawEventBusMode)
      ? (rawEventBusMode as (typeof EVENT_BUS_MODES)[number])
      : 'inproc';
}

export const config = {
  anythingLLMBaseUrl, // REQ-001
  anythingLLMApiKey: requireEnv('ANYTHINGLLM_API_KEY'), // REQ-001, REQ-013
  port: parseInt(process.env['PORT'] ?? '3002', 10), // REQ-020
  // REQ-019a: required ONLY at first boot (empty staff store). Once an account exists they
  // are optional and their absence MUST NOT block startup — so read (not requireEnv) here;
  // bootstrap.ts enforces their presence conditionally when it actually needs to seed.
  adminBootstrapUsername: process.env['ADMIN_BOOTSTRAP_USERNAME'],
  adminBootstrapToken: process.env['ADMIN_BOOTSTRAP_TOKEN'],
  sessionSecret: requireSecret('SESSION_SECRET'), // cookie signing (>= 32 chars)
  secretsKey: requireSecret('SECRETS_ENC_KEY'), // encrypt totp secrets at rest (>= 32 chars)
  dbPath, // shared, secret-free resolution (store/db-path.ts) so BFF + relay never diverge
  isProduction,
  // Session cookie Secure flag: default true (fail closed); an explicit dev-only opt-out via
  // COOKIE_INSECURE=1 allows plain-HTTP local dev. Production is ALWAYS secure (sec review M-1).
  cookieSecure: isProduction ? true : process.env['COOKIE_INSECURE'] !== '1',
  corsMode: isProduction ? 'strict' : 'permissive', // REQ-095
  webOrigins, // REQ-095 strict allowlist (raw parsed value)
  corsOrigins, // REQ-095 — the effective allowlist handed to @fastify/cors (never `true`)
  eventBusMode, // 04c + F-004 REQ-F004-021/039/046 (validated above)
  eventBusUrl: process.env['EVENT_BUS_URL'],
  // F-005 (REQ-F005-058/044): deployment-provided feature-catalog manifest path. Optional — unset or
  // empty means "no manifest configured" → empty catalog, normal start (REQ-F005-053a). A present-
  // but-broken file is fail-closed by the catalog loader itself (REQ-F005-053b), not here.
  featureCatalogPath: process.env['FEATURE_CATALOG_MANIFEST_PATH'] || undefined,
  // F-005 (REQ-F005-060, amends -048; constrains -027): human-readable customer/install label shown
  // on the toggle surface. Falls back to the FIXED NEUTRAL LITERAL "this install" when CUSTOMER_LABEL
  // is unset — never any engine-derived value (ANYTHINGLLM_BASE_URL, origin, host, port), which would
  // leak the engine's internal address into the product payload/DOM (REQ-F005-003/039 take precedence).
  customerLabel: process.env['CUSTOMER_LABEL'] || 'this install',
} as const;
