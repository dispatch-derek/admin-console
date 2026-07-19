# Changelog

All notable changes to the Admin Console are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

## [F-004 — Production Event-Bus Delivery (Outbox Relay)]

### Added

- **Outbox relay process:** A new supervised background service (`bff/src/relay/index.ts`) drains
  the durable `event_outbox` table and delivers `admin.*` domain events to peer endpoints over
  HTTP with guaranteed at-least-once semantics, per-key ordering, and automatic poison isolation
  (REQ-F004-001/010/014).

- **Event delivery infrastructure:** The relay implements per-key-ordered delivery with skip-ahead
  across keys (REQ-F004-016/042), exponential-backoff retry on transient failures (REQ-F004-013),
  and immediate parking of permanent rejections (REQ-F004-047). Crashed/restarted relays backfill
  the accumulated unpublished backlog oldest-first per-key order (REQ-F004-015/037).

- **Multi-peer fan-out with stateful ack tracking:** The HTTP transport (`HttpPeerTransport`)
  POSTs each event to N configured peers and acks only when every peer accepts (REQ-F004-050/051).
  Per-`deliveryId` ack state is tracked in memory across re-drives, so a re-attempt re-POSTs only
  the still-un-acked peers (REQ-F004-051(b)). Partial fan-out failures are isolated and marked
  for operator visibility (REQ-F004-051(e)).

- **Delivery-id stability:** Every delivery carries a stable, unique id (`<outbox-epoch>:<row-id>`)
  in the `x-event-delivery-id` HTTP header, constant across retries and process restarts (same DB),
  and distinct across DB resets. Peers must deduplicate on this id to achieve effectively-once
  processing (REQ-F004-018/036/048).

- **Health probe (`GET /ready`):** The relay serves an unauthenticated readiness endpoint (port
  3003 by default) that reports 200 when healthy and 503 with a machine-readable reason when
  degraded (backlog/lag over threshold, transport unreachable, store unwritable, REQ-F004-044).
  Operators wire this into their health-check policy.

- **Durable delivery bookkeeping:** Six new columns on `event_outbox` track delivery state —
  `ordering_key` (per-key partition), `attempt_count`, `next_attempt_at` (backoff window),
  `last_error` (diagnostics), `parked_at` (poison isolation), and `acked_at` (post-ack cap routing)
  — plus a singleton `outbox_meta` table seeding the delivery-id epoch (REQ-F004-029/038/048).

- **Ordering-key derivation:** A pure, total function (`deriveOrderingKey`) maps event names and
  targets to stable partition keys scoped to 8 domain-event families, with explicit support for
  singleton keys (`instance`, `baseline`) and independent events (`admin.feature_toggle.*`,
  REQ-F004-029/031/038).

- **Retention and pruning:** Published rows older than 7 days (configurable via
  `EVENT_BUS_RETENTION_MS`) are automatically pruned every ~1 hour (configurable via
  `EVENT_BUS_PRUNE_EVERY_CYCLES`). Unpublished and parked rows are never pruned (REQ-F004-019/035).

- **Separate relay-scoped config:** The relay boots with `DB_PATH + EVENT_BUS_*` environment
  variables only — no BFF secrets (`ANYTHINGLLM_*`, `SESSION_SECRET`, `SECRETS_ENC_KEY`) are
  required, so the relay can be packaged as an independent supervised process without credential
  leakage (REQ-F004-033/045).

- **Transport-agnostic drainer + pluggable adapter:** The drain orchestration layer (polling,
  per-key order, retry/backoff, park) is written once and imports only the `EventTransport`
  interface, not HTTP or peer details (REQ-F004-049). Future broker adoption (Kafka, NATS, etc.)
  will be a new `EventTransport` class plus one config branch, with zero churn to producers,
  routes, or the outbox schema (REQ-F004-050/052).

### Changed

- **BFF hard-refuse on non-`bus` mode in production:** Under `NODE_ENV=production`, any
  `EVENT_BUS_MODE` value other than `bus` (including the default `inproc`, typos, or unset)
  causes the BFF to refuse to boot with a clear error naming the variable (REQ-F004-021/039).
  This prevents silent event loss by enforcing the durable outbox path in production.

- **Event emission unchanged:** The `emitAdminEvent` call site and the `AdminEventEnvelope`
  contract are unchanged — no producer code needs modification (REQ-F004-004/005/006/022).
  The relay handles delivery independently behind the `EventBus` seam.

### Non-Goals

- F-004 delivers the **wire protocol only** (HTTP-to-known-peers). Standing up the physical
  message broker (Kafka, NATS, etc.) is an ops/platform concern outside this feature
  (REQ-F004-008).
- Downstream consumers of `admin.*` events (audit pipelines, alerting, cross-service automation)
  are separate work; F-004 delivers reliably to the transport (REQ-F004-007).
- The event contract itself (catalog, envelope shape, cardinality, redaction) is unchanged
  (REQ-F004-004).

### Known Limitations (see Security Review)

- **No per-peer request timeout hardened (F1):** Default 10s timeout bounds slow peers, but a
  hostile peer can stall that ordering key. Tunable via `EVENT_BUS_PEER_TIMEOUT_MS`.
- **No HTTPS/TLS enforcement or auth on peer delivery (F2):** Events are POSTed over plain HTTP
  with no HMAC/signature. Trusted-network / operator-controlled assumption; mitigate via HTTPS
  and private networks.
- **Unauthenticated `/ready` probe (F3):** Serves on `0.0.0.0` with no auth. Mitigate via
  network policy / loopback binding.

### Spec & Design

- **Specification:** `specs/F-004-production-event-bus.md` (rev 11, binding).
- **Architecture design:** `docs/design/09-F004-production-event-bus.md`.
- **Migration runbook:** `migrations/NOTES-F004.md` (schema delta, backfill, deploy phasing).
- **Security review:** `security/F-004-review.md` (pass with notes; two medium findings).
- **Relay operator guide:** `bff/src/relay/README.md` (boot, config, `/ready`, troubleshoot).
- **E2E test harness:** `tests/e2e/relay/README.md` (journey coverage, fixtures).

## [F-005 — Per-Customer Feature Toggle Console]

### Added

- **Feature-toggle console section:** A new customer-wide section (`features/feature-toggles/`)
  where staff operators can view and toggle per-customer feature enablement state. Each feature
  appears as a switch (DS `Toggle`), labeled with `displayName` and optional `description`,
  showing whether it is operator-set or using the declared default (REQ-F005-020/032).

- **Three BFF routes (all store-only, no engine call):**
  - `GET /api/feature-toggles` — list all declared features with their effective state, counts,
    and customer/install label (REQ-F005-019).
  - `PUT /api/feature-toggles/:featureKey` — set a feature enabled/disabled, persisting to the
    store and emitting `admin.feature_toggle.changed` on effective-state delta (REQ-F005-021/037).
  - `DELETE /api/feature-toggles/:featureKey/override` — remove an override, reverting to the
    catalog default; idempotent success when no override exists (REQ-F005-023).

- **Feature catalog manifest:** A deployment-provided JSON manifest (`FEATURE_CATALOG_MANIFEST_PATH`
  env var) declaring the available features with display metadata and defaults. The console reads
  it at startup (never mutates it), coerces missing `defaultEnabled` to `false`, and rejects a
  present-but-invalid manifest with a clear startup error (split load posture, REQ-F005-053).

- **Per-customer context affordance:** The toggles surface displays the operator's customer/
  install label (from `CUSTOMER_LABEL` env var, falling back to the fixed literal `"this install"`
  when unset, ensuring no engine-internal addresses leak into the product payload; REQ-F005-060)
  so the operator knows which customer a change binds to (REQ-F005-027).

- **Store-layer feature-toggle state:** One new table (`feature_toggle_state`) persists operator
  overrides: `feature_key` (PK), `enabled` (0/1), `updated_at`, `updated_by` (REQ-F005-012).

- **Audit trail & event catalog:** Every set/clear is recorded in the audit log with action
  `feature_toggle.set` / `feature_toggle.clear`, including effective-state-unchanged and
  idempotent cases (REQ-F005-038/059). A new event type `admin.feature_toggle.changed` emits
  only on effective-state delta (REQ-F005-037).

- **DS `Toggle` accessible-name binding (additive F-001 contract extension, REQ-F005-054):**
  The design-system `Toggle` now binds its label programmatically via `aria-labelledby` (and
  its optional description via `aria-describedby`), so the switch element announces its label
  as its accessible name — benefiting all `Toggle` consumers, not just F-005. Rendered as a
  native `<button type="button">` for keyboard operability and semantic clarity.

- **Per-row "Reset to default" action (REQ-F005-055):** Each feature row with `hasOverride:true`
  shows a "Reset to default" button; invoking it routes through a confirmation dialog (with copy
  noting whether the customer-visible state will change) and, on confirm, calls the `DELETE`
  route. An effective-state-unchanged reset (override equals default) is confirmed and audited
  but emits no event (REQ-F005-056).

- **Confirmation copy asserts immediate effect (REQ-F005-057):** The toggle confirmation dialog
  copy states that the change takes effect **immediately** in the customer-facing app, not merely
  neutral decision-only wording. This pins a forward constraint on the customer app: toggle
  consumption must be near-real-time (partially narrowing REQ-F005-009).

- **Empty state:** When the catalog declares zero features (expected until the customer-facing
  app ships), the surface renders "No features are defined for this install yet" instead of an
  error (REQ-F005-024).

### Changed

- **Opaque `featureKey` path-segment encoding contract (REQ-F005-028):** Callers percent-encode
  the `featureKey` (RFC 3986); the BFF decodes once and matches byte-for-byte against the
  catalog. A malformed percent-sequence → 400; an undeclared key → 404 (never a routing error).
  This makes every declared feature (however exotic its key) reachable without the console ever
  parsing the key's structure.

- **Store-confirmed writes (REQ-F005-021):** A `PUT`/`DELETE` reads the row back and confirms it
  matches the intended value before success is reported. This is a console-store deviation from
  the engine-oriented parent REQ-028, mirroring F-002's baseline-store convention (F-002 REQ-F002-035).

- **Effective-state-unchanged writes are persisted & audited (REQ-F005-037/038):** A `PUT` whose
  `enabled` equals the feature's current effective state still upserts the override row (refreshing
  `updated_at`/`updated_by` for idempotence tracking) and is audited; however, NO event emits
  (aligning with emit-only-on-actual-delta, parent REQ-029). The event stream is therefore a
  partial record of operator actions — the audit log is the complete history (REQ-F005-038).

### Web UI

- **New feature-toggles section** (`web/src/features/featureToggles/`) composed of:
  - `FeatureTogglesPage` — the main page component (customer-wide, not workspace-scoped).
  - `FeatureToggleRow` — renders each feature with its switch, effective-state indicator,
    provenance badge (default vs. operator-set), and per-row "Reset to default" affordance.
  - `ToggleConfirm` — lightweight (non-typed) confirmation dialog naming the feature and customer,
    asserting immediate effect in the customer app, with a "state will not change" note when
    applicable (REQ-F005-034/056/057).
  - `EmptyFeaturesState` — empty-state UI ("No features are defined for this install yet").
  - `useModalFocusTrap` — shared hook (in `web/src/components/`) managing focus into/out of the
    confirm dialog, moving focus into the dialog on open and returning to the trigger on close,
    with a focusability check to handle cases where the trigger is disabled/removed in the same
    React render commit.

- **Three new API client methods** (`web/src/api/client.ts`):
  - `listFeatureToggles()` — `GET /api/feature-toggles`, returns `FeatureToggleListView`.
  - `setFeatureToggle(featureKey, enabled)` — `PUT /api/feature-toggles/:featureKey`, returns `FeatureToggle`.
  - `clearFeatureToggleOverride(featureKey)` — `DELETE /api/feature-toggles/:featureKey/override`,
    returns `FeatureToggle`.

### Non-Goals

- F-005 makes no engine call and touches no engine state (REQ-F005-003).
- The customer-facing app and its runtime toggle-consumption mechanism are deferred (REQ-F005-009).
- Catalog authoring, fleet-wide bulk toggling, and orphan-feature visibility are deferred (REQ-F005-008/004/025).

### Spec & Design

- **Specification:** `specs/F-005-per-customer-feature-toggle-console.md` (rev 6, fully ruled).
- **Architecture design:** `docs/design/08-F005-feature-toggle-console.md`.
- **UX design:** `docs/design/ux/F-005-feature-toggle-console.md`.
- **Migration runbook:** `docs/F-005-migration-runbook.md` (covers the new `feature_toggle_state`
  table and catalog manifest setup).

## [F-001 — Adhere to a Design System]

### Added

- **Design-system adoption:** The console now adopts the Admin Console Design System (vendored at
  `web/vendor/design-system/`) as the single governing source of truth for design tokens and UI
  components (REQ-F001-001, REQ-F001-014). This replaces the ad-hoc ~723-line `web/src/index.css`
  token block and ~143 one-off `className` usages across 22 files.

- **11 recreated DS components** (`web/src/design-system/`) as production React/TypeScript:
  Badge, Button, IconButton, Input, Select, Textarea, Toggle, Table (with Row/Cell), PageHeader,
  Modal, SidebarItem. Each matches its vendored `.d.ts` prop contract and variant sets
  (REQ-F001-045).

- **Adopted token layer** (4 vendored token CSS files, byte-for-byte verbatim):
  - `colors.css` — dark (`:root`) and light (`[data-theme="light"]`) themes, `--theme-*` family
  - `typography.css` — type-scale tokens (`--fs-*`, `--fw-*`, `--lh-*`, `--tracking-*`)
  - `spacing.css` — layout tokens (`--space-*`, `--control-*`, `--radius-*`, `--shadow-*`,
    `--gradient-*`)
  - `fonts.css` — font-family tokens and `@font-face` (Plus Jakarta Sans)

  The token layer is imported once in `main.tsx` and replaces the ad-hoc block in `index.css`
  (REQ-F001-017).

- **Two-gate adherence enforcement** (REQ-F001-044, REQ-F001-047):
  - **oxlint gate** over `web/src/**/*.{ts,tsx,js,jsx}`: forbids raw hex colors, raw `px` values,
    off-system fonts, off-contract DS props, and deep DS-component imports in JS/TS. Run mode:
    `npm run lint:ds` (zero violations required).
  - **stylelint gate** over `web/src/**/*.css`: mirrors the hex/`px`/font rules for CSS, exempts
    the four adopted DS token files plus one bridge light-source file (path-scoped, not
    content-scoped). Run mode: `npm run lint:css` (zero violations required).

  Both gates are release-blocking, CI-enforced, and make migration completeness testable
  (REQ-F001-026, REQ-F001-027).

- **Bridge layer** (`web/src/bridge/`) for the one named DS coverage gap:
  - `RawEditorSurface.tsx` — code-editor surface, composed with DS `Textarea` + tokens
    (REQ-F001-046).
  - `prefers-color-scheme.css` — OS-driven light-theme selection via `@media
    (prefers-color-scheme: light)` block that re-points `--theme-*` tokens to their DS light values
    (REQ-F001-052, carve-out C, resolves RISK-1). A documented coupling to `light-source.css`
    (REQ-F001-025).

- **Orphaned token mapping** (REQ-F001-048, REQ-F001-053):
  - `--success` / `--success-bg` → `--theme-badge-success-{text,bg}`
  - `--danger` / `--danger-bg` → `--theme-badge-danger-{text,bg}` (disclosed color shift accepted)
  - `--danger-strong` → removed as dead (or `--alm-error` if a use surfaces)
  - Seven `--theme-*` custom properties undefined in DS → mapped to nearest DS tokens
    (`--theme-home-bg-card` → `--theme-bg-secondary`, etc.; five of seven removed as dead)

  All mappings are exhaustive per a reproducible `var()` audit (REQ-F001-053); no third orphan
  class exists.

- **Contract extensions on adopted components** (RISK-4, REQ-F001-020):
  - `Input`: `readOnly`, `min`/`max`/`step`/`inputMode`, `onBlur`, `aria-describedby`,
    `aria-invalid`, `error`, `autoComplete`
  - `Textarea`: `readOnly`, `spellCheck`
  - `Button`, `IconButton`: `title`, `aria-label`
  - `Select`, `Textarea`: auto-wired `aria-describedby` for hint/error text (WCAG 3.3.1)

  These extensions are adopted-only (not in the vendored reference) and must be re-applied after a
  re-sync (REQ-F001-025).

- **Dual-theme preservation:** The console continues to render correctly in both dark (default) and
  light themes via `[data-theme="light"]` and `@media (prefers-color-scheme: light)` paths, driven
  by the adopted DS token layer (REQ-F001-023, REQ-F001-024).

- **Accessibility improvements:**
  - `SidebarItem` nav items are now keyboard-operable with proper interactive roles (REQ-F001-030)
  - `Toggle` now has standard keyboard affordances
  - Form labels, error messages, and hints are wired with semantic `aria-describedby` (WCAG 3.3.1)
  - Heading landmarks preserved and enhanced on screens using `PageHeader` (REQ-F001-030)
  - `Modal` and `DangerConfirm` provide `role="dialog"`, `aria-modal`, and accessible naming

  **Non-gating:** The console targets WCAG 2.1 AA (REQ-F001-030), but pre-existing AA gaps are not
  F-001 blockers (ruling OQ-6).

- **E2E test harness** (`tests/e2e/`) for real-browser smoke testing (F-001 dual-theme,
  keyboard navigation, a11y, form submission, app shell boot).

### Changed

- **Migrated all five feature areas** + app shell + auth screens from ad-hoc styling to DS
  components and tokens:
  - `web/src/features/users/` — user list, membership panel, chat oversight
  - `web/src/features/workspaces/` — workspace list, knowledge panel, settings
  - `web/src/features/settings/` — LLM settings, secret fields, Ollama model select
  - `web/src/features/raweditor/` — raw environment editor (bridge surface) + masked diff
  - `web/src/features/diagnostics/` — diagnostics page
  - `web/src/auth/` — login, MFA enrollment

- **Shared components re-expressed on DS:**
  - `DangerConfirm` → DS `Modal` + `Button.danger` + `Input` (typed-token/ack gating preserved;
    REQ-F001-020)
  - `ErrorBanner` → DS tokens + `role="alert"` + verbatim message (REQ-F001-020)
  - `SetNotSetBadge` → DS `Badge` with `tone` per set/not-set (never reveals secret; REQ-F001-020)

- **Reduced `web/src/index.css`** from ~723 lines to the adopted DS token imports + residual global
  rules, with all ad-hoc token definitions and bespoke element/utility rules removed or migrated
  (REQ-F001-009, REQ-F001-027).

- **Behavior is unchanged:** All workflows, views, field semantics, client-side validation, keyboard
  operability, and danger-confirm gating are preserved (REQ-F001-021, REQ-F001-022). Test suite
  passes (518/518 vitest, 12/12 E2E Playwright).

- **Bundle size:** Gzipped production JS + CSS bundle remains within baseline + 10% (REQ-F001-033).
  Addition of 11 recreated components and token CSS is offset by removal of ad-hoc styling
  (pre-migration baseline captured at `docs/design/F-001/baseline-2026-07-09.md`).

### Documentation

- **`web/src/design-system/README.md`** — design-system usage guide covering component barrel,
  token layer, dual-theme preservation, adherence gates (`npm run lint:ds`, `npm run lint:css`),
  re-sync procedure, testing, and quick-reference token categories (REQ-F001-025).

- **`web/src/bridge/README.md`** — documents every bridge entry (code-editor surface, OS-light
  media block) with its DS coverage gap, and lists all adopted-contract prop extensions (RISK-4)
  with re-sync implications (REQ-F001-026, REQ-F001-025).

- **`tests/e2e/README.md`** — E2E test harness documentation and run instructions.

- **`docs/design/F-001/`** — phase-1 architecture docs updated to note RISK-1 and RISK-2 as
  RESOLVED by specification rev 6 rulings (REQ-F001-052, REQ-F001-053).

### Design Decisions (Spec Resolutions)

This feature resolves five correctness-bearing spec decisions (REQ-F001-050/051/052/053/054/055;
rulings 2026-07-08):

- **OQ-9 (REQ-F001-050):** CSS adherence is gated by **stylelint over `.css`** (not oxlint, which
  cannot parse CSS). Path-scoped exemption of four token files closes the "re-host as `bridge.css`"
  loophole.

- **OQ-10 (REQ-F001-051):** `--success*`/`--danger*` → badge-token mapping is ratified
  (REQ-F001-048). Disclosed danger-foreground color shift accepted.

- **OQ-11 (REQ-F001-054, RISK-1):** OS-driven light-theme selection is preserved via bridge
  `@media (prefers-color-scheme: light)` block (REQ-F001-052, carve-out C), not by editing the
  verbatim token file.

- **OQ-12 (REQ-F001-055, RISK-2):** Seven non-DS `--theme-*` custom properties → nearest-DS-token
  mapping (REQ-F001-053). Mapping is exhaustive per reproducible audit.

### Testing

- **Vitest unit suite:** 518/518 passing (existing + new component tests).
- **Adherence gates:** `npm run lint:ds` (oxlint) and `npm run lint:css` (stylelint) pass with
  zero violations.
- **E2E harness:** 12/12 Playwright tests passing (app boot, dual-theme paths, keyboard nav,
  form submit, a11y).
- **Type safety:** Full `tsc --noEmit` passes under strict tsconfig (`noUncheckedIndexedAccess`).

### Non-Goals

- No change to AnythingLLM's own application or native theme (REQ-F001-004).
- No new operator capability or behavior (REQ-F001-005).
- No backend/BFF changes (REQ-F001-006).
- No rebrand or logo asset (DS ships none; REQ-F001-007).

### GTM Status

Full design-system compliance (all five feature areas, both adherence gates green) is a **hard
completion gate** for the October 2026 GTM (REQ-F001-028a, ruling OQ-7). This release meets that
gate.

---

**Specification:** `specs/F-001-adhere-to-design-system.md` (rev 6, fully ruled)
**Design docs:** `docs/design/F-001/`
**Implementation scope:** `web/` only (frontend-only systematization, behavior-preserving)
