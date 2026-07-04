# Admin Console — Design Overview

Status: implementation architecture, rev 2. Designs to spec `specs/admin-console.md`
(rev 7) under the binding `docs/governing-architecture.md`.

This overview names the packages, the dependency direction, where each of the four
boundary rules is enforced, and the concrete technology choices. Detail lives in the
sibling docs:

- `01-bff-architecture.md` — BFF internal layers, engine adapter, verify-after-write, event emitter.
- `02-product-api.md` — the console's own product API contract + engine mapping table.
- `03-data-models.md` — BFF-owned persistence + `admin.*` event schemas.
- `04-cross-cutting.md` — auth/MFA, event bus, Ollama discovery, raw editor, secrets, errors, config.
- `05-web-architecture.md` — React/Vite app structure and feature areas.
- `06-risks.md` — open technical risks and assumptions.

## Packages (REQ-020)

Two packages, mirroring `front-end-custom`:

```
anythingllm-admin-console/
  bff/    Fastify + TypeScript, port 3002   (the anti-corruption layer)
  web/    React + TypeScript + Vite, 5173   (speaks only /api/*)
```

`web` dev server proxies `/api/*` to the BFF (mirrors the sibling app). Package
manifests, tsconfig, and `type: module` mirror `front-end-custom/{bff,web}`.

## Dependency direction (one way, inward to the engine)

```
Browser (web/)
  │  only relative /api/* ; product vocabulary only (REQ-021, REQ-021a)
  ▼
BFF product routes  ──►  auth/session guard  ──►  identity/slug resolver
  │                                                     │
  │                                                     ▼
  │                                              engine adapter  ──►  AnythingLLM /api/v1
  │                                              (ONLY module that knows engine shapes)
  ├──►  verify-after-write  ──►  event emitter  ──►  event bus (abstract)
  └──►  audit sink (stdout + append-only store)

BFF-owned store (SQLite): staff accounts, sessions, audit log, identity map, event outbox
```

Nothing in `web/` imports engine types. Nothing outside the engine-adapter module
references a `/v1/...` path or engine field name. Both are enforced by static scan
(REQ-021a, REQ-026) and by the type split (REQ-025): product types are shared with
`web/`; engine types live only in `bff/src/engine/`.

## Where the four boundary rules are enforced

| Rule (governing-arch) | Enforced in | Spec |
|---|---|---|
| 1. Talk only through the API | `bff/src/engine/adapter.ts` is the sole `fetch` caller of the engine; no DB/file access | REQ-021, REQ-026 |
| 2. Synthesize events at our boundary | `bff/src/events/emitter.ts`, invoked only after verify-after-write succeeds | REQ-029, §14 |
| 3. Identities in our DB | `bff/src/identity/` maps product `id` ↔ opaque engine slug/numeric id; SQLite `workspace_map` | REQ-021b, §6.4 |
| 4. Engine API key never in browser | key lives in `config`, attached in `authHeaders()` inside the adapter; session cookie is all the browser holds | REQ-013, REQ-011 |

## Technology choices (appliance-appropriate)

- **BFF store: embedded SQLite via `better-sqlite3`.** One box, one customer,
  single process. A single-file embedded DB gives us atomic transactions (needed for
  the verify → outbox → audit sequence), synchronous calls that fit Fastify handlers,
  and zero extra process to manage on the Mac Studio. Rejected: Postgres (a server to
  operate/upgrade — violates the appliance goal and REQ-113's spirit); flat JSON files
  (no atomicity, no concurrent-write safety, no append-only guarantee for audit).
  Rationale supports REQ-093a's "BFF-local append-only store". See `03-data-models.md`.
- **Auth: local sessions + argon2id + TOTP.** `argon2` for password hashing (REQ-015),
  `otplib` (or equivalent RFC-6238) for TOTP (REQ-016), httpOnly session cookie backed
  by a `sessions` row (REQ-011, REQ-014). See `04-cross-cutting.md`.
- **Event bus: abstract `EventBus` interface + transactional outbox.** The on-box
  shared bus may not exist yet, so we ship an in-process emitter that also writes an
  `event_outbox` row in the same transaction as the verify result; a relay drains the
  outbox to the real bus when configured. See `04-cross-cutting.md` and `06-risks.md`.
- **HTTP framework: Fastify 4 + `@fastify/cors` + `@fastify/cookie`**, mirroring the
  sibling BFF. Native `fetch` for upstream calls (as the sibling does).

## Scale / simplicity tradeoffs deliberately made

- **One role, no RBAC engine.** Spec has exactly one actor (REQ-010); we model a flat
  `staff` table and self/last-account guardrails (REQ-018a), not a permission system.
- **No message-queue infrastructure in v1.** The outbox + abstract interface is enough
  for a single box; we do not stand up Kafka/NATS ourselves (see risks).
- **No ORM.** Hand-written SQL against `better-sqlite3` with a thin repository layer;
  the schema is ~6 small tables. An ORM would be more machinery than the data justifies.
- **No client-side router library required.** The web app is a handful of feature areas;
  a small in-app view switch (as the sibling `App.tsx` does) or a minimal router is
  sufficient. Left to the implementer; `05-web-architecture.md` assumes a light router.

## Spec-to-design traceability

Every product route in `02-product-api.md` cites the REQ it satisfies and the engine
call it maps to. Every persisted entity and event in `03-data-models.md` cites its REQ.
Cross-cutting mechanisms in `04-cross-cutting.md` are keyed to REQ ids. `06-risks.md`
lists the places the spec leaves to implementation and the one spec/architecture tension
(event bus dependency).
