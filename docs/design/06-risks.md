# Open Technical Risks & Assumptions

## R1 — Event bus dependency (highest) — spec/architecture tension
The governing architecture mandates publishing every verified write to a **shared on-box
event bus** (rule 2, REQ-029d), but that bus is not known to exist on the appliance yet,
and neither the spec nor the grounding names a concrete bus product/endpoint.
**Mitigation (this design):** publish behind an abstract `EventBus` with a transactional
outbox; default to an in-process emitter + durable `event_outbox`; add a relay when
`EVENT_BUS_URL` is configured (`04-cross-cutting.md` §c). **Open:** the real bus's
protocol, delivery guarantees, and topic/subject naming — an in-process bus means no
independent feature service can subscribe cross-process until the real bus lands.
This is the one place the spec's intent runs ahead of the available infrastructure.

## R2 — Two 403s may not be cleanly separable
REQ-023/097 require distinguishing key-rejection from authorization/precondition 403s, but
AnythingLLM may not always signal which is which in a machine-readable way. **Assumption:**
the adapter can classify by response body/shape and route context (multi-user-gated
operations). **Risk:** ambiguous engine responses could be misclassified; the classifier
in `server/errors.ts` is a likely spot for revision once tested against the live engine.

## R3 — Verify-after-write for secrets and eventually-consistent reads
`GET /v1/system` returns secrets only as booleans, so we can confirm "now set" but not the
value (REQ-060/078a) — a secret set to the same value is indistinguishable from unchanged.
Also, the engine's "known write-consistency gaps" (REQ-028) mean a verify re-read may lag;
a naive immediate re-read could false-negative and surface a spurious 409. **Likely
revision:** a small bounded retry/backoff in `verifiedWrite` for read-after-write lag.

## R4 — Membership delta → per-user events requires a reliable prior snapshot
`admin.workspace_user.assigned/unassigned` (REQ-049) are computed by diffing prior vs
verified membership. **Assumption:** the pre-write members read is an accurate baseline;
concurrent edits from the customer app could skew the emitted deltas. Acceptable under the
spec's fresh-read concurrency model (OQ-6) but worth noting.

## R5 — The 186-key whitelist must be captured exactly
REQ-078b/096 make grounding §5's 186 keys the single source of truth. **Assumption:**
`engine/env-keys.ts` is generated/verified against the pinned engine's `updateENV.js`;
drift silently breaks the raw editor and curated writes. Contract tests (REQ-022a) should
assert the count and membership.

## R6 — Session-auth-only engine operations are out of scope (confirmed, not a defect)
`POST /system/enable-multi-user` and `GET /system/api-keys` require session auth and are
unreachable by the developer-API-key BFF (grounding §4, REQ-117/120). The console detects
and blocks the multi-user-off state (REQ-040) and offers no API-key admin. **Assumption:**
an operator enables multi-user out-of-band in the native UI before §6 features are usable.

## R7 — Ollama base path reachability from the BFF host
Model discovery assumes the BFF can reach `OllamaLLMBasePath` (REQ-075). On the appliance
Ollama is co-located, but a misconfigured base path or auth token will make discovery fail;
graceful free-text degradation (REQ-076) contains the impact.

## R8 — Shared product-type distribution between packages
`web/` must import product types without importing engine types (REQ-025). **Assumption:**
types are shared via a small local package or a build step copying declarations; the exact
mechanism is left to the implementer. The hard rule is that `engine/*` is never reachable
from `web/`.

## Items the spec leaves to implementation
- Session model details (sliding vs fixed expiry, cookie attributes beyond httpOnly).
- Client-side routing library choice (`05-web-architecture.md` assumes a light router).
- TOTP/argon2 library selection (spec fixes the algorithms, not the packages).
- Outbox relay cadence and retry policy.
- Exact SQLite migration tooling.
- Recovery-code count and password-policy specifics.
