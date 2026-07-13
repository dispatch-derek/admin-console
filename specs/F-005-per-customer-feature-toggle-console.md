# F-005: Per-Customer Feature Toggle Console — Specification

Status: Draft rev 7 — records one human ruling (Derek, RATIFIED 2026-07-13) AMENDING the customer/
install-label fallback of REQ-F005-048 as new REQ-F005-060: when `CUSTOMER_LABEL` is unset the label
falls back to the fixed neutral literal `"this install"`, never an engine-derived value. A security
review found the prior origin/identifier fallback was implemented as a fallback to the engine base URL
(`ANYTHINGLLM_BASE_URL`), leaking the engine's internal hostname/port into the `GET /api/feature-toggles`
payload and the DOM, in tension with REQ-F005-003 (no F-005 code path references the engine base URL/
paths) and REQ-F005-039 (engine paths/identifiers never appear in an F-005 payload); REQ-F005-003/039
take precedence. REQ-F005-048's origin/identifier-fallback clause is marked DEPRECATED **in place** (not
deleted, not renumbered); no requirement ID renumbered or reused; append-only.
(rev 6 baseline: records two human rulings (RATIFIED 2026-07-12) from Phase-2 test-generation as
new REQ-F005-058 (manifest configuration contract: `FEATURE_CATALOG_MANIFEST_PATH` env var + JSON
`{"features":[FeatureCatalogEntry…]}` shape, pinning REQ-F005-044/053) and REQ-F005-059 (audit `action`
literals `feature_toggle.set` / `feature_toggle.clear`, pinning REQ-F005-038); append-only, no existing
requirement changed)
(rev 5 baseline: records four human rulings (RATIFIED 2026-07-12) from the UX design review of
`docs/design/ux/F-005-feature-toggle-console.md` as new REQ-F005-054..057 (DS `Toggle` accessible-name
extension; per-row "Reset to default" affordance; effective-state-unchanged reset still confirmed;
confirm copy asserts immediate customer effect + pins a near-real-time consumption constraint on the
future customer app, partially narrowing REQ-F005-009); append-only, no existing requirement changed)
(rev 4 baseline: records a human ruling (RATIFIED 2026-07-12) pinning the manifest load-failure
posture as new REQ-F005-053 (split: absent manifest → empty catalog + normal start; present-but-broken
manifest → refuse to start with a named error), resolving an architect-flagged conflict in
`docs/design/08-F005-feature-toggle-console.md`; append-only, no existing requirement changed)
(rev 3 baseline: records the human ruling (all ten open questions REQ-F005-043..052 RATIFIED at
their recommended defaults, unchanged) and fixes one editorial grammar nit in REQ-F005-037; NOT a
review-fix round and NOT a behavior change. No existing requirement ID was renumbered or reused)
(rev 2 baseline: resolves two BLOCKING spec-review findings (empty-override DELETE contract
REQ-F005-023/030; opaque `featureKey` URL-encoding contract REQ-F005-028) and pins several
non-blocking NOTEs in place (event-vs-audit provenance completeness, effective-state count basis,
`defaultEnabled` coercion, store-confirm-failure status, perf N, concurrency/idempotent re-write,
"no-op" wording); adds one Open Question for cross-spec event ordering (REQ-F005-052))
(rev 1 baseline: initial draft — for implementation and QA review)
Feature brief (framing intent, NOT authoritative requirements): `briefs/F-005-per-customer-feature-toggle-console.md`
Parent spec (conventions, architecture, shared requirements): `specs/admin-console.md` (v1, rev 7)
Grounding references: `docs/governing-architecture.md` (BFF anti-corruption layer, boundary rules),
`docs/design/03-data-models.md` (BFF-owned SQLite store, `admin.*` event schemas),
`docs/design/02-product-api.md` (product-API conventions), `docs/design/05-web-architecture.md`
(web section/routing conventions), `docs/design/F-001/01-component-contracts.md` (design-system
`Toggle` = `role="switch"`, `PageHeader`, `ErrorBanner`, `DangerConfirm`, `Badge`).
Event-bus delivery: `specs/F-004-production-event-bus.md` (the production `admin.*` bus this feature publishes to).

This is an **additive** feature spec layered on `specs/admin-console.md`. It introduces a distinct
requirement-ID namespace, **`REQ-F005-###`**, so its IDs never collide with the parent spec's
`REQ-###` series or the sibling `REQ-F001-###`/`REQ-F002-###`/`REQ-F003-###`/`REQ-F004-###` series.
Section numbers (§1, §1.1, …) below are **local to this document**; downstream tests cite the
`REQ-F005-###` id (globally unique) plus the local §. Requirement IDs and section numbers are
**stable**: never renumber or reuse an id; append new ids or mark items **DEPRECATED**.

Where this spec reuses parent-spec machinery (staff auth REQ-012, the BFF-owned SQLite store and
boundary rule 3, the `admin.*` event bus §14, the audit log REQ-093/093a, product-typed contracts
REQ-025, error mapping/verbatim message REQ-023/097/097a, and the `DangerConfirm` pattern §8), it
cites the parent `REQ-###` id rather than restating it.

> **Load-bearing distinction from F-002/F-003.** F-002 and F-003 are anti-corruption-layer features
> that read and write the AnythingLLM **engine** (`/api/v1/*`). **F-005 does not touch the engine at
> all.** Feature-toggle state is console-owned data (boundary rule 3), persisted in the BFF store and
> consumed by a co-located, not-yet-built customer-facing application — never by AnythingLLM. There is
> therefore no engine read, no engine write, no verify-after-write against the engine, and no product↔
> engine field map in this feature. This is stated normatively in REQ-F005-003 and §2.

---

## §1 Overview & Scope

### §1.1 Purpose
F-005 gives a staff operator a **console-managed, per-install feature-enablement surface**: a new
section in the admin console that lists the features declared as available on this install's shared
codebase and lets the operator turn each feature **on or off for this one customer's install**. The
enablement state is the console's own data, is the durable system of record for "which features are
enabled for this customer," and is intended to be (a) read by the co-located customer-facing
application to decide what to expose, and (b) a future input to per-customer billing.

- REQ-F005-001 — The console persists, per install (one install == one customer, parent REQ-001/002),
  a set of **per-feature enablement overrides** in its own BFF-owned store (§4), and exposes an
  operator surface to VIEW every declared feature with its current effective state and to SET each
  feature enabled or disabled (§6). *Test:* an operator can open the feature-toggle section, see the
  declared features with their current on/off state, flip one, and re-open the section to observe the
  new state persisted.

### §1.2 Single-install, single-tenant scoping (by construction)
- REQ-F005-002 — Because the admin console is co-located on the same single-tenant install as the
  customer-facing app it governs (parent REQ-001/002; brief "Affected Users"), an operator session is
  scoped to **exactly one** customer's toggle set by construction — the store holds state for this
  install only. The feature provides NO cross-install, fleet-wide, or multi-customer view or action
  (§2 REQ-F005-004). Toggle state lives and is read **locally**, never synced from or to a remote
  control plane. *Test:* the toggle surface and its store contain state for a single install; there is
  no request to any remote/central control plane and no UI affordance selecting among multiple
  customers.

### §1.3 No engine interaction
- REQ-F005-003 — F-005 introduces NO AnythingLLM engine read or write and NO new engine custody path.
  Feature-toggle state is console-owned (boundary rule 3, `docs/design/03-data-models.md`); reads and
  writes touch only the BFF store (§4) and the declared feature catalog (§5). There is no
  verify-after-write against the engine (the store write is confirmed against the store itself,
  REQ-F005-021). *Test:* a static scan confirms no F-005 code path references an engine `/api/v1/*`
  path, an engine field name, or `ANYTHINGLLM_BASE_URL`; the toggle routes issue only console-store
  reads/writes.

---

## §2 Out of Scope (Non-Goals)

Mirrors the brief's "Out of Scope" plus the engine-boundary and catalog-authorship boundaries.

- REQ-F005-004 — **Fleet-wide / multi-customer / bulk toggling** across more than one customer install
  from a single session is a non-goal (brief Out of Scope; REQ-F005-002). Each install's console acts
  only on its own install.
- REQ-F005-005 — **A customer-facing settings surface** is a non-goal: end customers never see or
  operate this toggle interface; it is a staff-operator tool (parent REQ-010; brief Out of Scope).
- REQ-F005-006 — **The billing/invoicing system itself** is a non-goal (brief Out of Scope; parent
  REQ-115). F-005 produces enablement state and change history that a future billing capability MAY
  consume (via the read API and/or the event bus); it implements no pricing, metering, or invoicing
  logic and defines no billing schema.
- REQ-F005-007 — **The customer-facing web application and its individual features** are a non-goal.
  F-005 governs the *enablement* of features declared by that application's shared codebase; it does
  not build, contain, or define any of those features.
- REQ-F005-008 — **Authoring the feature catalog** is a non-goal. The console does not let operators
  create, rename, delete, or re-scope features; the set of declared features is owned by the shared
  codebase / deployment (§5, REQ-F005-016). Operators only toggle enablement of already-declared
  features.
- REQ-F005-009 — **Defining the customer-facing app's runtime consumption mechanism** is out of scope
  for this revision. F-005 guarantees a durable, readable system of record for enablement state; how
  the customer-facing app reads and reacts to that state at runtime (poll cadence, caching,
  restart/reload semantics, and the auth model for a non-staff consumer) is the customer app's own
  effort and is deferred (REQ-F005-045, REQ-F005-047).
- REQ-F005-010 — **AnythingLLM engine feature-flagging** is a non-goal: F-005 does not read or write
  any AnythingLLM setting, env key, or workspace field (REQ-F005-003). It is a wholly console-owned
  mechanism.
- REQ-F005-011 — **Cross-deployment sharing / central fleet management** is out of scope for this
  revision (REQ-F005-002). The data model is required only to *avoid foreclosing* an eventual central
  plane (REQ-F005-015), not to implement one.

---

## §3 Definitions & Glossary

- **Feature** — an independently-controllable capability of the shared customer-facing codebase,
  identified to the console by a **stable feature key**. The console is agnostic to the underlying
  granularity (module, feature flag, or finer); a "feature" is exactly one entry in the declared
  catalog (§5). The intended granularity is a product decision (REQ-F005-043).
- **Feature key** (`featureKey`) — a stable, opaque string that identifies a feature across the
  feature's lifetime and (potentially) across installs. It is the primary key of both the catalog
  entry and the enablement override row (§4). The console never parses or derives meaning from its
  structure.
- **Feature catalog** — the declared set of features available on this install, each with display
  metadata and a declared default state (§5, REQ-F005-016). Owned by the shared codebase / deployment,
  not by the console (REQ-F005-008).
- **Enablement override** — a per-feature, operator-set boolean persisted in the console store
  recording that the operator has explicitly set this feature enabled or disabled on this install
  (§4). A feature MAY have no override (never explicitly set).
- **Effective state** — the boolean the console reports and a consumer would act on for a feature:
  the enablement override when one exists, otherwise the catalog-declared default (§5, REQ-F005-017).
- **Customer/install label** — a human-readable identifier of which customer/install this console
  governs, displayed on the surface so an operator knows whom a change binds to (§6, REQ-F005-027).

---

## §4 Data Model (BFF-owned store)

Feature-toggle state is the console's OWN data (boundary rule 3, `docs/design/03-data-models.md`),
persisted in the existing embedded SQLite store (`better-sqlite3`) alongside `staff`, `audit_log`,
`workspace_map`, and the outbox. There is no engine-side authority for this data — the console store
is the sole system of record.

- REQ-F005-012 — The BFF store adds one table (or equivalent), migrated in `store/db.ts`:
  **`feature_toggle_state`** (one row per feature the operator has explicitly set — an override):
  - `feature_key` (TEXT PK — the stable catalog key, REQ-F005-016);
  - `enabled` (INTEGER NOT NULL — 0/1, the explicit operator override);
  - `updated_at` (TEXT ISO-8601);
  - `updated_by` (TEXT staff id, parent REQ-029c actor).
  *Test:* the migration creates the table; reading a feature that has no row reports "no override" and
  resolves to its catalog default (REQ-F005-017); writing a feature's state creates/updates exactly
  one row.
- REQ-F005-013 — **Override rows are the only persisted state; the catalog is NOT copied into the
  store as authoritative.** The declared catalog (§5) is the source of the feature set, display
  metadata, and defaults; the store persists only per-feature overrides. Effective state is always
  computed from the current catalog + override (REQ-F005-017), never from a cached catalog snapshot.
  *Test:* changing a feature's catalog-declared default (e.g. a redeploy) changes the effective state
  of a feature that has NO override, and does not change the effective state of a feature that HAS an
  override.
- REQ-F005-014 — **Retained history for audit/billing; overrides not silently deleted.** Setting a
  feature's state is recorded in the append-only audit log (REQ-F005-038) and emits a change event
  (REQ-F005-037), so a durable history of "who set which feature to what, when, for this install"
  exists to feed future billing. An override row for a feature that is later removed from the catalog
  (an **orphan**, REQ-F005-025) is retained in the store (not deleted), even though it is not rendered
  in the active toggle list. *Test:* toggling a feature produces an audit entry and an event; removing
  a feature from the catalog does not delete its override row.
- REQ-F005-015 — **Fleet-readiness of the model (avoid foreclosing central management,
  REQ-F005-011).** Override rows are keyed by the **stable global feature key** (REQ-F005-016), not by
  an install-local surrogate id, so this install's override set is a clean single-tenant slice that a
  future central plane could aggregate without a data migration. This revision persists NO cross-tenant
  identifier and builds NO central plane; the requirement is only that the key be the feature's stable
  global identifier. This is a load-bearing forward-compatibility choice surfaced for ratification
  (REQ-F005-050). *Test:* the override row's primary key is the catalog `featureKey`; no
  install/tenant surrogate id is introduced into the key.

---

## §5 Feature Catalog & Effective-State Resolution

The console must render "the features available in the shared codebase," but the customer-facing app
does not exist yet, so **today the catalog may be empty** (REQ-F005-024). The catalog is a declared
contract the console reads; the console does not author it (REQ-F005-008).

- REQ-F005-016 — **Feature catalog (declared, read-only to the console).** The BFF exposes a feature
  catalog: a set of entries, each with a stable `featureKey`, a `displayName`, an optional
  `description`, an optional `category` (for grouping), and a `defaultEnabled` boolean (the state a
  feature takes on this install before any operator override). The catalog's **shape** is normative
  (it is the `FeatureCatalogEntry` product type, §7.1); the catalog's **source** — how the shared
  codebase declares features to the BFF — is a deployment concern with a recommended default
  (REQ-F005-044). The console MUST NOT invent, mutate, or persist the catalog as authoritative
  (REQ-F005-008/013). **`defaultEnabled` coercion (resolves review NOTE).** The product
  `FeatureCatalogEntry.defaultEnabled` (§7.1) is a required, always-defined boolean; when the declared
  catalog source omits it for an entry, the BFF **coerces the missing value to `false`** (disabled) at
  load time, so the default `D` used in effective-state resolution (REQ-F005-017) is never undefined.
  This coercion is the mechanical realization of the off-by-default posture whose ratification is
  tracked in REQ-F005-049. *Test:* the BFF loads a catalog of declared features; each entry exposes
  `featureKey`, `displayName`, a defined boolean `defaultEnabled`, and optional `description`/
  `category`; a catalog entry that omits `defaultEnabled` loads with `defaultEnabled=false`; the
  console provides no route or UI that creates or edits a catalog entry.
- REQ-F005-053 — **Manifest load-failure posture (split; human ruling RATIFIED 2026-07-12, resolving
  an architect-flagged conflict in `docs/design/08-F005-feature-toggle-console.md` the spec had left
  unpinned).** The catalog source is a deployment-provided manifest (REQ-F005-044). Its
  load outcome at BFF startup/readiness is governed by a **split posture** that MUST distinguish
  "there are simply no features declared" from "the declared catalog is corrupt":
  - **(a) Absent manifest → empty catalog, start normally.** When the manifest path is **unset**, OR is
    set but the file is **absent** (does not exist), the BFF treats the catalog as **empty**: it starts
    normally (no startup error, readiness passes) and `GET /api/feature-toggles` returns an empty
    `features[]` with the first-class empty state (REQ-F005-024, empty-is-valid). This is the expected
    state until the customer-facing app ships.
  - **(b) Present-but-broken manifest → refuse to start.** When the manifest file **exists** but fails
    to load, parse, or validate (unreadable, malformed syntax, or schema-invalid content — e.g. a
    non-string `featureKey`, a duplicate key, or a wrong-typed field), the BFF **refuses to start**: it
    fails startup/readiness with a **clear error that names the manifest path and the parse/validation
    failure**, and does NOT fall back to an empty catalog. Config corruption MUST NOT masquerade as "no
    features" (which would silently withhold every feature). This mirrors the parent fail-fast-on-bad-
    config posture (parent REQ-001 startup-env behavior).
  - **Coercion is NOT a validation failure (boundary with REQ-F005-016).** A manifest entry that merely
    **omits `defaultEnabled`** is valid: it is coerced to `false` (REQ-F005-016), NOT treated as a
    parse/validation failure, and MUST NOT trigger case (b) refuse-to-start.
  *Test:* with the manifest path unset the BFF starts, readiness passes, and `GET /api/feature-toggles`
  returns `features: []`; with the path set to a non-existent file, same result (starts empty, no
  error); with the path set to a file containing malformed/schema-invalid content, the process exits
  non-zero / fails readiness and the startup error names the manifest path and the failure; with a
  file whose only "defect" is an entry missing `defaultEnabled`, the BFF starts and that entry loads
  with `defaultEnabled=false` (no refuse-to-start).
- REQ-F005-058 — **Manifest configuration contract (path env var & file shape; human ruling RATIFIED
  2026-07-12, resolving a Phase-2 test-generation ambiguity — pins the previously-unpinned name and
  shape left open at REQ-F005-044/053).** The catalog manifest's location and shape are fixed as:
  - **Path:** the manifest file path is provided to the BFF via the environment variable
    **`FEATURE_CATALOG_MANIFEST_PATH`**. "Unset" in REQ-F005-053 case (a) means this env var is absent/
    empty; "set but absent" means the var names a path that does not exist on disk.
  - **File shape:** the manifest is a **JSON** document of shape **`{ "features": [ ... ] }`**, where
    each array element is a **`FeatureCatalogEntry`** (§7.1: `featureKey`, `displayName`, optional
    `description`, optional `category`, `defaultEnabled` — the last coerced to `false` when omitted,
    REQ-F005-016). A document that is not JSON, whose top level is not an object with a `features`
    array, or whose entries are not valid `FeatureCatalogEntry` values is a **schema-invalid** manifest
    and triggers the REQ-F005-053 case (b) refuse-to-start (the split load posture of REQ-F005-053 is
    unchanged by this pin). *Test:* with `FEATURE_CATALOG_MANIFEST_PATH` unset the catalog is empty and
    the BFF starts (REQ-F005-053(a)); with it set to a JSON file `{"features":[{"featureKey":"x",
    "displayName":"X","defaultEnabled":true}]}` the catalog loads that one feature; with it set to a
    file that is not JSON or lacks a top-level `features` array, the BFF refuses to start with the
    named-path error (REQ-F005-053(b)).
- REQ-F005-017 — **Effective-state resolution (deterministic).** For a feature with catalog default
  `D` and override row value `O`: `effective = O` when an override row exists, else `effective = D`.
  Override always wins over the current default; a later change to `D` never overrides an existing `O`
  (REQ-F005-013). A feature present in the catalog with no override row resolves to `D` and is reported
  with `hasOverride = false`. *Test:* a feature with `defaultEnabled = false` and no override reports
  effective `false`; setting an override `true` reports effective `true`; clearing the override
  (REQ-F005-023) reports effective `false` again; changing the catalog default while an override exists
  does not change the effective value.
- REQ-F005-018 — **Feature-key correspondence.** The `feature_key` of an override row (§4) and the
  `featureKey` of a catalog entry (REQ-F005-016) are the same identifier space. An override row whose
  key is present in the current catalog is an **active override**; one whose key is absent is an
  **orphan** (REQ-F005-025). *Test:* an override whose key matches a catalog entry is joined to that
  entry in the list view; an override whose key matches no catalog entry is classified orphan and
  excluded from the active list (REQ-F005-025).

---

## §6 Functional Requirements

### §6.1 Viewing features & state

- REQ-F005-019 — The console lists every catalog feature via `GET /api/feature-toggles` (§7),
  returning for each: `featureKey`, `displayName`, `description`, `category`, `defaultEnabled`, the
  resolved `enabled` effective state (REQ-F005-017), `hasOverride`, and the override's `updatedAt`/
  `updatedBy` (null when no override). The response also carries the customer/install label
  (REQ-F005-027) and counts. **Count semantics (resolves review NOTE).** Counts are computed on the
  **effective** state (REQ-F005-017), over exactly the features rendered in `features[]`: `enabled` =
  the number of active features whose effective `enabled` is `true`; `disabled` = those whose effective
  `enabled` is `false`; `total` = `enabled + disabled` = `features.length`. **Orphan overrides
  (REQ-F005-025) are excluded from both `features[]` and every count.** *Test:* the list renders one row
  per catalog feature with its effective on/off state; a feature with no override shows
  `hasOverride:false` and its default as the effective state; `enabled + disabled == total ==
  features.length`; a catalog of three features where two resolve enabled (one by override, one by
  default) and one resolves disabled reports `{enabled:2, disabled:1, total:3}`, and an orphan override
  present in the store changes none of these counts.
- REQ-F005-020 — **State provenance is visible.** For each feature the surface distinguishes "using
  the declared default" (`hasOverride:false`) from "explicitly set by an operator"
  (`hasOverride:true`), so an operator can tell whether a feature's current state was chosen or
  inherited. *Test:* a feature never explicitly set is shown as using its default; after an operator
  sets it, the same feature is shown as operator-set with the actor/time.

### §6.2 Toggling a feature

- REQ-F005-021 — **Set feature state.** The console sets a feature enabled/disabled via
  `PUT /api/feature-toggles/:featureKey` with body `{ enabled: boolean }` (§7). This write persists an
  override row (REQ-F005-012) to the console store ONLY; it performs NO engine write (REQ-F005-003).
  The write is confirmed against the store (the row is read back and equals the intended value) before
  success is reported; because this is a console-store write and not an engine mutation, the operation
  is recorded store-confirmed `verified:true` (mirroring the F-002 baseline-store convention
  REQ-F002-035, an explicit deviation from the engine-oriented parent REQ-028). **Idempotent re-write
  & concurrency (resolves review NOTE).** A `PUT` upserts the override row: a `PUT` whose `enabled`
  equals the feature's existing override value still refreshes `updated_at`/`updated_by` (the write is
  accepted and audited, REQ-F005-038, even though it is effective-state-unchanged and emits no event,
  REQ-F005-037). Concurrent `PUT`s to the same `featureKey` resolve **last-writer-wins** on the
  single-tenant SQLite store (each `PUT` is its own committed transaction; there is no optimistic-
  concurrency token in this revision, consistent with parent OQ-6). *Test:* a
  `PUT /api/feature-toggles/:featureKey` with `{ enabled:true }` persists the override, issues zero
  engine calls, and the subsequent `GET` reports the feature effective `true` with `hasOverride:true`;
  a second `PUT` of the same value refreshes `updatedAt`/`updatedBy` and emits no event.
- REQ-F005-022 — **Immediate-apply, per-feature.** Each toggle is applied independently and persisted
  immediately on its own request (no batched multi-feature save in this revision); the operator does
  not stage multiple changes behind a separate "save." Whether to instead batch changes behind an
  explicit save is a design decision with a recommended default (REQ-F005-046). *Test:* flipping one
  feature persists that feature alone and does not require or affect any other feature's state.
- REQ-F005-023 — **Clear an override (revert to default).** The console provides
  `DELETE /api/feature-toggles/:featureKey/override` (§7) to remove a feature's override row so the
  feature reverts to its catalog default (REQ-F005-017). Like the `PUT`, this is a store-only write
  and is audited/evented (REQ-F005-037/038) when the effective state changes. **No-override DELETE is
  idempotent success (resolves review BLOCKING GAP).** A `DELETE` against a **catalog-present** feature
  that currently has **no override row** is a valid, reachable request and is handled as an idempotent
  success: the BFF returns **`200 FeatureToggle`** with `hasOverride:false` and the feature's default
  effective state, deletes nothing (there was nothing to delete), emits **no** `admin.feature_toggle.
  changed` event (effective state unchanged, REQ-F005-037), and records an audit entry as an **accepted
  clear with no effective change** (consistent with REQ-F005-038's "every accepted set/clear, including
  effective no-ops"). It is NOT a 404 — the 404 case (REQ-F005-030) is reserved for a `featureKey`
  **absent from the catalog**, which is distinct from a catalog-present feature that merely has no
  override. *Test:* clearing an override for a feature whose default differs from the override returns
  the feature to `hasOverride:false` and its default effective state and emits one event; clearing an
  override that equals the default emits no change event (REQ-F005-037) but is still audited; a
  `DELETE` for a catalog-present feature with no override returns `200` with `hasOverride:false`, emits
  no event, records an accepted-clear audit entry, and is never a 404.
- REQ-F005-024 — **Empty state.** When the catalog declares zero features (the expected state until the
  customer-facing app ships), `GET /api/feature-toggles` returns an empty feature set and the UI
  renders a clear empty state ("No features are defined for this install yet") rather than an error or a
  blank surface. *Test:* with an empty catalog, the surface loads successfully and shows the empty-state
  message; no error banner is shown.
- REQ-F005-025 — **Orphan overrides are hidden from the active list, not deleted.** An override whose
  `feature_key` is not in the current catalog (a feature removed from the shared codebase) is an orphan
  (REQ-F005-018); it MUST NOT appear as a togglable row in `GET /api/feature-toggles`, and its retained
  row MUST NOT affect any active feature (REQ-F005-014). Whether to additionally surface orphans in a
  read-only "retired features" view is deferred (REQ-F005-049). *Test:* an override row for a
  no-longer-declared feature is absent from the active toggle list, and the corresponding row still
  exists in the store.
- REQ-F005-026 — **Newly-declared features.** A feature added to the catalog after this install exists
  appears in the list with `hasOverride:false` and its declared `defaultEnabled` as the effective
  state (REQ-F005-017), immediately available to toggle. The console does NOT auto-create an override
  for a new feature. *Test:* adding a catalog entry makes the feature appear using its default with no
  override; it receives an override only after an explicit set (REQ-F005-021).

### §6.3 Acting-on-whom context

- REQ-F005-027 — **Customer/install context affordance.** The feature-toggle surface MUST display a
  clear customer/install label (REQ-F005-003 glossary) so the operator knows which customer a change
  binds to (brief `ux_risk_read`: "which customer am I acting on"). The label's exact source is a minor
  configuration decision with a recommended default (REQ-F005-048). *Test:* the surface renders a
  non-empty customer/install label; the same label is returned by `GET /api/feature-toggles`.
- REQ-F005-060 — **Customer/install label fallback amended to a fixed neutral literal (human ruling,
  Derek, RATIFIED 2026-07-13; AMENDS REQ-F005-048 and constrains REQ-F005-027).** A security review
  found that the previously-ratified fallback of REQ-F005-048 — "falling back to the configured
  instance origin/identifier when unset" — was implemented as a fallback to the **engine base URL**
  (`ANYTHINGLLM_BASE_URL`), which **leaks the engine's internal hostname/port** into the
  `GET /api/feature-toggles` payload (`FeatureToggleListView.customerLabel`, §7.1) and into the DOM. That
  is in direct tension with **REQ-F005-003** (no F-005 code path references the engine base URL/paths)
  and **REQ-F005-039** (engine paths/identifiers never appear in an F-005 payload). **Ruling:** when
  `CUSTOMER_LABEL` is unset, the customer/install label (REQ-F005-027) falls back to the **fixed neutral
  literal `"this install"`**. **No value derived from engine configuration** — `ANYTHINGLLM_BASE_URL`,
  the engine origin, hostname, port, or any other engine-derived identifier — **may ever be used for the
  label.** The label is therefore **either the operator-configured `CUSTOMER_LABEL` or the literal
  `"this install"`, and nothing else.** **REQ-F005-003/039 take precedence** over the earlier
  REQ-F005-048 origin/identifier-fallback wording, which is DEPRECATED (marked in place, not deleted).
  **Accepted cost (recorded per ruling):** an install that has not configured `CUSTOMER_LABEL` shows a
  **non-identifying** label, a partial narrowing of REQ-F005-027's "so the operator knows which customer
  a change binds to" intent until `CUSTOMER_LABEL` is set; **setting `CUSTOMER_LABEL` remains the
  recommended deployment posture.** *Test:* with `CUSTOMER_LABEL` set, `GET /api/feature-toggles`
  returns that configured value as `customerLabel`; with `CUSTOMER_LABEL` unset, `customerLabel` equals
  exactly the literal `"this install"` and never contains `ANYTHINGLLM_BASE_URL`, the engine origin, or
  any engine hostname/port; a static scan confirms the label code path derives no value from engine
  configuration (REQ-F005-003/039).

---

## §7 API Surface

Product API, consistent with `docs/design/02-product-api.md`: product vocabulary only; all routes
require a staff session (parent REQ-012); error bodies are `{ message: string }` rendered verbatim
(parent REQ-097a). All routes are under `/api`. No engine call participates in any route
(REQ-F005-003).

### §7.1 Product types (excerpt — added to the shared `bff/src/types/product-types.ts`, parent REQ-025)

```ts
export interface FeatureCatalogEntry {
  featureKey: string;              // stable identifier (REQ-F005-016)
  displayName: string;
  description: string | null;
  category: string | null;         // optional grouping
  defaultEnabled: boolean;         // catalog-declared default (REQ-F005-017)
}

export interface FeatureToggle {
  featureKey: string;
  displayName: string;
  description: string | null;
  category: string | null;
  defaultEnabled: boolean;
  enabled: boolean;                // effective state (override ?? default, REQ-F005-017)
  hasOverride: boolean;            // whether an explicit operator override exists (REQ-F005-020)
  updatedAt: string | null;        // ISO-8601 of the override write; null if no override
  updatedBy: string | null;        // staff id of the override write; null if none
}

export interface FeatureToggleListView {
  customerLabel: string;           // which install/customer this console governs (REQ-F005-027)
  features: FeatureToggle[];
  counts: { enabled: number; disabled: number; total: number };
}
```

### §7.2 Routes

| Method / path | Req body | Resp | Store call(s) | Mutates → event |
|---|---|---|---|---|
| `GET /api/feature-toggles` | — | `FeatureToggleListView` | catalog read + override read | no (REQ-F005-019) |
| `PUT /api/feature-toggles/:featureKey` | `{ enabled: boolean }` | `FeatureToggle` | override upsert | yes (store) → `admin.feature_toggle.changed` when effective state changes (REQ-F005-021/037) |
| `DELETE /api/feature-toggles/:featureKey/override` | — | `FeatureToggle` | override delete | yes (store) → `admin.feature_toggle.changed` when effective state changes (REQ-F005-023/037) |

- REQ-F005-028 — **Opaque `featureKey` path-segment encoding contract (resolves review BLOCKING
  GAP).** Because a `featureKey` is a fully opaque string whose structure the console never parses
  (§3) and whose minting source is deferred (REQ-F005-044), a key MAY contain characters that are
  reserved or unsafe in a URL path segment (`/`, `?`, `#`, whitespace, etc.). To keep every declared
  feature reachable on `PUT`/`DELETE /api/feature-toggles/:featureKey[...]`, the contract is:
  - **Callers MUST percent-encode** the `featureKey` when composing the path segment
    (RFC 3986 percent-encoding of the single path segment; e.g. a key `a/b c` is sent as `a%2Fb%20c`).
  - **The BFF percent-DECODES** the `:featureKey` segment exactly once before use, then matches the
    decoded string **literally** (byte-for-byte, no normalization, no case folding) against catalog
    keys (REQ-F005-018) and override rows (REQ-F005-012).
  - A segment that is not valid percent-encoding → **400** ("malformed feature key"). A well-formed
    segment that decodes to a string absent from the catalog → **404** (REQ-F005-030), NOT a routing
    error.
  This keys the route on the opaque decoded value without the console ever ascribing meaning to the
  key's internal characters. *Test:* a feature whose key contains `/` is reachable via its
  percent-encoded segment (`%2F`) and its `PUT`/`DELETE` resolve to that exact catalog entry; the same
  key sent raw (unencoded `/`) does not silently match a different feature; a malformed
  percent-sequence returns 400; a well-formed encoding of an undeclared key returns 404.
- REQ-F005-029 — Every route above is BFF-brokered and staff-authenticated (parent REQ-012): the
  browser calls only these product `/api/*` routes; state lives only in the BFF store. *Test:* an
  unauthenticated call to any route returns 401; a static scan finds no engine path/field name in
  `web/` for any F-005 flow.
- REQ-F005-030 — **Request validation & error mapping.** The BFF validates inputs and maps failures to
  `{ message }` bodies (parent REQ-097/097a):
  - a `PUT` whose body omits `enabled` or whose `enabled` is not a JSON boolean → **400**
    ("enabled must be true or false");
  - a `PUT` or `DELETE` for a `:featureKey` **not present in the current catalog** → **404** ("unknown
    feature"); the console never creates state for an undeclared feature (REQ-F005-008). A `DELETE`
    against a **catalog-present** feature that has no override row is NOT this case — it is idempotent
    `200` success (REQ-F005-023);
  - a store write that cannot be confirmed (REQ-F005-021) → **500** `{ message }`
    ("could not confirm the change was saved") and NO event is emitted (REQ-F005-037);
  - unauthenticated → **401** (parent REQ-012).
  *Test:* a `PUT` with a non-boolean `enabled` returns 400; a `PUT`/`DELETE` for an undeclared feature
  key returns 404 and writes nothing; a store write that cannot be confirmed returns 500 with the
  verbatim message and emits no event; an unauthenticated call returns 401.

---

## §8 Web UI Requirements

The web surface follows `docs/design/05-web-architecture.md` and reuses existing design-system
building blocks. The brief's `complexity_read` notes this maps onto existing patterns: a labeled
list/roster of features driven by the design-system `Toggle` (`role="switch"`, keyboard-operable) plus
the established `PageHeader`/`ErrorBanner`/loading/empty scaffolding.

- REQ-F005-031 — **New console section under the customer-wide scope.** F-005 adds a dedicated section
  (e.g. `features/feature-toggles/`) reachable from the console's top-level navigation, naturally
  living within the existing "Customer-wide" area (brief `complexity_read`). It is not bound to a
  single workspace. *Test:* the feature-toggle section is reachable from navigation and is not scoped
  to a workspace.
- REQ-F005-032 — **Toggle control reuses the design-system `Toggle`.** Each feature row renders the
  design-system `Toggle` (`role="switch"` + `aria-checked`, `onChange(next:boolean)`;
  `docs/design/F-001/01-component-contracts.md`), labeled with the feature `displayName` and, where
  present, its `description`. *Test:* each feature row exposes a `role="switch"` control that is
  keyboard-operable and reflects the feature's effective state.
- REQ-F005-033 — **State + provenance are legible without relying on color alone.** Each row shows the
  effective on/off state AND whether it is operator-set or using the default (REQ-F005-020), encoded
  with text/iconography in addition to any color (WCAG non-color-only encoding, mirroring parent
  accessibility posture). *Test:* on/off and default-vs-operator-set remain distinguishable in a
  grayscale/color-blind simulation.
- REQ-F005-034 — **Change confirmation & consequence framing.** Because a toggle changes a live
  customer-facing capability, the UI surfaces consequence framing on a state change: it names the
  feature and the customer/install (REQ-F005-027) and states that the capability will become
  available/withheld in the customer-facing app. The **strength** of the gate — a lightweight
  confirm versus the parent §8 `DangerConfirm` typed-token dialog — is a decision with a recommended
  default (REQ-F005-047); a feature toggle is highly reversible (it flips back), so this revision
  adopts a **lightweight, non-typed confirmation** provisionally. *Test:* changing a feature's state
  presents a confirmation that names the feature and the customer before the change is committed;
  cancelling leaves the prior state.
- REQ-F005-035 — **Success/failure reflection.** After a set/clear, the UI reflects the outcome: on
  success the row shows the new effective state and provenance; on failure it renders the BFF
  `{ message }` verbatim via `ErrorBanner` (parent REQ-097a) and leaves the row showing its prior
  state (no optimistic state is left stranded as "saved"). *Test:* a forced store-write failure leaves
  the toggle showing its prior state and shows the verbatim error message.
- REQ-F005-036 — **Empty & loading states.** The surface renders a loading state while
  `GET /api/feature-toggles` is in flight and the empty state of REQ-F005-024 when the catalog is
  empty. *Test:* with an empty catalog the empty-state copy renders; during load a loading affordance
  renders; neither is an error state.
- REQ-F005-054 — **DS `Toggle` programmatic accessible name (human ruling RATIFIED 2026-07-12,
  resolving the ux-designer's OQ-1).** The design-system `Toggle` (F-001 contract,
  `docs/design/F-001/01-component-contracts.md`) renders `role="switch"` but does NOT currently bind
  its `label` programmatically, so each feature switch is an **unnamed switch** to assistive
  technology — failing REQ-F005-032/042. The ruling: **F-005's implementation scope includes extending
  the F-001 design-system `Toggle` contract** so the control binds its label to the switch element
  (via `aria-labelledby` referencing the rendered label, or an equivalent programmatic name binding).
  This is an **additive, backwards-compatible** DS change that benefits all `Toggle` consoles, NOT an
  F-005-local `aria-label` row workaround. Each F-005 feature switch MUST therefore have a
  **programmatic accessible name equal to the feature `displayName`** (REQ-F005-019), delivered
  through the extended DS `Toggle`. *Test:* for every rendered feature row, the switch element's
  computed accessible name equals that feature's `displayName`; the name is delivered by the DS
  `Toggle`'s label binding (e.g. `aria-labelledby`), not by a row-level `aria-label` override; the
  F-001 `Toggle` contract/tests reflect the additive label-binding behavior.
- REQ-F005-055 — **Per-row "Reset to default" affordance (human ruling RATIFIED 2026-07-12, resolving
  the ux-designer's OQ-2).** The web UI MUST expose a per-row **"Reset to default"** action on every
  feature row with `hasOverride:true` (REQ-F005-020), and MUST NOT expose it on rows with
  `hasOverride:false` (there is no override to clear). Invoking it routes through the confirmation
  (REQ-F005-034/056) and, on confirm, calls `DELETE /api/feature-toggles/:featureKey/override`
  (REQ-F005-023) with the `featureKey` percent-encoded per REQ-F005-028. *Test:* a row with an
  override shows the "Reset to default" action and a row without an override does not; invoking it
  presents the confirm dialog and, on confirm, issues a `DELETE` to the override route with the
  correctly percent-encoded key.
- REQ-F005-056 — **Effective-state-unchanged reset is confirmed, never silent (human ruling RATIFIED
  2026-07-12, resolving the ux-designer's OQ-3).** A "Reset to default" (REQ-F005-055) on a feature
  whose override value **equals** the catalog default — so clearing it does not change the
  customer-visible effective state (REQ-F005-037 effective-state-unchanged case) — MUST route through
  the **same** confirmation dialog as any other reset, with copy noting that the customer-visible state
  will **not** change (only the provenance reverts from operator-set to default). On confirm the write
  proceeds normally: store delete + audit entry, and **no** `admin.feature_toggle.changed` event
  (REQ-F005-023/037/038). Such a reset is **never silently applied and never hidden** from the
  operator. *Test:* resetting a feature whose override equals the default presents the confirm dialog
  with "state will not change" copy; on confirm the override row is deleted and an audit entry is
  recorded while zero events are emitted; the action is neither auto-applied nor omitted from the UI.
- REQ-F005-057 — **Confirm copy asserts immediate customer effect, and pins a forward constraint on the
  customer app (human ruling RATIFIED 2026-07-12, resolving the ux-designer's OQ-4 — the human chose
  AGAINST the designer's neutral-wording recommendation).** The confirmation dialog copy (REQ-F005-034)
  MUST assert that the change takes effect **immediately for the customer** — e.g. "will be
  **immediately** available/withheld in the customer-facing app" — NOT neutral, decision-only wording
  that omits timing. **Forward constraint (explicit consequence of this ruling):** because the console
  now promises immediate effect to the operator, the future customer-facing app's toggle-consumption
  design **MUST apply enablement changes effectively immediately** (near-real-time read of the
  console's state, REQ-F005-041), otherwise the console's confirm copy is false. This **partially
  narrows REQ-F005-009's deferral**: the consumption *mechanism* remains deferred and out of scope, but
  the *latency budget* is no longer open — it is pinned as **"effectively immediate"** (near-real-time),
  a binding requirement on that later effort. *Test:* the confirm dialog copy states the change takes
  effect immediately in the customer-facing app (not merely decision-neutral text); the spec records the
  near-real-time consumption constraint as a forward requirement on the customer app cross-referencing
  REQ-F005-009/041.

---

## §9 Events & Audit

F-005 events use the parent spec's `admin.*` namespace and event bus (§14, delivered on the
F-004 production bus). One new event name is added.

- REQ-F005-037 — **Event catalog addition — `admin.feature_toggle.changed`.** Emitted after a
  `PUT` (REQ-F005-021) or override `DELETE` (REQ-F005-023) persists to the console store AND the
  feature's **effective state actually changes**. An **effective-state-unchanged write** — a `PUT`
  whose `enabled` equals the feature's prior effective value (including creating an override equal to
  the catalog default), or a `DELETE` whose removal leaves the effective value unchanged (i.e. clearing
  an override equal to the default) — is still persisted and audited (REQ-F005-012/038) but emits
  **no** event (aligning with the parent's emit-only-on-actual-delta stance, REQ-029). **This is NOT a
  write-nothing no-op:** unlike the parent's engine no-op, such a write may still create/refresh the
  override row and flip `hasOverride` (REQ-F005-021); only the *emitted event* is suppressed, not the
  store write. Payload (parent REQ-029c shape): `actor` (staff id), `target: { featureKey }`,
  `changes: { enabled: boolean, previous: boolean, hasOverride: boolean }`, `verified`
  (store-confirmed `true`, REQ-F005-021), `timestamp` (ISO-8601). This is a console-store write, not an
  engine mutation, so it carries no engine verify. **`AdminEventName` union (cross-spec).** The closed
  event-name union (`docs/design/03-data-models.md` `events/catalog.ts`) MUST gain
  `'admin.feature_toggle.changed'`. **Ordering-key derivation (cross-spec dependency, resolves review
  NOTE).** `admin.feature_toggle.*` is a **new (seventh) event family** not covered by F-004 §3's
  ordering-key derivation (which reads `target.id`/`target.workspace`/`target.keys` over its six
  live families). Absent an added rule, feature-toggle events fall to F-004's reserved `__unkeyed__`
  key = **independent delivery, no per-key ordering**. Whether per-key ordering is required for the
  billing consumer, and if so which key, is a product decision tracked in **REQ-F005-052**; until it is
  ratified and F-004 §3 extended, feature-toggle events are `__unkeyed__` (mechanically safe, ordering
  not guaranteed). *Test:* toggling a feature from disabled to enabled emits one
  `admin.feature_toggle.changed` with `changes.enabled=true`, `changes.previous=false`; an
  effective-state-unchanged write emits zero events; a subscriber on the bus receives the emitted
  event; the `AdminEventName` union includes `admin.feature_toggle.changed`.
- REQ-F005-038 — **Audit is the complete operator-action record; the event stream is not
  (resolves review NOTE).** Every accepted set/clear — including effective-state-unchanged writes and
  provenance-only transitions (override created equal to default, `hasOverride` false→true; override
  cleared equal to default, true→false) — is recorded in the append-only audit log (parent
  REQ-093/093a) with actor, action (route), target (`featureKey`), the new state, `hasOverride`, the
  store-confirmed `verified` result, timestamp, and outcome; a failed write records a failure entry.
  Because `admin.feature_toggle.changed` fires only on an **effective-state change** (REQ-F005-037),
  the **event bus is NOT a complete log of operator actions** — a billing/history consumer that needs
  every operator action (including provenance-only transitions) MUST read the **audit log**, not the
  bus; the bus carries effective-state deltas only. REQ-F005-045's "read API and/or event stream"
  guidance is refined accordingly: full point-in-time action history comes from the audit log. *Test:*
  a toggle produces one audit entry naming the feature, actor, and new state; a rejected write produces
  a failure audit entry; a provenance-only transition (override set equal to the default) produces an
  audit entry but no bus event.
- REQ-F005-059 — **Audit `action` literals (human ruling RATIFIED 2026-07-12, resolving a Phase-2
  test-generation ambiguity; pins the `action` field of REQ-F005-038).** Toggle audit-log entries use
  the exact `action` string literals (parent `audit_log.action`, `docs/design/03-data-models.md`):
  - **`feature_toggle.set`** — for a `PUT /api/feature-toggles/:featureKey` override write
    (REQ-F005-021), including effective-state-unchanged and idempotent re-writes;
  - **`feature_toggle.clear`** — for a `DELETE /api/feature-toggles/:featureKey/override` override
    removal (REQ-F005-023), including the no-override idempotent-success case and the
    effective-state-unchanged reset (REQ-F005-056).
  These literals are the contract of record for consumers querying the audit log by action. *Test:* a
  `PUT` override write records an audit entry whose `action` equals exactly `feature_toggle.set`; a
  `DELETE` override clear records one whose `action` equals exactly `feature_toggle.clear`.

---

## §10 Non-Functional Requirements

- REQ-F005-039 — **Custody boundary (inherited, restated).** The browser never calls the engine and
  never receives the AnythingLLM API key; all F-005 reads/writes go through the BFF to the console
  store (parent REQ-011/013/021). Trivially satisfied because F-005 makes no engine call
  (REQ-F005-003). *Test:* no browser-originated F-005 request targets an engine URL; the API key never
  appears in an F-005 payload or bundle.
- REQ-F005-040 — **Performance.** The feature-toggle list view renders within **p95 < 1500 ms**
  (aligning with the parent read-view bound, REQ-100), and a single toggle write persists and is
  reflected on the next read within the same bound. **Sizing N (resolves review NOTE).** Parent
  REQ-100 sizes load in workspaces/users, which do not bound a feature catalog; for this feature the
  perf test N is a **seeded catalog of ≤ 500 declared features with ≤ 500 override rows** — a generous
  single-install appliance ceiling well above any realistic per-customer feature count. Because state
  is local console data with no engine round-trip, no fan-out or batched-concurrency envelope (contrast
  F-002 REQ-F002-058) is needed. *Test:* with a seeded catalog of 500 features and 500 overrides, list
  render and a single toggle round-trip are each under the p95 < 1500 ms bound.
- REQ-F005-041 — **Durability & immediacy.** A committed toggle is durable across a console/BFF
  restart (persisted in SQLite, not in-memory) and is immediately reflected by
  `GET /api/feature-toggles` after the write returns success. Propagation latency to the
  customer-facing app is a property of that app's consumption mechanism and is out of scope
  (REQ-F005-009/045). *Test:* a toggle set, followed by a BFF restart, is still in effect on the next
  read.
- REQ-F005-042 — **Accessibility.** The toggle list and any confirmation dialog follow the parent
  accessibility posture: the `Toggle` switch semantics and keyboard operation (REQ-F005-032), a
  confirmation dialog with focus moved into it on open and returned to the trigger on close, and status
  changes announced via an ARIA live region. *Test:* a keyboard-only operator can navigate the list,
  flip a feature, confirm, and hear the result announced; opening the confirmation moves focus into it.

---

## §11 Open Questions / Assumptions for Human Ruling

These were decisions the spec could not responsibly make alone; each carried a **recommended default**
that the requirements above adopt, with the governing REQ cited. REQ-F005-043..051 cover the brief's
own Open Questions and the two design-read decisions; REQ-F005-052 is a cross-spec decision surfaced
during spec review.

**Status: ALL RESOLVED — human ruling (2026-07-12).** Every open question below (REQ-F005-043 through
REQ-F005-052) was **RATIFIED at its recommended default, unchanged**. The recommended default in each
is now the adopted, normative decision; the requirements that adopted it provisionally are confirmed.
Each item is annotated **RESOLVED → &lt;adopted default&gt;** below; no further ruling is needed.

- REQ-F005-043 — **Feature granularity (brief OQ1).** What is a "feature" — an entire module, an
  individual feature flag, or something finer? The spec is deliberately **granularity-agnostic**: a
  feature is one catalog entry keyed by a stable `featureKey` (§3, §5), so any granularity works
  mechanically. *Recommended default:* **feature-flag-level** granularity — one catalog entry per
  independently-shippable capability the customer app can gate — so enablement lines up with how the
  customer app will actually withhold/expose capability. *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination — confirm flag-level, and
  confirm it matches how the customer-facing app will be built.
- REQ-F005-044 — **Catalog source mechanism (brief OQ6).** How does the shared codebase declare the
  set of features to the BFF (the `FeatureCatalogEntry` set, REQ-F005-016)? *Recommended default:* a
  **deployment-provided declarative manifest** (e.g. a versioned JSON/config the BFF loads at startup,
  appliance-appropriate and mirroring `bff/src/config.ts` conventions), rather than a runtime
  registration API or a hand-seeded DB table. *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination — confirm the manifest approach and its
  format/location; and confirm whether F-005 must align with or replace any pre-existing
  feature-flagging mechanism in the shared codebase (the brief notes none is known to exist).
- REQ-F005-045 — **Billing data-model relationship (brief OQ4).** Does billing consume this data
  directly, or via a separate reconciliation step? *Recommended default:* the console is the **system
  of record for current enablement plus an append-only change history** (REQ-F005-014/037/038); billing
  consumes it through the **read API and/or the append-only audit log**, with NO shared schema or
  direct table coupling between this feature and billing. **Note (per review):** the
  `admin.feature_toggle.changed` **event stream is a partial record** — it carries effective-state
  deltas only, not provenance-only operator actions (REQ-F005-037/038); the **audit log**, not the bus,
  is the complete operator-action history a billing consumer needing every action must read.
  *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination — confirm the loose read/audit coupling, and confirm whether billing needs full
  point-in-time history (satisfied by the audit log) or only current state (satisfied by the read API).
- REQ-F005-046 — **Immediate-apply vs batched save (brief Design read; interaction model).** Does each
  toggle apply immediately, or are changes staged behind an explicit "save"? *Recommended default:*
  **immediate-apply, per feature** (REQ-F005-022) — the simplest mental model, each change
  independently reversible, audited, and evented. *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination — confirm immediate-apply, or require
  a staged/batched save (which would add a batch write route and change the event/audit cardinality).
- REQ-F005-047 — **Confirmation strength (brief Design read; effect timing OQ2).** How strongly should
  a toggle be gated, and do changes take effect immediately for a live instance? *Recommended default:*
  a **lightweight, non-typed confirmation** naming the feature and customer (REQ-F005-034), because a
  toggle is highly reversible; the parent §8 `DangerConfirm` typed-token gate is reserved for
  destructive/irreversible operations and is NOT adopted here. On effect timing, the console persists
  immediately (REQ-F005-041); whether the customer app applies the change live or needs a
  reload/restart/cache-invalidation is the customer app's concern (REQ-F005-009).
  *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination —
  confirm the lightweight confirmation (vs. a stronger typed-token gate for enabling/disabling a live
  capability), and confirm the customer-app effect-timing expectation once that app is designed.
- REQ-F005-048 — **Customer/install label source (brief `ux_risk_read`).** Where does the
  customer/install label (REQ-F005-027) come from? *Recommended default:* a **configured customer/
  install label** (e.g. a `CUSTOMER_LABEL` deployment config value), ~~falling back to the configured
  instance origin/identifier when unset~~ **[DEPRECATED by REQ-F005-060, RATIFIED 2026-07-13 — the
  origin/identifier fallback was implemented as a fallback to the engine base URL (`ANYTHINGLLM_BASE_URL`)
  and leaked the engine hostname/port into the F-005 payload/DOM, in tension with REQ-F005-003/039; the
  fallback when `CUSTOMER_LABEL` is unset is now the fixed neutral literal `"this install"`, never an
  engine-derived value]**. *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12); label
  fallback subsequently AMENDED by REQ-F005-060 (RATIFIED 2026-07-13).* Ratified determination — confirm
  the config-driven label and its source of truth.
- REQ-F005-049 — **New-feature default state (brief OQ5) & retired-feature visibility.** What state
  does a newly-declared feature take before any operator sets it, and should retired (orphan) features
  be surfaced? *Recommended default (new features):* honor the **catalog-declared `defaultEnabled`**,
  and where a feature omits it, default to **disabled/off** — the safest go-to-market posture
  (features are withheld until explicitly enabled), matching the brief's "withhold a feature for whom
  it isn't ready" rationale (REQ-F005-017/026). *Recommended default (orphans):* **hide orphan
  overrides** from the active list while retaining their rows (REQ-F005-025); a read-only "retired
  features" view is deferred, not built. *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination — confirm off-by-default for
  default-unspecified features, and whether retired features need a surfaced view.
- REQ-F005-050 — **Stepping-stone to fleet management (brief OQ7).** Should the data model be shaped
  today to avoid a costly rework toward eventual centralized fleet management, and how far? *Recommended
  default:* adopt the **minimal, non-committal forward-compat measure** of REQ-F005-015 — key overrides
  by the stable global `featureKey` so this install's set is a clean single-tenant slice — while
  building **no** cross-tenant identifiers, sync, or central plane in this revision (REQ-F005-011).
  *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination — confirm this minimal measure is sufficient, or specify additional model/interface
  constraints (e.g. a tenant identifier, an export/sync contract) if a central plane is a near-term
  commitment.
- REQ-F005-051 — **Audit trail depth (brief OQ3).** Is an audit trail needed, and how deep? This spec
  treats it as **required, not optional** (REQ-F005-038: every set/clear audited; every effective
  change evented), given the billing rationale. *Recommended default:* the append-only audit log +
  event stream provide the "who toggled what, when" history; no additional dedicated history store is
  built. *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12).* Ratified determination — confirm the audit-log/event history is sufficient, or specify a richer
  dedicated toggle-history store/report if billing needs more than the audit log offers.
- REQ-F005-052 — **Event ordering key for `admin.feature_toggle.changed` (cross-spec with F-004; from
  review NOTE).** `admin.feature_toggle.*` is a new event family not covered by F-004 §3's ordering-key
  derivation, so its events currently fall to F-004's reserved `__unkeyed__` key — **independent
  delivery, no per-key ordering** (REQ-F005-037). This is mechanically safe (F-004 keeps the derivation
  total; unmatched events are independent, never a literal bad key), but it means two changes to the
  **same** `featureKey` are not guaranteed to be delivered in order. *Recommended default:* **accept
  `__unkeyed__` (no per-key ordering) for this revision** — a billing/history consumer reconstructs
  state from the audit log or a fresh read (REQ-F005-045), which does not depend on bus ordering, and
  each event carries `previous` + `enabled` (REQ-F005-037) so a late/duplicate delivery is
  self-describing. *RESOLVED → recommended default adopted, unchanged (RATIFIED 2026-07-12):* accept
  `__unkeyed__` (no per-`featureKey` ordering) for this revision; F-004 §3 is NOT extended now. Deferred
  and untriggered: should per-`featureKey` ordering later be required for the consumer, extending
  F-004 §3's derivation with an `admin.feature_toggle.*` rule (e.g. `feature:<target.featureKey>`) is a
  change that MUST be made in F-004, not silently assumed here.

---

## §12 Traceability to the Brief

| Brief element | Addressed by |
|---|---|
| Problem: no way to control which features are active for this customer's install | §1.1 REQ-F005-001, §6 |
| Affected users: staff operators, single install by construction | §1.2 REQ-F005-002 |
| Proposed Direction: new console section; a roster of features toggled on/off; state lives/read locally | §1.1/§1.2 REQ-F005-001/002, §6, §8 REQ-F005-031/032 |
| Proposed Direction: storage mechanism left open | §4 REQ-F005-012 (BFF store) + catalog source OQ REQ-F005-044 |
| Proposed Direction: no engine sync; local single-install | §1.3 REQ-F005-003, §2 REQ-F005-010 |
| Business rationale: go-to-market staging | §5 default-off posture REQ-F005-017/026 + REQ-F005-049 |
| Business rationale: billing foundation | §9 REQ-F005-037/038 (history) + REQ-F005-006/045 |
| Out of Scope: fleet/bulk, customer-facing surface, billing system, the customer app & its features | §2 REQ-F005-004..007/010/011 |
| Design read: reuse DS `Toggle`, list/`PageHeader`/`ErrorBanner`/loading/empty scaffolding | §8 REQ-F005-031..036 |
| Design read: which-customer affordance; consequence framing | §6.3 REQ-F005-027, §8 REQ-F005-034 |
| Design read: empty state when no features defined | §6.2 REQ-F005-024, §8 REQ-F005-036 |
| Open Q — feature granularity | REQ-F005-043 (§3/§5 granularity-agnostic) |
| Open Q — immediate effect vs restart | REQ-F005-041 + REQ-F005-047 (+ REQ-F005-009) |
| Open Q — audit trail | REQ-F005-038 + REQ-F005-051 |
| Open Q — billing data-model relationship | REQ-F005-045 |
| Open Q — default state for new features | REQ-F005-017/026 + REQ-F005-049 |
| Open Q — existing feature-flagging alignment | REQ-F005-044 |
| Open Q — stepping stone to fleet management | REQ-F005-015 + REQ-F005-050 |
| Cross-spec (F-004): event ordering key for the new feature-toggle family | §9 REQ-F005-037 + REQ-F005-052 |

---

### Self-check note (per analyst workflow step 5)
The requirements most at risk of divergent implementation are effective-state resolution
(REQ-F005-017), the override-vs-default provenance (REQ-F005-020), and orphan/new-feature handling
(REQ-F005-025/026); each is pinned to an exact predicate (`effective = override ?? default`, override
always wins, orphan = key-not-in-catalog) and a concrete test, so two implementers cannot both claim
compliance with different behavior. The genuinely undecided product decisions — granularity, catalog
source, default-state, confirmation strength, immediate-vs-batched, billing coupling, fleet
readiness, and cross-spec event ordering — are isolated in §11 as open questions, each adopting a
recommended default provisionally so implementation proceeds without silently resolving a product
ambiguity.

Rev 2 additionally pins the two reachable-input contracts a QA engineer could not otherwise state a
pass/fail for — the empty-override `DELETE` (idempotent `200`, REQ-F005-023/030) and the opaque
`featureKey` URL-encoding/decoding contract (REQ-F005-028) — plus the count basis (REQ-F005-019),
`defaultEnabled` coercion (REQ-F005-016), store-confirm-failure status (500, REQ-F005-030), perf N
(REQ-F005-040), and idempotent re-write/concurrency semantics (REQ-F005-021). The event stream is
explicitly demoted to a partial record (audit log is the complete operator-action history,
REQ-F005-038), and the "no-op" wording is replaced by "effective-state-unchanged write" to stop a
reader assuming the store write is skipped (REQ-F005-037).
