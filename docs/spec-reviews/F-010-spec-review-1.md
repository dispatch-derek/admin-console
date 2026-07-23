# F-010 Spec Review 1 (adversarial)

SPEC REVIEW REPORT
Spec: specs/F-010-deliver-admin-events-to-customer-web-app.md (Draft rev 1)
Checks executed: 8/8
Blocking findings: 3  (AMBIGUOUS 3 / UNTESTABLE 0 / CONTRADICTION 0 / GAP 0)
Notes: 8 (incl. 3 non-blocking GAPs folded into NOTEs)

## Blocking

### [AMBIGUOUS] REQ-F010-024 vs REQ-F010-017 — the "missing credential" acceptance path is environment-unpinned and unreachable in production
REQ-F010-024's *Test* asserts "(b) missing/wrong credential -> 401 -> immediate permanent park."
REQ-F010-017 makes a **missing** (unset/empty) credential with a peer configured a **production boot
refusal** — the relay never boots, so no POST is sent and no 401/park ever occurs. The requirement
bundles two cases with opposite behavior and never pins NODE_ENV.
- Reading A: REQ-F010-024's stub e2e runs in development (boot-soft, REQ-F010-017), so a *missing*
  credential does produce a delivered 401 -> park. Test passes.
- Reading B: it runs in production; a *missing* credential yields boot refusal (REQ-F010-017), NOT a
  401 park, so the "missing -> 401 -> park" arm can never execute. Test is unsatisfiable.
The "wrong" (set-but-incorrect) sub-case is consistent in both environments; only "missing" collides.
Fix: pin the environment REQ-F010-024 runs in, and either restrict its 401-park arm to the "wrong"
credential case or state that "missing -> 401 -> park" is the development-only behavior of REQ-F010-017.

### [AMBIGUOUS] REQ-F010-005 vs REQ-F010-007 — is the credential value delivered verbatim or trimmed by the env conventions?
REQ-F010-005 requires the credential on the wire "exactly as provided (no transformation, truncation,
or re-encoding beyond what HTTP header transmission requires)" — i.e. byte-for-byte.
REQ-F010-007 requires it be "parsed by the same env-reading conventions as the existing relay config
(config.ts)"; the only cited convention for the EVENT_BUS_* family (REQ-F004-052 / REQ-F010-003) is
per-entry **whitespace trim** + drop-empty.
- Reading A (REQ-F010-005 verbatim): a secret configured as `" abc "` is delivered as `" abc "`.
- Reading B (REQ-F010-007 same conventions): surrounding whitespace is trimmed; the same secret is
  delivered as `"abc"`.
Both implementations claim compliance and produce different wire bytes (and different cwa
constant-time-compare outcomes). This also leaves REQ-F010-017's "unset or **empty**" undefined for a
whitespace-only value: empty-after-trim (-> fail-fast) under Reading B, a valid non-empty secret
(-> boots, sends spaces) under Reading A.
Fix: state explicitly whether the credential scalar is trimmed, and define "empty" in REQ-F010-017 as
pre- or post-trim.

### [AMBIGUOUS] REQ-F010-005 / REQ-F010-024 — "exactly three headers of record" / "exact three-header outbound set" is undefined against transport-mandatory headers
REQ-F010-005: a peer stub "observes exactly three headers of record — content-type,
x-event-delivery-id, and the credential header — and no others introduced by F-010." REQ-F010-024
restates this as "assert the exact three-header outbound set" with no qualifier. The term "headers of
record" is undefined, and real HTTP clients (undici/fetch) auto-attach Host, Content-Length,
Accept-Encoding, Connection, User-Agent, etc., which the peer stub *does* receive.
- Reading A: assert the received request has literally three header entries — fails against any real
  HTTP client because of transport-mandatory headers.
- Reading B: assert exactly three application-level headers, excluding transport-default headers.
Two divergent QA test implementations, one of which cannot pass. Fix: define the assertion as "the
three application-level headers, in addition to the HTTP client's transport-mandatory headers," and
carry the "-introduced by F-010" qualifier into REQ-F010-024's test text.

## Notes (non-blocking)

- [GAP/NOTE] Credential containing HTTP-header-illegal bytes (CR/LF, control chars, non-ASCII):
  behavior unspecified. REQ-F010-005's "no transformation beyond what HTTP header transmission
  requires" does not say whether such a value is rejected at boot, throws at delivery, or is
  sanitized. Operator-controlled/defensive; recommend a boot-time validation clause.
- [GAP/NOTE] Oversized credential: a peer/proxy 431 (or client-side header-size limit) is uncovered by
  the error section. It would classify permanent (all-other-4xx, REQ-F004-055) -> immediate park, so
  the outcome is defined by inheritance, but F-010 does not call it out.
- [GAP/NOTE] In the dev boot-soft path with the credential unset (REQ-F010-017), whether the credential
  header is emitted with an empty value or omitted entirely is unspecified (REQ-F010-005 fixes the
  value, not header presence). Affects the "exactly three headers" claim in the missing-credential case.
- [NOTE] Delivery-id shape `<outbox-epoch>:<row-id>` is attributed to "cwa REQ-F005-011"
  (REQ-F010-006 and the §2 "Delivery id" definition). The in-repo authority that *produces* this shape
  is REQ-F004-048/018; consider citing the in-repo producer alongside the cwa consumer ref.
- [NOTE] Automated credential rotation and any startup credential-validation "ping" are not fenced by
  an explicit non-goal. REQ-F010-022 (no round-trip) + REQ-F010-016 (manual rotation runbook) imply
  manual-only; an explicit §6 non-goal would prevent scope drift.
- [NOTE] REQ-F010-017 grounds the fail-fast pattern at "config.ts:30-34"; REQ-F004-045 grounds
  EVENT_BUS_URL at config.ts:51-52. Line-number drift in grounding (re-confirm at build).
- [NOTE] F-004 cross-references all resolve and are accurately characterized: REQ-F004-052 (comma-list
  peer registration + EVENT_BUS_TRANSPORT selector), -051 / -051(d) / -051(e) (fan-out ack, immediate
  permanent park, partially-delivered park), -055 (HTTP classification, 401 -> permanent), -049
  (transport seam), -047 (transient/permanent classification), -014 (park), -025 (park/partial
  metrics), -045 (bus-mode-without-URL hard-refuse posture), -011 (never silently dropped), -002 (frozen
  contract), -050 (GTM HTTP transport), -043(c) (permanent/transient signal). No dangling or
  misremembered F-004 cross-ref found.
- [NOTE] The cwa REQ-F005-0xx references (F-005-060/061/062/063, -011) are cross-repo and explicitly
  "not owned here"; they were not verifiable within this review's scope (admin-console + F-004 only).

Verdict: BLOCK (revise)
