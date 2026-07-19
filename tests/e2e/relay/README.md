# E2E Test Harness for the F-004 Outbox Relay

Real cross-process E2E suite for the F-004 production event bus delivery service
(`specs/F-004-production-event-bus.md`, `docs/design/09-F004-production-event-bus.md`). Launches
the actual relay entrypoint (`bff/src/relay/index.ts`) as a **separate OS process** against a real
temporary SQLite outbox DB file and real localhost HTTP stub peers -- no mocking of the transport,
the DB, or the process boundary. This is what a unit or spec-level test structurally cannot cover:
env-var parsing at process boot, the composed drain loop wired to a real `HttpPeerTransport`, a
real bound `GET /ready` TCP port, and real SIGKILL/restart semantics against a shared DB file.

**Framework:** Vitest (Node environment, no browser).

## Quick start

```bash
cd tests/e2e/relay
npm install   # one-time (own node_modules, separate from bff's and the root tests/e2e's)
npm test
```

## Journeys covered

| File | Journey |
| --- | --- |
| `tests/delivery.e2e.test.ts` | Happy-path delivery across the real process/HTTP boundary (byte-for-byte envelope, `published_at` set); per-key ordering + independent-key non-blocking |
| `tests/fanout.e2e.test.ts` | Multi-peer fan-out: delivered to both peers, published only once both ack |
| `tests/crash-restart.e2e.test.ts` | Crash (`SIGKILL`) mid-delivery, restart against the same DB, at-least-once backfill |
| `tests/failure-retry-park.e2e.test.ts` | Transient 5xx retried with backoff and eventually delivered; permanent 4xx parked immediately; poison isolation (other keys unaffected) |
| `tests/ready-probe.e2e.test.ts` | `GET /ready` 503 while backlog/lag over threshold, 200 once healthy |
| `tests/boot-config.e2e.test.ts` | **Bug documentation** (`it.fails`) -- see below |

## Known bug this suite documents (not fixed here -- out of scope for `tests/e2e/`)

`bff/src/relay/config.ts` states the relay is a separate process that deliberately does not import
the BFF's main `config.ts` (which requires `ANYTHINGLLM_BASE_URL`/`ANYTHINGLLM_API_KEY`/
`SESSION_SECRET`/`SECRETS_ENC_KEY`). In practice `bff/src/relay/index.ts` -> `drainer.ts` ->
`store/repositories/outbox.repo.ts` -> `store/db.ts` -> `import { config } from '../config.js'`
pulls in that main config anyway, so the relay process **cannot boot** without those BFF-only
secrets set, contradicting its own documented contract. `tests/boot-config.e2e.test.ts` asserts the
documented (bug-free) behavior directly with `it.fails`, so it reports as a suite failure (the
signal to un-skip it) once the wiring is fixed, without blocking this suite in the meantime. Every
other journey works around it via `BFF_CONFIG_WORKAROUND_ENV` in `fixtures/relayProcess.ts`.

## Fixtures (`fixtures/`)

- `relayProcess.ts` -- spawns/kills the real relay child process, polls `/ready`, captures stdio.
- `stubPeer.ts` -- an ephemeral real `node:http` server double for a peer, with scriptable
  status/hang/release behavior and full request capture (headers, raw body).
- `db.ts` -- opens/seeds a real SQLite outbox DB file matching the documented `event_outbox` /
  `outbox_meta` schema (migrations/NOTES-F004.md); the relay's own migration runs additively on top
  when it boots.
- `tmp.ts` -- unique temp DB dir per test, cleaned up in `afterEach`.

## Isolation

Every test creates its own temp DB file, its own ephemeral stub-peer port(s), and its own ephemeral
relay `/ready` port, and tears all three down in `afterEach` -- tests pass in any order or run
alone. `vitest.config.ts` sets `fileParallelism: false` so concurrently-running test files never
race on OS resources (ports, spawned processes).
