# Adversarial Spec Review — F-004 Production-Ready Event Bus (rev-5 delta)

Spec reviewed: `specs/F-004-production-event-bus.md` (Draft **rev 5**, `REQ-F004-###` namespace)
Prior review: `docs/spec-reviews/spec-review-F004-rev4.md` (B1 blocking regression; MJ-A major; N1–N5 notes)
Parent: `specs/admin-console.md` (v1, rev 7)
Scope: (1) verify each rev-4 finding is genuinely resolved; (2) fresh adversarial pass on the
changed areas — the B1 force-mark-published mechanism, the shared `attempt_count`/cap disposition,
the MJ-A migration backfill, and N1/N3/N4/N5.
Checks executed (8/8): misinterpretation, one-line-test, error-coverage, example-vs-prose,
definition audit, boundary audit, non-goal probe, cross-reference.

---

## Part 1 — Verify-the-fixes (rev-4 findings)

- **B1 (post-ack park → wedged key) — mechanism-level RESOLVED, but the fix opens a new disposition
  gap (see B1-new).** The park→wedge regression itself is gone: REQ-F004-011 (l.257-262) now
  **force-marks the row published** on post-ack cap rather than parking it, and a published row is
  correctly not eligible / not in per-key head-of-line (REQ-F004-041 l.287-291; REQ-F004-042
  l.309-326), so it stops re-delivery *and* unblocks the key. No path in REQ-F004-014 (l.457-482),
  REQ-F004-041, or REQ-F004-042 still parks a post-ack row — parking is textually reserved for
  never-acked poison (l.265-268). The new REQ-F004-025 post-ack-cap counter (l.693-702) is present and
  distinct from parked depth. **However**, the claim that this makes `parked_at` carry "a single
  unambiguous meaning — never-delivered poison" (l.268-269) is not actually true given the shared
  `attempt_count`; see **B1-new** below.

- **MJ-A (NULL `ordering_key` on pre-migration backlog) — RESOLVED.** REQ-F004-029 (l.627-654) now
  requires `ordering_key` non-null for **every** row: (i) the migration backfills it for all
  pre-existing rows from the stored envelope via the §3 derivation, (ii) enqueue populates it at
  INSERT, (iii) "lazily on first drain" is removed as circular, and (iv) a residual NULL is defensively
  treated as `__unkeyed__`. This is consistent with the eligibility SQL sketch (REQ-F004-041 l.294):
  a NULL key fails `ordering_key = '__unkeyed__'` but also fails the equality-join in the
  older-shares-key `EXISTS`, so it drains independently — matching the intended `__unkeyed__` fallback.
  Backfill derivation is well-defined: the frozen envelope shape (parent REQ-029c) is unchanged, so the
  total §3 derivation applies identically to pre-F-004 envelopes. REQ-F004-015 (l.507-509) and the new
  *Test (backfill)* (l.651-654) are consistent. Resolved.

- **N1 (boot-refuse rationale) — RESOLVED.** REQ-F004-021 (l.582-592) and REQ-F004-039 (l.848-851) now
  state the real hazard: `InProcessBus.publish` inserts **and immediately `markPublished`**, so rows are
  marked published-without-delivery and a later switch to `bus` never re-drains them → silent permanent
  loss. Accurate against the grounded `bus.ts:19-24`.

- **N3 (two-writer `SQLITE_BUSY`) — RESOLVED.** REQ-F004-020 (l.528-536) adds `busy_timeout` + treat
  `SQLITE_BUSY`/`SQLITE_LOCKED` as transient-retryable, and explicitly excludes a transient busy on the
  post-ack `markPublished` from the cap. Coherent with REQ-F004-011 l.252-254. Has a concrete test.

- **N4 (single-delivery test vs overlap tolerance) — RESOLVED.** REQ-F004-017 test (l.375-384) is now
  scoped to the held-lease/single-instance nominal path and names the crash-overlap window as the
  deliberately tolerated exception.

- **N5 (`ws:undefined` fallback) — RESOLVED.** §3 (l.158-163) makes a prefix-matching event with an
  absent/empty target field fall back to `__unkeyed__`, never a literal `ws:undefined`, and
  REQ-F004-029 (l.635-637) mirrors it.

---

## Part 2 — Fresh findings on the changed areas

### Blocking

#### B1-new — [AMBIGUOUS / CONTRADICTION] Shared `attempt_count` gives no way to route a cap-exhausted row to the intended disposition (park vs force-publish); an ever-acked row can still be parked, re-opening N2
REQ-F004-011 fixes B1 by routing on ack-ness: a row that "exhausts max attempts **without ever being
acked**" is **parked** (l.265-267), while a row whose effect was "**already acked**" force-**publishes**
(l.257-258). But the counter that drives "exhausts max attempts" is a **single shared `attempt_count`**:
post-ack mark failures increment it and are "subject to the **same max-attempt cap** as a delivery
failure" (l.255-257), and delivery failures increment the same field (REQ-F004-013 l.443-446). The
REQ-F004-029 schema (l.620-624: `attempt_count`, `next_attempt_at`, `last_error`, `parked_at`,
`ordering_key`) has **no "ever-acked" marker**, and `published_at` stays NULL in *both* the never-acked
and the acked-but-mark-failed cases — so persisted state cannot distinguish them.

A row's history can **mix** both failure types (reachable): R on key K is delivered, acked, `markPublished`
fails (increment, `published_at` still NULL, R stays eligible); on a later re-drain the transport is
transiently down, so the *delivery* fails (REQ-F004-013 increment + backoff); that increment crosses the
cap on a **non-acked** attempt. Two implementations both claim compliance:
- **Reading A** — disposition keys on the *current* (cap-crossing) attempt's outcome: the last attempt
  was a delivery failure (not acked) ⇒ the row is **parked** per REQ-F004-014 (l.457-461). But R **was**
  delivered/acked earlier, so a *delivered* row is now parked.
- **Reading B** — disposition keys on *ever-acked*: requires a persisted ack flag the schema
  (REQ-F004-029) does not define; how it is tracked is unspecified.

Reading A directly contradicts REQ-F004-011's own l.268-269 claim that, after this fix, "`parked_at` now
carries a single unambiguous meaning — never-delivered poison — closing review N2's conflation," and
contradicts REQ-F004-014 l.463-465 ("a parked event is delivered zero times"). It re-opens exactly the
N2 conflation the rev-5 note claims to close, and the REQ-F004-025 test (l.699-702), which assumes a
clean never-acked→park / acked→publish split, has no defined outcome for the mixed-history row.
Resolution: the spec must specify the state that makes the intended disposition realizable — e.g. add an
"ever-acked" column to REQ-F004-029 and rule that **any row ever acked force-publishes at cap regardless
of the final attempt's failure type**, or reset/separate `attempt_count` on a successful ack. As written,
the park-vs-publish disposition and the N2-closure claim are underdetermined. **BLOCKING.**

### Major

#### MJ-B — [GAP] The named typical trigger (crash in the post-ack window) cannot increment `attempt_count`, so the cap does not bound the loop it claims to bound
REQ-F004-011 (l.252-254) names the typical cause of persistent post-ack failure as "a repeated **crash**
in the narrow post-ack window," and says the `attempt_count` cap exists because such a row "would
otherwise be re-drained forever." But a crash in the ack→`markPublished` window persists **nothing** — the
process dies before any write, so `attempt_count` is never incremented across such crashes and the
delivery itself succeeded (ack received), so the REQ-F004-013 delivery-failure increment does not fire
either. In a pure crash-loop `attempt_count` stays 0 forever and the cap **never engages**; the row
re-delivers indefinitely (duplicates absorbed by dedupe). The cap therefore bounds only the *in-process-
caught* mark-error case, not the crash case it names as typical. The delivered behavior is still safe
(effectively-once, never lost), so this is non-fatal, but REQ-F004-011's stated mechanism does not
achieve the bound it claims for its own headline scenario. Recommend either dropping the "typically a
repeated crash" framing or specifying a crash-survivable signal (e.g. the ever-acked marker from B1-new,
set before the mark, which would also let the cap engage across crashes).

### Notes (non-blocking)

- **N-a — [NOTE] Force-mark uses the same write that is failing.** REQ-F004-011 (l.258) force-marks
  `published_at` "best-effort" — but setting `published_at` is precisely the `markPublished` operation
  reported as failing. If the failure is a genuine persistent write error, the force-mark fails too (the
  spec acknowledges this at l.263-264, deferring to `/ready`); if it is intermittent, an ordinary retry
  would also have landed. So the force-mark meaningfully "unblocks the key" only in cases a plain retry
  would also have resolved. The spec's best-effort + `/ready` framing is internally consistent, so this
  is an observation, not a defect — but combined with MJ-B it means the post-ack cap does very little
  concrete work beyond emitting the REQ-F004-025 alert.

- **N-b — [NOTE] Cross-ref: `/ready` has no reason code for the force-mark/store-unhealthy state.**
  REQ-F004-011 (l.263-264) says a force-mark that "cannot land" is "surfaced by `/ready`
  (REQ-F004-044)," but REQ-F004-044's enumerated `reason` values (l.725) are transport-unreachable,
  bus-mode-without-URL, backlog/lag-over-threshold — none names a store-write failure. The "e.g." makes
  the list non-exhaustive and a stalled store would also trip `lag-over-threshold` indirectly (rows
  cannot be marked published → oldest-unpublished ages), so it is arguably covered, but the direct
  cross-reference does not point at a matching reason.

- **N-c — [NOTE] Does a successful ack reset `attempt_count`?** Tightly coupled to B1-new. If a row
  accrued delivery-failure attempts, then finally delivers/acks but `markPublished` fails once, is that
  the *first* post-ack attempt (fresh budget) or does it inherit the prior delivery-failure count
  (possibly forcing publish on the first post-ack failure)? The REQ-F004-025 phrase "`markPublished`
  **repeatedly** fails" (l.700-701) is consistent with either, and both end published, so impact is
  low — but the retry budget before force-publish is unspecified. Resolving B1-new (reset/separate
  counter, or ever-acked flag) would settle this too.

---

## Verdict

**BLOCK (revise).** The rev-4 blocking regression (B1 park→wedge) is fixed at the mechanism level —
post-ack rows force-publish instead of parking, unblocking the key — and MJ-A (NULL `ordering_key`
backfill) plus notes N1/N3/N4/N5 are genuinely and consistently resolved. However, the B1 fix leaves the
park-vs-force-publish **disposition** underdetermined: `attempt_count` is a single shared counter with no
persisted "ever-acked" state (REQ-F004-029), so a row that was delivered/acked but later crosses the cap
on a delivery failure can still be **parked** — contradicting REQ-F004-011's own claim (l.268-269) that
`parked_at` now unambiguously means never-delivered and re-opening review N2 (**B1-new, blocking**).
Secondarily, the cap cannot engage for the crash-in-window case the spec names as typical (**MJ-B**).
Resolving B1-new (add an ever-acked marker and rule that any ever-acked row force-publishes at cap
regardless of the final failure type, or reset/separate the counter on ack) also settles MJ-B and N-c.
