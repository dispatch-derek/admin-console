# SECURITY REVIEW REPORT — D-008 (GH #40): read-only `GET /metrics` relay route

**Date:** 2026-07-23
**Scope:** `bff/src/relay/ready.ts`, `bff/src/relay/metrics.ts`, `bff/src/relay/index.ts`
(diff `fix/d-006-https-peer-enforcement..HEAD -- bff/src/relay/`)
**Scanners run:** none installed in environment; review is manual + full data-flow trace of the added route.

## Verdict: PASS WITH NOTES

The change is purely additive and introduces no injectable sink, no user-controlled input,
and no secret/PII disclosure. It does, however, marginally widen the disclosure of the
already-flagged unauthenticated `0.0.0.0` relay probe surface (prior F-004 finding F3) by
exposing raw integer counters/gauges where `/ready` previously exposed only threshold-crossing
state. That is acceptable operational telemetry, recorded below as Informational — not a blocker.

## Data-flow confirmation (information exposure)

The `/metrics` body is `{ ...getCounters(), backlogCount, relayLagMs }`. Traced each field to source:

- `getCounters()` (`metrics.ts:66-68`) returns a shallow copy `{ ...counters }` of a
  process-lifetime singleton whose five fields (`delivered`, `attemptFailures`,
  `neverDeliveredPark`, `partiallyDeliveredPark`, `postAckCap`, `metrics.ts:29-43`) are
  `number`s only ever mutated by `+= 1` in the `record*` helpers. No strings, no envelope
  contents, no peer identity.
- `backlogCount` (`metrics.ts:24-26`) is `SELECT COUNT(*) ... ` → a single integer.
- `relayLagMs` (`metrics.ts:16-21`) is a computed millisecond age integer.

**Result:** the body carries only aggregate integer counters and gauges. No peer URLs, no
`EVENT_BUS_PEER_AUTH_TOKEN` / `X-Event-Auth-Token` value, no envelope payloads, no
usernames/PII, no config secrets. Confirmed clean on the focus area.

## DoS / injection / regression checks

- **No user input reflected / no injection sink:** the handler ignores `_req`; nothing from
  the request reaches a query, log, or response. The two SQLite statements are module-level
  prepared statements with no parameters — no injection surface.
- **No unbounded work:** handler does two bounded queries (`COUNT(*)` and `ORDER BY id ASC
  LIMIT 1`) plus an in-memory object spread — identical cost profile to the existing `/ready`
  handler. Constant per-request, no user-tunable amplification.
- **Purely additive:** `/ready` logic (`ready.ts:23-41`) is byte-for-byte unchanged; counter
  semantics unchanged. `getCounters` returns a defensive copy, so callers cannot mutate the
  singleton. `Counters` was only widened from `interface` to `export interface` — no behavior
  change. No regression.

## Findings

### [Informational] I1 — `/metrics` exposes raw operational counters on the unauthenticated `0.0.0.0` probe surface
`bff/src/relay/ready.ts:46-52`, served by `bff/src/relay/index.ts:54`
(`ready.listen({ port: READY_PORT, host: '0.0.0.0' })`).

- **Scenario:** the relay probe app binds all interfaces with no auth (pre-existing F-004
  finding F3). The prior review explicitly noted `/ready` leaks "No raw counts, thresholds, or
  peer URLs." `/metrics` now returns exact integers: cumulative `delivered` (traffic volume),
  `attemptFailures` and the two park counters (failure/backpressure intelligence), plus live
  `backlogCount` and `relayLagMs`. An unauthenticated caller with network reach to `READY_PORT`
  (default 3003) can now poll delivery throughput and failure/pressure trends over time, rather
  than only observing whether a threshold was crossed. This is operational intelligence, not a
  secret or PII disclosure.
- **Why not higher:** the values are aggregate integers with no identifiers or credentials;
  impact is limited to inferring relay load/health, and the exposure requires network reach to
  a port that is intended to be internal/deployment-fenced (systemd/container network policy,
  per F-004-020). This does not introduce a new class of risk — it incrementally deepens an
  already-accepted Low finding.
- **Remediation (optional, defense-in-depth; owner = implementer, tracked with F3):** bind the
  probe listener to a specific internal interface / loopback (or a private network CIDR) via a
  configurable `RELAY_READY_HOST` instead of hardcoded `0.0.0.0`, and/or ensure deployment
  network policy fences `READY_PORT` to the metrics scraper. If cross-host scraping is required,
  consider a bearer/shared-secret gate consistent with the relay's existing peer-auth model.
  No code change is required to accept this posture as operational telemetry.

## Not assessed

- Network/deployment enforcement of `READY_PORT` reachability (systemd unit / container network
  policy) — out of repo, a deployment concern.
- Automated SAST (semgrep/bandit-equivalent) — not installed; the diff is small enough for
  full manual coverage.
