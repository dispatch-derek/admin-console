# Security Review — F-004 Production Event-Bus / Outbox Relay Delivery

- Date: 2026-07-19
- Branch: `feat/f-004-event-bus-delivery` (diff `main...HEAD`)
- Reviewer role: application security (read-only on source/tests)
- Runtime: Node v24 (global `fetch`/undici)

## Scope
New/changed production code reviewed:
- `bff/src/relay/**` — `index.ts`, `drainer.ts`, `http-peer-transport.ts`, `transport.ts`,
  `config.ts`, `ready.ts`, `metrics.ts`, `backoff.ts`, `delivery-id.ts`
- `bff/src/events/ordering-key.ts`, `bff/src/events/bus.ts`
- `bff/src/store/repositories/outbox.repo.ts`, `bff/src/store/db.ts`, `bff/src/store/db-path.ts`
- `bff/src/config.ts` (production `EVENT_BUS_MODE` hard-refuse, shared db-path)

## Scanners run
- `npm audit --omit=dev` (bff): **0 vulnerabilities**.
- Secret grep across `bff/src/relay/**`: no secrets; only comments naming env vars.
- semgrep / bandit / gosec: **not installed** in environment (manual review used instead).

---

## Findings

### [Medium] F1 — No outbound request timeout; a hung/slow peer stalls delivery
`bff/src/relay/http-peer-transport.ts:47-51`

`fetch(url, {...})` is issued with no `AbortSignal`/timeout. `deliver()` awaits
`Promise.all(pending.map(...))` (all peers), and `drainer.runOnce()` awaits `Promise.all`
over every dispatched row. There is no per-request deadline.

- **Flow:** hostile/unresponsive peer at `EVENT_BUS_URL` → `fetch` hangs → `deliver()`
  promise never settles for that tick → per-ordering-key head-of-line (outbox.repo
  `selectEligible`) blocks that key's backlog until the socket finally errors.
- **Impact:** delivery of the `admin.*` stream stalls; backlog and relay-lag climb; only
  the 10s graceful-shutdown abandon can interrupt an in-flight hang. undici's default
  header/body timeouts (~300s) cap a fully-dead socket, but a *slow* (slowloris) peer that
  trickles bytes can hold the connection far longer, and even 300s/attempt is a large
  availability hit for the sole delivery path. Recoverable (retries as transient), so not
  High, but a real single-hostile-peer DoS lever.
- **Remediation:** attach `signal: AbortSignal.timeout(<few seconds>)` to each `fetch`;
  treat the resulting `AbortError` in the existing `catch` as `transient`. Consider a
  small per-peer concurrency/deadline budget so one slow peer cannot pin a tick.

### [Medium] F2 — Admin event stream POSTed to peers with no authentication/integrity and no TLS enforcement
`bff/src/relay/http-peer-transport.ts:47-51`, `bff/src/relay/config.ts:11-15`

The envelope is POSTed with only `content-type: application/json` and
`x-event-delivery-id`. There is no bearer token, no HMAC/signature over the body, and no
mTLS. `config.ts` parses `EVENT_BUS_URL` as a comma list with **no scheme/host validation**,
so a plain `http://` peer is accepted.

- **Impact (confidentiality):** `admin.*` envelopes describe privileged admin actions
  (user/workspace/invite/instance-config mutations). Over `http://` or an MITM'd hop they
  are exposed in cleartext.
- **Impact (integrity):** a consumer/peer cannot verify the events originated from the
  relay; a rogue peer (or anyone who can reach the consumer's ingest URL) can inject forged
  `admin.*` events. Redaction (`redactSecrets`) upstream limits secret exposure in the body,
  but authenticity of the stream is unprotected.
- **Blast radius** is bounded because `EVENT_BUS_URL` is operator-controlled config, but the
  task explicitly flagged this as a confidentiality/integrity question and it is a genuine
  gap for a sensitive machine-to-machine stream.
- **Remediation:** reject non-`https` peers in production during config parse; add a shared
  signing scheme (HMAC over body + delivery id, or bearer) or mTLS between relay and peers;
  document the peer trust model in the spec/runbook.

### [Low] F3 — `/ready` is unauthenticated, binds to `0.0.0.0`, and differentiates internal state
`bff/src/relay/index.ts:38`, `bff/src/relay/ready.ts:21-38`

`ready.listen({ port: READY_PORT, host: '0.0.0.0' })` exposes the probe on all interfaces
with no auth. Responses distinguish `transport-unreachable`, `store-unwritable`,
`backlog-over-threshold`, `lag-over-threshold`, `bus mode without EVENT_BUS_URL`.

- **Impact:** an unauthenticated network peer can confirm the relay exists and infer its
  health/pressure (backlog vs lag vs transport). No raw counts, thresholds, or peer URLs are
  returned, so disclosure is limited — but binding to `0.0.0.0` widens exposure beyond the
  orchestrator/loopback that actually needs the probe.
- **Remediation:** bind the readiness listener to loopback or the pod-internal interface and
  gate external reachability via network policy; optionally collapse the reason detail for
  anonymous callers.

### [Low] F4 — No scheme/host allowlist on the relay's outbound destination (SSRF surface)
`bff/src/relay/config.ts:11-15`, `bff/src/relay/http-peer-transport.ts:47`

The fetch destination comes **entirely from `EVENT_BUS_URL` env**, never from a request
field or DB value, so there is no runtime user-input → SSRF injection vector (confirmed:
`static-scans.test.ts` REQ-F004-028 asserts the URL never reaches a route/browser, and no
route/service imports relay config). The residual note is only that nothing constrains the
env to external/allowlisted hosts (e.g. it could target internal metadata endpoints), which
already presupposes control of the environment.
- **Remediation:** optional defense-in-depth — validate `EVENT_BUS_URL` entries against an
  expected scheme/host shape at boot.

### [Low] F5 — In-memory `ackMap` can grow to the working-set size during a sustained outage
`bff/src/relay/http-peer-transport.ts:30-39,83-85`; abandon path `bff/src/relay/drainer.ts:124-127`

An entry (possibly an empty `Set`) is created per `deliveryId` on the first `deliver()` and
is only evicted by `release()`, which the drainer calls on a **terminal** outcome (publish or
park). During a prolonged peer outage, every attempted-but-not-terminal row holds an entry
across up to `MAX_ATTEMPTS` (8) retries with backoff (minutes) before park→release.
Additionally, the graceful-shutdown **abandon** path (`deliverRow` returns on `'abandon'`)
does not call `release`, though the process is exiting so that is benign.
- **Impact:** bounded by the live working set, but under a wide multi-peer outage the map can
  hold entries for a large backlog. Memory pressure, not a crash in practice.
- **Remediation:** consider a size cap / TTL sweep on `ackMap`, and release on abandon for
  tidiness.

---

## Positives verified (not just unchecked)
- **SQL injection — none.** All `outbox.repo.ts` statements are parameterized (`@name`/`?`).
  The `db.ts` migration interpolates identifiers only from the **hardcoded** `additive` array
  and `PRAGMA table_info(${table})` with constant table names — no external input reaches DDL.
- **No envelope/secret leakage in error state or metrics.** `recordFailure` persists
  `errText(err)`; the network-failure `catch` in the transport carries no detail, and
  `TransportError` messages are static strings ("a peer transiently failed the delivery").
  No envelope body or secret is written to `last_error`, `metrics.ts`, or logs. Upstream
  `redactSecrets` is not undone by F-004 (transport delivers the frozen envelope byte-for-byte
  and never re-logs it).
- **`EVENT_BUS_MODE` production hard-refuse is sound.** `config.ts` requires exactly `'bus'`
  under `NODE_ENV=production`; relay `config.ts` hard-refuses `broker` in all envs and refuses
  an empty peer list in production. No bypass short of controlling `NODE_ENV`.
- **Secret decoupling is clean.** `store/db-path.ts` resolves the DB path from `DB_PATH`
  without importing the secret-requiring BFF `config.ts`; the BFF's own `requireSecret`
  (`SESSION_SECRET`, `SECRETS_ENC_KEY`) requirement is unchanged in `config.ts`. The relay
  reads no secret.
- **Deserialization is safe.** `deriveOrderingKeyForBackfill` (db.ts) wraps `JSON.parse` in
  try/catch → `__unkeyed__`; `deriveOrderingKey` operates on already-parsed objects and is
  total. Malformed envelopes cannot crash the backfill or the relay.
- **Delivery-id header is injection-safe.** `x-event-delivery-id` = `<uuid-epoch>:<numeric row id>`
  — no CRLF/user-controlled content.

## Not assessed
- E2E relay harness under `tests/e2e/relay/**` and its separate lockfile were not audited for
  CVEs (out of production scope; test-only). `npm audit` was run against `bff` only.
- Runtime behavior of undici's slowloris/header-timeout defaults under Node 24 was reasoned
  about, not empirically measured.
- Deployment/supervisor config (systemd/container single-instance guarantee for REQ-F004-017)
  is a deployment concern outside this diff.

## Verdict
**PASS WITH NOTES.** No Critical or High findings. Two Medium findings (F1 missing request
timeout, F2 unauthenticated/plaintext peer delivery) should be remediated before this relay
faces an untrusted network or a non-fully-trusted peer; both are straightforward hardening.
F3–F5 are low-priority defense-in-depth.
