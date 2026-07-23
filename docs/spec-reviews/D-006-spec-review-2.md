# D-006 Spec Review 2 — Relay Peer HMAC + Outbound SSRF/Host-Allowlist Hardening

Spec reviewed: `/home/derek/git/admin-console/specs/D-006-relay-peer-hmac-and-ssrf-hardening.md` (Draft rev 2)
Reviewer: adversarial specification reviewer (round 2 — delta pass)
Date: 2026-07-23
Checks executed: 8/8 (scoped to rev-1 deltas + contradiction re-check of changed sections against the whole)

---

## SPEC REVIEW REPORT

```
Spec: specs/D-006-relay-peer-hmac-and-ssrf-hardening.md (rev 2)
Checks executed: 8/8
Blocking findings: 0  (AMBIGUOUS 0 / UNTESTABLE 0 / CONTRADICTION 0 / GAP 0)
Notes: 3
Verdict: PASS WITH NOTES
```

Round discipline: this is the 2nd (final) review. Scope limited to the four rev-1 blocking
findings, the three folded notes, and a regression/contradiction scan of the changed
requirements (REQ-D006-004/006/013/014/015/016/017, §2, §8 Q3) against the whole. No
new-style opinions introduced.

---

## Resolution of the four rev-1 BLOCKING findings

### Finding 1 [GAP] REQ-D006-006/017 — timestamp clock semantics — RESOLVED
REQ-D006-006 now pins the value as **send-time**: "the wall-clock instant captured at the
moment of each outbound POST attempt," "regenerated on every attempt / re-drive," and
"MUST NOT be the event's outbox-origination (row-creation) time or any value persisted with
the event." The rev-1 Reading A/Reading B fork is closed — only send-time complies. The
new two-attempt test ("two attempts of the same row … carry different timestamp values,
each equal to that attempt's send-time") is a concrete pass/fail.

Backfill hazard genuinely closed: because the timestamp is regenerated per attempt, a
row drained by an F-004 backfill or a transient-retry re-drive carries a fresh send-time
("always now"), so it is never stale against cwa's freshness window. A backlog drain
therefore cannot stale-park. This directly discharges the park-every-delivery hazard
REQ-D006-019 exists to prevent, and is internally consistent with the REQ-F004 delivery-id
dedupe (§3.1: a re-drive is not byte-identical since the timestamp differs, but is still
collapsed by delivery-id — the freshness window is defense-in-depth on top of dedupe, not a
replacement). No contradiction with REQ-D006-026 "no added persisted state" (send-time is
computed, not persisted).

### Finding 2 [AMBIGUOUS] REQ-D006-013 — allowlist port match rule — RESOLVED
REQ-D006-013 replaces the under-specified rule with ONE deterministic rule: both the peer
URL and each allowlist entry are normalized through the WHATWG URL `.host` (peer =
`url.host`; entry = `new URL('https://' + entry).host`), then compared for equality; default
`:443` is elided consistently on both sides; exact match only, no wildcard/suffix. I traced
all six worked-example rows through the rule:

- Row 1 (`cwa.example` / `https://cwa.example`) → `cwa.example` == `cwa.example` → match. OK.
- Row 2 (`cwa.example` / `…:443`) → peer 443 elided → match. OK.
- Row 3 (`cwa.example:443` / `https://cwa.example`) → entry 443 elided → match. OK.
- Row 4 (`cwa.example` / `…:8443`) → peer `cwa.example:8443` vs `cwa.example` → no match → refuse. OK.
- Row 5 (`cwa.example:8443` / `…:8443`) → `cwa.example:8443` == `cwa.example:8443` → match. OK.
- Row 6 (`other.example` / `https://cwa.example`) → no match → refuse. OK.

Every Result column follows mechanically from the stated rule. The rev-1 port-less-entry
and default-port-normalization forks no longer have two readings.

### Finding 3 [GAP] REQ-D006-015 — allowlist activation boundary — RESOLVED
REQ-D006-015 now keys activation to the **parsed** allow-set (after split / per-entry
`trim()` / drop-empty), not the raw env string. All of `""`, `" "`, `","`, `", ,"`
parse to empty → INACTIVE → boots. The rev-1 `" "` → "active-but-empty → refuse every peer"
flip is eliminated, and the enumerated inactive cases are asserted in the test. Boundary is
now stated at its edge.

### Finding 4 [CONTRADICTION] REQ-D006-004 — `v1` labels two constructions — RESOLVED
REQ-D006-004 now binds the `v1` tag to exactly ONE layout (the 4-part
`v1\n<delivery-id>\n<timestamp>\n<body>`) and states the timestamp-less fallback is a
**distinct version tag** (e.g. `v2`, or `v1` redefined only in a superseding revision), with
the explicit invariant "within any single ruling, one tag = one layout, never both." §8 Q3
carries the same "version-tag invariant (not reopened)" framing. As the page now stands, `v1`
denotes a single byte layout, so the QA "v1 uniquely identifies the signed byte sequence"
test is writable. No same-page double-definition remains (see NOTE-3 below re: the
"redefine `v1` in a superseding revision" phrasing — non-blocking).

---

## Fold-in of the three rev-1 NOTES

- **NOTE-1 (miscited provenance cross-ref).** Corrected in the parent-spec list (§ header),
  §1.1 (REQ-D006-002 vicinity), and REQ-D006-016: the SSRF provenance premise now cites
  `security/F-004-review.md` finding **F4**, and REQ-F004-028 is correctly characterized as
  the opposite-direction (browser-never-reads-bus) guarantee. **Incompletely folded** — one
  residual instance remains (see NOTE-A).
- **NOTE-2 (unparseable peer entry).** Folded: REQ-D006-014 now fails closed on a peer entry
  the WHATWG parser cannot resolve to a host — "refuse to boot, naming the raw offending
  entry … an unparseable peer is treated as not-permitted, not as absent" — with a matching
  test clause.
- **NOTE-3 (undefined term).** Folded: §2 now defines "Signature-requiring peer" (a peer
  whose consumer verifies the HMAC and returns 401 on absent/malformed/invalid signature),
  explicitly distinguished from the relay-side "Signing required" posture.

---

## Regression / new-ambiguity scan of changed requirements

Scanned REQ-D006-004/006/013/014/015/016/017, §2, and §8 Q3 against the whole. No new
blocking AMBIGUOUS/UNTESTABLE/CONTRADICTION/GAP introduced. Cross-checks:

- REQ-D006-004 canonical input (4-part, timestamp always present under the adopted default)
  is consistent with REQ-D006-006 (timestamp always attached when signing) and REQ-D006-010
  (dev-with-no-key attaches NO signature at all, not a 3-part signature) — so no path emits a
  `v1`-tagged 3-part signature. Consistent.
- REQ-D006-013 normalization is used by REQ-D006-014 (fail-fast) and REQ-D006-015
  (activation). The split/trim/drop-empty string parse (activation, REQ-D006-015) is a
  distinct step from the per-entry WHATWG `.host` normalization (matching, REQ-D006-013);
  the spec keeps them separate and consistent.
- REQ-D006-016/017 test wording updated to the F4 provenance premise; no drift.
- §8 Q3 remains OPEN (still asks: include timestamp at all? units? window? nonce?) and the
  reframing only tightens the version-tag invariant, per its own "not reopened" note.

Three non-blocking observations follow.

---

## NON-BLOCKING NOTES

### [NOTE-A] NOTE-1 fold is incomplete — REQ-D006-036 still cites REQ-F004-028 for the provenance premise
REQ-D006-036 reads: "The SSRF leg is boot-time env validation only (REQ-D006-016), because
there is **no runtime user-input → SSRF vector (REQ-F004-028)**." Per the rev-1 NOTE-1
(which rev 2 accepted and corrected elsewhere), the "destination is env-only, never a
request/route/DB value → no runtime SSRF vector" premise belongs to **F-004-review finding
F4**, not REQ-F004-028 (which is the browser-never-reads-bus / log-hygiene guarantee, the
opposite direction). This is the same miscitation NOTE-1 flagged, left in one location the
rev-2 changelog did not enumerate. Non-blocking (the SSRF leg is fully specified as
boot-time validation regardless, and the substantive premise is independently true), but the
citation in REQ-D006-036 should point at F4 for consistency with the corrected §1.1 /
REQ-D006-016.

### [NOTE-B] Malformed (non-empty, WHATWG-unparseable) allowlist ENTRY behavior is unspecified
REQ-D006-014's fail-closed / name-the-entry rule is stated for an unparseable **peer**
entry (`EVENT_BUS_URL`), but the rev-2 delta newly applies WHATWG parsing to each
**allowlist** entry too (`new URL('https://' + entry).host`, REQ-D006-013). An allowlist
entry that survives split/trim/drop-empty as non-empty but is WHATWG-unparseable (e.g.
`cwa example` with an internal space) has no specified handling. I checked the outcome and it
is **not** a fail-open divergence: activation (REQ-D006-015) is decided on the string-level
split/trim/drop-empty parse, so such an entry keeps the allow-set non-empty → allowlist
ACTIVE; whether the implementer lets `new URL` throw or catches-and-skips, the sole entry
never matches a real peer, so REQ-D006-014 refuses boot either way (fail closed). The only
unspecified divergence is **error-surface quality** (opaque throw vs a named-entry message),
not the boot/no-boot outcome. Hence non-blocking. A one-line pin extending REQ-D006-014's
"name the raw offending entry, fail closed" to malformed allowlist entries (symmetric with
the peer-entry rule) would remove the residual latitude.

### [NOTE-C] "or `v1` would be redefined … in a superseding revision" — cross-version tag reuse awareness
REQ-D006-004 and §8 Q3 offer, as one option should the Q3 ruling drop replay protection,
that "`v1` would be redefined as the 3-part form in a superseding revision." This does not
violate the one-tag-one-layout invariant on the page as it stands (this revision defines
`v1` = 4-part only), so it is not a contradiction. Flagged only for human awareness: choosing
the "redefine `v1`" option later would make a `v1`-tagged signature mean different byte
layouts across relay/spec versions, which the "new tag `v2`" option avoids. This is a future
ruling concern, not a defect in rev 2.

---

## PER-CHECK RESULTS (delta-scoped)

1. **Misinterpretation attack** — Re-ran against the three previously divergent areas
   (timestamp value, allowlist match, activation). All three now admit one reading. No new
   two-implementation fork found in the changed requirements (the one candidate, malformed
   allowlist entry, resolves to the same boot outcome — NOTE-B).
2. **One-line-test check** — Every changed MUST carries an executable test; the timestamp
   test is now decidable (send-time, two-attempt), previously the sole under-decided one. No
   UNTESTABLE.
3. **Error-coverage sweep** — Added coverage: unparseable peer entry (REQ-D006-014, fail
   closed). Residual: malformed allowlist entry error-surface (NOTE-B, non-blocking, fails
   closed).
4. **Example-vs-prose reconciliation** — The REQ-D006-013 worked-example table (new) traces
   consistently through the stated normalization rule, all six rows. The `v1` example is now
   single-valued. No divergence.
5. **Definition audit** — "Signature-requiring peer" now defined and used consistently;
   distinct from "Signing required." Clean.
6. **Boundary audit** — Allowlist activation edge (whitespace/comma-only) now stated
   (inactive→boots); default-port elision edge now stated on both sides; epoch-ms clock
   source now pinned (send-time). All previously-unstated edges closed.
7. **Non-goal probe** — Fencing unchanged from rev 1 (mTLS, F3 bind, TLS/bearer re-spec,
   envelope/catalog/classifier, cwa verification, runtime egress, confidentiality, per-peer
   keys, nonce). No scope drift introduced by the deltas.
8. **Cross-reference check** — F4 provenance citation corrected in three of four locations
   (NOTE-A: one residual REQ-F004-028 in REQ-D006-036). Internal REQ-D006-001..037 numbering
   unchanged — no id renumbered or reused; append-only preserved. §/Q references resolve.

---

## Open-questions gate integrity

All seven §8 Open Questions remain **OPEN and unresolved** and still route to the human
ruling gate. Q1/Q2/Q4/Q5/Q6/Q7 are verbatim unchanged; Q3's framing was tightened to
preserve the one-tag-one-layout invariant (REQ-D006-004) but the decision it poses (include
the timestamp at all? units? window? nonce?) is **not** resolved. Each still adopts a
testable default so the spec is buildable now. The human gate is intact.

---

## VERDICT

**PASS WITH NOTES.** All four rev-1 blocking findings are resolved with no new blocking
ambiguity, untestability, or contradiction. The send-time / per-attempt regeneration fix
(REQ-D006-006) genuinely closes the park-every-backfilled-delivery hazard: a backlog drain
carries a fresh send-time and cannot stale-park. The three rev-1 notes were folded, with one
incomplete residual (NOTE-A: REQ-D006-036 still cites REQ-F004-028 for the provenance
premise) plus one newly-surfaced symmetry gap in error-surface wording (NOTE-B, fails closed,
non-blocking) and one cross-version tag-reuse awareness item (NOTE-C). None of the three
notes blocks finalization. The seven Open Questions remain open for the human ruling gate.
