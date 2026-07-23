# F-010: Deliver admin.* Events to customer-web-app (Register cwa as a Relay Peer + Shared-Secret Credential) — Specification

Status: Draft rev 3 — applies the human ruling gate (2026-07-22): resolves Open Questions Q1/Q2/Q4/Q5/Q6/
Q8/Q9 into the requirements and leaves Q3/Q7 explicitly deferred with named owners (§8). The Q2 ruling
corrects a factual premise — cwa's `/api/events/ingest` is **now implemented**, so real-cwa end-to-end
verification is no longer deferred (REQ-F010-024/016). Confirms the agreed default names
(`X-Event-Auth-Token` / `EVENT_BUS_PEER_AUTH_TOKEN`) and folds in four non-blocking review clarifications on
REQ-F010-005/017. No REQ id renumbered or reused; append-only; cwa's F-005 spec remains the contract of
record (no requirement invented from cwa code behavior).
(rev 2 baseline — resolves the three BLOCKING spec-review ambiguities on rev 1 (all in the credential
requirements; the F-004 cross-refs reviewed clean): the missing-credential env collision (REQ-F010-017/024),
the verbatim-vs-trimmed credential value (REQ-F010-005/007), and the "exactly three headers" ambiguity
against transport-mandatory headers (REQ-F010-005/024); folds in the optional NOTEs on header-illegal-byte
boot validation and whitespace-only/empty-after value handling. No REQ id renumbered or reused; append-only;
the nine Open Questions (§8) were untouched and still routed to the human ruling gate.)
(rev 1 baseline: initial draft, for implementation and QA review. Formalizes
`briefs/F-010-deliver-admin-events-to-customer-web-app.md` (authoritative intent). Adopts recommended
defaults for the brief's seven Open Questions (plus two analyst-added questions) so the requirements are
testable; every open question remains flagged in §8 for a human ruling gate. No default silently resolves
a question the brief's author raised.)

Feature brief (authoritative intent): `briefs/F-010-deliver-admin-events-to-customer-web-app.md`
Parent / composed specs (conventions, architecture, shared requirements this feature extends):
- `specs/F-004-production-event-bus.md` — the production `admin.*` relay this feature configures and
  extends. F-010 composes with **REQ-F004-052** (`EVENT_BUS_URL` comma-list peer registration +
  `EVENT_BUS_TRANSPORT` selector), **REQ-F004-051** (multi-peer fan-out ack; row published only on full
  fan-out; permanent-peer rejection parks immediately), **REQ-F004-055** (HTTP-response →
  permanent/transient classification), and **REQ-F004-049** (the transport-agnostic drainer ↔
  `EventTransport` seam).
- `specs/F-005-per-customer-feature-toggle-console.md` — structural conventions (this repo's sibling).
Cross-repo consumer contract (the seam this feature satisfies, NOT owned here):
`~/git/customer-web-app/specs/F-005-cross-app-identity-sync.md` §3.6 — **REQ-F005-060** (peer URL in
`EVENT_BUS_URL`), **REQ-F005-061** (three wire elements: envelope body + `X-Event-Delivery-Id` header +
shared-secret credential), **REQ-F005-062** (envelope frozen), **REQ-F005-063** (response classification
composes with this app's REQ-F004-055; cwa's 401 = permanent park by design). *(Where this document cites
`REQ-F005-0xx` it means the customer-web-app spec of that number, a distinct document from this repo's
`specs/F-005-per-customer-feature-toggle-console.md`; the citation names cwa explicitly to avoid
collision.)*
Grounding references (verified in-repo, re-confirm at build time): `bff/src/relay/http-peer-transport.ts`
(outbound POST, exactly two headers today), `bff/src/relay/transport.ts` (`EventTransport` seam,
`createTransport` factory), `bff/src/relay/config.ts` (relay-scoped `EVENT_BUS_*` config, 0 secret keys),
`bff/src/events/catalog.ts` (21 `admin.*` names, 5 `admin.user.*`), `bff/.env.example` (empty
`EVENT_BUS_URL`).

This is an **infrastructure / delivery-transport** feature spec layered on F-004. It introduces a distinct
requirement-ID namespace, **`REQ-F010-###`**, so its IDs never collide with the parent `REQ-###` series or
any sibling `REQ-F00x-###`/`REQ-F004-###` series. Section numbers (§1, §1.1, …) are **local to this
document**; downstream tests cite the globally-unique `REQ-F010-###` id plus the local §. Requirement IDs
and section numbers are **stable**: never renumber or reuse an id; append new ids or mark items
**DEPRECATED**.

Like F-004 this is a **backend / on-box infrastructure** feature: there is deliberately **no Web UI / UX
section** (the browser cannot read the on-box bus, parent REQ-029d). F-010 changes **outbound delivery
wire metadata plus relay configuration**; it does **not** change what is emitted (the `admin.*` catalog and
`AdminEventEnvelope` remain frozen per REQ-F004-002 / cwa REQ-F005-062).

---

## §1 Overview & Scope

### §1.1 Purpose
Today admin-console's F-004 relay drains its outbox to the HTTP peers named in `EVENT_BUS_URL`, but (a) cwa
is not among them and this deployment ships an empty peer list (`bff/.env.example` `EVENT_BUS_URL=`), and
(b) the outbound POST (`http-peer-transport.ts`) sends exactly two headers — `content-type` and
`x-event-delivery-id` — and carries **no credential**, while cwa's REQ-F005-061 requires **three** wire
elements: the envelope body, the `X-Event-Delivery-Id` header, **and** a shared-secret credential. There is
no credential-carrying code path anywhere in `bff/src/relay/` or `bff/src/events/`, and no secret among the
relay config keys or `EVENT_BUS_*` env vars. F-010 (i) registers cwa's ingest URL as a relay peer and (ii)
introduces the shared-secret credential path in the outbound transport, so that `admin.user.*` (and all
other `admin.*`) state changes are actually delivered to cwa. It ships that credential and **no more**;
broader relay auth-model hardening stays with D-006 (§7).

- REQ-F010-001 — **The core work is a transport change PLUS config, not config alone.** F-010 MUST
  introduce a shared-secret **credential-carrying code path** in the outbound HTTP transport where none
  exists today, in addition to registering cwa in the peer list. Configuration alone is insufficient:
  because no code path carries a credential, a peer added today would receive a POST with only the two
  existing headers, be rejected by its consumer (cwa returns 401), and — since 401 classifies **permanent**
  under REQ-F004-055 — be **parked permanently on its first delivery** rather than delivering anything.
  *Test:* a static scan shows the outbound transport (`http-peer-transport.ts` / its wiring) gains a
  credential source and attaches a credential to each peer POST; the pre-F-010 state (exactly two headers,
  no credential) is demonstrably changed.

- REQ-F010-002 — **F-010 changes delivery wire metadata + config only, NOT the event contract.** The
  `admin.*` catalog (`bff/src/events/catalog.ts`, 21 names across 8 families; 5 `admin.user.*`), the
  `AdminEventEnvelope` shape, event cardinality, and secret redaction are frozen (REQ-F004-002; cwa
  REQ-F005-062) and out of scope for F-010. F-010 consumes the already-shaped, already-redacted envelope as
  opaque bytes and delivers it unchanged; the credential is **transport metadata**, never an envelope
  field. *Test:* no F-010 change edits `catalog.ts` event names/payloads or the `AdminEventEnvelope`; the
  relay delivers the exact envelope JSON persisted to `event_outbox`, byte-for-byte (REQ-F010-012).

---

## §2 Definitions & Glossary

- **Peer** — an HTTP endpoint in the relay's `EVENT_BUS_URL` comma-list to which `HttpPeerTransport` POSTs
  each drained envelope (REQ-F004-052). cwa's `/api/events/ingest` is the peer this feature registers.
- **Shared-secret credential** — the opaque secret string cwa's REQ-F005-061 requires on the wire as the
  third element (alongside the envelope body and `X-Event-Delivery-Id`), which cwa constant-time compares
  to authenticate the producer. In this document, "credential", "shared secret", and "auth token" are
  synonyms.
- **Credential header** — the HTTP request header on the outbound peer POST that carries the credential
  value. Its exact name is an **open decision** to be agreed jointly with cwa (§8 Q1); the requirements
  below adopt the provisional default header name **`X-Event-Auth-Token`** so QA can assert a concrete
  wire shape.
- **Credential config key / env var** — the new relay-scoped configuration that sources the credential.
  Its exact name is part of §8 Q1; the requirements adopt the provisional default env var
  **`EVENT_BUS_PEER_AUTH_TOKEN`** (in the existing `EVENT_BUS_*` family, `bff/src/relay/config.ts`).
- **Delivery id** — the stable transport delivery id already produced by this app, shape
  `<outbox-epoch>:<row-id>`, carried in the `x-event-delivery-id` header (cwa REQ-F005-011). Frozen; F-010
  does not change it.
- **Permanent park** — the F-004 outcome (REQ-F004-014/047/051(d)/055) in which a peer's non-retryable
  rejection (any 4xx incl. 401, any 3xx, any non-2xx-non-transient) causes `deliver()` to reject permanent
  and the orchestration layer to park the ordering key immediately, with no backoff retries.
- **Fan-out ack** — the REQ-F004-051 rule that `deliver()` resolves (and the outbox row is marked
  `published_at`) **only** when **every** configured peer has returned 2xx.

---

## §3 Functional Requirements

### §3.1 Peer registration

- REQ-F010-003 — **cwa is registered as a relay peer.** cwa's ingest URL MUST be added to the relay's
  `EVENT_BUS_URL` comma-delimited peer list (composing REQ-F004-052; satisfying cwa REQ-F005-060). The
  registration follows the existing parse rules unchanged (comma split, per-entry whitespace trim, empty
  entries dropped — `config.ts`). *Test:* with cwa's URL present in `EVENT_BUS_URL`, `config.peerUrls`
  includes it and `HttpPeerTransport` fans out to it; with the URL absent, it does not. **This requirement
  fixes the wire shape, not a literal URL value** — the concrete cwa URL is a deployment value, not a spec
  constant.

### §3.2 Shared-secret credential on the wire

- REQ-F010-004 — **The outbound peer POST carries the shared-secret credential as the third wire element.**
  For each configured peer, `HttpPeerTransport.deliver()` MUST send, on the same single POST that already
  carries the envelope body and the `x-event-delivery-id` header, the shared-secret credential (satisfying
  cwa REQ-F005-061's three-element requirement). No additional request, round-trip, or handshake is
  introduced (REQ-F010-022). *Test:* the outbound POST to a configured peer contains all three of: the
  byte-for-byte envelope body, the delivery-id header, and the credential.

- REQ-F010-005 — **The credential is carried as an HTTP request header with the configured value
  verbatim (no trimming).** The credential MUST be attached as a request header whose name is the
  credential-header name (`X-Event-Auth-Token`, ruled 2026-07-22 as the agreed default, §8 Q1) and whose
  value is the configured secret **byte-for-byte as read from the credential env var (REQ-F010-007), with
  NO whitespace-trim, truncation, case-folding, or re-encoding** beyond what HTTP header transmission
  requires. The comma-split / whitespace-trim convention of REQ-F004-052 applies **only** to splitting the
  `EVENT_BUS_URL` peer list and MUST NOT be applied to the credential value; e.g. a configured value
  `" abc "` is delivered as `" abc "` (leading/trailing spaces preserved), never as `"abc"`.
  **Header-set assertion (defined at the application layer to resolve the transport-default ambiguity):**
  **when a credential is configured** (i.e. present and non-empty per REQ-F010-017 — this MUST does NOT
  apply to the dev boot-soft missing-credential path of REQ-F010-024(b-missing), which POSTs only the two
  pre-existing headers), the outbound POST MUST carry the three **application-level** headers
  `content-type`, `x-event-delivery-id`, and the credential header — **in addition to** whatever
  transport-mandatory headers the HTTP client itself attaches (`Host`, `Content-Length`, `Accept-Encoding`,
  `Connection`, etc.), which are out of scope for this assertion. F-010 introduces **exactly one** new
  application-level header (the credential header) and no others. **Whitespace-verification point:**
  byte-for-byte equality of a value carrying leading/trailing whitespace is asserted **at the point the
  transport sets the header value** (the value passed to the HTTP client), because some HTTP clients or
  intermediaries strip optional surrounding whitespace in transit; a peer stub that observes trimmed
  surrounding whitespace does not by itself prove a spec violation, whereas the transport setting a trimmed
  value does. *Test:* with a credential configured, the transport sets the credential header to a value
  equal to the configured secret byte-for-byte (including any leading/trailing whitespace) at the point of
  the call; a peer stub asserts the three named application-level headers are present, does NOT require the
  total header count to equal three (the client attaches transport-mandatory headers too), and asserts the
  credential header is the only new application-level header introduced by F-010.

- REQ-F010-006 — **The two existing wire elements are unchanged.** F-010 MUST NOT change the
  `content-type: application/json` header, the `x-event-delivery-id` header name, or the delivery-id value
  shape `<outbox-epoch>:<row-id>` (cwa REQ-F005-011). The credential is **added alongside** them, never in
  place of them. *Test:* after F-010, the delivery-id header name and value shape are identical to the
  pre-F-010 emission; the content-type is unchanged.

### §3.3 Credential sourcing & the transport seam

- REQ-F010-007 — **The credential is sourced from a NEW relay config key / env var, read as a raw single
  string.** The credential MUST be read from a new relay-scoped configuration value in the `EVENT_BUS_*`
  family (`EVENT_BUS_PEER_AUTH_TOKEN`, ruled 2026-07-22 as the agreed default, §8 Q1), in
  `bff/src/relay/config.ts`. It is read as a **raw
  single string value** — it is **NOT** comma-split and **NOT** whitespace-trimmed the way the
  `EVENT_BUS_URL` peer list is (REQ-F004-052's split/trim applies only to the peer list; the credential is
  delivered verbatim per REQ-F010-005). It MUST NOT be hard-coded, and MUST NOT be sourced from the BFF's
  engine/auth secrets (the relay deliberately does not import `bff/src/config.ts`; `config.ts` header
  comment). *Test:* setting the env var makes the credential available to the transport unmodified; a
  static scan finds no literal credential in source; the relay config module exposes the credential as a
  new key that is not passed through the peer-list split/trim.

- REQ-F010-008 — **The credential is threaded config → `createTransport` → `HttpPeerTransport` as a WIRE
  concern; the drainer never sees it (REQ-F004-049 seam preserved).** The credential MUST be passed from
  the relay config through the `createTransport` factory into `HttpPeerTransport` (mirroring how
  `peerTimeoutMs` is threaded today, `transport.ts`), and MUST remain owned entirely inside the transport.
  No credential, credential-header name, or auth logic may leak into the transport-agnostic
  drain/orchestration layer. *Test:* a static check confirms the drainer/orchestration module contains no
  credential value, credential-header constant, or auth logic; substituting a fake `EventTransport`
  (REQ-F004-049) still requires no drainer change and the drainer never receives the secret.

- REQ-F010-009 — **Credential scoping across peers (default: one shared secret applied to every configured
  peer).** For the October 2026 GTM configuration, cwa is the sole intended peer; the requirements adopt a
  **single shared-secret** applied to **all** configured peers. This is testable and sufficient for the
  known deployment, but it means that if a second, distinct peer were configured it would receive cwa's
  secret. Per-peer / per-destination credentials are **deferred** (§8 Q1/Q7). *Test:* with the credential
  configured, every peer POST carries the same credential header value; the spec records per-peer scoping
  as an open decision, not a built capability.

### §3.4 Confidentiality of the credential

- REQ-F010-010 — **The credential is NEVER placed in the event envelope (cwa REQ-F005-062 freeze holds).**
  The credential MUST NOT appear as a field of `AdminEventEnvelope`, `changes`, `target`, `payload`, or any
  other envelope member. `admin.user.created` MUST keep `changes = { username, role }` with no credential
  field and no new payload field. *Test:* the delivered envelope for `admin.user.created` is byte-for-byte
  the persisted envelope and contains no credential value; a scan of every emitted `admin.*` envelope shape
  shows no credential member.

- REQ-F010-011 — **The credential is NEVER written to logs, error messages, metrics, `/ready`, or the
  outbox.** The credential value MUST NOT appear in any log line, thrown/serialized error (including
  `TransportError` messages), metric label, `/ready` output, or any `event_outbox` column. Diagnostic
  output about a delivery may name the peer URL and the abstract outcome but MUST redact/omit the
  credential. *Test:* drive a delivery, a permanent park (401), and a boot with the credential set;
  scan all produced logs, error surfaces, metrics, `/ready`, and the outbox — the credential value appears
  in none of them.

### §3.5 Frozen contracts preserved

- REQ-F010-012 — **The envelope is delivered byte-for-byte; the catalog is unchanged.** F-010 MUST NOT
  reshape, re-redact, add to, or drop any envelope field, and MUST NOT add, rename, or remove any
  `admin.*` catalog name (`catalog.ts`: 21 names, 5 `admin.user.*`). *Test:* the bytes POSTed as the body
  equal the bytes persisted to `event_outbox`; `catalog.ts` is unchanged by F-010.

- REQ-F010-013 — **The REQ-F004-055 classifier semantics are unchanged.** F-010 MUST NOT edit the
  HTTP-response → permanent/transient mapping (2xx ack / all-5xx-408-429-network transient /
  all-other-4xx-any-3xx-any-other-non-2xx permanent). The credential change adds a header to the request;
  it does not alter how responses are classified. *Test:* the single-peer classification table of
  REQ-F004-055 (each outcome → ack/transient/permanent) is unchanged after F-010; a static check confirms
  `classifyStatus` is not modified in a way that changes any mapping.

### §3.6 Fan-out composition & parking behavior (must be verified, not a surprise)

- REQ-F010-014 — **A 401 from cwa classifies PERMANENT → immediate park (documented outcome).** A peer that
  rejects a delivery for a missing or wrong credential returns 401, which — per REQ-F004-055 — is in the
  **permanent** branch. `HttpPeerTransport.deliver()` MUST therefore reject **permanent** and the
  orchestration layer MUST park the ordering key **immediately** (no backoff retries), per
  REQ-F004-051(d)/-047/-014. This is the by-design consequence of a credential mismatch and MUST be
  captured as a verified, documented behavior rather than surfacing as a production surprise. *Test:*
  configure a peer that returns 401 (no/incorrect credential); `deliver()` rejects permanent, the row's
  `parked_at` is set immediately, `attempt_count` does not accumulate backoff retries, and the operator
  signal (park counter, REQ-F004-025) fires.

- REQ-F010-015 — **A row is published only after ALL peers ack; one peer's permanent outcome parks the
  ordering key for all peers.** Composing REQ-F004-051, F-010's addition of cwa as a (second) peer means an
  outbox row is marked `published_at` only when **every** configured peer returns 2xx; a permanent outcome
  from any not-yet-acked peer parks the whole ordering key regardless of what other peers acked (a
  partially-delivered park, REQ-F004-051(e)). Operators MUST be able to observe this outcome. *Test:* with
  two peers configured where one 2xx-acks and cwa returns 401, the row is **not** published, the ordering
  key parks immediately, the already-acked peer is not re-POSTed on any (nonexistent, because permanent)
  retry, and the park is surfaced as **partially delivered** (REQ-F004-051(e)/025) so operators know the
  acked peer holds a dedupable copy.

### §3.7 Operational documentation

- REQ-F010-016 — **A runbook covering peer registration, credential provisioning, and rotation is
  delivered.** No existing runbook mentions peers, secrets, or rotation. F-010 MUST deliver a runbook (per
  the repo docs convention, `docs/runbooks/F-010-*`) that documents, at minimum: (a) registering a peer in
  `EVENT_BUS_URL`; (b) provisioning the credential into the credential env var (REQ-F010-007) and where it
  is held (the deployment operator, §8 Q5); (c) rotating the credential — re-provision the credential env
  var and restart the relay, coordinated with cwa to avoid a 401 gap (§8 Q5); (d) the operator response to
  a permanent park caused by a peer (re-provision / restore the peer, then replay the parked rows for that
  key), including that partially-delivered parks are surfaced distinctly so acked peers' dedupable copies
  are known (REQ-F004-051(e), §8 Q6); and (e) a **deployment-validation step** that verifies a live
  `admin.user.*` delivery is accepted end-to-end by the **real cwa `/api/events/ingest` deployment** (the
  REQ-F010-024 part-(b) integration verification, now that cwa's endpoint is implemented). *Test:* the
  runbook exists under `docs/runbooks/` with an `F-010-` filename prefix and contains sections addressing
  (a)–(e).

---

## §4 Error Handling

- REQ-F010-017 — **Missing/empty credential while a peer is configured (default: fail-fast in
  production).** **"Unset or empty" is defined as:** the credential env var is **absent** OR is the
  **zero-length string** (`""`). A **whitespace-only** value (e.g. `" "`) is **NOT** treated as empty —
  it is a non-empty verbatim value that boots and is delivered as-is (REQ-F010-005); operators are warned
  in the runbook (REQ-F010-016) that a whitespace-only credential is almost certainly a misconfiguration,
  but it is well-defined, not a fail-fast trigger. In production bus mode, if a peer is configured
  (`EVENT_BUS_URL` non-empty) but the credential env var is unset or empty (as defined above), the relay
  MUST refuse to boot with a clear error naming the missing credential variable — mirroring the existing
  empty-peer-list fail-fast posture (REQ-F004-045, `config.ts:30-34`). This prevents the silent,
  self-inflicted 401 park loop that a credential-less peer would otherwise produce (REQ-F010-001). In
  **development** (`NODE_ENV != production`) the relay **boots soft** on an unset/empty credential — it
  starts (consistent with F-004's dev posture) and delivery to a credential-requiring peer parks per
  REQ-F010-014. This dev boot-soft posture is **normative** (not merely permitted) so the REQ-F010-024(b-
  missing) acceptance arm has a guaranteed precondition. **Boot-time header-legality validation (folds in
  review NOTE):** in **any** environment, if the credential value is present but contains bytes that are
  **illegal in an HTTP header field value**, the relay MUST refuse to boot with a clear error, rather than
  attempt a malformed request or silently drop the header; this validation is distinct from the empty-value
  check and is not environment-gated. The examples **CR, LF, and NUL are non-exhaustive illustrations** of
  the normative rule ("any byte illegal in an HTTP header field value"), not a closed list. This posture is
  the adopted default for §8 Q8 (ruled 2026-07-22: accepted). *Test:* in production with a peer configured and
  the credential var absent or `""`, the relay refuses to boot and the error names the credential variable;
  in production with the var set to a whitespace-only value, the relay boots (and sends the whitespace
  verbatim); in development with the var unset it boots (and delivery to a credential-requiring peer parks,
  per REQ-F010-014); in any environment with a credential containing a CR/LF/NUL byte the relay refuses to
  boot naming the illegal value.

- REQ-F010-018 — **A wrong or stale (mid-rotation) credential produces a permanent park, recoverable by
  re-provision + replay.** A credential that cwa rejects (401) yields the permanent park of REQ-F010-014.
  Recovery is not automatic: the operator re-provisions the correct credential and replays the parked rows
  for the affected key (F-004 park/replay machinery; runbook REQ-F010-016). *Test:* after a 401-induced
  park, re-provisioning the correct credential and replaying the parked row delivers it (peer now 2xx) and
  the row publishes; no envelope was lost (never a silent drop, REQ-F004-011).

- REQ-F010-019 — **Credential absence/misconfiguration never silently drops an event and never corrupts
  bookkeeping.** A missing, empty, or wrong credential MUST manifest only as (a) a boot refusal
  (REQ-F010-017) or (b) a delivery outcome (permanent park, REQ-F010-014) — never as a dropped event, a
  mangled envelope, or a wedged drainer for other ordering keys. *Test:* under each misconfiguration, the
  affected event is either never accepted for delivery (boot refusal) or parked and retained/queryable;
  other ordering keys keep flowing; no `event_outbox` row is deleted or marked published without an ack.

---

## §5 Non-Functional Requirements

- REQ-F010-020 — **Secret handling posture.** The credential MUST be supplied via the environment
  (`EVENT_BUS_*` family), never committed to source or fixtures. `bff/.env.example` MUST document the
  credential **key** with an **empty** value (as it does `EVENT_BUS_URL`), never a real secret. Any
  diagnostic surface that could include request detail MUST redact the credential (reinforcing
  REQ-F010-011). *Test:* the credential key appears in `.env.example` with an empty value; grep of the repo
  (excluding an operator's local, gitignored `.env`) finds no real credential literal; diagnostic output
  redacts it.

- REQ-F010-021 — **No regression to F-004.** F-010 MUST NOT change the transport-agnostic drainer, the
  `event_outbox` schema, the emitter (`emitAdminEvent`), the catalog, the envelope, or any mutating
  route/service. The existing relay unit suites and the multi-peer e2e fan-out journey (which runs at two
  peers) MUST continue to pass, updated only to account for the added credential header. *Test:* a static
  scan shows F-010 touches only the transport, its config wiring, `.env.example`, tests, and the runbook;
  the F-004 drain/order/retry/park suites pass unchanged in behavior; the 2-peer e2e passes with the
  credential header present.

- REQ-F010-022 — **No added round-trip or persisted state.** The credential MUST ride the existing single
  POST per peer; F-010 introduces no additional network round-trip per delivery and no new persisted
  (outbox/DB) state. *Test:* a delivery to a peer issues the same one POST it does today (now with the
  credential header); no new DB column or table is introduced by F-010.

- REQ-F010-023 — **Transport-swap boundary preserved (REQ-F004-049/050).** Adding the shared-secret
  credential MUST NOT break the broker-swap boundary: it is an `HttpPeerTransport`-internal wire concern, so
  a future `BrokerTransport` supplies its own equivalent auth behind the same `EventTransport` interface
  with zero churn above the seam. *Test:* substituting a fake/second `EventTransport` for
  `HttpPeerTransport` still requires no change to the drainer, emitter, outbox, routes, or envelope; the
  credential lives only in the HTTP transport and its config wiring.

- REQ-F010-024 — **Verifiability: e2e stub peer AND real-cwa integration (ruled "done" definition, §8 Q2,
  2026-07-22).** cwa's `/api/events/ingest` endpoint is **now implemented** (correcting the brief's
  2026-07-19/-20 "consumer absent / spec-text only" snapshot), so F-010's acceptance is **two-part**:
  **(a) in-repo automated acceptance against the existing e2e stub peer** — a stub that asserts the
  presence of the three application-level headers (REQ-F010-005, including the credential header) accepts
  (2xx) when the expected credential is present and returns 401 when it is wrong or absent-from-the-request,
  exercising both the happy path and the permanent-park path (REQ-F010-014); **and (b) an end-to-end
  integration verification against a real cwa deployment**, which is now possible and is therefore **no
  longer deferred**. Part (b) is captured as a **deployment-validation step in the F-010 runbook**
  (REQ-F010-016), not as an in-repo automated test (cwa is a separate deployment). cwa's F-005 spec
  (cwa REQ-F005-060..063, envelope freeze REQ-F005-062, delivery-id REQ-F005-011) remains the **contract of
  record**; F-010 derives **no** requirement from cwa's actual implementation behavior. **Environment
  pinning (resolves the REQ-F010-017 collision):** the 401→permanent-park
  arm is exercised via two distinct routes, because REQ-F010-017 makes a *missing* credential a
  **production boot refusal** (nothing boots, no POST, no 401):
  - **(a) Wrong credential — env-independent.** A **set-but-incorrect** credential boots in **either**
    NODE_ENV, is POSTed, and the stub returns 401 → immediate permanent park. This arm runs in the e2e
    default environment.
  - **(b) Missing credential — DEVELOPMENT (boot-soft) only.** An **absent/empty** credential with a peer
    configured is reachable **only** under `NODE_ENV != production` (boot-soft, REQ-F010-017); the relay
    boots, POSTs without the credential header, the stub returns 401 → immediate permanent park. Under
    `NODE_ENV=production` this arm is **unreachable by design** (the relay refuses to boot,
    REQ-F010-017) — asserted instead as a boot refusal, not as a 401 park.
  Verification against a real cwa deployment is **deferred** and gated on cwa's ingest endpoint existing
  (§8 Q2). *Test:* the e2e suite drives the stub peer through (a) correct credential → 2xx → row published
  (any env); (b-wrong) a set-but-incorrect credential → 401 → immediate permanent park (any env);
  (b-missing) in `NODE_ENV != production`, an absent credential → 401 → immediate permanent park; and, in
  `NODE_ENV=production`, an absent credential → **boot refusal** (REQ-F010-017), NOT a 401 park. Each
  delivering case asserts the three application-level headers are present (with the credential header being
  the one introduced by F-010, REQ-F010-005), not a literal total header count. The real-cwa integration
  (part (b)) is executed as the runbook deployment-validation step (REQ-F010-016), confirming a live
  `admin.user.*` delivery is accepted by the real cwa ingest endpoint.

---

## §6 Non-Goals

Seeded from the brief's Out of Scope. Each is a boundary a QA engineer can assert F-010 did **not** cross.

- REQ-F010-025 — **Relay transport hardening stays with D-006 (GH #16), per product-owner ruling
  2026-07-19.** HMAC or mTLS peer authentication, and https-only peer-URL scheme enforcement, are **out of
  scope**. F-010 ships the shared-secret credential cwa's REQ-F005-061 requires and no more; it does not
  redesign the relay's authentication model. *Test:* F-010 introduces no HMAC/mTLS signing and no
  peer-URL scheme validation; those remain D-006's scope.
- REQ-F010-026 — **Building or modifying cwa's `/api/events/ingest` or any cwa consumer logic is out of
  scope** (cwa F-005's scope). *Test:* F-010 changes no file under the customer-web-app repo.
- REQ-F010-027 — **Changing the event envelope, the `admin.user.created` `changes` shape, or adding
  payload fields is out of scope** (frozen by cwa REQ-F005-062; REQ-F010-010/012). *Test:* the envelope and
  catalog are unchanged.
- REQ-F010-028 — **Changing the REQ-F004-055 classifier semantics is out of scope** (REQ-F010-013). *Test:*
  the classification mapping is unchanged.
- REQ-F010-029 — **Broker-based transport, or any transport other than HTTP peers, is out of scope**
  (`EVENT_BUS_TRANSPORT=broker` still hard-refuses to boot, REQ-F004-052/`config.ts`). *Test:* F-010 adds
  no broker/non-HTTP transport.
- REQ-F010-030 — **Deployment topology artifacts (docker-compose / k8s / Dockerfile) are out of scope** —
  none exist in-repo. *Test:* F-010 introduces no such artifact.

---

## §7 Self-Check (analyst workflow step 5)

The requirements most at risk of divergent implementation are the credential's exact wire and config shape
(REQ-F010-005/007) and the parking consequence (REQ-F010-014/015). The wire/config shape is pinned to a
concrete header name, env-var name, "verbatim value", and a three-application-level-header outbound set; the
**names** (`X-Event-Auth-Token` / `EVENT_BUS_PEER_AUTH_TOKEN`) are now the ruled agreed default (§8 Q1), and
a later joint change with cwa would alter only the *names*, not the *shape*, so QA retains a stable pass/fail
target. The parking consequence is pinned to REQ-F004-055's exact 401→permanent mapping and REQ-F004-051's
fan-out rule, with concrete tests, so two implementers cannot both claim compliance with different behavior.
The boot posture on a missing credential (REQ-F010-017) adopts F-004's fail-fast-in-production /
boot-soft-in-development pattern (ruled, §8 Q8), keeping the REQ-F010-024 acceptance arms reachable.

---

## §8 Open Questions / Assumptions for Human Ruling

**Status: RULED (human ruling gate complete, 2026-07-22).** Q1, Q2, Q4, Q5, Q6, Q8, Q9 are **RESOLVED**
and folded into the requirements cited. Q3 and Q7 have **no default and remain explicitly DEFERRED with a
named owner** (not deleted). Q1–Q7 are the brief's seven questions; Q8–Q9 are analyst-added.

- Q1 — **Credential header name and env-var name, on BOTH sides.** cwa pins the delivery-id header exactly
  but named neither the header nor the env var for the shared secret; the single most likely source of a
  silent 401 loop. **RESOLVED (2026-07-22):** header `X-Event-Auth-Token`, env var
  `EVENT_BUS_PEER_AUTH_TOKEN` (REQ-F010-005/007), agreed as the default. A later joint change with cwa
  alters the **names only, not the wire/config shape**.
- Q2 — **Can F-010 be verified against a real cwa deployment, or only a stub?** **RESOLVED (2026-07-22),
  changing a factual premise:** cwa's `/api/events/ingest` endpoint is **now implemented** (correcting the
  brief's 2026-07-19/-20 "consumer absent / spec-text only" snapshot). "Done" = **(a)** in-repo automated
  acceptance against the e2e stub peer (three application-level headers incl. the credential + 401→
  permanent-park) **AND (b)** an end-to-end integration verification against a **real cwa deployment**,
  which is **no longer deferred** and is captured as a deployment-validation step in the runbook
  (REQ-F010-024, REQ-F010-016(e)). cwa's F-005 spec (cwa REQ-F005-060..063/062/011) remains the contract
  of record; F-010 derives no requirement from cwa's actual code behavior.
- Q3 — **What does October 2026 concretely require of this row?** 0 of 28 corpus matches connect the date
  to F-010, the peer list, or the cwa ingest endpoint, and two conflicting characterizations exist.
  **NO DEFAULT — DEFERRED (owner: product owner).** The GTM date is deliberately **not** encoded as a hard
  requirement (product-owner ruling: internal goal, concrete date unpinned). Retained here, not deleted.
- Q4 — **Does peer-scheme validation (rejecting `http://`) belong here or with D-006?** **RESOLVED
  (2026-07-22):** https-only / reject-`http://` enforcement stays with **D-006** (out of scope here,
  REQ-F010-025). **Security caveat kept visible:** the console today accepts plaintext `http://` peers
  (config does 0 scheme validation; all README examples are `http://`), so shipping a shared secret over a
  peer list that permits `http://` is a live exposure until D-006 lands.
- Q5 — **How is the credential rotated, and who holds it?** **RESOLVED (2026-07-22):** rotation =
  re-provision the credential env var + restart the relay, coordinated with cwa to avoid a 401 gap; holder
  = the deployment operator. Documented in the runbook (REQ-F010-016(b)/(c)).
- Q6 — **How should a permanent park caused by one peer be operated?** **RESOLVED (2026-07-22):** the
  runbook (REQ-F010-016(d)) directs the operator to restore/re-provision the peer, then replay the parked
  rows for that key; partially-delivered parks (REQ-F004-051(e)) are surfaced distinctly so acked peers'
  dedupable copies are known.
- Q7 — **Does D-006 need re-examination now that a second peer is contemplated?** D-006's recorded reach
  basis (`inproc`, empty peer list, transport inactive) no longer describes reality once cwa is on the
  wire, and a second peer changes D-006's blast radius. **NO DEFAULT — DEFERRED (owner: the human who owns
  D-006 / GH #16).** This spec proposes nothing about D-006's scoring. Relatedly, the per-peer-credential
  scoping deferral (REQ-F010-009) should be revisited if/when a second distinct peer is contemplated.
  Retained here, not deleted.
- Q8 — **(analyst-added) Boot posture when a peer is configured but the credential is unset/empty.**
  **RESOLVED (2026-07-22):** fail-fast in production (naming the missing var), boot-soft in development
  (REQ-F010-017), mirroring REQ-F004-045's empty-peer-list refusal — already reflected in
  REQ-F010-017/-024 and confirmed consistent.
- Q9 — **(analyst-added) Credential scoping across multiple peers.** **RESOLVED (2026-07-22):** a single
  shared secret for the single-peer (cwa) configuration; per-peer/per-destination credentials **deferred**
  (REQ-F010-009). **Disclosure-risk caveat kept:** sending cwa's secret to any future unrelated peer is a
  disclosure risk — revisit with Q7 when a second distinct peer is contemplated.

---

## §9 Revision History

- **Rev 1 (2026-07-22)** — Initial draft. Formalizes `briefs/F-010-deliver-admin-events-to-customer-web-app.md`.
  Establishes the `REQ-F010-###` namespace (REQ-F010-001..030). Specifies (i) cwa peer registration
  (§3.1), (ii) the new shared-secret credential path in the outbound transport and its config sourcing/seam
  handling (§3.2/§3.3), (iii) credential confidentiality — out of envelope, out of logs (§3.4), (iv) frozen
  contracts preserved (§3.5), (v) the fan-out/401-permanent-park consequence as verified behavior (§3.6),
  and (vi) the peer/credential/rotation runbook (§3.7). Carries the brief's seven Open Questions plus two
  analyst-added (Q8 boot posture, Q9 credential scoping) into §8, each with a recommended default where one
  was adopted and none silently resolved. The October 2026 GTM date is deliberately not encoded as a hard
  requirement (Q3). No prior sections to renumber (initial revision).
- **Rev 2 (2026-07-22)** — Resolves three BLOCKING spec-review ambiguities on rev 1, all in the credential
  requirements (the F-004 cross-refs reviewed clean); no REQ id renumbered or reused; append-only.
  Changes:
  - **REQ-F010-005** — Pinned the credential value as byte-for-byte verbatim with **no** whitespace-trim
    (REQ-F004-052's split/trim is peer-list-only; `" abc "` stays `" abc "`), and redefined the header-set
    assertion as the **three application-level** headers **in addition to** the client's transport-mandatory
    headers (`Host`, `Content-Length`, etc.), with F-010 introducing exactly one new application-level
    header — resolving the "exactly three headers of record" ambiguity.
  - **REQ-F010-007** — Clarified the credential is read as a **raw single string**, not comma-split or
    whitespace-trimmed like the peer list — resolving the verbatim-vs-trimmed collision with REQ-F010-005.
  - **REQ-F010-017** — Defined "unset or empty" precisely (env var absent OR zero-length `""`; whitespace-
    only is non-empty and boots verbatim), and folded in a boot-time **header-legality validation** clause
    (CR/LF/NUL → refuse to boot in any environment).
  - **REQ-F010-024** — Pinned NODE_ENV for the 401→park arms: the **wrong-credential** arm runs in either
    env; the **missing-credential**→401→park arm is **development-only** (boot-soft), while under
    production the missing case is asserted as a **boot refusal** (REQ-F010-017), not a 401 park —
    resolving the unsatisfiable/environment-unpinned collision. Carried the application-level header
    assertion (not a literal total count) into the acceptance tests.
  The nine Open Questions (§8) are unchanged and still route to the human ruling gate.
- **Rev 3 (2026-07-22)** — Applies the human ruling gate; no REQ id renumbered or reused; append-only.
  Question dispositions (§8): Q1/Q2/Q4/Q5/Q6/Q8/Q9 **RESOLVED**; Q3 and Q7 have **no default** and are
  **explicitly DEFERRED with named owners** (Q3 → product owner; Q7 → the D-006 / GH #16 owner), retained
  in §8 rather than deleted. Requirement changes:
  - **REQ-F010-024 (Q2, factual-premise change)** — cwa's `/api/events/ingest` is now implemented; "done"
    is now two-part — (a) in-repo stub acceptance AND (b) a real-cwa end-to-end integration verification,
    **no longer deferred**, captured as a runbook deployment-validation step. cwa's F-005 spec stays the
    contract of record; no requirement derived from cwa code behavior.
  - **REQ-F010-016 (Q2/Q5/Q6)** — Runbook scope expanded to name the credential holder (deployment
    operator), the rotation sequence (re-provision + relay restart coordinated with cwa), the
    partially-delivered-park operator response, and a new (e) real-cwa deployment-validation step.
  - **REQ-F010-005 / REQ-F010-007 (Q1)** — Default names `X-Event-Auth-Token` / `EVENT_BUS_PEER_AUTH_TOKEN`
    recorded as agreed (a later joint change alters names only, not shape).
  - **REQ-F010-005 (non-blocking clarifications 1 & 2)** — Scoped the three-application-level-header MUST
    to "when a credential is configured" (so it does not conflict with the REQ-F010-024(b-missing) dev
    two-header path), and added that byte-for-byte whitespace equality is asserted at the point the
    transport sets the header value (some clients strip surrounding whitespace in transit).
  - **REQ-F010-017 (non-blocking clarifications 3 & 4)** — Made the dev boot-soft posture **normative** so
    the REQ-F010-024(b-missing) acceptance precondition holds, and noted CR/LF/NUL are **non-exhaustive**
    illustrations of the header-legality rule.
  Q3 (GTM date) remains deliberately unencoded as a hard requirement.
