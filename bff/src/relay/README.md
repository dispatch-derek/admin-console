# F-004 Outbox Relay — Production Event-Bus Delivery

The relay is a **separate supervised process** that drains the durable `event_outbox` table and delivers `admin.*` domain events to peer endpoints over HTTP with at-least-once semantics, per-key ordering, and poison isolation. It runs independently from the BFF and shares only the SQLite `event_outbox` file and the transport URL configuration.

See the specification (`specs/F-004-production-event-bus.md`) and design doc (`docs/design/09-F004-production-event-bus.md`) for the complete feature.

## Quick start

The relay is entrypointed at `bff/src/relay/index.ts`. In production, run it as a separate OS process under a supervisor (systemd unit, container restart policy, etc.) that maintains exactly one instance (the single-drainer constraint). The supervisor is a deployment concern outside this code; this document covers what the relay itself needs.

### Bootstrapping the relay

The relay boots with **relay-scoped configuration only** — no BFF secrets. It requires:

1. **A database:** `DB_PATH` environment variable (shared with the BFF; the same SQLite file).
2. **Transport configuration:** `EVENT_BUS_*` environment variables (below).

Example:

```bash
# Production boot with just the relay-scoped config (no BFF secrets needed).
# Note: if EVENT_BUS_URL is set (a peer is configured), EVENT_BUS_PEER_AUTH_TOKEN must also be set
# (the shared-secret credential), or the relay will refuse to boot (REQ-F010-017).
DB_PATH=/data/console.db \
EVENT_BUS_TRANSPORT=http \
EVENT_BUS_URL=http://bus-peer-1:8080/api/events,http://bus-peer-2:8080/api/events \
EVENT_BUS_PEER_AUTH_TOKEN=<the-shared-secret> \
node dist/relay/index.js
```

The relay does NOT import or require the BFF's `config.ts`, so it does not need `ANYTHINGLLM_*`, `SESSION_SECRET`, or `SECRETS_ENC_KEY` — it refuses to boot if those secrets are missing (contradicting its documented contract).

### Compiled execution

In a built/deployed environment:

```bash
cd bff && npm run build  # compiles src/**/*.ts to dist/
# Start the relay as a supervised process (when a peer is configured, the credential is required):
DB_PATH=/data/console.db EVENT_BUS_URL=http://peer:8080/api/events EVENT_BUS_PEER_AUTH_TOKEN=<secret> node dist/relay/index.js
```

The compiled output at `dist/relay/index.js` is the real entrypoint for production.

## Configuration

The relay reads its own environment variables (prefixed `EVENT_BUS_*` and `DB_PATH`). The BFF reads `EVENT_BUS_MODE` to decide whether to enqueue rows (`bus` mode) or skip the relay entirely (`inproc`, development-only).

### Relay-side environment variables

| Variable | Default | Meaning | Hard-refuse (production) |
|----------|---------|---------|-------------------------|
| `DB_PATH` | (required) | Absolute path to the shared SQLite outbox DB file. Same value as the BFF uses. | — |
| `EVENT_BUS_URL` | (empty) | Comma-delimited list of peer endpoints (whitespace trimmed per entry). Example: `http://peer-1:8080/api/events,http://peer-2:8080/api/events` | Yes: relay refuses to boot in production without this set (but starts soft in dev, reporting not-ready on `/ready`). |
| `EVENT_BUS_PEER_AUTH_TOKEN` | (empty) | Shared-secret credential attached to every outbound peer POST as the `X-Event-Auth-Token` HTTP header (F-010 REQ-F010-007). Read as a raw single string — NOT trimmed or split like the peer list. When a peer is configured, this MUST be set (non-empty) in production; see boot posture below. | Yes (production + peer configured + unset/empty): relay refuses to boot, preventing silent 401 loops. Development + unset: boots soft; delivery to a credential-requiring peer parks per REQ-F010-014. |
| `EVENT_BUS_TRANSPORT` | `http` | Transport adapter selector: `http` (GTM HTTP peer delivery) or `broker` (future). | Yes: `broker` hard-refuses to boot in **all environments** — no broker transport exists in this build yet. |
| `EVENT_BUS_BACKLOG_THRESHOLD` | `1000` | Row count; `/ready` reports not-ready when unpublished backlog ≥ this. | — |
| `EVENT_BUS_LAG_THRESHOLD_MS` | `30000` | Milliseconds; `/ready` reports not-ready when the age of the oldest unpublished row ≥ this. | — |
| `EVENT_BUS_RETENTION_MS` | `604800000` (7 days) | How long to retain published rows before pruning (unpublished/parked rows NEVER pruned). | — |
| `EVENT_BUS_PRUNE_EVERY_CYCLES` | `3600` | Prune every N poll ticks (~hourly at 1 s/tick). | — |
| `EVENT_BUS_PEER_TIMEOUT_MS` | `10000` | Per-peer HTTP request timeout (bounds a peer that accepts the socket but never responds). | — |
| `RELAY_READY_PORT` | `3003` | Port the relay's `GET /ready` probe listens on (`0.0.0.0`). | — |
| `NODE_ENV` | (any) | When set to `production`, additional validation applies (e.g., hard-refuse on missing URLs). | — |

### Shared-secret credential (F-010)

The relay attaches the shared-secret credential to every outbound peer POST as the `X-Event-Auth-Token`
HTTP header (F-010 REQ-F010-004/005). This credential is sourced from `EVENT_BUS_PEER_AUTH_TOKEN`
and is read as a raw single string — NOT comma-split or whitespace-trimmed like `EVENT_BUS_URL`
(REQ-F010-007). The configured value is set on the header byte-for-byte at the transport layer, but
note that **WHATWG Fetch may strip leading/trailing HTTP whitespace in transit**; do not rely on
padding whitespace for the credential to be transmitted as-is.

**Boot posture (REQ-F010-017):**

- **Production + a peer configured + credential unset/empty → refuse to boot.** This prevents a silent,
  self-inflicted 401 permanent park loop (credentials missing → delivery rejected → permanent park).
- **Production + no peer configured OR credential set → boot normally.**
- **Development + credential unset/empty → boot soft.** The relay starts (consistent with F-004's dev
  posture) and delivery to a credential-requiring peer parks per REQ-F010-014.
- **Any environment + credential contains illegal HTTP header bytes (CR, LF, NUL, or other control
  characters) → refuse to boot.** This prevents malformed requests.

**Peer registration and credential provisioning:**
See `docs/runbooks/F-010-peer-registration-and-credential.md` for detailed operational guidance:
(a) registering a peer in `EVENT_BUS_URL`; (b) provisioning the credential (held by the deployment
operator, never committed to source); (c) rotating the credential; (d) responding to credential-mismatch
parks; (e) validating end-to-end delivery against the real cwa endpoint.

**Security caveat:** The relay attaches the credential to all peers in `EVENT_BUS_URL`, and performs
no peer-URL scheme validation, so a misconfigured plaintext `http://` peer would carry the secret in
cleartext. Prefer `https://` peers and use private networks. HTTPS-only enforcement is tracked in
D-006 (GH #16) and D-007 (GH #39).

### BFF-side configuration

The **BFF** (not the relay) reads `EVENT_BUS_MODE`:

| Variable | Default | Meaning | Hard-refuse |
|----------|---------|---------|------------|
| `EVENT_BUS_MODE` | `inproc` | Bus mode selector: `inproc` (in-process `EventEmitter`, development) or `bus` (durable outbox, production). | Yes (production only): any non-`bus` value (e.g., `inproc` or a typo) causes the BFF to refuse to boot with a clear error naming the variable. |

## Delivery semantics

### At-least-once, per-key-ordered, effectively-once-or-isolated

- **At-least-once on the wire:** If the relay delivers an event to a peer, that peer receives it at least once. Duplicates are possible after a crash between transport ack and local `published_at` bookkeeping.
- **Per-key ordering:** Events sharing an ordering key (derived from the event name and target) are delivered to peers in the order they were emitted (by row ID). Skip-ahead is permitted across distinct ordering keys, so a stuck key never blocks others.
- **Effectively-once processing:** Peers **must deduplicate on the stable delivery ID** (carried in the `x-event-delivery-id` HTTP header). This collapses at-least-once duplicates to one effect at the consumer.
- **Isolation of poison events:** Events that cannot be delivered (transport rejects them, repeated transient failures exhaust the retry cap) are **parked** — isolated, retained, queryable, and alerted — so they never silently drop and never block their ordering key's siblings.

### Delivery id

Every delivery carries a stable, unique delivery ID: `<outbox-epoch>:<row-id>`. The epoch is generated once when the DB is provisioned (stored in `outbox_meta.epoch`) and remains constant for the DB lifetime. If the DB is reset, a new epoch is generated, and a peer that dedupes on this ID will re-process rows from the reset. **Consumers must deduplicate on this delivery ID.**

### Retry and backoff

Transient failures (network errors, 5xx, 408/429 responses) trigger exponential backoff with a cap, up to a maximum number of attempts. After the cap is reached:

- **If the row was ever fully acked by the transport:** force-mark it published and stop (post-ack-cap event reached the consumer, only local bookkeeping was lossy).
- **If the row was never fully acked:** park it (genuine poison).

Permanent failures (4xx responses other than 408/429, 3xx redirects) **park immediately** with no retries.

### Retention and pruning

Published rows older than `EVENT_BUS_RETENTION_MS` are automatically pruned every `EVENT_BUS_PRUNE_EVERY_CYCLES` poll ticks. **Unpublished and parked rows are NEVER pruned** regardless of age, so they remain queryable and replayable.

## Health and readiness (`GET /ready`)

The relay serves a `GET /ready` HTTP probe on `RELAY_READY_PORT` (default `3003`), bound to `0.0.0.0`. Responses:

### 200 OK

Relay is healthy:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"ok":true}
```

This means:

- The transport is reachable (last delivery attempt succeeded or no deliveries have been attempted yet).
- The unpublished backlog is strictly below `EVENT_BUS_BACKLOG_THRESHOLD`.
- The age of the oldest unpublished row is strictly below `EVENT_BUS_LAG_THRESHOLD_MS`.
- The relay can write to the store (the `acked_at` / `published_at` persistence probe succeeds).

### 503 Service Unavailable

Relay is degraded or misconfigured. Response includes a machine-readable reason:

```
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{"ok":false,"reason":"backlog-over-threshold"}
```

Possible reasons:

- `transport-unreachable` — the transport is not responding (no successful delivery in recent ticks).
- `bus-mode-without-url` — relay is running in `bus` mode but `EVENT_BUS_URL` is not configured (dev only; production hard-refuses to boot).
- `backlog-over-threshold` — unpublished row count ≥ `EVENT_BUS_BACKLOG_THRESHOLD`.
- `lag-over-threshold` — age of oldest unpublished row ≥ `EVENT_BUS_LAG_THRESHOLD_MS`.
- `store-unwritable` — relay cannot persist bookkeeping to the DB (a write probe fails).

Wire this probe into your orchestrator's health-check policy. A 503 reason does not imply data loss — it is a signal to investigate and recover.

## Known limitations & operational security

The security review (`security/F-004-review.md`) identified the following known limitations. They are **not bugs** but deployment guidance:

### [Medium] No request timeout on slow peers (F1)

A peer that accepts the TCP connection but never sends a response can stall the relay and block that ordering key until a timeout (default 10s per peer, tunable via `EVENT_BUS_PEER_TIMEOUT_MS`). A slow/hostile peer is a DoS vector. **Mitigation:** configure `EVENT_BUS_PEER_TIMEOUT_MS` to a value suitable for your network (default 10s is adequate for most). The timeout is per-peer and independent per key, so one slow peer does not stall the entire relay (other keys keep flowing).

### [Medium] Unauthenticated, plaintext peer delivery (F2)

Events are delivered to peers over plain HTTP (if configured) with no authentication, no HMAC/signature, and no TLS enforcement. An MITM or an untrusted peer can read or forge `admin.*` events. **F-010 adds a shared-secret credential to the wire (F-010 REQ-F010-005)**, which is exposed in cleartext if sent to a plaintext `http://` peer. **Mitigation:** enforce HTTPS-only in your peer list (reject non-`https` URLs in config), run peers on private networks, and use mTLS or bearer tokens if available. HTTPS-only enforcement is tracked in D-006 (GH #16) and D-007 (GH #39). This is a trusted-network assumption (the same assumption as the BFF's engine adapter, which also has no TLS requirement at this stage).

### [Low] Unauthenticated `/ready` probe (F3)

The `/ready` endpoint is served on `0.0.0.0` with no authentication. An unauthenticated network peer can determine whether the relay is running and infer its health (backlog/lag/transport state). **Mitigation:** bind `/ready` to loopback or a pod-internal interface and gate external visibility via network policy. Collapse the reason detail for anonymous callers if you need to expose the probe.

### [Low] No outbound SSRF allowlist (F4)

The `EVENT_BUS_URL` is taken entirely from the environment and is not validated against an allowlist. If an attacker controls the environment, they could target internal metadata endpoints. **Mitigation:** environment control is a deployment concern; assume `EVENT_BUS_URL` is operator-controlled and not user-input. Defense-in-depth: optionally validate the URL scheme/host at boot.

## Data model

The relay reads and writes to the `event_outbox` table in the shared SQLite file. The schema is managed by the BFF's migration (`bff/src/store/db.ts`), which runs at startup. The relay never alters the schema — it only reads, filters, and updates bookkeeping columns.

### Columns the relay uses

- `id` — primary key, unique row identifier.
- `envelope` — the frozen JSON `AdminEventEnvelope` (unchanged, byte-for-byte).
- `published_at` — timestamp when delivery succeeded; NULL until then.
- `ordering_key` — derived from the event name and target (spec §3); scopes per-key ordering.
- `attempt_count` — number of failed delivery or post-ack-mark attempts (incremented per retry).
- `next_attempt_at` — ISO time when the row becomes eligible again (NULL = immediately eligible).
- `parked_at` — timestamp when the row was parked (NULL = active); parked rows are never retried.
- `acked_at` — timestamp when the transport fully acked the row (NULL until full ack; gates the post-ack cap decision).
- `last_error` — human-readable error message from the most recent failure (diagnostics only; no secrets).

The relay also reads `outbox_meta.epoch` once at startup to compose delivery IDs.

## Testing the relay

See `tests/e2e/relay/README.md` for the E2E test harness. Tests launch the actual relay entrypoint as a separate OS process against real SQLite and real HTTP stub peers, covering boot config, delivery, per-key ordering, retry/backoff, poison isolation, fan-out, crash/restart, and `/ready` probe behavior.

To run the tests:

```bash
cd tests/e2e/relay
npm install
npm test
```

## Troubleshooting

### Relay won't boot

Check `stderr` and look for:

- `EVENT_BUS_URL must be set ... when the relay runs in production bus mode` — production hard-refuse; set the env var.
- `EVENT_BUS_PEER_AUTH_TOKEN must be set ... when a peer is configured` — production hard-refuse when a peer is configured but the credential is unset or empty (F-010 REQ-F010-017); set the env var to the shared secret, or remove all peers from `EVENT_BUS_URL`.
- `EVENT_BUS_PEER_AUTH_TOKEN contains a byte that is illegal in an HTTP header field value` — the credential contains a control character (CR, LF, NUL, etc.); fix the credential value to use only legal header bytes.
- `broker transport not available in this build` — `EVENT_BUS_TRANSPORT=broker` is not supported in this GTM; use `http`.
- Any other startup error — check that `DB_PATH` points to a valid, writable SQLite file with the F-004 migration applied.

### `/ready` is not 200

- `transport-unreachable` — check that the peers in `EVENT_BUS_URL` are reachable and listening. Try a manual `curl` to a peer endpoint.
- `backlog-over-threshold` or `lag-over-threshold` — the relay is behind; events are accumulating. Check that peers are accepting deliveries and not responding with errors.
- `store-unwritable` — the SQLite file is not writable (permissions, disk full, file locked). Check file permissions and disk space.

### Ordering or duplicates at the peer

- If a peer is not deduplicating on the `x-event-delivery-id` header, it will process duplicates. Ensure your peer's consumer reads this header and dedupes.
- If events from the same ordering key are arriving out of order, the relay is not running (or has crashed). Restart it, and it will backfill oldest-first per-key order.

## Deployment checklist

- [ ] Relay runs as a separate supervised process (systemd, container restart, etc.) with exactly one instance.
- [ ] `DB_PATH` points to the shared SQLite file (same value as the BFF).
- [ ] `EVENT_BUS_MODE=bus` is set for the BFF in production (causes hard-refuse if unset or typo'd).
- [ ] `EVENT_BUS_URL` is set to your peer list (relay hard-refuses in production without it).
- [ ] `EVENT_BUS_TRANSPORT=http` (the only GTM option).
- [ ] Peer endpoints are reachable and listening on the specified URLs.
- [ ] Peers deduplicate on the `x-event-delivery-id` header (required for effectively-once semantics).
- [ ] `/ready` is wired into your orchestrator's health-check policy (probe port `RELAY_READY_PORT`, default `3003`).
- [ ] `EVENT_BUS_PEER_AUTH_TOKEN` is provisioned at deploy time by the operator (F-010; never committed to source).
- [ ] The shared secret matches what cwa expects on `/api/events/ingest` (cwa REQ-F005-061).
- [ ] A live `admin.user.*` delivery is validated end-to-end against the real cwa endpoint (F-010 REQ-F010-024).
- [ ] (Optional) `EVENT_BUS_PEER_TIMEOUT_MS` is tuned to your network latency (default 10s).
- [ ] (Optional) `EVENT_BUS_BACKLOG_THRESHOLD` / `EVENT_BUS_LAG_THRESHOLD_MS` are tuned to your SLO.
- [ ] Peers use HTTPS and are on a private network or run with mTLS (defend against MITM of `admin.*` events and the shared secret; F-010 does no peer-URL scheme validation, tracked in D-006 GH #16).

## References

- **F-004 Specification:** `specs/F-004-production-event-bus.md` (rev 11, binding).
- **F-010 Specification:** `specs/F-010-deliver-admin-events-to-customer-web-app.md` (rev 3, binding).
- **Design:** `docs/design/09-F004-production-event-bus.md`.
- **F-004 Migration runbook:** `docs/runbooks/F-004-migration-runbook.md`.
- **F-010 Peer/credential/rotation runbook:** `docs/runbooks/F-010-peer-registration-and-credential.md` (peer setup, credential provisioning, rotation, operator response to parks).
- **Security review (F-004):** `security/F-004-review.md`.
- **Security review (F-010):** `security/F-010-security-review.md` (pass with notes; informational note on HTTP whitespace handling).
- **E2E test harness:** `tests/e2e/relay/README.md`.
