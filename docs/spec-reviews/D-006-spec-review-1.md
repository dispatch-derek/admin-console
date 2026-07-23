# D-006 Spec Review 1 — Relay Peer HMAC + Outbound SSRF/Host-Allowlist Hardening

Spec reviewed: `/home/derek/git/admin-console/specs/D-006-relay-peer-hmac-and-ssrf-hardening.md` (Draft rev 1)
Reviewer: adversarial specification reviewer (page-stands-alone pass)
Date: 2026-07-23
Checks executed: 8/8

---

## SPEC REVIEW REPORT

```
Spec: specs/D-006-relay-peer-hmac-and-ssrf-hardening.md (rev 1)
Checks executed: 8/8
Blocking findings: 4  (AMBIGUOUS 1 / UNTESTABLE 0 / CONTRADICTION 1 / GAP 2)
Notes: 4
Verdict: BLOCK (revise)
```

---

## Cross-reference verification (Check 8) — grounding confirmed

Every external citation was resolved against the source. Result: **all cited requirements exist and
(with one exception, NOTE-1) mean what D-006 says.**

- **REQ-F004-055** (specs/F-004 line 497) — HTTP→permanent/transient classifier. Confirms **any 4xx incl.
  401 → permanent branch**. Grounded in code: `classifyStatus` (`http-peer-transport.ts:46-51`) returns
  `permanent` for 401. → REQ-D006-018's "bad/missing signature → cwa 401 → permanent park" **genuinely
  follows**, not asserted without support.
- **REQ-F004-051** (F-004 line 435), incl. (d) immediate-park-on-permanent and (e) partially-delivered-park
  — exist and match REQ-D006-018's fan-out claims.
- **REQ-F004-052** (F-004 line 971) — `EVENT_BUS_URL` comma-list + `EVENT_BUS_TRANSPORT` selector. Matches.
- **REQ-F004-049** (F-004 line 396) — two-layer transport seam. Matches REQ-D006-008/028.
- **REQ-F004-045** (F-004 line 945) — empty-peer-list boot fail-fast. Matches the mirrored-guard claims.
- **REQ-F010-005/007/008/011/014/016/017/019/022/024/026** — all verified in specs/F-010; each is used
  faithfully. F-010's "three application-level headers" (REQ-F010-006) is a **floor**, so D-006 adding a
  4th/5th header (REQ-D006-011) does **not** contradict it. The HMAC is genuinely **additive** and uses a
  **distinct key** (REQ-D006-007) — no conflict with the shipped bearer.
- **cwa REQ-F005-061** ("Wire carriage") and **REQ-F005-063** ("Response-classification alignment,
  401→permanent park by design") exist in `~/git/customer-web-app/specs/F-005-cross-app-identity-sync.md`
  and say what D-006 claims. cwa is correctly fenced as contract-of-record / out-of-scope (REQ-D006-017/035).
- **Code grounding**: `config.ts:75-92` scheme guard, `config.peerUrls` export, `isCredentialConfigured`
  (exported `http-peer-transport.ts:35-37`), `AUTH_TOKEN_HEADER='X-Event-Auth-Token'` (line 18), bearer
  attach (lines 90-91), `createTransport` threading (`transport.ts:39-53`) — **all match** the spec's
  grounding claims.
- **REQ-F004-028** — **does NOT say what D-006 claims** (see NOTE-1).

---

## BLOCKING FINDINGS

### [GAP] REQ-D006-006 / REQ-D006-017 — the signed timestamp's *clock semantics* are unspecified; cwa cannot enforce a freshness window and F-004 backfill may self-park

REQ-D006-006 attaches `X-Event-Timestamp` (epoch-ms decimal) "so a peer MAY enforce a freshness window,"
and REQ-D006-017 commits that this spec "MUST pin, on the producer side, exactly: … the timestamp header
and its inclusion in the signed input." The spec pins the header's **presence**, **format**, and that it is
**signed** — but never pins **what the value measures** nor whether it is **regenerated per delivery
attempt**. Two compliant readings:

- **Reading A (send-time):** the value is wall-clock `Date.now()` at the moment the signature is computed,
  freshly for each POST/re-drive.
- **Reading B (event-time):** the value is the event's origination time (e.g. the outbox row `ts`), stable
  across attempts and reproducible.

Both satisfy REQ-D006-006's test verbatim ("present, decimal epoch-ms, covered by the signature"). The
choice is **not** cosmetic: F-004 **backfill** (drains rows accumulated during an outage — REQ-F004-024,
the "Backfill" definition) delivers rows long after they were created. Under Reading A a backfilled row
carries a *fresh* timestamp and passes any cwa freshness window; under Reading B every backfilled row looks
stale and — if cwa enforces the very freshness window this requirement exists to enable — is **rejected
401 → permanent park** (REQ-D006-018) for the entire drained backlog. This is precisely the
"park-every-delivery" hazard REQ-D006-019 is meant to avoid, reintroduced through an unspecified field.

Because a freshness window is inherently a **shared-semantics** contract (the verifier must know what the
number means to compare it to "now"), leaving the clock source and per-attempt regeneration unstated is a
GAP in the cross-repo wire contract that REQ-D006-017 claims to fully determine. *Fix:* state that
`X-Event-Timestamp` MUST be the current wall-clock time (epoch ms) at signature computation, regenerated on
each delivery attempt (so it is a *send* timestamp, independent of the event's origination/outbox time).

### [AMBIGUOUS] REQ-D006-013 — the host/port allowlist match rule is under-specified for port-less entries and for WHATWG default-port normalization

REQ-D006-013 fixes "exact, case-insensitive host match; if an allowlist entry includes a port, the peer
URL's port must also match; wildcard/suffix matching is NOT provided." Two gaps in the port rule produce
divergent boot outcomes:

1. **Port-less allowlist entry vs ported peer URL.** The rule only covers the case where the *allowlist
   entry* includes a port. The converse is unspecified: allowlist `cwa.example` (no port), peer
   `https://cwa.example:8443`.
   - Reading A: a port-less allowlist entry matches **any** port ⇒ boots.
   - Reading B: a port-less allowlist entry means "default port only" ⇒ `:8443` is not permitted ⇒
     **refuses to boot** (REQ-D006-014).
2. **WHATWG default-port normalization.** REQ-D006-013 says the peer host/port is extracted with the WHATWG
   `URL` parser but says nothing about how the *allowlist entry* is parsed or about default-port elision.
   `new URL('https://cwa.example:443').port === ''` (443 is elided for https). So allowlist entry
   `cwa.example:443` compared against peer `https://cwa.example` (or `…:443`):
   - Reading A: normalize both ⇒ 443 ≡ default ⇒ match ⇒ boots.
   - Reading B: compare the literal allowlist port `443` against the parsed peer port `''` ⇒ mismatch ⇒
     **refuses to boot**.

Two implementers both claim compliance with REQ-D006-013 while one boots and the other hard-refuses on the
same config — the exact ambiguity the focus flagged ("exact vs suffix, case, port … testable at boot").
The GTM single-peer default (`cwa.example` host, implicit-443 https) happens to be unaffected, but the rule
as written is not testable at its boundary. *Fix:* specify the port-less-entry semantics (match-any-port vs
default-only) and require both sides be normalized through the same WHATWG `URL` (so `:443`/elided and
`:80`/elided compare equal), or state ports are compared post-normalization.

### [GAP] REQ-D006-015 — the "set (non-empty)" activation boundary is unstated for a whitespace/comma-only allowlist value

REQ-D006-015 makes the allowlist "active iff `EVENT_BUS_PEER_ALLOWLIST` is set (non-empty)," while
REQ-D006-013 parses it "with the same split / per-entry-trim / drop-empty convention as `EVENT_BUS_URL`."
"Non-empty" is not disambiguated between the **raw env string** and the **parsed list**, so a value like
`" "` or `","` (raw non-empty, parses to an empty list) has two behaviors:

- Reading A (raw-string test, mirroring the shipped `isCredentialConfigured` `""`-only rule): raw is
  non-empty ⇒ allowlist **active** ⇒ allowed-host set is empty ⇒ **every** configured peer is outside the
  allowlist ⇒ **refuse to boot** (REQ-D006-014).
- Reading B (parsed-list test): the list is empty ⇒ treated as unset ⇒ allowlist **inactive** ⇒ boots and
  delivers.

The `""` case is clear (unset), but the whitespace/comma-only edge is not, and it flips a boot into a
refuse-to-boot. Boundary edge affecting §-referenced boot behavior (REQ-D006-014/015). *Fix:* define
activation against the **parsed** list (active iff the trimmed, empty-dropped list is non-empty) or
explicitly against the raw string, and state the whitespace/comma-only outcome.

### [CONTRADICTION] REQ-D006-004 vs REQ-D006-006 — the version tag `v1` is assigned to two different canonical constructions

REQ-D006-004 asserts a versioning invariant: "The version tag `v1` **pins the construction** so a future
change is an explicit new version, not a silent break," and fixes the v1 input as the 4-part
`v1\n<delivery-id>\n<timestamp>\n<body>`. REQ-D006-006 then states that if the §8 Q3 ruling drops replay
protection, "the timestamp header and its term in the canonical input are removed and the input becomes
`v1\n<delivery-id>\n<body>`" — i.e. the **same tag `v1`** now labels a **different (3-part)** construction.

Removing the timestamp term *is* a change to the construction, which by REQ-D006-004's own rule must be a
new version (v2), not a re-used v1. As written, a QA engineer told "v1 uniquely identifies the signed byte
sequence" cannot write a single passing test: the spec defines v1 as both the 4-part and the 3-part input
depending on an unresolved ruling.

Practical severity is **lower** than the other blockers (within either Q3 ruling the relay and cwa
implement the *same* construction, so this does not itself cause relay/cwa signature divergence), but it is
a literal internal contradiction of a load-bearing invariant the spec advertises. *Fix:* have the
replay-dropped fallback use `v2` (or state the version tag is assigned at ruling time), so one tag never
denotes two byte layouts.

---

## NON-BLOCKING NOTES

### [NOTE-1] REQ-F004-028 is mischaracterized (cross-reference says something different from the section)

D-006 repeatedly cites REQ-F004-028 as "the static scan asserting the relay destination **never comes
from** a route/request/DB" (header note; §1.1; REQ-D006-001/016; and REQ-D006-016's test: "REQ-F004-028's
'URL never reaches a route/request' assertion still holds"). The actual REQ-F004-028 ("Security & log
hygiene (inherited)," F-004 line 1131) asserts the **opposite direction**: the browser never *reads* the
bus and never *receives* `EVENT_BUS_URL` (an outbound-leak / log-hygiene guarantee); its test is "no
browser-originated request can reach the transport or obtain `EVENT_BUS_URL`." It does **not** assert the
destination's *provenance* (that the URL is env-only and never sourced from a request/route/DB). The
substantive premise D-006 relies on **is** independently true and supported — but by the **F-004-review F4**
finding ("comes entirely from `EVENT_BUS_URL` env, never from a request field or DB value … no route/service
imports relay config"), not by REQ-F004-028. Since the SSRF leg is fully specified as boot-time validation
regardless, this is non-blocking, but the citation should be corrected (cite F4 and/or the "no
route/service imports relay config" fact for the provenance premise; REQ-F004-028 for the browser/log leg).

### [NOTE-2] REQ-D006-013/014 — unparseable `EVENT_BUS_URL` entry under the new URL parser is unspecified

REQ-D006-013 extracts host/port with `new URL(...)`, and REQ-D006-014 requires the boot error to **name the
offending host**. The shipped scheme guard only does `startsWith('https://')` (`config.ts:84`), so an entry
like `https://` (or other host-less/garbled-but-`https://`-prefixed strings) passes the scheme guard but
throws in `new URL(...)` — a boot refusal with an opaque thrown error and **no host to name**, contradicting
REQ-D006-014's "name the offending host" contract for that input. Degenerate config, hence NOTE, but the
spec should state the unparseable-entry behavior (e.g. refuse to boot naming the raw offending *entry*).

### [NOTE-3] "signature-requiring peer" is used without definition

REQ-D006-010/018/021 refer to a "signature-requiring peer" (a peer, i.e. cwa, that rejects unsigned
deliveries). §2 defines "**Signing required**" — but that is the *relay's* boot posture, a different
concept. Meaning is recoverable from context (the peer returns 401 for a missing/invalid signature), so
non-blocking, but the near-identical terms invite conflation; consider defining "signature-requiring peer"
explicitly.

### [NOTE-4] Header-value normalization vs signed value (theoretical)

`delivery-id` and `timestamp` are carried both in HTTP headers and in the signed canonical input. WHATWG
Fetch may strip surrounding HTTP whitespace from header values (noted in `config.ts:48-49`). With the
current value shapes (`<uuid-epoch>:<row-id>`; decimal digits) no whitespace is present, so no divergence
occurs — but if either value ever gained surrounding whitespace, cwa (reading the normalized header) and
the relay (signing the pre-normalization value) would diverge. Non-blocking today; worth a one-line pin
that the signed value equals the transmitted (post-normalization) value.

---

## PER-CHECK RESULTS

1. **Misinterpretation attack** — Two divergent-implementation constructions found and reported
   (timestamp clock semantics; allowlist port rule; allowlist activation boundary). Core HMAC construction
   (REQ-D006-004/005) is otherwise well-pinned: versioned tag, HMAC-SHA256, lowercase-hex 64-char,
   `\n`-joined, **exact raw body bytes** (explicitly not re-serialized) — the top divergence risk (relay vs
   cwa signature over the body) is correctly closed **except** for the timestamp value.
2. **One-line-test check** — Every MUST/SHOULD carries a stated test; all are executable except where the
   underlying value is under-specified (timestamp semantics feeds an otherwise-runnable test that passes
   under both readings — captured as the GAP, not as UNTESTABLE). No UNTESTABLE findings.
3. **Error-coverage sweep** — Covered: missing/empty key (prod fail-fast / dev soft, REQ-D006-021), wrong
   key (401 park, REQ-D006-022), illegal-byte key (explicitly N/A — key is HMAC input not a header,
   REQ-D006-021), disallowed host (boot refusal, REQ-D006-014), allowlist unset (inactive, REQ-D006-015),
   never-silent-drop (REQ-D006-023/024). Gaps: unparseable peer URL under the new parser (NOTE-2);
   whitespace/comma-only allowlist value (blocking GAP above).
4. **Example-vs-prose reconciliation** — Few concrete examples; the canonical-input example traces
   consistently through §3.1 and is restated identically in §7. The one divergence is the `v1` fallback
   (CONTRADICTION above).
5. **Definition audit** — §2 glossary is thorough; all signing/allowlist terms defined before use. One mild
   undefined term ("signature-requiring peer," NOTE-3).
6. **Boundary audit** — Numeric/edge limits: 64-char hex (pinned), epoch-ms decimal (format pinned, clock
   unpinned — GAP), allowlist port equality (ambiguous — AMBIGUOUS), allowlist activation non-empty
   boundary (unstated — GAP). "Non-empty string" for the key mirrors shipped `isCredentialConfigured`
   (`""`/undefined = unset; `" "` = set) — clear.
7. **Non-goal probe** — Strong fencing: mTLS (REQ-D006-031), F3 bind-address (REQ-D006-032), re-spec of
   TLS/bearer (REQ-D006-033), envelope/catalog/classifier (REQ-D006-034), cwa verification (REQ-D006-035),
   runtime egress filtering (REQ-D006-036), confidentiality/encryption (REQ-D006-037), per-peer keys
   (REQ-D006-009 deferred), nonce (§8 Q3). No unfenced scope-drift found; the spec does not wander into
   mTLS or F3.
8. **Cross-reference check** — All F-004/F-010/cwa/code citations resolve and (except REQ-F004-028, NOTE-1)
   mean what D-006 claims. Internal REQ-D006-001..037 numbering is contiguous with no dupes; §/Q references
   resolve.

---

## VERDICT

**BLOCK (revise).** Four blocking findings, all concentrated in the two most divergence-prone areas the
focus identified (the exact signed bytes, and the allowlist match/activation rules). The single most
important is the **timestamp-semantics GAP**: unspecified clock source turns a compliant implementation
into a park-every-backfilled-delivery outage against any cwa freshness window. The core HMAC-over-body
construction, the additive/distinct-key discipline, the 401→permanent-park composition, the code grounding,
and the non-goal fencing are otherwise solid; resolving the four findings (each has a one-line fix) should
clear the spec.
