# SECURITY REVIEW REPORT — D-011 (GH #51)

Wire-header rename: `X-Event-Auth-Token` → `X-Event-Bus-Peer-Auth-Token`
Branch: `fix/d-011-header-rename-bus-peer-auth-token`
Date: 2026-07-23
Reviewer: application security review (read-only)

## Scope

Diff `main..HEAD` limited to a single wire-header string literal rename plus
doc/test re-anchoring:

- `bff/src/relay/http-peer-transport.ts:18` — `AUTH_TOKEN_HEADER` constant
- `bff/src/relay/config.ts:77` — comment only
- `bff/src/relay/README.md:56,68` — docs only
- Tests re-anchored to the new literal:
  `confidentiality.f010.test.ts`, `static-scans.f010.test.ts`,
  `http-peer-transport.f010.test.ts`, `drainer.f010.test.ts`,
  `f010-peer-auth.unit.test.ts`, `transport.f010.test.ts`,
  `relay-config.d006.test.ts`, new `http-peer-transport.d011.test.ts`,
  and e2e `credential-auth.e2e.test.ts` / `fanout.e2e.test.ts`

## Scanners run

None (no source-logic change to warrant SAST; diff is a single string literal).
Manual review + targeted grep of `bff/src` for credential sinks and header stragglers.

## Findings

None (no Critical / High / Medium / Low).

### Verification performed

1. **Credential sourcing/attachment unchanged.** `bff/src/relay/http-peer-transport.ts:90-91`
   still attaches the secret only when `isCredentialConfigured(this.peerAuthToken)`
   is true, setting `headers[AUTH_TOKEN_HEADER] = this.peerAuthToken` byte-for-byte.
   Only the constant's string value changed. Source → sink path (env
   `EVENT_BUS_PEER_AUTH_TOKEN` → `config.ts:52` → `index.ts:34` → transport ctor →
   header) is identical to the F-010 baseline.

2. **Redaction guarantees hold under the new name.** The credential value is
   never emitted to any log, error, `TransportError`, metric, `/ready`, outbox
   row, or source literal. `TransportError` messages
   (`http-peer-transport.ts:122,126`) are static strings with no credential/peer
   detail. No `console.*`/logger call in the transport or `transport.ts` touches
   the token. The renamed header only changes the *key* string; it does not
   introduce any new place the *value* is written. Confidentiality/static-scan
   tests were correctly re-anchored to `X-Event-Bus-Peer-Auth-Token`, preserving
   the same negative-assertion coverage against the emitter, catalog, drainer,
   `ready.ts`, and `metrics.ts`.

3. **No weakening of controls.** `classifyStatus` (2xx ack / 5xx+408+429
   transient / other permanent), the fan-out permanent-park composition, the
   401→permanent-park path, the boot-time missing-credential fail-fast
   (`config.ts:68`), the https-only peer-scheme guard (`config.ts`), and the
   credential-value byte guard (`ILLEGAL_HEADER_VALUE_BYTE`, `config.ts:18,54`
   — still rejects CR/LF/NUL/control bytes at boot to prevent header injection
   via the credential value) are all untouched by this diff.

4. **Header-name legality.** `X-Event-Bus-Peer-Auth-Token` consists solely of
   ALPHA and `-`, a valid RFC 7230 field-name `token`. It is a hardcoded
   constant (not attacker-influenced), so there is no header/CRLF injection
   surface from the name itself.

5. **No stale old-header reference in tracked source.** Grep confirms
   `X-Event-Auth-Token` no longer appears in `bff/src`. Remaining hits are
   intentional negative assertions in `http-peer-transport.d011.test.ts` and a
   compiled copy in `bff/dist/` — `bff/dist/` is git-ignored (confirmed via
   `git check-ignore`), i.e. a local build artifact regenerated at build/deploy,
   not a tracked regression.

## Notes (non-blocking)

- **N1 — Cross-repo dependency (expected, not a defect in this diff).** Until
  customer-web-app D-003 renames its accepted header to
  `x-event-bus-peer-auth-token`, the two sides are mismatched and the consumer
  will 401 → permanent-park every delivery. This is the known coordinated
  cutover, already tracked; flagged here only so the pipeline is not declared
  healthy before cwa D-003 lands.

- **N2 — Deploy hygiene (informational).** Ensure the relay is rebuilt from
  `bff/src` before deploy so the stale `bff/dist/relay/http-peer-transport.js`
  (still carrying the old literal locally) is not shipped. No action for the
  implementer beyond the normal build step; noted for the release checklist.

## Not assessed

- Runtime behavior of the peer/consumer (customer-web-app) — out of scope for
  this repo's diff; covered by the cross-repo D-003 cutover.
- Full F-010 credential design (only the delta from `main..HEAD` was reviewed;
  the underlying design was previously reviewed and is unchanged here).

## Verdict

**PASS** — The change is a pure, well-contained wire-header string-literal
rename. No source-logic, credential-handling, or control-flow change; all
F-010 confidentiality and fail-fast guarantees are preserved and the
confidentiality/static-scan test anchors were updated in lockstep. Merge is
gated only by the coordinated customer-web-app D-003 rename (Note N1), which is
a functional cross-repo dependency, not a security defect.
