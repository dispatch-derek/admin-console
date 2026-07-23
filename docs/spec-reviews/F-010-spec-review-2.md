# F-010 Spec Review 2 (adversarial, round 2 — delta pass)

SPEC REVIEW REPORT
Spec: specs/F-010-deliver-admin-events-to-customer-web-app.md (Draft rev 2)
Checks executed: 8/8 (scoped to rev-2 deltas + contradiction re-check of changed sections against the whole, per round-2 discipline)
Blocking findings: 0  (AMBIGUOUS 0 / UNTESTABLE 0 / CONTRADICTION 0 / GAP 0)
Notes: 4
Rev-1 blocking findings re-checked: 3/3 RESOLVED

---

## Rev-1 finding disposition

### RESOLVED — [was AMBIGUOUS] REQ-F010-024 vs REQ-F010-017 — missing-credential path environment-unpinned / unreachable in production
Rev 2 splits the 401→permanent-park arm of REQ-F010-024 into two explicitly NODE_ENV-pinned routes:
- **(a) wrong (set-but-incorrect) credential** — boots in *either* NODE_ENV, is POSTed, stub 401s → park.
- **(b) missing/empty credential** — reachable *only* under `NODE_ENV != production` (boot-soft); under
  `NODE_ENV=production` it is "unreachable by design" and asserted as a **boot refusal**, not a 401 park.
The acceptance test now enumerates four concrete cases (a / b-wrong any-env / b-missing dev / production
missing = boot refusal). This is internally consistent with REQ-F010-017's production-fail-fast /
dev-boot-soft posture. The rev-1 "bundles two cases with opposite behavior, never pins NODE_ENV" defect is
gone. RESOLVED.

### RESOLVED — [was AMBIGUOUS] REQ-F010-005 vs REQ-F010-007 — credential verbatim vs trimmed
Rev 2 REQ-F010-005 pins the value "byte-for-byte as read from the credential env var … with NO
whitespace-trim, truncation, case-folding, or re-encoding," with a worked example (`" abc "` → `" abc "`,
spaces preserved), and explicitly states REQ-F004-052's split/trim applies **only** to the peer list.
REQ-F010-007 is correspondingly clarified: the credential is read as a "raw single string … NOT
comma-split and NOT whitespace-trimmed the way the `EVENT_BUS_URL` peer list is." The two clauses now
agree on Reading A (verbatim). REQ-F010-017 additionally closes the derived "what is empty?" question:
"unset or empty" = absent OR zero-length `""`; whitespace-only is non-empty and boots verbatim. RESOLVED.
(One residual testability caveat about the wire-level fate of leading/trailing whitespace — NOTE 2.)

### RESOLVED — [was AMBIGUOUS] REQ-F010-005 / REQ-F010-024 — "exactly three headers" undefined vs transport-mandatory headers
Rev 2 REQ-F010-005 redefines the assertion at the **application layer**: the POST MUST carry the three
application-level headers (`content-type`, `x-event-delivery-id`, credential header) **in addition to**
the client's transport-mandatory headers (`Host`, `Content-Length`, `Accept-Encoding`, `Connection`, …),
explicitly "does NOT require the total header count to equal three," and states F-010 introduces "exactly
one new application-level header." REQ-F010-024's acceptance test carries the same qualifier ("the three
application-level headers … not a literal total header count"). Both prior readings now collapse to
Reading B. RESOLVED.

Rev-1 non-blocking NOTEs also addressed: the header-illegal-byte boot check is folded into REQ-F010-017
(CR/LF/NUL → refuse to boot, any env); the dev-missing header-omission ambiguity is resolved by
REQ-F010-024(b-missing) stating the relay "POSTs **without** the credential header."

---

## Regression scan of changed requirements (REQ-F010-005 / -007 / -017 / -024)

No blocking regression introduced. Four non-blocking observations follow.

### [NOTE] REQ-F010-005 (unconditional three-header MUST) vs REQ-F010-024(b-missing) (dev omits the credential header)
REQ-F010-005 states, unconditionally, "the outbound POST MUST carry the three application-level headers …
and the credential header." REQ-F010-024(b-missing) describes a compliant dev-only path where the relay
"POSTs **without** the credential header" (two application-level headers). Strict reading: an invariant
("always three") conflicts with an enumerated exception ("two, in dev-missing"). Charitable reading
(the one I adopt, so this is a NOTE not a CONTRADICTION): REQ-F010-005's value clause is "the configured
secret … as read from the credential env var," which presupposes a configured secret; when none is
configured — only possible under dev boot-soft — there is nothing to attach, and REQ-F010-024(b-missing)
governs. The invariant holds everywhere it is preconditioned (production is always credential-configured,
per REQ-F010-017). Recommend scoping REQ-F010-005's header-set assertion to "when a credential is
configured" to remove the residual tension explicitly.

### [NOTE] REQ-F010-005 — "byte-for-byte incl. leading/trailing whitespace" test vs the "beyond what HTTP header transmission requires" carve-out
REQ-F010-005 simultaneously (i) requires the wire value to preserve leading/trailing spaces
(`" abc "` → `" abc "`) and asserts a test that "value equals the configured secret byte-for-byte
(including any leading/trailing whitespace)," and (ii) hedges "beyond what HTTP header transmission
requires." HTTP field-value semantics (RFC 7230) treat leading/trailing OWS as excludable, and some
Node HTTP clients strip it. If the chosen client strips OWS, the byte-for-byte-including-whitespace test
is un-passable *regardless of implementation* — an untestability risk confined to the whitespace-padded
credential case (itself flagged as "almost certainly a misconfiguration"). Non-blocking because the
value is well-defined for the normal (non-padded) case and REQ-F010-017 explicitly designates padded
values as operator error; recommend the runbook (REQ-F010-016) warn that leading/trailing whitespace may
not survive the HTTP client and should never be relied upon.

### [NOTE] REQ-F010-017 "MAY boot soft" (optional) vs REQ-F010-024(b-missing) acceptance arm that requires dev boot-soft
REQ-F010-017 leaves the dev posture optional ("In development the relay **MAY** boot soft"), yet
REQ-F010-024(b-missing)'s acceptance test drives "in `NODE_ENV != production`, an absent credential →
boots → 401 → immediate permanent park," which presumes dev *does* boot soft. An implementation that
legitimately chose dev fail-fast (permitted by MAY) would make that one test arm undrivable. Non-blocking
because the happy path (arm a), the wrong-credential arm (b-wrong), and the production-missing boot-refusal
arm are all NODE_ENV-independent or production-pinned and fully testable irrespective of the dev choice;
only this single sub-arm is contingent. Recommend either promoting dev boot-soft to MUST for the purpose
of this acceptance arm, or marking arm (b-missing) as conditional on the dev-boot-soft default.

### [NOTE] REQ-F010-017 header-legality set is illustrative ("e.g. CR, LF, or NUL")
The rule ("bytes illegal in an HTTP header field value → refuse to boot, any env") is complete by
reference and unambiguous; the enumerated bytes are examples and the test pins exactly CR/LF/NUL. Other
control bytes (0x01–0x08, 0x7F) are covered by the rule but not by the test. No action required — noting
that the rule, not the examples, is the normative surface, so QA should validate against
"illegal-in-field-value," not only the three named bytes.

---

## Contradiction re-check of changed sections against the whole (round-2 requirement)
- REQ-F010-017 (production fail-fast on empty credential + peer configured) vs REQ-F010-020
  (`.env.example` ships the credential key empty): consistent — `.env.example` also ships `EVENT_BUS_URL`
  empty, so no peer is configured in the example and the fail-fast precondition is not met.
- REQ-F010-017 (whitespace-only boots + delivers verbatim) vs REQ-F010-017 (CR/LF/NUL → refuse boot):
  consistent — SP/HTAB are legal field-value bytes, control bytes are not.
- REQ-F010-024 (four-arm acceptance) vs REQ-F010-014/-015 (permanent-park / fan-out) and REQ-F004-055:
  consistent — every delivering arm routes through the unchanged 401→permanent mapping.
- REQ-F010-007 (raw single string, not split/trimmed) vs REQ-F010-003 (peer list split/trim unchanged):
  consistent — split/trim is explicitly fenced to the peer list only.

---

Verdict: PASS WITH NOTES

The three rev-1 blocking ambiguities are each resolved cleanly and no new AMBIGUOUS / UNTESTABLE /
CONTRADICTION / blocking-GAP was introduced by the rev-2 deltas. Four non-blocking notes remain for the
human's awareness; none prevents finalization. Round-2 review budget is now exhausted for this spec.
