// bff/src/relay/config.ts — the RELAY-SCOPED config (spec REQ-F004-021/033/039/044/045/052;
// design §5, §11). The relay is a SEPARATE supervised process (REQ-F004-033), so it deliberately
// does NOT import the BFF's config.ts — that module `requireEnv`s ANYTHINGLLM_*, SESSION_SECRET,
// and SECRETS_ENC_KEY at load, engine/auth secrets the relay never uses and must not crash on.
// This config requires only the DB path + the EVENT_BUS_* family.

const isProduction = process.env['NODE_ENV'] === 'production';

// EVENT_BUS_URL — comma-delimited peer list (comma delimiter, per-entry whitespace trimmed, empty
// entries dropped — mirrors WEB_ORIGINS, bff/src/config.ts). Relay-only (REQ-F004-045/052).
const eventBusUrl = process.env['EVENT_BUS_URL'];
const peerUrls = (eventBusUrl ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// EVENT_BUS_TRANSPORT selector (REQ-F004-052). Closed set {http, broker}, default http. `broker`
// HARD-REFUSES to boot in ALL environments (rev-10) — there is structurally no BrokerTransport in
// this build, so the relay must not start pretending it can deliver.
const transportKind = process.env['EVENT_BUS_TRANSPORT'] ?? 'http';
if (transportKind === 'broker') {
  throw new Error('broker transport not available in this build (EVENT_BUS_TRANSPORT=broker)');
}

// bus-mode-without-URL hard-refuse (REQ-F004-045). In production an empty peer list means the
// relay cannot deliver anything ⇒ refuse to boot naming the missing URL. In development it boots
// soft (starts, /ready reports not-ready separately). The BFF is unaffected and keeps enqueuing.
if (isProduction && peerUrls.length === 0) {
  throw new Error(
    'EVENT_BUS_URL must be set (comma-delimited peer list) when the relay runs in production bus mode',
  );
}

// /ready thresholds (REQ-F004-024/026): backlog rows, lag ms. Defaults 1000 / 30000.
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  eventBusUrl, // raw value (may be undefined)
  peerUrls, // parsed peer endpoints for HttpPeerTransport fan-out
  transportKind, // 'http' (broker already refused above)
  backlogThreshold: intEnv('EVENT_BUS_BACKLOG_THRESHOLD', 1000),
  lagThresholdMs: intEnv('EVENT_BUS_LAG_THRESHOLD_MS', 30_000),
  dbPath: process.env['DB_PATH'] ?? 'data/console.db',
  isProduction,
} as const;
