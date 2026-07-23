# Security Review — D-006 TLS-enforcement leg (GH #16, folds in D-007 Sev5)

Date: 2026-07-23
Reviewer: Application Security (defensive review, read-only)
Scope: `bff/src/relay/config.ts` (non-https peer-scheme fail-fast, lines 75-92),
with supporting review of `bff/src/relay/http-peer-transport.ts`,
`bff/src/relay/transport.ts`, `bff/src/relay/index.ts`, `bff/src/events/bus.ts`,
`bff/src/config.ts`. Tests read (not modified): `bff/test/relay/relay-config.d006.test.ts`,
`bff/test/relay/config-scheme-guard.unit.test.ts`.
Scanners run: manual review + Node runtime probe of the scheme check against the
WHATWG URL parser; targeted greps for TLS-verification-disabling flags. No
project SAST configured for the relay module; `npm audit` not run (out of scope
for this single-file defect fix).

## Verdict: PASS

The fix genuinely closes the D-007 cleartext-secret exposure. I found no reachable
production/credentialed configuration in which the F-010 shared secret can traverse
`http://`. No Critical/High/Medium findings. Two Informational notes below.

---

## Assessment of the focus areas

### 1. Does the guard actually close the exposure? — YES

The secret (`X-Event-Auth-Token`) is attached by the transport
(`http-peer-transport.ts:90-91`) **iff** `isCredentialConfigured(peerAuthToken)` is
true. The boot guard (`config.ts:82`) rejects any non-`https://` peer **whenever**
`isCredentialConfigured(peerAuthToken) || isProduction`. Because the guard's first
disjunct is the *exact same predicate* (same imported `isCredentialConfigured`
function) that governs header attachment, it is structurally impossible for the
credential to be attached while an `http://` peer is accepted: any config in which
the header would be sent forces the guard to require https and refuse boot otherwise.

The transport consumes `config.peerUrls` / `config.peerAuthToken` (index.ts:32-34 →
transport.ts:53 → HttpPeerTransport), i.e. the very array the guard validated — no
second, unvalidated parse of `EVENT_BUS_URL` exists on the outbound path. The BFF
enqueue side (`config.ts:78`, `events/bus.ts`) only writes to the durable outbox DB
and never POSTs peers, so there is no alternate cleartext path. D-007 is closed, not
merely narrowed.

### 2. Bypass analysis of `url.toLowerCase().startsWith('https://')` — SOUND

A runtime probe compared the guard's verdict against `new URL().protocol` for mixed
case, near-miss schemes, other insecure schemes, embedded userinfo, leading/internal
whitespace, BOM, C0 controls, and intra-scheme tabs. Result: **every** input the
guard accepts parses to scheme `https:`. This holds because the URL scheme is the
substring before the first `:`; if a string literally begins with the 8 bytes
`https://`, that prefix contains no tab/newline/control and no leading control that
the parser could strip to change the scheme, so `fetch` is guaranteed to use TLS.

The residual parser quirks (`htt\tps://…`, `\x01https://…`, which the WHATWG parser
would recover into a valid https request) are **rejected** by the guard — a
false-reject in the safe direction (fails closed, refuses boot), never a false-accept.
Case folding is handled by `toLowerCase()`; per-entry `trim()` on the peer-list split
strips leading whitespace before the check, so ` http://` / `\thttp://` are correctly
rejected. Mixed peer lists are fully iterated (`config.ts:83` for-of), so one bad
entry among good ones still refuses boot and names the offending entry. A prefix
`startsWith` check is sufficient here for the TLS property.

### 3. Gating correctness — NO GAP

There is no state where a real credential is attached but the guard does not fire:
- credential non-empty ⇒ `isCredentialConfigured` true ⇒ guard fires (require https).
- credential empty/unset (`''`/`undefined`) ⇒ transport does not attach the header, so
  no secret leaks even over `http://`; the only cleartext in dev-no-credential is the
  `admin.*` envelope, which is the documented dev-loopback tradeoff.
- production + non-empty peer list + empty credential is caught earlier by the
  REQ-F010-017 fail-fast (`config.ts:68-73`) before the scheme loop, so boot refuses
  regardless. The OR gate's `isProduction` disjunct is defense-in-depth on top.

### 4. Secret leak in the new error — CLEAN

The thrown boot error interpolates only the peer `url`; the `peerAuthToken` value is
never referenced in the message (consistent with REQ-F010-011 redaction). Confirmed
by inspection of `config.ts:85-89`.

### 5. Scope check — CONFIRMED TLS-only

No HMAC request signing, no mTLS, and no SSRF/egress allowlist were added; this leg is
purely scheme enforcement, matching the stated D-006 future scope. No
TLS-verification-disabling was introduced (no `NODE_TLS_REJECT_UNAUTHORIZED`,
`rejectUnauthorized:false`, custom `Agent`, or `checkServerIdentity` override anywhere
in `bff/src`), so `fetch` performs standard certificate validation on the now-enforced
https connections.

---

## Findings

### [Informational] Shared secret is a bearer token protected by transport only — deferred D-006 legs
File: `bff/src/relay/http-peer-transport.ts:18,90-91`
With TLS now enforced, the `X-Event-Auth-Token` is a static bearer credential replayed
verbatim to every peer. There is no per-request signature (HMAC) or mutual TLS, so a
compromised/malicious peer in the list, or anyone able to alter `EVENT_BUS_URL`, learns
a reusable secret. This is explicitly out of scope for this leg and tracked as future
D-006 work. Recorded here as **accepted/deferred residual risk**, not a regression of
this fix.
Remediation (future): per-message HMAC over the envelope + timestamp/nonce, and/or mTLS,
so a captured token alone is not sufficient to impersonate the sender.

### [Informational] Boot error echoes the full peer URL, including any embedded userinfo
File: `bff/src/relay/config.ts:85-89`
If an operator (mis)configures a peer with URL-embedded credentials
(`http://user:pass@host`), the fail-fast error string reproduces the userinfo in boot
logs. This does not leak the F-010 `EVENT_BUS_PEER_AUTH_TOKEN` (that value is never in
the message), and userinfo-in-URL is a discouraged operator anti-pattern, so impact is
low. Optional hardening: redact userinfo before interpolation, or name only the parsed
scheme/host rather than the raw string.

---

## Not assessed
- Full-repo dependency audit (`npm audit`) and broader relay SAST — out of scope for
  this single-file defect fix; only the D-006 change surface was reviewed.
- Runtime TLS posture of the deployment environment (cert pinning, CA trust store) —
  outside the code under review.
- The deferred D-006 legs (HMAC/mTLS/SSRF allowlist) were confirmed absent by design,
  not security-reviewed for a future implementation.
