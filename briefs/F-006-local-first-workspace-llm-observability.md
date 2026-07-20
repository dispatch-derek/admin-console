# F-006: Local-first per-workspace LLM observability (usage, performance, resource load)

## Problem

The appliance runs many workspaces against a single locally installed Ollama
provider through the AnythingLLM engine, but operators and customers cannot see
how any individual workspace behaves. There is no visibility into per-workspace
usage (how much a workspace is being used), performance (how fast or slow its
LLM responses are), or the resource load it places on the shared local hardware.

Concretely, three blind spots exist today:

- **Capacity / degradation is invisible.** An operator sizing hardware or
  watching for slowdown has no per-workspace performance or resource-load
  signal to reason from. Degradation is noticed only when a human complains, not
  observed as it develops.
- **The customer cannot be shown their own usage or performance.** There is no
  per-workspace usage/performance surface to report back to the customer whose
  workspaces these are.
- **After-the-fact troubleshooting has nothing to read.** When a specific
  workspace was slow or a response failed, support has no historical record of
  that workspace's request timings or failures to diagnose from — the event is
  gone once it has passed.

The one diagnostics screen that exists shows exactly two instance-wide facts (a
single vector count and a masked environment dump) and no per-workspace figures
and no history over time, so none of the three blind spots above are covered
today.

This section describes the missing visibility only; it takes no position on how
the visibility should be produced.

## Affected Users

- **Operators doing capacity planning and tuning.** They size the appliance's
  hardware, watch for degradation, and tune Ollama/engine settings; today they
  do this without per-workspace performance or resource-load data.
- **Customers receiving reporting.** The single-tenant customer whose
  workspaces run on the appliance is a consumer of usage/performance reporting
  surfaced back to them. (Whether that reporting is delivered inside
  admin-console or the customer-web-app is an open question below.)
- **Support / troubleshooting staff.** Whoever diagnoses a slow or failed
  response for a specific workspace after it happened.

Denominator note for reach scoring: this is a single-tenant appliance, so the
per-deployment population is one operator team and one customer per appliance,
multiplied across the installed fleet. Fleet size at launch, per product owner
(2026-07-19): **under 5 appliances in play**. Within each of those deployments,
all three consumer groups (operator, customer, support) are exposed to the
blind spots whenever they need capacity, reporting, or troubleshooting answers.

## Business Rationale

Product-owner rulings of 2026-07-19 frame the value:

- The three named consumers are (1) ops/capacity planning, (2) customer-facing
  reporting, and (3) troubleshooting/support. These are the falsifiable
  business claims to test: that operators cannot currently size/tune from data,
  that customers have no usage/performance report, and that support cannot
  diagnose past per-workspace incidents.
- This is **explicitly not** billing or metering — that use is ruled out, so
  business value should not be argued from revenue-metering grounds.
- **Product-owner addition, 2026-07-19 (verbatim):** "We view that the data
  that we would get from observability tools would be of value to our customers
  and could benefit our revenues as a way to provide customer value through
  reports or dashboards." This refines the exclusion above: usage
  *metering/chargeback* remains out of scope, but customer-facing reports and
  dashboards built on this data are viewed as a revenue-benefiting product
  capability. As a falsifiable claim: customers value per-workspace
  usage/performance reporting enough that it strengthens retention or supports
  revenue — testable against customer adoption of, or willingness to pay for,
  such reporting once deployed.
- The feature is bounded by a hard product constraint: zero-cloud, air-gap-
  friendly observability. The product owner's verbatim statement of the value
  proposition this constraint protects:

  > "Our value proposition is that our appliance and your data are safe because
  > we keep it secure on the local device. You do not share your data with any
  > AI companies. Your data stays in Canada, and even better, within the walls
  > of your business. We want to minimize the amount of internet touchpoints our
  > app and device has."

  Because of this, any observability that relies on a SaaS backend (Datadog,
  Grafana Cloud, or equivalent) is out of bounds by product definition, not by
  preference. The business rationale therefore rests on delivering the three
  consumers' visibility while keeping all telemetry on-device.

## Timing

Timing is tied to go-to-market / production readiness. No calendar date, launch
window, or competitive deadline was supplied. Whether GTM requires the full
three-consumer surface or an ops-minimum first is an open question below. No
other time-sensitivity input was provided (flagged).

## Existing Evidence

All entries below are discovery leads to be re-verified by the research role,
not established fact.

- `[agent-discovery 2026-07-19]` The only diagnostics screen today
  (`web/src/features/diagnostics/DiagnosticsPage.tsx:1-75`) renders exactly two
  instance-scoped things (one instance-wide vector count + a masked env dump);
  zero per-workspace metrics and zero time-series.
- `[agent-discovery 2026-07-19]` `bff/src/relay/metrics.ts:1-68` exists but
  covers only F-004 relay delivery (2 DB gauges + 5 in-memory process-lifetime
  counters); none are LLM-, workspace-, or resource-scoped.
- `[agent-discovery 2026-07-19]` No metrics/telemetry libraries in either app.
  BFF deps: fastify/cookie/cors/argon2/better-sqlite3/dotenv/otplib/qrcode; web
  deps: react/react-dom/phosphor-icons. No prom-client, opentelemetry, pino, or
  statsd present.
- `[agent-discovery 2026-07-19]` Per-workspace signals reachable today amount to
  only `GET /v1/system/vector-count` (instance-wide single integer,
  `adapter.ts:247-249`). ChatOversight queries per-workspace chats
  (`POST /v1/admin/workspace-chats`) but passes records through as opaque
  `unknown[]` — zero metric fields parsed (`oversight.service.ts:13-27`,
  `mappers.ts:228-231`, `engine-types.ts:96-108`).
- `[agent-discovery 2026-07-19]` The F-004 event catalog has 20 `admin.*` event
  names, all config/CRUD deltas; none carry usage/perf/resource data
  (`events/catalog.ts:5-92`).
- `[agent-discovery 2026-07-19]` Engine upstream: an `event_logs` telemetry
  table exists (id, event, metadata, userId, occurredAt) but its route
  `/system/event-logs` is session-auth-only and NOT reachable via the BFF's API
  key. The API-key surface is 6 operations, none usage-metric
  (`docs/anythingllm-surface.md:205-219`; upstream prisma schema). The
  `workspace_chats` columns (12) have no dedicated token/latency columns —
  timing/token data is embedded inside the response JSON blob
  (docs.anythingllm.com/features/chat-logs). No Prometheus endpoint upstream.
- `[agent-discovery 2026-07-19]` Ollama local: `/api/generate` and `/api/chat`
  responses carry 6 per-request numeric fields (total_duration, load_duration,
  prompt_eval_count, prompt_eval_duration, eval_count, eval_duration);
  `/api/ps` returns per-loaded-model size, size_vram, expires_at. No Prometheus
  endpoint. The BFF today consumes only `/api/tags` — zero of these metric
  fields (`adapter.ts:258`; github.com/ollama/ollama/blob/main/docs/api.md).
- `[agent-discovery 2026-07-19]` customer-web-app has a small observability
  scope (structured request logs; outbox inspectability;
  `customer.answer.delivered` event carrying citationCount + latencyMs —
  `specs/F-001-bff-layer-and-domain-events.md:890-902`) but no per-workspace
  usage/resource surface.
- `[agent-discovery 2026-07-19]` Zero mentions of per-workspace usage/resource
  observability anywhere in admin-console docs/README/CHANGELOG/git log; the
  term appears only in F-004 relay and engine-surface contexts.
- Fleet size at launch: under 5 appliances in play (product-owner statement,
  2026-07-19; human-supplied, not agent-discovered).

## Proposed Direction

One non-binding sketch, offered only to make the brief concrete: capture
per-workspace usage, performance, and resource-load signals on-device and
present them to the three consumers through admin-console (with customer-facing
reporting possibly surfaced via customer-web-app), backed entirely by
local storage with no cloud telemetry backend. Because the discovery leads
suggest per-request LLM metrics are visible to the engine (the caller of Ollama)
but not exposed to the BFF via API key, an implementation would first have to
resolve where those metrics can actually be captured; resource load might come
from Ollama's `/api/ps`, OS-level sampling, or another source. This direction is
illustrative and non-binding; it does not constrain the eventual design.

## Design Considerations

Reads from the ux-designer agent (2026-07-19); informs the human's later Effort and
Risk scores, does not set them.

- **complexity_read:** The three named consumers (operator capacity-planning,
  customer-facing reporting, after-the-fact troubleshooting) each carry a distinct
  mental model and likely a distinct view, rather than one shared dashboard —
  capacity planning wants aggregate trends across workspaces, reporting wants a
  clean per-workspace summary framed for a customer, troubleshooting wants to scrub
  to a past moment. The Proposed Direction also floats surfacing customer reporting
  via customer-web-app, which would mean designing across two front-ends with
  different (non-shared) component surfaces. Per-workspace scoping is an established
  pattern in the existing workspaces/ surfaces, so the navigation/scoping shell has
  precedent; the observability content inside it does not. This is the console's
  first time-series/history surface — nothing existing renders a trend over time, a
  time-window selection, a metric-series legend, or hover-to-inspect-a-datapoint;
  all are net-new interaction vocabulary. There is also a live-vs-historical
  dimension (ops/capacity may want near-current load; troubleshooting is explicitly
  retrospective) implying a time-range control or live/paused distinction not
  present anywhere today. Design-system fit: the DS covers tables, forms, and
  navigation but has no charting, plotting, axis, legend, tooltip, or date-range
  primitive, and no charting dependency exists (web deps are react, react-dom,
  @phosphor-icons only). Tabular history and summary tiles compose cleanly from
  existing Table/Badge/PageHeader/Select primitives; any graphical time-series would
  require a new visualization pattern (new dependency or hand-built SVG) plus new
  tokens for series colors and axes — the first substantial extension beyond the
  recreated DS surface. Whether the spec demands graphical charts versus
  tabular/summarized history is the pivotal unresolved design question and belongs
  to the spec owner.
- **ux_risk_read:** Time-series visualization is one of the higher-risk patterns for
  WCAG 2.1 AA — color-encoded multi-series data needs a non-color redundant channel,
  plotted datapoints need a keyboard-reachable and screen-reader-legible equivalent
  (commonly a paired data table), axis/units/contrast of thin plot strokes against
  themed backgrounds need deliberate handling, and the project ships dual
  light/dark themes any series palette must satisfy. A tabular-first presentation
  inherits the DS's already-audited semantics and largely sidesteps this; a
  graphical presentation concentrates most of the feature's accessibility exposure.
  Reduced-motion becomes relevant if any live/streaming update animates.
  Reversibility: the feature is read-only observability — no data mutation, no
  destructive operator action — so the interaction pattern is low-stakes and a
  chosen presentation can be revised later; the durable commitments are the capture
  location and storage shape (the implementation-first unknown the Direction
  flags), not the screen interactions. Usability-testing: the three audiences
  diverge enough that validating comprehension is warranted — trend readability for
  the operator, and especially the customer-facing framing (what a customer should
  and should not infer from usage/performance numbers), where wording and scope
  carry reporting-appropriateness risk. If a graphical pattern is chosen, testing
  datapoint-inspection and time-window selection with keyboard and assistive-tech
  users is the concentration point.

## Out of Scope

- **Cloud/SaaS observability backends** (Datadog, Grafana Cloud, or any hosted
  telemetry service) — hard-excluded by the local-first product constraint.
- **Billing / chargeback / metering** — explicitly ruled out by the product
  owner; this feature is not a usage-metering feature.
- **Host-level general APM** beyond what the three named consumers need.
- **customer-web-app's own request-logging scope** — already specified there
  (`specs/F-001-bff-layer-and-domain-events.md:890-902`) and not re-opened here.
- **Alerting / paging infrastructure** is provisionally out of scope but may
  belong as an open question rather than a hard exclusion (see below).

## Open Questions

- **Where can per-request LLM metrics actually be captured?** This is a real
  architectural unknown: the engine sits between the apps and Ollama; the engine
  does not expose per-request metrics via its API key, and Ollama's per-request
  fields are visible only to the caller of Ollama — which is the engine, not the
  BFF. Resolving the capture point is prerequisite to most of the feature.
- **Resource-load source and sampler.** Is resource load read from Ollama
  `/api/ps`, from OS-level sampling, or elsewhere — and which component samples
  it?
- **Sampling cadence vs. storage growth.** Disk on the appliance is finite; what
  cadence balances fidelity against growth?
- **Retention / rollup policy on the appliance,** and whether observability data
  is included in backups (ties to F-008 backups).
- **Where does customer-facing reporting live** — inside customer-web-app as a
  separate workbook row (as i18n is handled), or exported from admin-console?
- **Does GTM need the full three-consumer surface,** or an ops-minimum first?
- **Is alerting/paging in or out?** Provisionally out of scope above; flagged
  here in case a consumer needs it.
- **Are customer-facing reports/dashboards a packaged/paid capability** (which
  would harden the revenue link in the Business Rationale) or an included
  value-add that supports retention only?
