# D-006: Relay Peer HMAC Body Signing + Outbound SSRF/Host-Allowlist Hardening — Specification

Status: RULED rev 3 — applies the human ruling gate (2026-07-23): all seven §8 questions are RESOLVED and
folded into the requirements; §8 is marked RULED. Key ruling: **Q3 chose the simpler path and DROPPED the
timestamp / replay protection** — the signed input is the 3-part `v1\n<delivery-id>\n<body>` and the
timestamp-specific REQ-D006-006 (plus the §2 Timestamp-header definition) are marked **DEPRECATED** rather
than renumbered. Q6 added a **production-requires-an-allowlist** fail-fast (dev stays opt-in). Q7 pinned the
3-step operator-driven cut-over; the zero-gap dual-key rotation window is a new NON-GOAL deferred to
**F-014** (REQ-D006-038, the sole appended id). No REQ id renumbered or reused; append-only.
(rev 2 baseline — resolves the four BLOCKING determinism/testability findings from the rev-1 spec review;
no REQ id renumbered or reused; append-only. Tightened timestamp send-time semantics (then still adopted),
the allowlist host/port normalization rule (REQ-D006-013), allowlist activation on the parsed list
(REQ-D006-015), and one-tag-one-layout for `v1` (REQ-D006-004); folded in three non-blocking notes
(F-004-review F4 citation, unparseable-entry handling, "signature-requiring peer" definition). The seven
Open Questions were carried to the human ruling gate — now resolved in rev 3.)
(rev 1 baseline — for implementation and QA review. Formalizes the **two remaining legs** of D-006
(GH #16, "Event relay delivers `admin.*` envelopes to peers without authentication or TLS enforcement")
per the product-owner ruling (2026-07-23). Adopts recommended defaults for every open decision so the
requirements are testable; every open decision remains flagged in §8 for a human ruling gate. No default
silently resolves a decision the source findings or the product owner left open.)

Authoritative problem statements: `security/F-004-review.md` findings **F2** (auth / integrity / TLS —
the integrity remainder) and **F4** (no scheme/host allowlist on the outbound destination). GH #16
records the remediation framing ("HMAC over body + delivery id, or bearer, or mTLS"; "validate
`EVENT_BUS_URL` entries against an expected scheme/host shape at boot"). The `security/D-006-security-review.md`
[Informational] deferred-legs note ("per-message HMAC over the envelope + timestamp/nonce, and/or mTLS")
is the recorded residual this spec discharges.

**This spec covers ONLY the two D-006 legs that are NOT yet shipped:**
1. **Message authenticity/integrity via HMAC body signing** (F2 remainder — the bearer weakly proves the
   producer but there is no signature over the body, so a peer cannot detect tampering or forge-proof the
   origin).
2. **Outbound SSRF / host allowlist** (F4 — constrain `EVENT_BUS_URL` peer entries to an allowlisted
   host shape at boot; defense-in-depth).

**Two D-006 legs are ALREADY SHIPPED and are the BASELINE this spec builds on — they MUST NOT be
re-specified here** (see §1.2):
- **TLS enforcement (DONE):** `bff/src/relay/config.ts:75-92` fails fast at boot on any non-`https://`
  peer URL whenever a credential is configured or `NODE_ENV=production`.
- **Shared-secret bearer (DONE, F-010):** every outbound peer POST already carries the
  `X-Event-Auth-Token` header sourced from `EVENT_BUS_PEER_AUTH_TOKEN`
  (`bff/src/relay/http-peer-transport.ts:18,90-91`; spec `specs/F-010-deliver-admin-events-to-customer-web-app.md`).

This is a **backend / on-box infrastructure security-hardening** spec layered on F-004 and F-010. It
introduces a distinct requirement-ID namespace, **`REQ-D006-###`**, so its IDs never collide with the
parent `REQ-###`/`REQ-F004-###`/`REQ-F010-###` series. Section numbers (§1, §1.1, …) are **local to this
document**; downstream tests cite the globally-unique `REQ-D006-###` id plus the local §. Requirement IDs
and section numbers are **stable**: never renumber or reuse an id; append new ids or mark items
**DEPRECATED**. There is deliberately **no Web UI / UX section** (the browser cannot read the on-box bus;
F-004 parent REQ-029d).

Parent / composed specs (conventions and shared requirements this feature extends):
- `specs/F-004-production-event-bus.md` — the production `admin.*` relay. This spec composes with
  **REQ-F004-052** (`EVENT_BUS_URL` comma-list peer registration + `EVENT_BUS_TRANSPORT` selector),
  **REQ-F004-051** (multi-peer fan-out ack; permanent-peer rejection parks immediately),
  **REQ-F004-055** (HTTP-response → permanent/transient classification), **REQ-F004-049** (the
  transport-agnostic drainer ↔ `EventTransport` seam), and **REQ-F004-045** (empty-peer-list boot
  fail-fast, the style mirrored by every guard here). The SSRF leg's defense-in-depth scoping rests on the
  **`security/F-004-review.md` finding F4** provenance fact (the relay destination comes **only** from
  `EVENT_BUS_URL` env, never a request/route/DB value, so there is no runtime user-input → SSRF vector) —
  distinct from REQ-F004-028, which asserts the opposite direction (the browser never reads the bus / never
  receives `EVENT_BUS_URL`).
- `specs/F-010-deliver-admin-events-to-customer-web-app.md` — the shipped shared-secret bearer. This spec
  mirrors its cross-repo wire discipline (**REQ-F010-005/007** verbatim-value + new `EVENT_BUS_*` env key,
  **REQ-F010-008** the config→`createTransport`→`HttpPeerTransport` threading seam, **REQ-F010-011**
  credential-out-of-logs, **REQ-F010-014** the 401→permanent-park composition, **REQ-F010-016** the
  provisioning/rotation runbook, **REQ-F010-017** the missing-credential boot posture, **REQ-F010-022**
  no-added-round-trip). The HMAC is a **second wire element added alongside** the bearer, delivery-id, and
  body — specified with the same discipline F-010 applied to the bearer.

Cross-repo consumer contract (the seam this feature satisfies, NOT owned here):
`~/git/customer-web-app/specs/F-005-cross-app-identity-sync.md` §3.6 — cwa **REQ-F005-061** (the wire
elements it verifies at `/api/events/ingest`), **REQ-F005-063** (a 401 from cwa composes with this app's
REQ-F004-055 → permanent park). *(Where this document cites `REQ-F005-0xx` it means the customer-web-app
spec of that number, a distinct document from this repo's `specs/F-005-*`; the citation names cwa
explicitly to avoid collision.)* cwa's F-005 spec remains the **contract of record**; this document
derives **no** requirement from cwa's implementation behavior and specifies **only** the producer-side wire
contract plus the composition.

---

## §1 Overview & Scope

### §1.1 Purpose

With TLS enforced (the shipped D-006 TLS leg) and the F-010 shared-secret bearer on every POST, two F-004
security findings remain open:

- **F2 integrity remainder.** The `X-Event-Auth-Token` is a **static bearer** replayed verbatim to every
  peer. It weakly proves the producer *holds a secret*, but there is **no signature over the request body**,
  so a peer cannot detect that a delivered envelope was tampered with in transit, and any party who learns
  the reusable token (a malicious peer in the list, or anyone able to alter `EVENT_BUS_URL`) can forge
  `admin.*` events. A per-message HMAC over the delivered content binds authenticity *and* integrity to each
  request, so a captured static token alone is insufficient to forge a body-bound message.
- **F4 SSRF surface.** `config.ts` parses `EVENT_BUS_URL` with **no host allowlist**. The
  `security/F-004-review.md` **finding F4** confirmed the destination comes **only** from env (never a
  request/route/DB value), so there is **no runtime user-input → SSRF injection vector**; the residual is
  only that nothing constrains the env to allowlisted hosts (it could target an internal metadata endpoint).
  This leg is therefore **boot-time env validation as defense-in-depth**, not per-request egress filtering.

- REQ-D006-001 — **Scope: exactly two legs, layered on the shipped baseline.** This spec MUST add
  (i) HMAC body signing on the outbound peer POST (§3.1) and (ii) a boot-time outbound host allowlist for
  `EVENT_BUS_URL` (§3.2), and MUST NOT re-implement, weaken, or restate the already-shipped TLS scheme
  guard (`config.ts:75-92`) or the F-010 shared-secret bearer. *Test:* the implementation adds an HMAC
  signature path and a host-allowlist boot guard; a static scan shows the existing https-scheme guard and
  the `X-Event-Auth-Token` bearer path are unchanged in behavior by D-006.

- REQ-D006-002 — **The frozen contracts are preserved.** D-006 MUST NOT change the `AdminEventEnvelope`
  shape, the `admin.*` catalog (`bff/src/events/catalog.ts`), the delivery-id shape `<outbox-epoch>:<row-id>`
  (`x-event-delivery-id` header), or the REQ-F004-055 permanent/transient classifier semantics. The
  signature is **transport wire metadata** computed over already-frozen bytes; it is never an envelope
  field and never alters classification. *Test:* `catalog.ts`, the envelope shape, the delivery-id value
  shape, and the `classifyStatus` mapping are byte-for-byte unchanged by D-006.

### §1.2 Baseline already shipped — NOT re-specified here

The following are recorded as the **baseline** this spec assumes; they are **NON-goals to re-specify**
(§6, REQ-D006-033) and are cited only so the two new legs compose correctly:

- **TLS scheme enforcement (D-006 TLS leg, DONE).** `config.ts:82-92` refuses to boot on any peer whose
  scheme is not `https://` whenever `isCredentialConfigured(peerAuthToken) || isProduction`. This spec's
  host allowlist (§3.2) is an **additional, independent** boot guard that composes with — and does not
  replace — this scheme guard (REQ-D006-016).
- **Shared-secret bearer (F-010, DONE).** The `X-Event-Auth-Token` header carries the
  `EVENT_BUS_PEER_AUTH_TOKEN` value verbatim on every peer POST (REQ-F010-004/005). This spec's HMAC
  signature (§3.1) is a **distinct wire element added alongside** the bearer, using a **distinct key**
  (REQ-D006-007); it does not modify or reuse the bearer.

---

## §2 Definitions & Glossary

- **Peer** — an HTTP endpoint in the relay's `EVENT_BUS_URL` comma-list to which `HttpPeerTransport` POSTs
  each drained envelope (REQ-F004-052).
- **Envelope body** — the frozen `AdminEventEnvelope` JSON delivered as the POST body, byte-for-byte as
  persisted to `event_outbox` (REQ-F004-002 / REQ-F010-012). D-006 signs these bytes but never mutates them.
- **HMAC signature** — a keyed hash (**HMAC-SHA256**, RULED §8 Q2; §3.1) computed by the relay over a
  well-defined **canonical signing input** (REQ-D006-004) using the **signing key** (REQ-D006-007), carried
  to each peer as an added HTTP request header so the peer can independently recompute and constant-time
  compare it to authenticate the producer and detect body tampering.
- **Canonical signing input** — the exact, reproducible byte sequence the HMAC is computed over
  (REQ-D006-004): the **3-part `v1\n<delivery-id>\n<body>`** form (RULED §8 Q3 — no timestamp). It is
  defined precisely enough that cwa can reconstruct it and verify.
- **Signature header** — the outbound request header carrying the lowercase-hex signature. Its name is
  **`X-Event-Signature`** (RULED §8 Q1, agreed jointly with cwa).
- **Timestamp header** — **DEPRECATED (rev 3, RULED §8 Q3 — replay protection dropped).** A previously
  provisional `X-Event-Timestamp` header carrying a send-time timestamp for a peer freshness window. It is
  **NOT** emitted: the ruling drops the timestamp entirely (replay is absorbed by cwa's existing delivery-id
  dedupe). Retained here only so the term's removal is traceable; no requirement emits it.
- **Signing key** — the secret keying material for the HMAC, sourced from the **new** relay-scoped env var
  **`EVENT_BUS_PEER_SIGNING_KEY`** in the `EVENT_BUS_*` family (RULED §8 Q4). It is **distinct from** the
  F-010 bearer token (REQ-D006-007).
- **Host allowlist** — the boot-time set of permitted peer hosts against which each `EVENT_BUS_URL` entry
  is validated (§3.2): a new comma-list env var **`EVENT_BUS_PEER_ALLOWLIST`** (RULED §8 Q6).
- **Permanent park** — the F-004 outcome (REQ-F004-047/051(d)/055) in which a peer's non-retryable
  rejection (any 4xx incl. 401, any 3xx, any non-2xx-non-transient) causes `deliver()` to reject permanent
  and the orchestration layer to park the ordering key immediately, no backoff.
- **Signing required** — the boot state in which the relay MUST have a valid signing key configured or it
  refuses to boot (production posture, REQ-D006-010/021); mirrors the F-010 credential-required posture.
- **Signature-requiring peer** — a configured peer whose consumer verifies the HMAC signature and returns
  401 when the signature is absent, malformed, or invalid (i.e. cwa once its verification is deployed in
  require mode, REQ-D006-019). Delivery to such a peer without a valid signature yields the REQ-D006-018
  401→permanent park. The term describes the **peer's** verification posture; whether the **relay** attaches
  a signature is governed separately by the enable posture (REQ-D006-010).

---

## §3 Functional Requirements

### §3.1 HMAC body signing on the wire

- REQ-D006-003 — **The outbound peer POST carries an HMAC signature as an added wire element on the same
  single POST.** When signing is configured (REQ-D006-010), for each configured peer
  `HttpPeerTransport.deliver()` MUST attach the HMAC signature header (`X-Event-Signature`) to the **same
  single POST** that already carries the envelope body, the `x-event-delivery-id` header, and the
  `X-Event-Auth-Token` bearer. **No timestamp header is emitted** (RULED §8 Q3 — replay protection dropped;
  see REQ-D006-006 DEPRECATED). No additional request, round-trip, handshake, or persisted state is
  introduced (composing REQ-F010-022). *Test:* a signed delivery to a configured peer issues exactly one
  POST that contains all of: the byte-for-byte envelope body, the delivery-id header, the bearer header, and
  the signature header — and NO `X-Event-Timestamp` header — with no second network call made.

- REQ-D006-004 — **The canonical signing input is precisely defined and reproducible (RULED §8 Q3 — 3-part,
  no timestamp).** The HMAC MUST be computed over a canonical byte sequence that binds the **delivery-id and
  the exact request body bytes**. The canonical input is the UTF-8 concatenation, in order, joined by a
  single `\n` (0x0A) separator: `"v1"` (a version tag) `\n` `<x-event-delivery-id value>` `\n`
  `<raw envelope body bytes>`. The body bytes are the **exact** POST body (REQ-F004-002 frozen envelope),
  never a re-serialized or re-ordered form. **The version tag `v1` names exactly ONE byte layout: this
  3-part `v1\n<delivery-id>\n<body>` form.** A tag MUST map to exactly one layout — there is no second
  construction that also carries the `v1` tag; a future change to what is signed (e.g. re-introducing a
  timestamp or nonce) would be a **distinct version tag** (`v2`, …), never a redefinition of `v1`. *Test:*
  for a known key, delivery-id, and body, the produced signature equals an independently-computed HMAC over
  the documented 3-part `v1` canonical input; changing any one byte of the body (or the delivery-id) changes
  the signature; no delivery emits an `X-Event-Timestamp` header or a 4-part signing input.

- REQ-D006-005 — **Algorithm, encoding, and header name (RULED §8 Q1/Q2).** The signature MUST be
  **HMAC-SHA256** (RULED §8 Q2), encoded as **lowercase hexadecimal** (64 hex characters; RULED §8 Q2), and
  carried in the signature header **`X-Event-Signature`** (RULED §8 Q1, agreed jointly with cwa exactly as
  F-010 agreed the bearer header name). The value MUST be the encoded HMAC only (no key material, no envelope
  content). *Test:* the signature header is present on a signed delivery, its value is a 64-char lowercase
  hex string, and it verifies as HMAC-SHA256 over the canonical input (REQ-D006-004); a static check
  confirms the algorithm/encoding/header-name constants match the RULED values.

- REQ-D006-006 — **DEPRECATED (rev 3, RULED §8 Q3 — replay protection / timestamp DROPPED).** This
  requirement previously specified a signed send-time `X-Event-Timestamp` header for a peer freshness window.
  The human ruling gate chose the **simpler path** and **removed the timestamp and replay protection
  entirely**: no `X-Event-Timestamp` header is emitted (REQ-D006-003) and the canonical signing input is the
  3-part `v1\n<delivery-id>\n<body>` form (REQ-D006-004). **Rationale:** replay is absorbed by cwa's existing
  effectively-once dedupe on the delivery-id — a replayed valid delivery carries the same delivery-id and is
  collapsed to one effect at the consumer — so a producer-side freshness window is unnecessary, and the
  lower complexity is accepted. This id is retained (never reused/renumbered) so the removal is traceable;
  **no requirement here emits a timestamp.** *Test:* no delivery emits an `X-Event-Timestamp` header; the
  signed input is 3-part (REQ-D006-004).

- REQ-D006-007 — **The signing key is a NEW `EVENT_BUS_*` env var, distinct from the bearer, read as a raw
  string (RULED §8 Q4).** The signing key MUST be sourced from a **new** relay-scoped config value in the
  `EVENT_BUS_*` family (**`EVENT_BUS_PEER_SIGNING_KEY`**, RULED §8 Q4, `bff/src/relay/config.ts`), read
  as a **raw single string** — NOT comma-split or whitespace-trimmed the way the `EVENT_BUS_URL` peer list
  is. It MUST NOT reuse the `EVENT_BUS_PEER_AUTH_TOKEN` bearer value as the HMAC key (a signature keyed by
  the same secret the bearer already transmits adds no forgery resistance against a party who learned the
  bearer — the whole point of F2's remainder), MUST NOT be hard-coded, and MUST NOT be sourced from the
  BFF's engine/auth secrets (the relay deliberately does not import `bff/src/config.ts`; `config.ts` header
  comment). *Test:* setting the env var makes the key available to the transport; a static scan finds no
  literal key in source and confirms the HMAC key is the new value, not the bearer token; the key is not run
  through the peer-list split/trim.

- REQ-D006-008 — **The signing key is threaded config → `createTransport` → `HttpPeerTransport` as a WIRE
  concern; the drainer never sees it (REQ-F004-049 seam preserved).** The key MUST be passed from relay
  config through the `createTransport` factory into `HttpPeerTransport` (mirroring how `peerTimeoutMs` and
  `peerAuthToken` are threaded today, `transport.ts:39-53`), and MUST remain owned entirely inside the
  transport. No signing key, signing logic, signature-header constant, or algorithm choice may leak into the
  transport-agnostic drain/orchestration layer (`drainer.ts`). *Test:* a static check confirms the
  drainer/orchestration module contains no signing key, signing logic, or signature-header constant;
  substituting a fake `EventTransport` (REQ-F004-049) still requires no drainer change and the drainer never
  receives the key.

- REQ-D006-009 — **Key scoping across peers (RULED §8 Q4: one shared signing key for all peers).**
  A **single shared signing key** applies to **all** configured peers, matching the F-010 bearer scoping
  (REQ-F010-009) and the single-peer (cwa) GTM configuration. This means a second, distinct peer would
  receive signatures under the same key. Per-peer / per-destination signing keys are **deferred**
  (RULED §8 Q4/Q7), to be revisited if/when a second distinct peer is contemplated. *Test:* with a signing
  key configured, every peer POST carries a signature computed with the same key; the spec records per-peer
  key scoping as a deferred decision, not a built capability.

- REQ-D006-010 — **Enable posture: sign iff a key is configured; required in production when a peer is
  configured (RULED §8 Q5).** Mirroring the F-010 bearer posture (REQ-F010-017): the transport attaches a
  signature **iff** a signing key is configured (a non-empty string; `undefined`/`""` = unset, using an
  `isSigningConfigured` predicate analogous to the shipped `isCredentialConfigured`); and in **production**
  (`NODE_ENV=production`) with a peer configured (`EVENT_BUS_URL` non-empty) the signing key MUST be present
  or the relay refuses to boot (REQ-D006-021). In **development** the relay boots soft on an unset key (no
  signature attached; delivery to a signature-requiring peer parks per REQ-D006-018). *Test:* with a key
  set, every peer POST is signed; with no key set in dev, the POST carries no signature header; in
  production with a peer configured and no key set, the relay refuses to boot (REQ-D006-021).

- REQ-D006-011 — **The existing wire elements are unchanged.** D-006 MUST NOT change the
  `content-type: application/json` header, the `x-event-delivery-id` header name or value shape, the
  `X-Event-Auth-Token` bearer header, or the envelope body bytes. The signature header is **added alongside**
  them, never in place of them. F-010's REQ-F010-005 "three application-level headers when a credential is
  configured" assertion is **extended, not replaced**: when signing is also configured the outbound POST
  carries those three plus **exactly one** new application-level header (the `X-Event-Signature` header — and
  no timestamp header, RULED §8 Q3) — still in addition to whatever transport-mandatory headers the HTTP
  client attaches. *Test:* after D-006, the content-type, delivery-id, and bearer headers are identical to
  the pre-D006 emission; a peer stub asserts the added signature header is present alongside them and that
  no `X-Event-Timestamp` header is present, not requiring a literal total header count.

- REQ-D006-012 — **The signing key and signature material are NEVER placed in the envelope, logs, errors,
  metrics, `/ready`, or the outbox.** The signing key MUST NOT appear anywhere on the wire, in any log line,
  thrown/serialized error (including `TransportError` messages), metric label, `/ready` output, or any
  `event_outbox` column (mirroring REQ-F010-011 for the bearer). The signature **value** rides only its
  request header and MUST NOT be written to `last_error`, metrics, `/ready`, or the outbox. The signing key
  MUST NOT appear as a field of `AdminEventEnvelope` or any envelope member. *Test:* drive a signed
  delivery, a signature-mismatch permanent park (401), and a boot with the key set; scan all produced logs,
  error surfaces, metrics, `/ready`, and the outbox — the signing key value appears in none, and the
  signature value appears only on the request header, never in a persisted/diagnostic surface.

### §3.2 Outbound SSRF / host allowlist (boot-time, defense-in-depth)

- REQ-D006-013 — **`EVENT_BUS_URL` peer hosts are validated against an allowlist at boot (RULED §8 Q6).**
  The relay MUST validate, at boot, that every `EVENT_BUS_URL` peer entry's **host** is permitted by an
  allowlist. The allowlist source is a **new** relay-scoped env var **`EVENT_BUS_PEER_ALLOWLIST`** (RULED
  §8 Q6) — a comma-delimited list of allowed hosts (or `host:port`), parsed with the same split /
  per-entry-trim / drop-empty convention as `EVENT_BUS_URL`.

  **Deterministic EXACT match rule (RULED §8 Q6 — ONE rule, no implementation latitude).** Both sides are
  normalized through the **WHATWG URL host+port representation** before comparison, so the default HTTPS
  port 443 is elided **consistently on both sides**:
  - The **peer** side compares the peer URL's normalized authority = `url.host` (i.e. `url.hostname`
    lowercased, plus `:port` **only when `url.port` is non-empty** — the WHATWG parser elides a default
    `:443` on an `https://` URL so `url.port === ''` and `url.host` has no port).
  - Each **allowlist entry** is normalized the same way: parse it as the authority of an `https://` URL
    (`new URL('https://' + entry)`) and take that object's `.host` (hostname lowercased; default `:443`
    elided; any non-default port retained).
  - Match iff the peer's normalized `.host` **equals** an allowlist entry's normalized `.host`
    (case-insensitive is already guaranteed by the lowercasing). Exact match only; **no** wildcard/suffix
    matching by default.

  Consequences of this one rule (asserted by the example table): a **port-less** allowlist entry matches a
  peer on the **default 443 only** (because both normalize to a bare host); an explicit `:443` on either
  side is **elided** so `cwa.example:443` and `cwa.example` are the **same** normalized host and match; a
  **non-default** port must appear (and match) on both sides.

  | Allowlist entry | Peer URL | Normalized allow `.host` | Normalized peer `.host` | Result |
  |---|---|---|---|---|
  | `cwa.example` | `https://cwa.example/api/events/ingest` | `cwa.example` | `cwa.example` | **match → boot** |
  | `cwa.example` | `https://cwa.example:443/api/events/ingest` | `cwa.example` | `cwa.example` | **match → boot** (443 elided both sides) |
  | `cwa.example:443` | `https://cwa.example/api/events/ingest` | `cwa.example` | `cwa.example` | **match → boot** (443 elided both sides) |
  | `cwa.example` | `https://cwa.example:8443/api/events/ingest` | `cwa.example` | `cwa.example:8443` | **no match → refuse boot** (peer has non-default port) |
  | `cwa.example:8443` | `https://cwa.example:8443/api/events/ingest` | `cwa.example:8443` | `cwa.example:8443` | **match → boot** |
  | `other.example` | `https://cwa.example/api/events/ingest` | `other.example` | `cwa.example` | **no match → refuse boot** |

  The config source (the `EVENT_BUS_PEER_ALLOWLIST` env var) and **EXACT** (not suffix/wildcard) match rule
  are **RULED §8 Q6**; the match rule above is fixed to a single deterministic form so two implementers
  cannot diverge. **Malformed allowlist ENTRY handling (NOTE-B):** if a **non-empty** allowlist entry that
  survived the split/trim/drop-empty parse (REQ-D006-015) cannot be parsed by the WHATWG URL parser into a
  `.host` (e.g. `cwa example` with an embedded space, or another unparseable authority), the relay MUST
  **fail closed — refuse to boot, naming the raw offending allowlist entry** — rather than silently drop it
  or treat it as matching nothing/everything (mirroring REQ-D006-014's unparseable-peer-entry handling). The
  error MUST NOT include the signing key or bearer value. *Test:* each row of the table above is asserted
  (the peer boots or refuses exactly as the Result column states); a peer whose normalized `.host` is absent
  from the normalized allow-set refuses to boot (REQ-D006-014); a non-empty but unparseable allowlist entry
  (e.g. `cwa example`) refuses to boot and the error names that raw entry.

- REQ-D006-014 — **Fail-fast at boot on a peer host outside the allowlist, naming the offending host.** When
  the allowlist is active (REQ-D006-015) and any `EVENT_BUS_URL` entry's host is not permitted, the relay
  MUST refuse to boot with a clear error that **names the offending host** (mirroring the empty-peer-list
  fail-fast REQ-F004-045 and the non-https scheme fail-fast `config.ts:82-92`). The error MUST iterate the
  whole peer list so one bad entry among good ones still refuses boot. **Unparseable-entry handling:** if a
  peer entry cannot be parsed into a host by the WHATWG URL parser used for the REQ-D006-013 normalization
  (so no host can be extracted to compare), the relay MUST likewise **refuse to boot, naming the raw
  offending entry** (fail closed) rather than silently skip it or attempt an unresolved match — an
  unparseable peer is treated as not-permitted, not as absent. The error MUST NOT include the signing key or
  bearer value. *Test:* a mixed peer list with one disallowed host refuses to boot and the error names that
  host; a peer entry that fails to parse into a host refuses to boot and the error names the raw entry; the
  signing key and bearer do not appear in the message.

- REQ-D006-015 — **Activation posture keyed to the PARSED list: dev opt-in, production REQUIRED (RULED
  §8 Q6, with the override).** Activation is decided on the **PARSED allow-set — after applying the same
  split (`,`) / per-entry `trim()` / drop-empty filter used for `EVENT_BUS_URL` — NOT the raw env string.**
  A "parse-empty" value is: the var absent, `""`, `" "`, `","`, `", ,"`, or any all-whitespace/all-separator
  value that yields zero surviving host entries.
  - **Development (`NODE_ENV != production`): opt-in.** The allowlist check is **active iff the parsed
    allow-set is non-empty.** A parse-empty value → the allowlist is **INACTIVE → the relay boots** and
    refuses no peers (preserving the pre-D006 baseline). This removes the `" "` → "active with empty
    allow-set → every peer refused" ambiguity: in dev an all-whitespace value is inactive, never a
    boot-refusing empty allow-set.
  - **Production (`NODE_ENV=production`) with a peer configured (`EVENT_BUS_URL` non-empty): REQUIRED.** A
    parse-empty (absent or whitespace-only) `EVENT_BUS_PEER_ALLOWLIST` MUST **refuse to boot with a clear
    error naming the missing variable** (fail-fast, mirroring the production empty-peer-list REQ-F004-045,
    the missing-credential REQ-F010-017, and the non-https scheme `config.ts:82-92` guards). In production an
    allowlist is not optional once a peer is configured. When the parsed allow-set is non-empty, the
    REQ-D006-013/-014 exact-match validation applies in every environment.
  *Test:* in **development** with `EVENT_BUS_PEER_ALLOWLIST` unset, `""`, `" "`, `","`, or `", ,"`, the
  relay boots unchanged from the allowlist-disabled baseline (no peer refused); in **production** with a
  peer configured and the var parse-empty, the relay **refuses to boot naming the variable**; in any
  environment a non-empty parsed allow-set activates the REQ-D006-014 exact-match fail-fast.

- REQ-D006-016 — **The allowlist is boot-time env validation, NOT per-request egress filtering — scoped by
  F-004-review F4.** Because the relay destination comes **only** from `EVENT_BUS_URL` env and never from a
  request/route/DB value (`security/F-004-review.md` finding F4), D-006 MUST implement this leg as
  **boot-time validation of the env-sourced peer list only**. It MUST NOT add per-request URL filtering, a
  runtime egress proxy, or any per-delivery destination check (there is no runtime user-input → SSRF vector
  to filter). The allowlist guard MUST compose with the shipped non-https scheme guard as a **second,
  independent boot-time peer-URL check** over the same `config.peerUrls` array (`config.ts:82-92`), not a
  replacement of it. *Test:* a static scan shows the allowlist check runs only at config/boot time over the
  env peer list; no per-request destination filtering is added; the F-004-review F4 provenance premise (the
  destination is env-only, never a route/request/DB value) still holds.

### §3.3 Cross-repo wire contract & composition (producer side only)

- REQ-D006-017 — **The wire format is specified precisely enough for cwa to verify; cwa's verification
  implementation is OUT OF SCOPE.** This spec MUST pin, on the producer side, exactly: what bytes are signed
  (REQ-D006-004 — the 3-part `v1\n<delivery-id>\n<body>`, no timestamp), the algorithm (REQ-D006-005), the
  encoding (REQ-D006-005), and the signature header name (REQ-D006-005). cwa's implementation of signature
  **verification** at `/api/events/ingest` (recomputing the HMAC, constant-time comparing) is **owned by
  cwa** (cwa F-005), exactly as F-010 treated cwa's ingest endpoint (REQ-F010-026). This document derives
  **no** requirement from cwa's implementation behavior. *Test:* the §3.1 requirements fully determine the
  produced bytes for a given key/delivery-id/body such that an independent verifier can reproduce them;
  D-006 changes no file under the customer-web-app repo.

- REQ-D006-018 — **A bad or missing signature yields cwa 401 → PERMANENT park (composes REQ-F004-055,
  same design as F-010's credential mismatch).** A peer that rejects a delivery for a missing or invalid
  signature returns 401, which — per REQ-F004-055 — is in the **permanent** branch, so
  `HttpPeerTransport.deliver()` rejects permanent and the orchestration layer parks the ordering key
  **immediately** (no backoff), and — in a multi-peer fan-out — parks the whole key even if another peer
  acked (REQ-F004-051(d)/(e), surfaced as a partially-delivered park, REQ-F004-025). This is the by-design
  consequence of a signature mismatch and MUST be captured as verified, documented behavior (mirroring
  REQ-F010-014/015), not surface as a production surprise. *Test:* configure a stub peer that returns 401 on
  a bad/absent signature; a signed-but-wrong (or unsigned-but-required) delivery makes `deliver()` reject
  permanent, `parked_at` is set immediately, `attempt_count` accrues no backoff retries, and the park
  counter (REQ-F004-025) fires.

- REQ-D006-019 — **Coordination sequencing: the 3-step cross-repo cut-over (RULED §8 Q7).** Because a
  signature the consumer does not yet verify is harmless, but a signature the relay *requires* while the
  consumer rejects unsigned/legacy requests would 401→**permanent-park every delivery** (composing
  REQ-F004-055), enabling signing MUST follow this ordered sequence:
  1. **cwa deploys verification in accept-but-don't-require mode** — cwa accepts both signed and
     as-yet-unsigned deliveries (cwa-owned; referenced, not specified here — cwa F-005).
  2. **the relay enables signing** — the deployment operator provisions `EVENT_BUS_PEER_SIGNING_KEY` so the
     transport attaches `X-Event-Signature` to every peer POST (this repo's step; REQ-D006-010).
  3. **cwa flips to require** — cwa rejects (401) any delivery lacking a valid signature (cwa-owned;
     referenced, not specified).
  Any other order park-every-delivery. Steps 1 and 3 are **cwa-owned** and are referenced only; **step 2 is
  this spec's**. The producer's signing is controlled solely by the presence of the signing key
  (REQ-D006-010), so it can be enabled/disabled without a code change. The sequence is driven by the
  deployment operator per the runbook (REQ-D006-020), which includes an explicit "confirm signed traffic is
  healthy" gate between steps 2 and 3. This mirrors F-010's Q2 "can this be verified before the consumer
  verifies" concern. *Test:* the runbook (REQ-D006-020) documents the 3-step sequence with the between-steps
  operator health gate; the producer's signing toggles solely on the presence of the signing key with no
  code change.

### §3.4 Operational documentation

- REQ-D006-020 — **A runbook for signing-key provisioning and rotation is delivered (mirrors REQ-F010-016).**
  D-006 MUST deliver a runbook (per the repo docs convention, `docs/runbooks/D-006-*`) documenting, at
  minimum: (a) provisioning the signing key into `EVENT_BUS_PEER_SIGNING_KEY` and where it is held (the
  **deployment operator**, never committed to source); (b) rotating the signing key — a **simple coordinated
  re-provision + relay restart** (RULED §8 Q4/Q7), documenting the brief coordination window with cwa needed
  to avoid a signature-mismatch (401) park gap (a **zero-gap dual-key transition window is explicitly out of
  scope**, deferred to F-014 — REQ-D006-038); (c) the **3-step cut-over sequence** of REQ-D006-019
  (1: cwa accept-but-don't-require → 2: relay enables signing → 3: cwa requires), **operator-driven, with an
  explicit "confirm signed traffic is healthy" gate between steps 2 and 3** before cwa is asked to flip to
  require; (d) configuring `EVENT_BUS_PEER_ALLOWLIST` (including that production requires it, REQ-D006-015)
  and the operator response to an allowlist boot refusal (REQ-D006-014); and (e) the operator response to a
  signature-mismatch permanent park (re-provision the correct key, replay the parked rows for that key, per
  REQ-F004 park/replay machinery). *Test:* the runbook exists under `docs/runbooks/` with a `D-006-`
  filename prefix and contains sections addressing (a)–(e), including the between-steps-2-and-3 health gate.

---

## §4 Error Handling

- REQ-D006-021 — **Missing/misconfigured signing key while signing is required (RULED §8 Q5: fail-fast in
  production, boot-soft in development).** "Unset or empty" is defined as: the
  `EVENT_BUS_PEER_SIGNING_KEY` env var is **absent** OR the **zero-length string** (`""`), reusing the
  F-010 `isCredentialConfigured` semantics (a whitespace-only key is a non-empty value that boots, though
  it is almost certainly a misconfiguration and MUST be warned against in the runbook). In **production** bus
  mode, if a peer is configured (`EVENT_BUS_URL` non-empty) and signing is required by the adopted posture
  (REQ-D006-010) but the signing key is unset/empty, the relay MUST refuse to boot with a clear error
  **naming the missing variable** — mirroring the F-010 missing-credential fail-fast (REQ-F010-017,
  `config.ts:68-73`). In **development** the relay boots soft (no signature attached; delivery to a
  signature-requiring peer parks per REQ-D006-018). Unlike the bearer, the signing key is **not** placed in
  an HTTP header, so there is **no header-legality boot check** for it (the analog of REQ-F010-017's
  CR/LF/NUL check does not apply — the key is HMAC input, not a header value). *Test:* in production with a
  peer configured and the key absent/`""`, the relay refuses to boot naming the variable; in development
  with the key unset it boots (unsigned) and delivery to a signature-requiring peer parks.

- REQ-D006-022 — **A wrong or stale (mid-rotation) signing key produces a permanent park, recoverable by
  re-provision + replay.** A signing key that produces a signature cwa rejects (401) yields the permanent
  park of REQ-D006-018. Recovery is not automatic: the operator re-provisions the correct key (coordinated
  with cwa per REQ-D006-020(b)) and replays the parked rows for the affected key. *Test:* after a
  signature-mismatch park, re-provisioning the correct key and replaying the parked row delivers it (peer
  now 2xx) and the row publishes; no envelope was lost (never a silent drop, REQ-F004-011).

- REQ-D006-023 — **Signing/allowlist misconfiguration never silently drops an event and never corrupts
  bookkeeping.** A missing, wrong, or mis-scoped signing key, and a disallowed peer host, MUST manifest only
  as (a) a boot refusal (REQ-D006-021 / REQ-D006-014) or (b) a delivery outcome (permanent park,
  REQ-D006-018) — never as a dropped event, a mutated envelope, or a wedged drainer for other ordering keys
  (mirrors REQ-F010-019). *Test:* under each misconfiguration, the affected event is either never accepted
  for delivery (boot refusal) or parked and retained/queryable; other ordering keys keep flowing; no
  `event_outbox` row is deleted or marked published without an ack.

- REQ-D006-024 — **An allowlist rejection is a boot refusal, never a runtime drop.** Because the allowlist
  is boot-time only (REQ-D006-016), a disallowed peer host MUST be caught at boot (REQ-D006-014) and MUST
  NOT manifest as a per-delivery runtime failure, park, or silent skip. *Test:* a disallowed host is
  rejected at boot; no code path filters or drops a delivery at runtime based on the allowlist.

---

## §5 Non-Functional Requirements

- REQ-D006-025 — **Secret handling posture for the signing key.** The signing key MUST be supplied via the
  environment (`EVENT_BUS_*` family), never committed to source or fixtures. `bff/.env.example` MUST
  document the signing-key **key** (and the `EVENT_BUS_PEER_ALLOWLIST` key) with **empty** values, never a
  real secret (as it does `EVENT_BUS_URL` / `EVENT_BUS_PEER_AUTH_TOKEN`). Any diagnostic surface that could
  include request detail MUST redact the key and signature (reinforcing REQ-D006-012). *Test:* the new keys
  appear in `.env.example` with empty values; a repo grep (excluding an operator's gitignored `.env`) finds
  no real key literal; diagnostic output redacts them.

- REQ-D006-026 — **No added round-trip or persisted state.** The signature header MUST ride the existing
  single POST per peer; D-006 introduces no additional network round-trip per delivery and no new persisted
  (outbox/DB) state (composing REQ-F010-022). *Test:* a signed delivery issues the same one POST per peer
  (now with the added signature header); no new DB column or table is introduced by D-006.

- REQ-D006-027 — **No regression to F-004 or F-010.** D-006 MUST NOT change the transport-agnostic drainer,
  the `event_outbox` schema, the emitter (`emitAdminEvent`), the catalog, the envelope, the delivery-id, the
  REQ-F004-055 classifier, the shipped https-scheme guard, or the F-010 bearer path. The existing relay unit
  suites and the multi-peer e2e fan-out journey MUST continue to pass, updated only to account for the added
  signature header. *Test:* a static scan shows D-006 touches only the transport, its config
  wiring, `.env.example`, tests, and the runbook; the F-004/F-010 drain/order/retry/park/bearer/scheme
  suites pass unchanged in behavior; the multi-peer e2e passes with the signature header present.

- REQ-D006-028 — **Transport-swap boundary preserved (REQ-F004-049/050).** The HMAC signing MUST be an
  `HttpPeerTransport`-internal wire concern, so a future `BrokerTransport` supplies its own equivalent
  message-authenticity behind the same `EventTransport` interface with zero churn above the seam. *Test:*
  substituting a fake/second `EventTransport` for `HttpPeerTransport` requires no change to the drainer,
  emitter, outbox, routes, or envelope; the signing key and signing logic live only in the HTTP transport
  and its config wiring.

- REQ-D006-029 — **Signing cost is bounded and in-process.** Producing the signature MUST be exactly one
  in-process HMAC-SHA256 computation over the canonical input per peer POST (REQ-D006-004), with **no**
  added I/O, network call, or persisted read/write, so the added per-delivery latency is a single hash over
  the body and is negligible relative to the existing network POST. *Test:* a static/trace check confirms
  each peer POST computes at most one HMAC and performs no additional I/O for signing; a benchmark (if run)
  shows no material added latency versus the pre-D006 delivery.

- REQ-D006-030 — **Verifiability: in-repo e2e stub peer AND real-cwa integration (mirrors REQ-F010-024).**
  D-006 acceptance is two-part: **(a) in-repo automated acceptance against an e2e stub peer** — a stub that
  recomputes the HMAC over the documented canonical input (REQ-D006-004) accepts (2xx) when the signature is
  present and valid, and returns 401 when the signature is absent, malformed, or computed with the wrong key
  — exercising both the happy path and the permanent-park path (REQ-D006-018); **and (b) an end-to-end
  integration verification against a real cwa deployment**, captured as a **deployment-validation step in
  the D-006 runbook** (REQ-D006-020), NOT an in-repo automated test (cwa is a separate deployment) and
  **sequenced by the RULED 3-step cut-over** (REQ-D006-019 step 3 — cwa flipped to require; §8 Q7). *Test:*
  the e2e suite drives the stub through (correct signature → 2xx → row published) and (absent/wrong
  signature → 401 → immediate permanent park); the real-cwa integration is executed as the runbook
  deployment-validation step.

---

## §6 Non-Goals

Each is a boundary a QA engineer can assert D-006 did **not** cross.

- REQ-D006-031 — **mTLS is out of scope (considered, deferred — needs cert infrastructure not in-repo).**
  Mutual-TLS peer authentication was considered as an alternative to HMAC and **deferred**: it requires
  client-certificate issuance, distribution, trust-store, and rotation infrastructure that does not exist in
  this repo, whereas HMAC body signing reuses the existing single-POST env-configured model. D-006 ships
  HMAC, not mTLS. *Test:* D-006 introduces no client certificate, custom TLS `Agent`, `checkServerIdentity`
  override, or mTLS handshake; the recorded alternative-considered rationale is documented here.

- REQ-D006-032 — **The F3 inbound relay HTTP-surface hardening is out of scope.** Binding/auth of the
  relay's `/ready` and `/metrics` endpoints (currently `0.0.0.0`, F-004-review F3) is a separate
  **inbound-surface** concern and is not addressed here. *Test:* D-006 changes no `/ready` or `/metrics`
  bind address or auth.

- REQ-D006-033 — **Re-specifying the shipped TLS enforcement or the F-010 shared-secret bearer is out of
  scope.** The non-https scheme guard (`config.ts:75-92`) and the `X-Event-Auth-Token` bearer (F-010) are
  the shipped baseline (§1.2); D-006 builds on them and does not restate, weaken, or re-implement them.
  *Test:* the shipped scheme guard and bearer path are unchanged in behavior by D-006.

- REQ-D006-034 — **Changing the event envelope, `admin.*` catalog, delivery-id shape, or the REQ-F004-055
  classifier semantics is out of scope** (REQ-D006-002). *Test:* the envelope, catalog, delivery-id shape,
  and classifier mapping are unchanged.

- REQ-D006-035 — **Implementing cwa's signature verification (or any cwa consumer logic) is out of scope**
  (cwa F-005's scope; REQ-D006-017). *Test:* D-006 changes no file under the customer-web-app repo.

- REQ-D006-036 — **Per-request / runtime SSRF egress filtering is out of scope.** The SSRF leg is boot-time
  env validation only (REQ-D006-016), because there is no runtime user-input → SSRF vector
  (`security/F-004-review.md` finding **F4**; REQ-F004-028 asserts the opposite direction — the browser
  never reads the bus — and is not the provenance premise here). *Test:* D-006 adds no per-delivery
  destination filter, egress proxy, or runtime URL check.

- REQ-D006-037 — **Confidentiality of the envelope beyond TLS is out of scope.** The HMAC provides
  **authenticity and integrity**, not confidentiality; body confidentiality is provided by the shipped TLS
  enforcement (§1.2). D-006 adds no payload encryption. *Test:* D-006 introduces no envelope-body encryption
  or additional confidentiality mechanism.

- REQ-D006-038 — **A dual-key / zero-gap rotation transition window is out of scope — deferred to F-014
  (RULED §8 Q4/Q7).** A rotation mode in which cwa accepts the **old OR new** signing key simultaneously so
  the key can rotate with **zero park gap** is **explicitly out of scope** of D-006. D-006 ships **simple
  coordinated rotation** (re-provision + relay restart, with a brief coordination window that may 401→park
  in-flight deliveries until both sides are on the new key; recoverable by replay, REQ-D006-022). The
  zero-gap dual-key capability is logged as **F-014** in `feature-value-scoring.xlsx` (status Idea). *Test:*
  D-006 introduces no dual-key / accept-both-keys rotation mechanism; the runbook (REQ-D006-020(b)) documents
  simple coordinated rotation and names F-014 as the deferred zero-gap successor.

---

## §7 Self-Check (analyst workflow step 5)

The requirements most at risk of divergent implementation are the **canonical signing input**
(REQ-D006-004) and the **enable/boot posture** (REQ-D006-010/021/015), because two engineers could sign
different byte sequences (e.g. body only vs delivery-id+body, different delimiters) and both claim "HMAC
over the body." These are now pinned by the RULED decisions to a single versioned construction
(`v1\n<delivery-id>\n<body>` — no timestamp, RULED §8 Q3), a named algorithm (HMAC-SHA256), a named
encoding (lowercase hex), and named header/env-var constants (`X-Event-Signature` /
`EVENT_BUS_PEER_SIGNING_KEY` / `EVENT_BUS_PEER_ALLOWLIST`), each with a reproducible byte-for-byte test
target, so QA has a stable pass/fail signature. With Q3 ruled, `v1` names exactly one layout and no
cross-version ambiguity remains. The 401→permanent-park composition is pinned to REQ-F004-055 + REQ-F004-051
with concrete tests, so two implementers cannot both claim compliance with different parking behavior. The
allowlist match rule (WHATWG `.host` exact, RULED §8 Q6) and its dev-opt-in / production-required activation
(REQ-D006-015) are pinned with a worked example table and enumerated parse-empty cases. The SSRF leg is
pinned to **boot-time env validation only** (not per-request), removing the ambiguity of "where does the
allowlist run."

---

## §8 Open Questions / Assumptions for Human Ruling

**Status: RULED (human ruling gate complete, 2026-07-23).** All seven questions are **RESOLVED** and folded
into the requirements cited; none remains open. The recorded defaults are now binding decisions, not
provisional adoptions.

- Q1 — **Signature header name (joint with cwa).** **RULED (2026-07-23): ACCEPT** — `X-Event-Signature`
  (REQ-D006-005), agreed jointly with cwa. A later joint change would alter the name only, not the
  canonical-input shape.
- Q2 — **HMAC algorithm and output encoding.** **RULED (2026-07-23): ACCEPT** — HMAC-**SHA256**,
  **lowercase hex** (64 chars) (REQ-D006-005). Base64 was considered; hex chosen for unambiguous,
  case-stable constant-time compare.
- Q3 — **Exactly what is signed, and replay protection (timestamp/nonce?).** **RULED (2026-07-23): SIMPLER
  PATH — DROP the timestamp / replay protection.** The `X-Event-Timestamp` header and the send-time
  timestamp are removed entirely; the signed canonical input is the **3-part `v1\n<delivery-id>\n<body>`**,
  now the single `v1` layout (REQ-D006-004; the timestamp-specific REQ-D006-006 and the §2 Timestamp-header
  definition are marked **DEPRECATED**). **Rationale:** replay is absorbed by cwa's existing delivery-id
  dedupe — a replayed valid delivery is a duplicate cwa drops — so a producer-side freshness window is
  unnecessary; the lower complexity is accepted. This also retires the reviewer's cross-version `v1`
  ambiguity concern (one tag, one layout).
- Q4 — **Signing-key env var name; per-peer vs shared; provisioning + rotation.** **RULED (2026-07-23):
  ACCEPT** — new `EVENT_BUS_PEER_SIGNING_KEY` (distinct from the bearer, REQ-D006-007), a **single shared**
  key for all peers (REQ-D006-009), operator-provisioned, rotated via **simple coordinated re-provision +
  relay restart** (REQ-D006-020(b)). Per-peer keys **deferred**; the zero-gap dual-key rotation window is
  **out of scope, deferred to F-014** (REQ-D006-038).
- Q5 — **Is HMAC always-required-when-configured, or strictly prod-gated?** **RULED (2026-07-23): ACCEPT** —
  sign iff the signing key is configured; **require** the key in production when a peer is configured
  (fail-fast, mirroring the F-010 bearer/https guards), boot-soft in development (REQ-D006-010/021).
- Q6 — **SSRF allowlist config shape/source and activation posture.** **RULED (2026-07-23) with an
  override:** (a) the `EVENT_BUS_PEER_ALLOWLIST` env var with **EXACT** (not suffix/wildcard) WHATWG-`.host`
  case-insensitive match + the worked example table (REQ-D006-013); (b) **production REQUIRES an allowlist**
  — with a peer configured and the parsed allow-set empty, `NODE_ENV=production` **refuses to boot** naming
  the missing var, while development stays **active-iff-set (opt-in)** (REQ-D006-015).
- Q7 — **cwa coordination sequencing.** **RULED (2026-07-23): accept the 3-step rollout; keep rotation
  simple; defer dual-key.** The safe cut-over is the ordered 3-step sequence (1: cwa accept-but-don't-require
  → 2: relay enables signing → 3: cwa flips to require), any other order park-every-delivery (composing
  REQ-F004-055); steps 1 & 3 are cwa-owned (referenced), step 2 is this spec's (REQ-D006-019). **Owner:** the
  **deployment operator**, driven by the runbook, with an explicit "confirm signed traffic is healthy" gate
  between steps 2 and 3 (REQ-D006-020(c)). Rotation stays simple coordinated re-provision + restart; a
  dual-key zero-gap window is **out of scope, deferred to F-014** (REQ-D006-038).

---

## §9 Revision History

- **Rev 1 (2026-07-23)** — Initial draft, for implementation and QA review. Formalizes the two remaining
  D-006 legs (GH #16) per the product-owner ruling (2026-07-23): (i) HMAC body signing for message
  authenticity/integrity (§3.1, the F-004-review F2 remainder) and (ii) a boot-time outbound host allowlist
  (§3.2, F-004-review F4, scoped to defense-in-depth by REQ-F004-028). Establishes the `REQ-D006-###`
  namespace (REQ-D006-001..037). Records the shipped TLS scheme guard and the F-010 shared-secret bearer as
  the **baseline** (§1.2) and explicitly non-goals to re-specify (REQ-D006-033). Specifies the producer-side
  cross-repo wire contract precisely enough for cwa to verify while marking cwa's verification OUT OF SCOPE
  (REQ-D006-017), and the 401→permanent-park composition with REQ-F004-055 (REQ-D006-018). Records mTLS as a
  considered-and-deferred alternative/non-goal (REQ-D006-031). Carries seven Open Questions into §8, each
  with a recommended testable default (Q1 header name, Q2 algorithm/encoding, Q3 signed-input/replay,
  Q4 signing-key name/scope/rotation, Q5 enable posture, Q6 SSRF allowlist shape/activation, Q7 cwa
  coordination sequencing), all routed to the human ruling gate. No prior sections to renumber (initial
  revision).
- **Rev 2 (2026-07-23)** — Resolves the four BLOCKING determinism/testability findings from the rev-1 spec
  review; no REQ id renumbered or reused; append-only. All seven Open Questions (§8) remain **open and
  unresolved** and still route to the human ruling gate (Q3's framing tightened per Finding 4; the decision
  it poses is not resolved; Q1/Q2/Q4/Q5/Q6/Q7 verbatim unchanged). Changes:
  - **REQ-D006-006 (GAP — timestamp clock semantics):** pinned the timestamp as **send-time** — captured at
    each outbound POST **attempt** and **regenerated per attempt/re-drive**, explicitly NOT
    outbox-origination time — so an F-004 backfill or a retry re-drive carries a fresh send-time and a
    backlog drain never stale-parks against cwa's freshness window. Added a two-attempt test.
  - **REQ-D006-013 (AMBIGUOUS — allowlist port match):** replaced the under-specified "exact host, port if
    present" rule with ONE deterministic rule — normalize both the peer URL and each allowlist entry through
    the WHATWG URL `.host` (default `:443` elided consistently on both sides), compare case-insensitively;
    a port-less entry matches the default 443 only, `cwa.example:443` ≡ `cwa.example`. Added a worked
    example table QA can assert row-by-row.
  - **REQ-D006-015 (GAP — activation boundary):** keyed activation to the **parsed** allow-set (after
    split/trim/drop-empty), not the raw env string — a value parsing to empty (`""`, `" "`, `","`, …) is
    **inactive → boots**, removing the `" "` "empty allow-set refuses every peer" flip. Enumerated the
    inactive cases in the test.
  - **REQ-D006-004 (CONTRADICTION — `v1` labels two constructions):** made `v1` name exactly ONE byte
    layout (the 4-part timestamped default); the timestamp-less fallback is a **distinct version tag**, never
    a second `v1` variant. Reframed §8 Q3 to preserve the one-tag-one-layout invariant without reopening the
    question.
  - **NOTE-1 (mischaracterized cross-ref):** corrected the SSRF-provenance citation from **REQ-F004-028**
    (which asserts the browser never reads the bus — the opposite direction) to the **`security/F-004-review.md`
    finding F4** in the parent-spec list, §1.1, and REQ-D006-016.
  - **NOTE-2 (unparseable entry):** REQ-D006-014 now fails closed on a peer entry the URL parser cannot
    resolve to a host — refuse to boot naming the raw offending entry, not silently skip.
  - **NOTE-3 (undefined term):** added a **"Signature-requiring peer"** definition to §2.
- **Rev 3 (2026-07-23)** — Applies the human ruling gate; all seven §8 questions RESOLVED and §8 marked
  RULED; no REQ id renumbered or reused; append-only. One new id appended (REQ-D006-038); two items marked
  **DEPRECATED** (REQ-D006-006 and the §2 Timestamp-header definition). Question dispositions and requirement
  changes:
  - **Q1/Q2 (ACCEPT):** finalized `X-Event-Signature` and HMAC-SHA256/lowercase-hex as RULED in
    REQ-D006-005 and the §2 definitions (removed "provisional/default" language).
  - **Q3 (SIMPLER PATH — DROP timestamp/replay):** removed the `X-Event-Timestamp` header and send-time
    timestamp entirely. **REQ-D006-004** canonical input is now the 3-part `v1\n<delivery-id>\n<body>` (the
    single `v1` layout). **REQ-D006-006 marked DEPRECATED** (retained, not renumbered) with the
    replay-absorbed-by-delivery-id-dedupe rationale. Updated REQ-D006-003 (no timestamp header emitted),
    REQ-D006-011 (exactly one new app-level header; no timestamp), REQ-D006-017 (wire contract no longer
    mentions a timestamp/freshness window), REQ-D006-026/-027 (dropped "and timestamp"), and the §2
    Canonical-input / HMAC-signature / Timestamp-header definitions. Retires the reviewer's cross-version
    `v1` ambiguity note.
  - **Q4 (ACCEPT):** finalized `EVENT_BUS_PEER_SIGNING_KEY`, single shared key, simple coordinated rotation
    in REQ-D006-007/-009/-020; per-peer and dual-key deferred.
  - **Q5 (ACCEPT):** finalized the sign-iff-configured / production-required / dev-boot-soft posture as
    RULED in REQ-D006-010/-021.
  - **Q6 (RULED with override):** REQ-D006-013 finalized as EXACT WHATWG-`.host` match (RULED, worked table
    kept); **REQ-D006-015 now requires an allowlist in production** (fail-fast naming the missing var when a
    peer is configured and the parsed allow-set is empty) while development stays opt-in; **NOTE-B** folded
    into REQ-D006-013 (a non-empty but unparseable allowlist entry fails closed, naming the raw entry).
  - **Q7 (RULED):** REQ-D006-019 rewritten as the explicit 3-step operator-driven cut-over (cwa
    accept-but-don't-require → relay enables signing → cwa requires), steps 1 & 3 cwa-owned/referenced, step
    2 this spec's; REQ-D006-020(c) adds the operator "confirm signed traffic is healthy" gate between steps 2
    and 3; REQ-D006-030 re-anchored to the RULED sequence.
  - **NON-GOAL added — REQ-D006-038:** a zero-gap dual-key rotation transition window is out of scope,
    deferred to **F-014** (logged in `feature-value-scoring.xlsx`, status Idea); referenced from
    REQ-D006-020(b) and §8 Q4/Q7.
  - **NOTE-A (cross-ref):** corrected REQ-D006-036's SSRF-provenance citation from REQ-F004-028 to
    `security/F-004-review.md` finding F4 (matching the rev-2 corrections elsewhere).
  - **§7 Self-Check** updated to reflect the ruled 3-part construction and the dev-opt-in/prod-required
    allowlist activation.
