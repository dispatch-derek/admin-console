// bff/src/relay/config.ts — the RELAY-SCOPED config (spec REQ-F004-021/033/039/044/045/052;
// design §5, §11). The relay is a SEPARATE supervised process (REQ-F004-033), so it deliberately
// does NOT import the BFF's config.ts — that module `requireEnv`s ANYTHINGLLM_*, SESSION_SECRET,
// and SECRETS_ENC_KEY at load, engine/auth secrets the relay never uses and must not crash on.
// This config requires only the DB path + the EVENT_BUS_* family.

import { dbPath } from '../store/db-path.js';
import { isCredentialConfigured } from './http-peer-transport.js';

const isProduction = process.env['NODE_ENV'] === 'production';

// Boot-time header-legality validation (REQ-F010-017), environment-INDEPENDENT and DISTINCT from the
// empty-value check below. If the credential is present but carries any byte that is illegal in an
// HTTP header field value, refuse to boot rather than attempt a malformed request or silently drop
// the header. CR/LF/NUL are non-exhaustive illustrations of the rule: legal bytes are HTAB, visible
// ASCII (0x21–0x7E), space (0x20), and obs-text (0x80–0xFF); anything else (other C0 controls, DEL)
// is illegal. The credential value is NOT included in the message (REQ-F010-011 redaction).
const ILLEGAL_HEADER_VALUE_BYTE = /[^\t\x20-\x7e\x80-\xff]/;

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

// EVENT_BUS_PEER_AUTH_TOKEN — the shared-secret credential attached to every outbound peer POST
// (F-010 REQ-F010-007). Read as a RAW single string: NOT comma-split and NOT whitespace-trimmed the
// way the EVENT_BUS_URL peer list is (that split/trim is peer-list-only). The value is delivered
// verbatim on the wire (REQ-F010-005); it must never be hard-coded here or sourced from the BFF's
// engine/auth secrets. `undefined` when unset — no invented fallback default.
const peerAuthToken = process.env['EVENT_BUS_PEER_AUTH_TOKEN'];

if (peerAuthToken !== undefined && ILLEGAL_HEADER_VALUE_BYTE.test(peerAuthToken)) {
  throw new Error(
    'EVENT_BUS_PEER_AUTH_TOKEN contains a byte that is illegal in an HTTP header field value ' +
      '(e.g. CR, LF, NUL, or another control character); refusing to boot with a malformed credential',
  );
}

// Missing/empty-credential-while-a-peer-is-configured fail-fast (REQ-F010-017), mirroring the
// empty-peer-list posture above (REQ-F004-045). "Unset or empty" = the var is ABSENT or the
// zero-length string (""); a whitespace-only value (" ") is NON-empty and boots (delivered verbatim).
// Production: refuse to boot naming the missing variable — this prevents the silent 401 park loop a
// credential-less peer would otherwise produce. Development: boot SOFT (delivery to a
// credential-requiring peer parks per REQ-F010-014) — this dev posture is normative.
if (isProduction && peerUrls.length > 0 && !isCredentialConfigured(peerAuthToken)) {
  throw new Error(
    'EVENT_BUS_PEER_AUTH_TOKEN must be set (shared-secret credential) when a peer is configured ' +
      '(EVENT_BUS_URL non-empty) and the relay runs in production bus mode',
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
  peerAuthToken, // EVENT_BUS_PEER_AUTH_TOKEN — raw verbatim shared-secret credential (may be undefined)
  transportKind, // 'http' (broker already refused above)
  backlogThreshold: intEnv('EVENT_BUS_BACKLOG_THRESHOLD', 1000),
  lagThresholdMs: intEnv('EVENT_BUS_LAG_THRESHOLD_MS', 30_000),
  // Provisional constants of record, operator-tunable (same integer-parse-with-fallback style as the
  // /ready thresholds above; blank/invalid → default). Defaults are byte-identical to the previously
  // hard-coded values so production behavior is unchanged.
  retentionMs: intEnv('EVENT_BUS_RETENTION_MS', 7 * 24 * 60 * 60 * 1000), // REQ-F004-019/035 prune window (7 days)
  pruneEveryCycles: intEnv('EVENT_BUS_PRUNE_EVERY_CYCLES', 3_600), // prune cadence in poll ticks (~hourly at 1s)
  peerTimeoutMs: intEnv('EVENT_BUS_PEER_TIMEOUT_MS', 10_000), // per-peer request timeout (REQ-F004-055 wire concern)
  // Re-export the SHARED, secret-free path resolution (store/db-path.ts) — the same value store/db.ts
  // opens — so the relay's config and its real DB handle can never drift (matches bff/src/config.ts).
  dbPath,
  isProduction,
} as const;
