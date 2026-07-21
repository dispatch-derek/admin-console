# F-013: Instance notice authoring and admin.notice.* event emission

## Problem

Instance notices are instance-wide operational communications shown to customer-web-app
end users — a login banner, an unread indicator in the sidebar, and a mobile notice list,
all fed by `GET /api/notices` in customer-web-app. Those reader surfaces are live and
working today.

Per the 2026-07-20 product-owner ruling, the party who *should* author those notices is
the admin user working in admin-console: notices are instance-wide operational
communications and are the operator's message, not an individual app's message. That
capability does not exist here. This repository has no notice data model, no notice API,
and no notice surface: `bff/src/events/catalog.ts` declares 22 `admin.*` event types
(`admin.workspace.*`, `admin.user.*`, `admin.invite.*`, `admin.instance.*`,
`admin.raw_env.written`, `admin.baseline_prompt.*`, `admin.feature_toggle.changed`) and no
notice family at all; the only "notice" string matches under `web/src` are unrelated UI
copy in `web/src/features/users/MultiUserGate.tsx:3` and
`web/src/features/settings/OllamaModelSelect.tsx:23`. The designated author therefore has
no way to write, publish, or retire a notice from the surface they actually work in, and
no central record exists of what was communicated instance-wide, by whom, or when.

**Nobody is blocked from publishing a notice today.** customer-web-app already ships a
working local authoring path — `POST /api/notices`
(`bff/src/routes/appstate.routes.ts:65`) and `PATCH /api/notices/:id` (line 82), over a
notices store with `insert`, `setActive`, and `listActive` (lines 60, 75, 89), shipped in
that repo's F-001. Notices can be created and retired right now. The observable gap is
about *where authorship lives and what record it leaves*, not about whether the
communication can happen: content originates in a per-app surface, is visible only to that
app, and leaves no entry in admin-console's central audit trail
(`recordAudit`, `bff/src/audit/audit.ts:21`, backed by `audit_log`) even though the
operator's other instance-wide actions do.

## Affected Users

Two distinct populations, following the same split customer-web-app's F-003 brief uses:

1. **admin-console operators (staff users)** — the population the authorship ruling
   designates as the correct author of instance notices. They are the ones who currently
   have no authoring capability in the surface they work in, and who bear the governance
   consequence (no central record of what was communicated).
2. **customer-web-app end users** — the readers. They already receive notices through the
   live login banner, sidebar unread state, and mobile notice list. Their exposure is to
   *which* notices appear and how consistently, not to whether any appear at all.

**Honest limits on quantification.** Neither repository contains usage analytics,
telemetry on notice publication, or support-ticket intake. There is therefore no in-repo
basis to state:
- how many admin-console operators there are, or how many customer-web-app end users read
  notices;
- how frequently notices are actually published today through customer-web-app's local
  path, or whether that path is used at all in practice;
- **whether admin-console's admin population and customer-web-app's admin population are
  the same people.** This is the load-bearing unknown for both affected-user groups (see
  Open Question 4) and it is not answerable from either repository.

No numbers are estimated here. Establishing headcount, publish frequency, and population
overlap is work for the scoring-time evidence pass, drawing on sources outside these
repositories.

## Business Rationale

The driver, per the 2026-07-20 ruling, is **single source of truth and governance** for
instance-wide operational communications. The falsifiable claims available:

1. **Instance notices should originate where the operator works and be centrally
   auditable.** admin-console is the operator's surface; its mutation pattern already
   records every verified write to `audit_log` via `recordAudit`
   (`bff/src/audit/audit.ts:21`) and emits an `admin.*` event. Notices, which are
   instance-wide operational statements, currently sit outside that discipline entirely.
   *Falsifiable by:* discovering that customer-web-app's local notice writes are already
   audited to a comparable standard, or that notice content is not considered
   governance-relevant by the people accountable for it.

2. **The strong version of the problem statement was tested during drafting and fails; the
   weaker version is what stands.** The strong version — "instance notices cannot be
   published" or "the operator cannot communicate with customers" — is **false**.
   customer-web-app's `POST /api/notices` / `PATCH /api/notices/:id` path is shipped and
   working (`bff/src/routes/appstate.routes.ts:65,82`). What survives is a
   consolidation-and-record argument: authorship sits in the wrong place per the ruling,
   there is no central record, and there is no path for a single notice to reach more than
   one app. Whether that misplacement is a real operational cost or an architectural
   preference with no observed consequence is **not established from in-repo material**
   and is the central thing scoring-time evidence should test.
   *Falsifiable by:* finding that customer-web-app's admin population **is** the operator
   population (in which case authorship is already effectively where the ruling wants it,
   and only the audit-record half of the argument survives); or by finding that per-app
   authoring has caused no observed problem — no wrong-audience notice, no missing record
   anyone needed, no duplicated effort.

3. **The delivery machinery this would ride already exists on both sides, so the cost
   argument is about the authoring surface and the event family, not about building
   cross-app transport.** admin-console has a transactional outbox (`event_outbox` table,
   `bff/src/store/db.ts:137`; `outbox.repo.ts`) shipped as F-004, and a proven emission
   pattern (`emitAdminEvent`, `bff/src/events/emitter.js`). customer-web-app has a live
   ingest endpoint with delivery-id dedupe and shared-secret auth
   (`POST /api/events/ingest`, `bff/src/routes/ingest.routes.ts:80`), its F-005.
   *Falsifiable by:* finding that the existing relay cannot carry an event of this shape
   or payload size, or that F-010 (see Timing) turns out to be more than peer registration.

4. **A single-origin notice can reach more than one consumer; a per-app notice cannot.**
   Today a notice written in customer-web-app is visible only in customer-web-app. This is
   consistent with the standing principle that admin-console read layers should serve
   customer-web-app as a second consumer.
   *Falsifiable by:* establishing that there is and will be only one consumer app, making
   cross-app reach a hypothetical benefit.

No revenue, retention, contractual, or regulatory argument is available from in-repo
material. None is asserted here.

## Timing

**No deadline known.** No regulatory date, contract commitment, competitive move, launch
window, or seasonal driver has been supplied for this feature.

**A sequencing dependency exists inside this repository, and it is not a deadline.**
admin-console **F-010** — "Deliver admin.* events to customer-web-app: add its ingest
endpoint to the relay peer list"
(`briefs/F-010-deliver-admin-events-to-customer-web-app.md`, status **Prioritized — not
implemented**) — is what registers customer-web-app as a relay peer and provisions the
shared-secret credential its ingest endpoint requires. Until F-010 ships, `admin.notice.*`
events emitted by this feature have no delivery path to customer-web-app: they would be
written to the outbox and relayed nowhere. That is a real build-order constraint, but it
sets no date and creates no urgency by itself. Whether F-013 should ship before F-010
(emitting into a void until the peer is registered) or wait for it is genuinely open — see
Open Question 7. Any urgency attributed to this row on the basis of F-010's existence would
be a misreading.

Similarly, customer-web-app's F-003 (`briefs/F-003-cross-app-notice-sync.md` in that repo)
is **Deferred** and is a consumer of this work, not a clock on it.

## Existing Evidence

All entries below were supplied by the human from in-repo inspection during the 2026-07-20
drafting session. **No discovery scan was run**, so nothing here carries an
`[agent-discovery]` tag. Every entry is a **lead to re-verify at scoring time**, not
settled fact — file contents and line numbers drift.

**admin-console (this repo) — producer side, does not exist yet:**
- Zero notice capability. `bff/src/events/catalog.ts` declares 22 `admin.*` event types
  (`admin.workspace.*`, `admin.user.*`, `admin.invite.*`, `admin.instance.*`,
  `admin.raw_env.written`, `admin.baseline_prompt.*`, `admin.feature_toggle.changed`) and
  no notice family. The only "notice" matches under `web/src` are unrelated copy in
  `web/src/features/users/MultiUserGate.tsx:3` and
  `web/src/features/settings/OllamaModelSelect.tsx:23`. No notice data model, no API, no
  UI.
- Emission has a house pattern to follow:
  `emitAdminEvent(name, actorId, target, verified, payload)` from
  `bff/src/events/emitter.js`, called after a verified write — see
  `bff/src/services/workspace.service.ts:117,159,193,230`, and that file's header comment
  at line 3 describing the "re-shape → verify-after-write → emit event + audit" mutation
  sequence.
- Persistence is SQLite, tables declared in `bff/src/store/db.ts`: `staff:79`,
  `recovery_codes:94`, `sessions:102`, `login_challenges:110`, `workspace_map:119`,
  `audit_log:127`, `event_outbox:137`, `outbox_meta:159`, `baseline_prompt:173`,
  `workspace_baseline_state:185`, `feature_toggle_state:216`. Repositories live in
  `bff/src/store/repositories/` (audit, baseline, feature-toggle, login-challenges,
  outbox, recovery-codes, sessions, staff, workspace-map). A notice table and repository
  would be net-new.
- There is no dedicated migrations directory; migration behavior is exercised in
  `bff/test/store/*-migration.test.ts` (feature-toggle, baseline, f004-outbox), so an
  additive-table precedent exists.
- Audit: `recordAudit(entry)` at `bff/src/audit/audit.ts:21`, backed by the `audit_log`
  table and `audit.repo.ts`.
- Transactional outbox for events already exists (`event_outbox` table, `outbox.repo.ts`)
  — F-004's shipped production relay machinery.
- **F-010** (`briefs/F-010-deliver-admin-events-to-customer-web-app.md`) is
  **Prioritized — not implemented**; it registers customer-web-app as a relay peer and
  provisions the shared secret. See Timing.

**customer-web-app (`/home/derek/git/customer-web-app`) — consumer side:**
- Reader surfaces are live and unmodified: login banner, sidebar unread state, mobile
  notice list, fed by `GET /api/notices`.
- **Local authoring already works there**: `POST /api/notices`
  (`bff/src/routes/appstate.routes.ts:65`) and `PATCH /api/notices/:id` (line 82), over a
  notices store with `insert`, `setActive`, `listActive` (lines 60, 75, 89). Shipped in
  that repo's F-001. This is the evidence that falsifies the strong form of the problem
  statement — see Business Rationale claim 2.
- Event ingest is live and Implemented (its F-005): `POST /api/events/ingest`
  (`bff/src/routes/ingest.routes.ts:80`), session-guard-exempt
  (`bff/src/server/session-guard.ts:14`), with delivery-id dedupe
  (`bff/src/events/ingest/admin-envelope.js`, `readDeliveryId`) and shared-secret auth
  (`bff/src/server/ingest-auth.ts`), projecting through
  `bff/src/identity/projection.service.ts`. This is the proven precedent an
  `admin.notice.*` family would ride.
- Its brief `briefs/F-003-cross-app-notice-sync.md` is the consumer-side counterpart,
  status **Deferred**. It takes the authorship ruling as given and does not build the
  producer.

**Human rulings, 2026-07-20 (settled; recorded so later readers are not misled):**
- *Authorship.* The correct author of customer-web-app instance notices is the admin user
  working in admin-console, not customer-web-app's own admin. customer-web-app's F-003 is
  a pure event consumer, projecting admin-console-authored content into reader surfaces
  that already work.
- *Scope.* F-013 covers **both halves as one feature**: (a) the admin-console notice data
  model plus admin-gated authoring UI (compose / publish / retire), and (b) emission of a
  new `admin.notice.*` event family (created / updated / retired, exact names TBD) over
  the existing F-004 relay, following the pattern `admin.user.*` already proves. The
  halves are useless apart — authoring that emits nothing, or an event nobody can author.
- *Business driver.* Single source of truth / governance, as set out in Business
  Rationale. A consequence is that customer-web-app's local authoring path is expected to
  be retired or restricted — but **whether it is retired, restricted, or kept as a
  fallback is not settled** (Open Question 3).

## Proposed Direction

Non-binding sketch; nothing here narrows what engineering later estimates against.

A notice table and repository would be added under `bff/src/store/` alongside the existing
ones, following the additive-table pattern already exercised in
`bff/test/store/*-migration.test.ts`. Notice mutations would follow the house mutation
sequence documented at `bff/src/services/workspace.service.ts:3` — re-shape, verify after
write, then `recordAudit` plus `emitAdminEvent` — so that publishing a notice leaves the
same central record as every other instance-wide operator action. Events would enter the
existing `event_outbox` and ride F-004's relay unchanged.

A new `admin.notice.*` family would be declared in `bff/src/events/catalog.ts` beside the
existing 22 types, with create / update / retire members; names, payload shape, and
whether content travels inline or by reference are open (Open Questions 1 and 5). An
admin-gated authoring surface in `web/src` would let an operator compose, publish, and
retire an instance notice, and see what is currently live.

Sequencing relative to F-010 is a real choice, not a detail — see Timing and Open
Question 7.

## Design Considerations

Two reads from the **ux-designer agent** (2026-07-20), recorded verbatim. These inform the
human's later Effort and Risk scores; they do not set them. The agent notes both reads are
grounded only in the drafted Proposed Direction and the current codebase — no F-013 spec
and no design reference bundle exists yet.

- **complexity_read:** The compose/publish/retire shape lands on top of idioms this console
  already has, but no single existing surface carries the whole shape. The nearest
  precedent is the F-002 baseline-prompt page
  (`web/src/features/baseline-prompt/BaselinePromptPage.tsx`): a stateful page shell owning
  fetches and a compose → preview → typed-token confirm → outcome-panel sequence, with
  presentational children taking data + callbacks. Its editor (`BaselineEditor.tsx`) is a
  labeled DS Textarea over a single stored body of long-form text, with a "Save stores the
  text only — nothing reaches consumers until you apply" separation between authoring and
  fan-out. That separation is structurally the same idea as draft-vs-published, so the
  compose half of a notice surface is a re-application of an existing pattern rather than a
  new one. Where the analogy stops: baseline-prompt is a singleton — one stored text, no
  roster of authored items, no per-item lifecycle. A notice surface implies many notices
  over time. The closest list-of-authored-items management surface is InviteList
  (`web/src/features/users/InviteList.tsx`): create-form above a DS Table with a Status
  column and a per-row destructive action — the same create/lifecycle/retire skeleton, but
  it is a plainer surface (no confirm gate, status rendered as bare text) than a
  customer-visible publish would want. So a notice surface would be a composition of two
  existing patterns that have not previously been combined on one page.

  Lifecycle state display has a direct idiom: `SyncStateChip` encodes each state as glyph
  (aria-hidden) + text label + color class specifically so states stay distinguishable
  without color, and `FeatureToggleRow`/`ToggleConfirm` show the state-change-with-confirm
  pattern. A draft/live/retired chip set is a same-shaped instantiation, and `.sync-chip`
  plus the badge-success/warn/danger token trios in `web/src/index.css` already carry the
  visual vocabulary. Whether "draft" is even a state the notice model has is unsettled in
  the sketch, and the number of chips follows from that, not from design.

  Rich-text: there is no precedent anywhere. Every text surface in the repo is either a
  short single-line DS Input, a plain textarea (baseline text, `RawEditorSurface` for env
  content), or read-only `<pre>` with `white-space: pre-wrap` for display of stored text.
  There is no formatting toolbar, no markdown preview, no sanitization-facing editor, and
  no DS primitive for one — the design system ships Input, Textarea, Select, Toggle,
  Button, IconButton, Badge, Table, Modal, PageHeader, SidebarItem and nothing richer. If
  notice content is plain text, this stays inside the existing Textarea idiom; if it needs
  any markup, that is a net-new capability with no in-repo pattern to extend and a
  cross-app rendering contract (what customer-web-app will actually render) to settle
  first. The sketch leaves inline-vs-reference content open, so this fork is live.

  Design-system fit of what is new: a preview of the composed notice, a live-notice roster,
  and lifecycle chips all resolve to existing tokens and existing structural class families
  (`.baseline-region` cards, `.outcome-panel`, `.sync-chip`, DS Table). The one thing with
  no token or component answer is a rendering of what the notice will look like in the
  consuming app — the console has no fixture of customer-web-app's chrome, and cross-app
  visual fidelity is not something the shared token layer can supply.

- **ux_risk_read:** The defining exposure is that the operator commits an instance-wide,
  customer-visible change to a surface they cannot see. Every existing danger surface in
  this console shows the operator the actual target state before commit — baseline-prompt
  renders a per-workspace current-vs-composed diff and enumerates the destructive subset
  inside the DangerConfirm body; `MaskedDiffConfirm` does the same for raw env writes. A
  notice publish has no equivalent target to enumerate: the blast radius is "everyone", and
  the composed artifact renders in another application's login banner, sidebar indicator,
  and mobile list. Legibility before commit therefore has to be carried by content preview
  plus an explicit statement of audience, and any preview is an approximation of a surface
  this repo does not own — a fidelity gap that can quietly mislead. DangerConfirm's
  typed-token + named-target + stated-consequence contract is reusable here and is the
  natural gate, but the "target" string it wants is unambiguous elsewhere
  ("acme-workspace") and vague here.

  Reversibility is the second exposure and is weaker than the sketch's word "retire"
  suggests. Retire is an authoring-side state change; propagation is asynchronous through
  `event_outbox` and F-004's relay. So the operator's mental model ("I unpublished it") and
  the system reality ("a retire event is queued") diverge for an unbounded window, during
  which readers in the other app may still see the notice. This is the same class of
  honesty problem F-005 already solved locally — its live-region announcement explicitly
  says when clearing an override produced no customer-visible change rather than implying
  one — but there the console could observe the resulting state. Here it cannot: the
  console has no view of relay delivery at all. `DiagnosticsPage` exposes only vector count
  and a masked env dump; there is no outbox or relay-health surface anywhere in `web/src`
  to reuse or link to. Consequently a publish confirmed by `verifiedWrite` and audited is a
  confirmation about the local row, not about readers, and a naive success state would
  assert delivery the system never checked. Distinguishing "recorded here" from "reached
  readers" in the UI copy and state model is the central failure-legibility question, and
  the sketch does not say whether any delivery signal will exist to distinguish them. If
  none will, the surface should be designed to not claim what it cannot know.

  Error legibility otherwise follows established handling: ErrorBanner surfaces BFF
  `{ message }` verbatim, and the F-005 rule of keeping the dialog open with the row at its
  prior state on failure avoids stranded optimistic success. Partial-outcome reporting has a
  precedent too (the per-item outcome panel with applied/failed/skipped/diverged), which may
  be the right shape for a publish whose local write and downstream emit can succeed
  independently.

  Accessibility exposure: a compose/publish flow concentrates the patterns this repo has
  already had to get right by hand — modal focus trap, Escape, focus return when a
  successful confirm unmounts its own trigger (baseline-prompt threads a `fallbackFocusRef`
  at a section heading for exactly this), aria-live announcement of an outcome, and
  non-color-only state encoding for lifecycle chips. All of that is available to reuse, so
  the exposure is less about inventing than about a new surface reproducing the whole set
  correctly. Two specific pressures: a long-form composer plus a preview plus a roster plus
  a dialog makes focus order and heading structure do more work than on any current page;
  and lifecycle chips will lean on `--theme-text-secondary` and the badge token trios, which
  is precisely where the unresolved D-002 light-theme contrast failure lives — any muted
  helper text, chip label, or "not yet published" affordance built now inherits that defect
  rather than being cleared by this feature. Usability-testing need is concentrated on one
  question rather than the flow generally: whether an operator who has never seen the
  consuming app can correctly predict, from this surface alone, what end users will see and
  when they will stop seeing it.

## Out of Scope

- **customer-web-app's consumer and projection work** — its F-003. This feature is the
  producer half only.
- **F-010's relay peer registration and shared-secret credential provisioning.** A
  dependency (see Timing), not part of this feature's build.
- **Changes to the event envelope or relay transport.** F-004's machinery is consumed as
  is.
- **Relay authentication hardening** — that is defect D-006, tracked separately.
- **customer-web-app's existing reader surfaces** (login banner, sidebar unread state,
  mobile notice list). Consumed as they are; not redesigned here.
- **Notice targeting or segmentation beyond instance-wide** — excluded unless specifically
  argued back in (Open Question 6).
- **Scheduling and expiry automation** (publish-at, auto-expire) — excluded unless
  specifically argued back in.
- **Retiring or restricting customer-web-app's local authoring path.** *Contested:* the
  business-driver ruling anticipates this happening, but the decision is not made and the
  work would land in the other repository. See Open Question 3.

## Open Questions

1. **Does an `admin.notice.*` event carry the full notice content inline, or a reference
   the consumer resolves?** customer-web-app's F-005 ingest already establishes an
   envelope and a projection service (`bff/src/identity/projection.service.ts`) — the
   existing precedent should be checked and followed rather than re-litigated. Bears on
   payload size, on whether the consumer needs a read-back call, and on what happens when
   a notice is edited after delivery.
2. **Does `admin.notice.retired` tombstone or hard-delete on the consumer?** A tombstone
   preserves a record and supports idempotent replay under delivery-id dedupe; a delete is
   cleaner but loses history and interacts badly with out-of-order delivery. Not decided.
3. **What happens to customer-web-app's existing local authoring path** (`POST
   /api/notices`, `PATCH /api/notices/:id`) — retire, restrict to a break-glass role, or
   keep as a deliberate fallback? And **if both a locally-authored and a projected notice
   exist, what is the precedence rule?** Without an answer, the consumer has two writers
   into one reader surface and no conflict rule.
4. **Does admin-console's admin population actually correspond to customer-web-app's?**
   If they are the same people, the consolidation argument weakens sharply — authorship is
   already effectively in the operator's hands and only the central-record half of the
   rationale survives. If they are different populations, the misplacement is real. This
   question decides whether Business Rationale claim 2 holds in its weakened form or fails
   outright, and it is not answerable from either repository.
5. **What are the exact event names?** `admin.notice.created` / `.updated` / `.retired` is
   the working assumption drawn from `admin.user.*`, but the catalog's existing naming
   conventions (`bff/src/events/catalog.ts`) should govern, and whether "update" and
   "retire" are distinct events or one state-change event is unresolved.
6. **Are instance notices instance-wide only, or is targeting needed?** Targeting is
   currently in Out of Scope, but if any real notice needs to reach a subset of users or
   workspaces, the data model must accommodate it from the start rather than be retrofitted.
7. **Should F-013 ship before F-010, or wait for it?** Shipping first means emitting
   `admin.notice.*` events with no registered peer to receive them — the outbox accumulates
   deliveries with no destination, and the authoring UI works while nothing reaches
   customer-web-app end users. Shipping after means this feature is blocked on another
   Prioritized-but-unimplemented item. There is a third option — ship the authoring and
   emission but hold the UI behind a toggle — that has not been evaluated.
8. **Who may author a notice?** This brief assumes admin-gated authoring by staff users,
   consistent with the authorship ruling, but whether every staff user or only a narrower
   role should be able to publish an instance-wide communication is not settled, and the
   blast radius of a notice is instance-wide by definition.
9. **What delivery signal does the authoring surface get — and what may it claim without
   one?** A publish that passes `verifiedWrite` and is recorded by `recordAudit` confirms
   the local row only. Delivery to readers is asynchronous through `event_outbox` and
   F-004's relay, and this console has **no relay-delivery visibility at all**:
   `DiagnosticsPage` exposes only vector count and a masked env dump, and no outbox or
   relay-health surface exists anywhere in `web/src` to reuse or link to. So an operator
   can publish, see a success state, and have no way to learn whether any reader saw the
   notice — or, after a retire, whether readers have stopped seeing it. Three things need
   ruling on: (a) whether this feature exposes any delivery or outbox signal at all, or
   deliberately ships without one; (b) if not, what the surface is permitted to assert on
   success, since a naive "Published" claims delivery the system never checked and the copy
   must distinguish *recorded here* from *reached readers*; (c) whether the same reasoning
   applies to retire, where the mental model ("I unpublished it") and the system reality
   ("a retire event is queued") diverge for an unbounded window. This interacts directly
   with Open Question 7 — if F-013 ships before F-010, every publish succeeds locally and
   reaches nobody, and without a delivery signal the surface cannot say so. Bears on the
   reversibility and failure-legibility concerns in the ux_risk_read above.
