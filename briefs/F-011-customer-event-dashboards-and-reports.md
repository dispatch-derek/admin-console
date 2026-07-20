# F-011: Dashboard and reports for visualizing the data coming in as customer.* events from customer-web-app

> Cross-repo naming note: "cwa" = the `customer-web-app` repo. **cwa F-005** is that
> repo's cross-app identity sync; **cwa F-007** is its production event-relay twin
> (the outbound delivery half of the `customer.*` stream). **admin-console F-004** is
> this repo's already-implemented outbound event bus/relay for `admin.*` events, and
> **admin-console F-010** is the peer registration for the opposite (admin-console →
> cwa) direction. None of these are this row; every reference below is disambiguated
> inline.

## Problem — what's broken/missing, for whom, observed how. No solution language. (feeds: user_value)

customer-web-app catalogues and emits a stream of 13 `customer.*` event names across 7
families (user, conversation, answer, topic, topic_user, branding, addon), covering
sign-in/sign-out, conversation lifecycle, answer delivery, topic and document changes,
topic/user assignment, branding changes, and add-on toggles. That activity record exists
at the point of emission and is, today, unavailable to anyone in admin-console. Nothing
in admin-console can see it, hold it, or answer a question from it.

Observed state of the gap in this repo:

- **No inbound surface.** `bff/src` has 0 matches for `customer.` and 0 for `ingest`;
  none of the 52 route-method registrations across 8 route files is an event-ingest path;
  `bff/src/relay/http-peer-transport.ts` is outbound-only with no inbound counterpart.
- **Nowhere for the record to live.** The single better-sqlite3 WAL store has 11 tables
  and 9 repository modules; two are append-only and time-ordered (`audit_log`,
  `event_outbox`), but 0 tables store externally-received events. The 7-day
  `EVENT_BUS_RETENTION_MS` prune window that exists applies to this app's *outbound*
  `admin.*` outbox; there is no inbound-event retention configuration anywhere in the repo.
- **No capability to render the record over time.** `web/package.json` declares 3
  production dependencies (`@phosphor-icons/react`, `react`, `react-dom`); there are 0
  charting/graphing libraries in deps or devDeps, 0 chart/graph/plot/sparkline components
  across 132 files in `web/src`, and no SVG-plot or canvas rendering code.

Consequently, three groups currently have no way to get at cwa customer activity from the
console: staff investigating what happened on a given customer account, reviewers who need
a durable, exportable activity record, and anyone asking aggregate questions about how
customers use the product. Today each of those questions has no answer available in
admin-console at all — not a slow answer or a partial one.

Honest encoding of how this was observed: this gap was found by inspecting the code and
the two repos' workbooks, **not** from reported pain. There are 0 GitHub issues in this
repo (of 5) mentioning dashboards, reports, charts, or visualization; 0 customer support
tickets, 0 usage analytics, and 0 interview records exist in either repo. The one recorded
human statement of intent is captured in Existing Evidence and belongs to a different
feature's data (F-006). This is a declared-but-unconsumed stream and a missing capability,
not an observed complaint.

## Affected Users — segments, share, frequency. (feeds: reach)

Product-owner ruling (2026-07-19): the audience is all three of the following, not an
audit-only subset, and the scope covers all 13 `customer.*` families.

- **Internal ops / support staff** — per-customer drill-down while investigating account
  activity ("what did this user/topic/conversation do, and when"). Frequency follows
  support/investigation workload, which is not measured in either repo. This segment
  already uses the console's read-only surfaces (`ChatOversight.tsx`, `UserList.tsx`,
  `WorkspaceList.tsx`), so the console is their existing habitat.
- **Compliance / audit reviewers** — need an evidence-grade, exportable, retention-aware
  activity record. Frequency is episodic (review/attestation cycles), and no cycle,
  regulation, or retention obligation is on record: 0 references to any named regulatory
  regime (SOC2, GDPR, HIPAA, ISO) and 0 stated data-retention obligations exist in either
  repo. What "evidence-grade" means for this segment is therefore unestablished (see Open
  Questions).
- **Product / business reporting** — aggregate usage trends across customers rather than
  per-customer drill-down. Frequency is periodic (weekly/monthly reporting rhythm),
  unmeasured here.

Share and frequency, stated honestly:

- **The stream has 0 consumers today**, in either repo. Nothing reads `customer.*`.
- **Both upstream producers are unshipped**: cwa F-005 is In Progress (rank 4) and cwa
  F-007 is Deferred (rank 2), both `date_scored` 2026-07-19. 2 of 2 upstream rows are
  unshipped, so the stream does not yet arrive anywhere.
- **Volume is unknown.** There are 0 observed event-volume measurements in either repo and
  0 `customer.*` volume figures anywhere. The single numeric figure of record — "p95
  emit-to-ack < 5 s; sustain ≥ 50 ev/s" — is a *design target* for admin-console's own
  outbound bus, not a measurement of customer activity.
- The size of each of the three segments is not recorded anywhere in either repo; they are
  named by product-owner ruling, not sized by data.

## Business Rationale — falsifiable. (feeds: business_value)

Falsifiable claims:

1. **cwa's customer activity record is currently unreachable from admin-console.**
   Falsifiable by grepping `bff/src` for `customer.`/`ingest` (currently 0 matches) and by
   enumerating the 52 route-method registrations (0 ingest paths). If any of the three named
   audiences needs cwa activity data, admin-console cannot supply it today at any latency.
2. **cwa has already named admin-console as the intended consumer.** cwa's F-007 brief
   records product-owner ruling (d), 2026-07-19: admin-console is the intended near-term
   consumer of the `customer.*` stream "for audit and customer-reporting". That brief also
   records (line 134) that the admin-console-side consumer was "not yet tracked as a
   feature" — F-011 is the row that closes that traceability gap. Falsifiable against
   `~/git/customer-web-app/briefs/F-007-production-event-relay-twin.md`.
3. **cwa's relay work is justified partly by this consumer existing.** cwa F-007's business
   rationale claim 4 asserts the delivered stream has a named business purpose because
   admin-console will consume it. If F-011 is never built, that portion of F-007's value
   case does not realize — the two rows' value cases are coupled and jointly falsifiable.
4. **The stated commercial upside is an expressed intent, not a measured demand.** The
   strongest evidence of record is a verbatim product-owner statement dated 2026-07-19 in
   `briefs/F-006-local-first-workspace-llm-observability.md`: "We view that the data that
   we would get from observability tools would be of value to our customers and could
   benefit our revenues as a way to provide customer value through reports or dashboards."
   Two honesty caveats that must not be dropped: (a) that statement is about **F-006's**
   observability data, not the cwa `customer.*` stream, and (b) it is an intent statement,
   not a pricing decision, a customer commitment, or a measured willingness to pay. F-006's
   own brief leaves "are customer-facing reports/dashboards a packaged/paid capability"
   open and unresolved.

Honest encoding so business_value is not inflated: **the value case rests on a
product-owner statement of intent, not on observed demand.** 0 support tickets, 0 usage
analytics, 0 GitHub issues, 0 interview records. Outside F-006, 0 briefs and 0 specs in
this repo frame a reporting capability. Of 17 workbook rows (11 Feature, 6 Defect), 2 are
reporting-adjacent (F-006 Prioritized rank 11; D-003 Prioritized rank 1), neither of which
requests this. The concrete, verifiable part of the case is integration completion and
closing the traceability gap cwa F-007 flagged; the revenue/customer-value part is
aspiration on the record.

## Timing — deadlines/windows or "none known". (feeds: time_sensitivity)

**October 2026 GTM.** The October 2026 go-to-market goal applies to this row. Encoded
exactly as cwa's F-007 brief encodes it: it is an **internal company goal date, not an
external or regulatory deadline**. Its concrete date, and the precise definition of what
GTM requires of this row, are not pinned down (see Open Questions). Context for how firm
this is: October 2026 is named as a timing driver in 5 admin-console briefs (F-001, F-002,
F-003, F-004, F-005), and F-001 still carries the **unresolved** open question "Is October
2026 GTM a hard compliance gate or a soft target for the console?" No named regulatory
regime and no stated retention obligation exist in either repo to harden it.

**Hard sequencing constraint — this row cannot deliver value until two upstream rows ship,
in order:**

1. **cwa F-005 (cross-app identity sync)** — currently In Progress (rank 4). cwa F-007's
   product-owner ruling (c), 2026-07-19: F-007 is to be built only after F-005 is
   implemented.
2. **cwa F-007 (production event-relay twin)** — currently Deferred (rank 2). Until it
   ships, cwa's bus-mode publish path is insert-only and nothing is delivered off-box;
   there is no `customer.*` stream arriving anywhere for this row to consume.

Until both land, any work here consumes a stream that does not arrive. That is a
sequencing fact, not a recommendation about when to schedule it.

## Existing Evidence — pointers only; agent entries prefixed [agent-discovery 2026-07-19]; human leads untagged. (feeds: confidence)

All entries below are **leads for a later research pass to re-verify**, not established
fact. The `[agent-discovery ...]` entries are this pipeline's own prior output and may be
stale.

Human leads (untagged):

- Product-owner rulings on this row (2026-07-19): (1) the audience is all three of
  internal ops/support, compliance/audit reviewers, and product/business reporting; (2)
  scope covers all 13 `customer.*` families, not a narrowed audit-only subset; (3) the
  October 2026 GTM goal applies as an internal company goal date, not an external or
  regulatory deadline, with concrete date and precise requirements still unpinned.
- cwa F-007 brief (`~/git/customer-web-app/briefs/F-007-production-event-relay-twin.md`),
  recording product-owner ruling (d) 2026-07-19: admin-console is the intended near-term
  consumer of `customer.*` for audit and customer-reporting; ruling (c): F-007 is built
  only after cwa F-005; line 40: "no consumer… running in either repo today"; line 134:
  the admin-console consumer is "not yet tracked as a feature".
- Verbatim product-owner statement, 2026-07-19, recorded in
  `briefs/F-006-local-first-workspace-llm-observability.md`: "We view that the data that we
  would get from observability tools would be of value to our customers and could benefit
  our revenues as a way to provide customer value through reports or dashboards." (About
  F-006's observability data, not the `customer.*` stream.)
- Unresolved open question carried in `briefs/F-001-*`: "Is October 2026 GTM a hard
  compliance gate or a soft target for the console?"
- Intake demand: 0 GitHub issues (of 5) and 0 briefs/specs outside F-006 request a
  reporting or visualization capability; 0 support tickets, 0 usage analytics, 0 interview
  records exist in either repo.

Agent-discovered signals (re-verify before scoring):

- [agent-discovery 2026-07-19] cwa `bff/src/events/catalog.ts:5-33` — 13 `customer.*` names
  across 7 families (user, conversation, answer, topic, topic_user, branding, addon).
  `CustomerEventEnvelope<P>` has 7 fields (event, actor, target, changes?, verified,
  timestamp, payload?), declared SCHEMA-IDENTICAL to admin-console's `AdminEventEnvelope`,
  differing only in name namespace. Only **1 of 13** declares a typed payload
  (`AnswerDeliveredPayload { citationCount, latencyMs }`); 12 of 13 carry only untyped
  `changes`/`target`.
- [agent-discovery 2026-07-19] cwa emit sites — 11 call sites covering the 13 names.
  Observed shapes: `conversation.started` target `{id, topicId}` changes `{title}`;
  `conversation.renamed` target `{id}` changes `{title}`; `conversation.deleted` target
  `{id}` no changes; `topic.documents_changed` changes `{adds, deletes}`; `topic.updated`
  changes = arbitrary `patch`; `topic_user.assigned|unassigned` target `{topic, user}` no
  changes; `branding.updated` target `{}` changes `{businessName, logo}`; `addon.toggled`
  changes `{installed}`; `user.logged_in|logged_out` target `{id}` no changes. Citations:
  cwa `conversations.routes.ts:87,113,134`; `topics.routes.ts:105,131,176,180`;
  `appstate.routes.ts:26,52`; `auth.routes.ts:51,60`; `users.routes.ts:34`;
  `chat.routes.ts:81`.
- [agent-discovery 2026-07-19] admin-console has no inbound event surface: 0 matches for
  `customer.` and 0 for `ingest` in `bff/src`; 0 of 52 route-method registrations across 8
  route files is an event-ingest path; `bff/src/relay/http-peer-transport.ts` is
  outbound-only with no inbound counterpart.
- [agent-discovery 2026-07-19] Persistence: better-sqlite3, single WAL file, **0 `.sql`
  migration files** — forward migrations are idempotent `CREATE TABLE IF NOT EXISTS` +
  PRAGMA-guarded `ALTER` at module load; down-migrations are hand-written functions
  (`rollbackF002/F004/F005`). 11 tables, 9 repository modules. Two append-only time-ordered
  tables exist (`audit_log`, `event_outbox`) but **0 tables store externally-received
  events**. `bff/src/store/db.ts:79-222,224-253,318-424`.
- [agent-discovery 2026-07-19] No charting capability: 3 production deps total
  (`@phosphor-icons/react`, `react`, `react-dom`); 0 charting/graphing libraries in deps or
  devDeps; 0 chart/graph/plot/sparkline components across 132 files in `web/src`; no
  SVG-plot or canvas rendering code. `web/package.json:14-18`.
- [agent-discovery 2026-07-19] Largest existing read-only surfaces:
  `features/featureToggles/FeatureTogglesPage.tsx` 180 lines;
  `features/users/UserList.tsx` 163; `features/workspaces/WorkspaceList.tsx` 119;
  `features/users/ChatOversight.tsx` 101; `features/diagnostics/DiagnosticsPage.tsx` 75.
  Largest read-only backend surface = 53 lines total (`oversight.service.ts` 27 +
  `oversight.routes.ts` 26).
- [agent-discovery 2026-07-19] Reusable patterns: one shared
  `design-system/components/Table.tsx` (70 lines, `Table = Object.assign(TableBase, {Row,
  Cell})`, `columns`/`minWidth` API, 3 consumers). One paging implementation —
  `ChatOversight.tsx` with `PAGE_SIZE = 20` and prev/next offset buttons. **0 matches for
  `paginat`/`pageSize`/`loadMore`** anywhere in `web/src` — no generic pagination
  component. 18 files import from the design-system barrel.
- [agent-discovery 2026-07-19] Design-system constraints: 160 custom-property declarations
  across 4 token files (colors 87, light-source 30, spacing 26, typography 17).
  `web/src/index.css` is 1127 lines declaring 0 properties, consuming 36 `var(--…)` refs.
  4 build-blocking gates: `build = lint:ds && lint:css && tsc && vite build`,
  `lint:ds = eslint src && oxlint --deny-warnings`, `lint:css = stylelint`. 688 lines of
  token-conformance tests across 4 files. Workbook F-001 = Prioritized, rank 2.
- [agent-discovery 2026-07-19] Upstream producers both unshipped: cwa F-005 = In Progress
  (rank 4), cwa F-007 = Deferred (rank 2), both `date_scored` 2026-07-19. 2 of 2 upstream
  rows unshipped. Local branch `feature/F-005-cross-app-identity-sync` exists, not on origin.
- [agent-discovery 2026-07-19] Sequencing: cwa F-007 brief records 6 product-owner rulings
  (a)–(f) including "(c) build this only after F-005 is implemented" and "(d) admin-console
  is the intended near-term consumer for audit and customer-reporting"; its line 40 records
  "no consumer… running in either repo today"; line 134 records the admin-console consumer
  "not yet tracked as a feature".
- [agent-discovery 2026-07-19] Retention: `EVENT_BUS_RETENTION_MS` default 604800000
  (7 days), `EVENT_BUS_PRUNE_EVERY_CYCLES` default 3600; prune is `DELETE FROM event_outbox
  WHERE published_at IS NOT NULL AND published_at < ?` — published rows only,
  unpublished/parked never pruned. This applies to the outbound `admin.*` outbox; **there
  is no inbound-event retention configuration in the repo**.
- [agent-discovery 2026-07-19] Volume: exactly 1 numeric event-rate figure of record —
  "p95 emit-to-ack < 5 s; sustain ≥ 50 ev/s" — a **design target, not an observed
  measurement** (`docs/design/09-F004-production-event-bus.md:289-291`). A spec review
  records that the throughput requirement originally had "no defined rate". 0 observed
  event-volume measurements in either repo; 0 `customer.*` volume figures anywhere.
- [agent-discovery 2026-07-19] Demand evidence (thin): 0 of 5 GitHub issues across the repo
  mention dashboards/reports/charts/visualization. Workbook has 17 rows (11 Feature, 6
  Defect); 2 are reporting-adjacent — F-006 (Prioritized, rank 11) and D-003 (Prioritized,
  rank 1). `briefs/F-006-local-first-workspace-llm-observability.md` records the verbatim
  product-owner statement quoted above (2026-07-19), plus "usage metering/chargeback remains
  out of scope", a design read that time-series display "would require a new visualization
  pattern (new dependency or hand-built SVG)", and open questions "Where does customer-facing
  reporting live" and "Are customer-facing reports/dashboards a packaged/paid capability".
  Outside F-006, 0 briefs and 0 specs frame a reporting capability. 0 customer support
  tickets, 0 usage analytics, 0 interview records exist in either repo.
- [agent-discovery 2026-07-19] October 2026 / compliance: named as timing driver in 5
  admin-console briefs (F-001, F-002, F-003, F-004, F-005). F-001 records the unresolved
  open question "Is October 2026 GTM a hard compliance gate or a soft target for the
  console?" cwa F-007 states it is "an internal company goal date, not an external or
  regulatory deadline". F-004's brief names "audit/compliance pipelines" as downstream
  consumers but frames it conditionally ("if audit or compliance depends on…"), naming no
  regulation. 0 references to any named regulatory regime (SOC2, GDPR, HIPAA, ISO) and 0
  stated data-retention obligations in either repo; the only retention figure of record is
  the 7-day operational prune window.

## Proposed Direction — one non-binding paragraph.

Non-binding sketch: although the workbook row is titled "dashboard and reports", the
discovery signals suggest the visualization layer is the last of at least four layers, and
the row should not be read as a front-end-only piece of work. A plausible shape is
layered — (1) an **inbound ingest surface** in `bff/src` to receive `customer.*` envelopes
from cwa's relay (none exists today; the existing `http-peer-transport.ts` is outbound-only,
and the envelope being declared schema-identical to `AdminEventEnvelope` may make the
receiving contract cheap to define); (2) **persistence and retention** for received events,
likely a new append-only time-ordered table following the existing `audit_log`/
`event_outbox` shape and the repo's idempotent `CREATE TABLE IF NOT EXISTS` migration
convention, plus an inbound retention policy which currently has no counterpart in config;
(3) a **query/read surface** over that table serving all three audiences' access patterns —
per-customer drill-down, exportable evidence-grade extracts, and cross-customer aggregates;
and only then (4) a **presentation layer** in `web/src`, where there is currently no
charting dependency and no chart component, so tabular/list rendering could reuse the
existing shared `Table.tsx` and the `ChatOversight.tsx` paging idiom, while any time-series
rendering would need either a new dependency (weighed against a 3-dependency front end and
4 build-blocking lint/token gates) or hand-built SVG — the same trade-off F-006's design
read already surfaced. Nothing here is committed; sequencing, layer boundaries, and whether
all 13 families get equal treatment are open.

## Design Considerations

UX complexity and risk reads from the **ux-designer agent** (DESIGN role, 2026-07-19). These
**inform** the human's later Effort and Risk scores; they do not set them, and no score is
proposed here. Like the Proposed Direction they attach to, they are non-binding.

- **complexity_read:** The Proposed Direction reads as one surface but design-wise it is three
  distinct patterns landing together. (a) Per-record drill-down is the only one with real
  precedent: `web/src/design-system/components/Table.tsx` (70 lines, `columns`/`minWidth` API,
  3 consumers) plus the offset pager in `ChatOversight.tsx` covers it, though there is no
  generic pagination component anywhere in `web/src` (0 matches for
  `paginat`/`pageSize`/`loadMore`), so the pager is a copy of a 6-line idiom, not a reusable
  primitive — a fourth consumer of that idiom is the point where extracting one becomes a
  design decision rather than a copy-paste. (b) Evidence-grade export is a pattern with no
  precedent in the app at all: export affordance, scope/date-range disclosure, "what you are
  getting" confirmation, and retention-window communication are all new interaction vocabulary
  here. (c) Cross-customer aggregate/time-series is the genuine discontinuity — `web/package.json`
  carries 3 production dependencies and zero charting libraries, and there are 0
  chart/graph/plot/sparkline components and no SVG-plot or canvas code across 132 files in
  `web/src`. Any trend rendering is either a new dependency that has to pass 4 build-blocking
  gates (`lint:ds` eslint+oxlint, `lint:css` stylelint, `tsc`, `vite build`) and 688 lines of
  token-conformance tests including a dual-theme harness, or hand-built SVG that has to declare
  its own color/geometry vocabulary against 160 existing custom properties across 4 token files.
  F-006's design read reached the same conclusion independently. Separately, the payload shape
  drives most of the presentational design work: only 1 of 13 event names
  (`AnswerDeliveredPayload { citationCount, latencyMs }`) has a typed payload, so 12 of 13
  arrive as untyped `changes`/`target` bags with per-family shapes (e.g. `topic.updated` carries
  an arbitrary `patch` object). Making those human-readable is per-family display logic — a
  renderer registry or per-family cell formatters — not a column list; that design work is
  invisible in the "reuse Table.tsx" framing. For scale calibration only: the largest read-only
  feature page in the app today is `FeatureTogglesPage.tsx` at 180 lines, and this sketch spans
  three access patterns and one new rendering category.

- **ux_risk_read:** Accessibility exposure is the sharpest risk and it is concentrated in the
  visualization layer. This repo has a live, recurring contrast-defect pattern — D-002
  (light-theme `--theme-text-secondary #7a7d7e` at 4.15:1, below the 4.5:1 WCAG 2.1 AA
  threshold, and byte-pinned by F-001's gates so it cannot be fixed in this feature's scope)
  and D-001 (provider panel background contrast). Every existing token must clear both themes
  because the dual-theme harness enforces it, so any new visualization introduces the same
  problem for a new class of colors. If a chart encodes meaning in color (event family, series
  identity, severity), that meaning must survive both themes, must not be color-only (needs
  shape/label/pattern or a data-table equivalent), and needs a non-visual path — screen-reader
  users and keyboard users get nothing from an SVG plot unless an accessible tabular
  alternative is designed alongside it, which effectively means designing the aggregate view
  twice. D-003 is the directly applicable cautionary precedent and it lives in the exact file
  proposed for reuse: `ChatOversight.tsx:77` renders `<pre>{JSON.stringify(chat, null, 2)}</pre>`
  (verified in-repo 2026-07-19). Copying that idiom for 12 untyped payload bags would reproduce
  D-003 by construction, and for the compliance/audit audience an unreadable dump is a
  functional failure, not a cosmetic one. Reversibility is asymmetric across the three layers:
  the drill-down table and the pager are cheap to redesign; a charting dependency is a
  one-way-ish door (bundle, token conformance, theming, a11y semantics baked into a vendor's
  DOM output), and the export format is the least reversible of all because auditors will
  retain and reference the artifact — its column set and semantics become a de facto contract.
  Usability-testing need is unevenly distributed too: the drill-down table needs little, but the
  per-family payload rendering needs to be checked with actual ops/support staff against real
  event bags (readability is the whole feature there), and the export needs one pass with a
  compliance/audit reviewer to confirm the artifact is evidence-grade and its retention window
  is legible rather than implied. Also worth surfacing for the human: none of the three
  audiences is sized by data (product-owner ruling 2026-07-19 named them but did not size them),
  so the risk that the surface is optimized for the wrong access pattern is a real, currently
  unmeasured design risk.

## Out of Scope

- **Building cwa's outbound relay twin** — that is cwa F-007's job (currently Deferred).
  This row consumes a delivered stream; it does not deliver one.
- **The cross-app identity-projection work** — cwa F-005 (currently In Progress), including
  the `customer.user.*` emission it defines.
- **Emission / `ctx.emit` wiring and the `customer.*` catalog itself** — already implemented
  in cwa; not this repo's to change.
- **The `admin.*`-direction peer registration** (admin-console → cwa) — that is F-010 in
  this repo, the mirror-image row.
- **Any change to admin-console's implemented F-004 outbound relay** or its outbound
  `event_outbox` retention/prune behavior.
- **Usage metering, chargeback, or billing** off customer event data — F-006's brief already
  records this as out of scope, and nothing here reopens it.
- **F-006's local-first workspace LLM observability telemetry** — a separate data source
  with its own row; whether the two share a reporting surface is an Open Question, not an
  in-scope commitment.
- **Extracting a shared event/relay package across the two repos** — deferred by the
  2026-07-18 ratified "no shared package yet" decision.

## Open Questions — an empty section is a red flag.

1. **Boundary with F-006.** F-006's brief already asks "Where does customer-facing reporting
   live?" F-006 (local LLM observability telemetry) and F-011 (the cwa `customer.*` stream)
   are two different data sources that could collide on one reporting surface. Are these one
   reporting capability with two feeds, or two independent surfaces? Which row owns the
   shared parts? Unresolved, and it materially changes both rows' shape.
2. **Internal-only or customer-facing?** F-006 records the unresolved question of whether
   reports/dashboards are a packaged/paid capability. Ruling 1 names three *internal*
   audiences for F-011, but the strongest business-intent statement on record talks about
   customer value and revenue. Is F-011 internal-only, or a precursor to a customer-facing
   capability?
3. **Inbound retention policy.** No inbound-event retention configuration exists in the repo
   (the only retention of record is the 7-day outbound outbox prune), and no compliance
   obligation is on record to derive one from. How long must received `customer.*` events be
   kept, and who decides?
4. **Expected `customer.*` volume.** 0 observed measurements exist in either repo; the only
   rate figure of record is a design target for a different (outbound) path. What arrival
   rate and retained-row count should storage and query design assume?
5. **What "evidence-grade" means** for the compliance/audit audience, given 0 named
   regulatory regime and 0 stated retention obligations in either repo. Tamper-evidence?
   Immutability guarantees? A specific export format? Chain-of-custody?
6. **Do all 13 families need equal treatment?** Ruling 2 scopes all 13, but 12 of 13 carry
   only untyped `changes`/`target` (only `answer.delivered` declares a typed payload). Does
   "all 13" mean uniform depth of display/reporting for each, or uniform *ingest and
   retention* with differentiated presentation?
7. **What does October 2026 concretely require of this row?** The date is an internal goal,
   not a regulatory deadline, its concrete date is unpinned, and F-001's "hard gate or soft
   target" question is still unresolved. What must be demonstrably working by then — ingest
   only, ingest plus query, or full visualization?
8. **Does the sequencing hold?** This row cannot realize value until cwa F-005 then cwa
   F-007 ship, and both are unshipped (In Progress / Deferred). If cwa F-007 stays Deferred,
   is F-011 blocked, or is there an interim arrangement the product owner wants considered?
9. **Who confirms the three audiences' actual access patterns?** All three segments are named
   by ruling, not sized or interviewed (0 interview records, 0 analytics). What would count
   as sufficient validation before build?
