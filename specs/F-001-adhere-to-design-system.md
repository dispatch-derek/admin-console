# F-001: Adhere to a Design System — Specification

Status: Draft rev 3 — resolves spec-review `docs/spec-review-F001.md` (B1–B5, M1–M2, N1–N4), folds
in the vendored DS ground truth at `web/vendor/design-system/`, and applies the six §9 human rulings
of 2026-07-07 (OQ-3 on-demand re-sync; OQ-4 internal-only exposure; OQ-5 small operator base <25;
OQ-6 WCAG 2.1 AA, non-gating; OQ-7 GTM is a **hard gate**; OQ-8 phasing acceptable). All §9 open
questions are now RESOLVED; no assumption remains outstanding. For implementation and QA review.
Feature brief (authoritative intent): `briefs/F-001-adhere-to-design-system.md`
Parent spec (conventions, architecture, shared requirements): `specs/admin-console.md` (v1, rev 7)
Sibling spec (format/structure template): `specs/F-002-customer-system-prompt.md`
Grounding references (current-state baseline, inspected 2026-07-07): `web/src/index.css`,
`web/src/App.tsx`, `web/src/main.tsx`, `web/src/components/{DangerConfirm,ErrorBanner,SetNotSetBadge}.tsx`,
and the five feature areas under `web/src/features/{workspaces,users,settings,raweditor,diagnostics}/`.
Governing-system ground truth (vendored in-repo, inspected 2026-07-07): the design-system handoff
bundle under `web/vendor/design-system/` — `README.md`, `project/readme.md`, the manifest
`project/_ds_manifest.json`, the token CSS `project/tokens/{fonts,colors,typography,spacing}.css`, the
11 component prototypes under `project/components/**` and their `.d.ts` prop contracts, the admin-console
UI kit `project/ui_kits/admin-console/`, and the adherence linter config
`project/_adherence.oxlintrc.json`.

This is an **additive** feature spec layered on `specs/admin-console.md`. It introduces a distinct
requirement-ID namespace, **`REQ-F001-###`**, so its IDs never collide with the parent spec's
`REQ-###` series or F-002's `REQ-F002-###` series. Section numbers (§1, §1.1, …) below are **local
to this document**; downstream tests cite the `REQ-F001-###` id (globally unique) plus the local §.
Requirement IDs and section numbers are **stable**: never renumber or reuse an id; append new ids or
mark items **DEPRECATED**.

**Nature of this feature (read first).** F-001 is a **frontend-only (`web/`) systematization /
migration**: it adopts an already-owned design system (the **Admin Console Design System**, vendored
in-repo at `web/vendor/design-system/`, exported from Claude Design) as the console's
governing source of truth for design tokens and UI components, and migrates the console's five
feature areas off their ad-hoc, hand-authored styling onto that system. It changes what screens are
**built from**, not what they **do**. It introduces NO new operator capability, NO engine
capability, and NO BFF/backend change. Where this spec reuses parent-spec machinery — the custody
boundary (parent REQ-021/021a/026), the no-engine-leakage static-scan discipline (parent REQ-021a),
read-view performance bounds (parent REQ-100), and the existing shared components / `DangerConfirm`
typed-token pattern (parent §8) — it cites the parent `REQ-###` id rather than restating it.

**Native-look preservation (not a risk).** The governing design system was **derived from
AnythingLLM's own admin surface** — its tokens, components, and screens were recreated from the
open-source AnythingLLM frontend (`web/vendor/design-system/project/readme.md` "Sources"; the token
set even reuses the `--theme-*` names the console already ships). Adopting it therefore **preserves**
the console's intentional "reads like an extension of AnythingLLM's native settings UI" look rather
than abandoning it. What changes is that this look becomes systematized and governed instead of
re-decided per screen. (The customer-facing AnythingLLM product app is out of scope; the DS is
admin-surface-only, matching the console.)

**Honesty note — what is now established and ruled.** The governing design system is no longer
an unverified remote project: it is **vendored in-repo** at `web/vendor/design-system/`. Two facts the
prior revision carried as ASSUMPTIONs are now **established and cited**: its contents / pattern
coverage (former A7 → now fact, §5) and its dual-theme coverage (former A1 → now fact, §6.4). The
items that this revision carried as narrower open questions — the re-sync **cadence** (A2's mechanism
was already known, §6.5), the committed accessibility standard (A3), GTM hardness (A5), and phasing
acceptability (A4) — were each resolved by the **2026-07-07 human rulings** recorded in §9. Every
former ASSUMPTION is now a ratified fact; each dependent requirement below states the ruling it rests
on rather than a provisional assumption. This spec invents no answer to any still-open item because
none remains open.

---

## §1 Overview & Scope

### §1.1 Purpose
- REQ-F001-001 — F-001 establishes **one governing design system** for the Admin Console's frontend:
  a single source of truth for color, spacing, typography, and component behavior, sourced from the
  already-owned **Admin Console Design System** (vendored at `web/vendor/design-system/`) and consumed
  by the console's `web/` package. The goal is a
  console that reads as one coherent, professional product across all five feature areas, replacing
  the current per-screen re-decision of styling. *Test:* after migration, every migrated screen
  derives its color/spacing/typography from the governing token set (§6.1) and its interactive
  surfaces from the governing component set (§6.2), with no screen introducing its own independent
  styling primitives (§6.6).

### §1.2 Nature — frontend-only systematization, behavior-preserving
- REQ-F001-002 — F-001 changes ONLY the `web/` package. It touches no `bff/` code, no engine path,
  no product API contract, no product data model, and no operator-visible capability. It is a
  **behavior-preserving migration**: the set of things an operator can do, the routes/views that
  exist (`web/src/App.tsx` `View` union), the workflows, and the field/validation semantics defined
  by the parent spec are unchanged. *Test:* a diff of the migration touches only files under
  `web/src/` (styling, component structure, and their tests); no `bff/` file, no product-type file
  consumed by the BFF, and no parent-spec functional requirement changes behavior; the `View` union
  and navigation structure of `App.tsx` are preserved (or changed only cosmetically, never removing a
  view).

### §1.3 Relationship to the parent spec
- REQ-F001-003 — F-001 introduces NO new engine write, NO new product route, and NO new custody
  path. The parent custody boundary (browser never holds the API key, browser calls only product
  `/api/*` routes — parent REQ-013/021/021a/026) is preserved verbatim; a design-system migration
  cannot and MUST NOT introduce any engine URL, `/v1/*` path, or engine field name into `web/`
  (parent REQ-021a remains release-blocking). *Test:* the parent REQ-021a static scan of `web/`
  still finds no engine identifier after migration; no F-001 change adds a network call, a product
  route, or an engine reference.

---

## §2 Out of Scope (Non-Goals)

Mirrors the brief's **Out of Scope** section and the parent spec's boundaries.

- REQ-F001-004 — **No change to AnythingLLM's own application or native theme.** F-001 governs only
  this console's `web/` surface. It MUST NOT alter, restyle, or re-theme the customer-facing
  AnythingLLM application or its native admin UI. *Test:* no F-001 change touches anything outside
  this repo's `web/` package; the AnythingLLM instance's own theme is untouched.
- REQ-F001-005 — **No new operator functionality or behavior.** F-001 adds no capability, no
  setting, no route, no workflow. Any change that alters what an operator can do (beyond how it
  looks) is out of scope for this feature. *Test:* the console's capability set (parent §5–§7)
  before and after migration is identical.
- REQ-F001-006 — **No backend / BFF change.** No `bff/` code, engine mapping, product route, event,
  or audit behavior is modified by F-001. *Test:* the `bff/` package is unchanged by the migration
  diff.
- REQ-F001-007 — **No rebrand / no new brand authorship.** F-001 **applies** the existing governing
  design system; it does NOT define, negotiate, or invent a new brand, logo, or visual identity. The
  governing system itself ships **no brand mark** — every place a logo would go renders "Admin
  Console" in plain type (`web/vendor/design-system/project/readme.md` "Branding: not yet
  determined") — so F-001 MUST NOT introduce a logo or wordmark requirement; it renders plain type
  wherever the system does. Choices not expressed by the adopted system are not F-001's to originate.
  *Test:* the migration consumes tokens/components from the adopted system rather than authoring
  net-new brand primitives; no logo/wordmark asset is introduced; any local value that must fill a
  gap is an isolated, documented bridge entry (REQ-F001-026), not a new brand decision.
- REQ-F001-008 — **Not a redesign of flows or information architecture.** Beyond adopting the
  system's primitives, F-001 does not restructure navigation, re-order fields, add screens, or
  redesign interactions. Visual change is a consequence of adopting the system, not an independent
  goal. *Test:* screen inventory, field inventory, and navigation grouping (`App.tsx` `NAV`) are
  preserved.

---

## §3 Definitions & Glossary

- **Governing design system (the "DS")** — the single, authoritative source of design tokens and UI
  components that all migrated console screens consume. For F-001 this is the **Admin Console Design
  System**, vendored in-repo at `web/vendor/design-system/`.
- **Admin Console Design System** — the already-owned design system to adopt, delivered as a **static
  handoff bundle** exported from Claude Design and checked into the repo at
  `web/vendor/design-system/`. Its tokens, 11 React component prototypes, admin-console UI kit, and
  adherence linter config are inspectable in-repo (see the manifest `project/_ds_manifest.json`). It
  was derived from AnythingLLM's own admin frontend (`project/readme.md` "Sources") and covers the
  **admin surface only**.
- **Handoff bundle** — the vendored `web/vendor/design-system/` tree. Its `README.md` states the
  medium is HTML/CSS/JS **prototypes to be recreated** in whatever technology fits the target
  codebase, NOT a live runtime dependency. It is checked in as the immutable **reference** F-001
  implements against (REQ-F001-015). It is NOT consumed via a live `claude_design` MCP dependency.
- **Adherence linter** — the shipped oxlint config `web/vendor/design-system/project/_adherence.oxlintrc.json`,
  adopted by F-001 as a REQUIRED CI lint gate over `web/src/` (REQ-F001-044). It forbids raw hex
  colors, raw `px` values, non-`Plus Jakarta Sans` fonts, off-contract DS component props/variants,
  and imports of DS component internals — pinning the adoption floor testably (REQ-F001-044).
- **Design token** — a named, themeable primitive (color, spacing, typography, radius, etc.). The
  console's CURRENT token layer is the `--theme-*` / `--success` / `--danger` CSS custom properties
  in `web/src/index.css`; F-001 replaces this ad-hoc layer with the governing system's tokens
  (§6.1).
- **Component primitive** — a reusable UI building block from the governing system (button, field,
  badge, modal, table, etc.), consumed rather than re-implemented per screen.
- **Ad-hoc styling baseline** — the current state F-001 migrates FROM: the ~723-line
  `web/src/index.css` and ~143 one-off `className` usages across 22 files (§4).
- **Migration site** — any location in `web/src/` that currently applies ad-hoc styling (a
  `className` usage or a CSS rule in `index.css`) and must be migrated to the governing system.
- **Behavior-preserving** — a migration in which observable operator-facing behavior (workflows,
  reachable views, field semantics, validation, keyboard/AT operability, dual-theme support) is
  unchanged; only the styling/component **source** and appearance change (§6.3).
- **Consume, don't fork** — the vendored handoff bundle (`web/vendor/design-system/`) is the immutable
  **reference**; it is never hand-edited. All production code — the adopted token CSS and the
  recreated components — lives under `web/src/` and composes the DS primitives rather than diverging
  from them. This keeps the reference clean so a future re-sync stays a diff-and-reapply, not a merge
  against locally-mutated vendor files (§6.5, REQ-F001-015).
- **Bridge entry** — a small, explicitly isolated, documented local adaptation that remains **after**
  the adherence linter passes (REQ-F001-044): i.e. a gap the DS genuinely does not cover (the
  raw/code-editor surface is the one named candidate, REQ-F001-046). It is kept in one identifiable
  bridge layer so gaps are auditable and a re-sync cannot silently overwrite them (§6.5,
  REQ-F001-026). The linter — not a size budget — is what bounds this layer.
- **Re-sync** — absorbing a subsequent DS update into the console at low marginal cost by
  **re-exporting a fresh handoff bundle, diffing it against the vendored reference, and re-applying
  the deltas** into `web/src/`. This is a diff-based procedure, NOT an `npm update` (§6.5,
  REQ-F001-025).

---

## §4 Current-State Baseline (the migration surface)

This section pins the concrete, inspected state F-001 migrates FROM, so the scope is testable
against what exists rather than an abstraction. All counts are as inspected on 2026-07-07 and are
the contract of record for "what must be migrated"; if the codebase changes before implementation,
the migration surface is re-inventoried, not silently assumed.

- REQ-F001-009 — **Ad-hoc token/CSS baseline.** The console's styling is centralized in a single
  `web/src/index.css` of ~723 lines: a `:root` dark token block, a `:root[data-theme='light']`
  light token block, a `@media (prefers-color-scheme: light)` fallback block, and ~40 bespoke
  element/utility rules (`.app`, `.app-sidebar`, `.field`, `.entity-table`, `.modal`, `.badge`,
  `.provider-group`, `.danger-button`, etc.). This file, in full, is a migration site: F-001
  replaces its ad-hoc token layer and bespoke rules with the governing system's tokens/components
  (§6.1, §6.6). *Test:* the migration accounts for every rule in `index.css` — each is either
  replaced by a governing token/component, retained as an explicitly documented bridge
  (REQ-F001-026), or removed as dead; none is left as an unexplained ad-hoc rule.
- REQ-F001-010 — **One-off `className` usages.** There are **143** `className` occurrences across
  **22 files** under `web/src/` (inspected 2026-07-07; the App shell, the five feature areas, the
  three shared components, and the auth screens). Each is a migration site subject to §6.6. *Test:*
  a static inventory enumerates every `className` site; each maps to a governing-system component or
  token usage, an isolated bridge (REQ-F001-026), or a removal — none is left as an
  unaccounted-for ad-hoc class.
- REQ-F001-011 — **Three factored shared components.** Exactly three shared UI components exist
  today under `web/src/components/`: `DangerConfirm.tsx` (the parent §8 typed-token / acknowledge
  confirmation dialog, parent REQ-078c/080/081), `ErrorBanner.tsx` (renders the BFF `{ message }`
  verbatim, parent REQ-097a), and `SetNotSetBadge.tsx` (the secret set/not-set indicator, parent
  REQ-060). These are prime migration targets: each MUST be re-expressed on the governing system's
  primitives WITHOUT changing its contract or behavior (§6.2, §6.3). *Test:* after migration each of
  the three retains its exact props/contract and behavior (e.g. `DangerConfirm` still gates on an
  exact token match / acknowledge toggle; `ErrorBanner` still renders `role="alert"` and the
  message verbatim; `SetNotSetBadge` never reveals a secret value).
- REQ-F001-012 — **Five feature areas in scope.** The migration spans exactly the five feature areas
  named in the brief, grounded to their directories: **users** (`web/src/features/users/`),
  **workspaces** (`web/src/features/workspaces/`), **settings** (`web/src/features/settings/`),
  **raw editor** (`web/src/features/raweditor/`), and **diagnostics**
  (`web/src/features/diagnostics/`), plus the App shell (`web/src/App.tsx`) and the auth screens
  (`web/src/auth/`) that host them. *Test:* every one of the five directories, the App shell, and
  the auth screens is covered by the migration; none is skipped.
- REQ-F001-013 — **Dual-theme mechanism (must be preserved).** Today the console supports two
  themes: **dark is the default** (`:root` tokens) and **light** is available via the
  `[data-theme='light']` attribute AND via the `@media (prefers-color-scheme: light)` fallback when
  the root is not explicitly `[data-theme='dark']`. There is **no in-app theme switcher** in
  `web/src/` today (no source sets `data-theme` at runtime; `main.tsx` only mounts `App` and imports
  `index.css`); theme is driven by the OS preference and/or an externally-set `data-theme` attribute.
  F-001 MUST preserve this behavior exactly (§6.4). *Test:* the current theme-selection mechanism
  (dark default, light via `[data-theme='light']` or `prefers-color-scheme`, no in-app switcher
  introduced unless explicitly ruled in) is unchanged after migration.

---

## §5 Adoption Model (governing-system consumption)

- REQ-F001-014 — **Single source of truth.** After migration the governing design system is the
  SINGLE source of truth for the console's design tokens and component behavior. A screen MUST NOT
  re-declare an independent color/spacing/typography primitive that duplicates or diverges from a
  governing token; where the system provides a primitive, the console consumes it. *Test:* a static
  review finds no per-screen redefinition of a token the governing system already provides; new
  color/spacing/type values appear only as adopted DS tokens or as a declared bridge entry
  (REQ-F001-026), and the adherence linter (REQ-F001-044) passes.
- REQ-F001-015 — **Consume, don't fork (recreate in `web/src/`, keep the vendored bundle immutable).**
  The DS is delivered as a static handoff bundle to be **recreated** (bundle `README.md`), not
  consumed as a live runtime dependency. F-001 therefore: (a) adopts the DS token CSS **verbatim**
  into `web/src/` (REQ-F001-017); (b) **recreates** the DS components as production React/TS under
  `web/src/design-system/` (REQ-F001-045); and (c) keeps `web/vendor/design-system/` checked in as an
  **immutable reference** — no F-001 commit hand-edits any file under `web/vendor/design-system/`. All
  local code lives in `web/src/` and composes the recreated primitives. *Test:* the migration diff
  contains no edit to any file under `web/vendor/design-system/`; the recreated DS layer under
  `web/src/design-system/` is a single identifiable un-forked layer; console screens import DS
  primitives from that layer's barrel (never from vendored paths, never DS component internals —
  enforced by REQ-F001-044).
- REQ-F001-045 — **Recreate the 11 DS components as production React/TS.** The 11 components declared
  in the manifest (`web/vendor/design-system/project/_ds_manifest.json`) — `Badge`, `PageHeader`,
  `Table` (with `Table.Row`/`Table.Cell`), `Button`, `IconButton`, `Input`, `Select`, `Textarea`,
  `Toggle`, `SidebarItem`, `Modal` — are recreated as typed `.tsx` under `web/src/design-system/`,
  matching each component's `.d.ts` prop contract and declared variant sets (e.g. `Button.variant ∈
  {cta,solid,ghost,danger,login}`, `Badge.tone ∈ {info,success,warn,danger,neutral}`), using
  `@phosphor-icons/react` for icons. The recreations satisfy the console's strict tsconfig
  (`noUncheckedIndexedAccess`) and its RTL testing conventions. *Test:* each of the 11 components
  exists under `web/src/design-system/`, exports the props named in its vendored `.d.ts`, type-checks
  under the console's `tsconfig`, and passes the adherence linter's prop/variant rules
  (REQ-F001-044).
- REQ-F001-016 — **Coverage-scoped adoption (ESTABLISHED — the DS covers the console's patterns).**
  The DS ships a full token set (colors incl. dark+light, type, spacing, radius, shadow, gradients)
  plus 11 components that map 1:1 onto the console's patterns
  (`web/vendor/design-system/project/_ds_manifest.json`; `readme.md`). The mapping is concrete:
  data tables/lists → `Table` (`.entity-table`, `.entity-list`, membership/document lists);
  danger-confirm modal → `Modal` (`DangerConfirm`); set/not-set and status badges → `Badge`
  (`.badge*`, `SetNotSetBadge`); settings/provider forms → `Input`/`Select`/`Textarea`/`Toggle`/
  `Button`/`IconButton` (`.field`, `.provider-group`, `SecretField`); app shell/sidebar →
  `SidebarItem` + `PageHeader` (`.app*`, `.sidebar*`). The **one known gap** is the raw/code-editor
  surface (`web/src/features/raweditor/`): the DS ships no dedicated code-editor component, and
  `Textarea` is the closest primitive — this is the single legitimate named bridge candidate
  (REQ-F001-046). Every other pattern is served by a DS component or composed from DS tokens; none
  reverts to ad-hoc styling. *Test:* for each pattern above, the migration record cites the DS
  component that serves it; the only pattern permitted a bridge entry is the raw editor
  (REQ-F001-046); the adherence linter (REQ-F001-044) passes over the migrated scope.

---

## §6 Functional Requirements

### §6.1 Token migration

- REQ-F001-017 — **Adopt the DS token CSS verbatim as the console's token layer.** The DS token CSS
  (`web/vendor/design-system/project/tokens/{fonts,colors,typography,spacing}.css`) is adopted
  **verbatim** into `web/src/` as the console's token layer, replacing the ad-hoc `--theme-*` /
  `--success*` / `--danger*` block currently hand-authored in `web/src/index.css` (REQ-F001-009).
  Because the DS tokens reuse the **same `--theme-*` names the console already uses**, screens keep
  referencing the same custom-property names; only their definition source changes. *Test:* after
  migration the console's token definitions are the adopted DS token CSS (byte-for-byte matching the
  vendored reference); the hand-authored `--theme-*`/`--success*`/`--danger*` block in the old
  `index.css` is gone; migrated screens resolve color/spacing/typography through the adopted DS
  tokens.
- REQ-F001-018 — **No hardcoded off-system values (linter-enforced).** Migrated `web/src/` code MUST
  NOT contain raw color/spacing/type literals that bypass the token layer (e.g. inline `#0e0f0f`,
  ad-hoc `12px` spacings, a non-`Plus Jakarta Sans` font-family). This is enforced mechanically by
  the adherence linter (REQ-F001-044), which flags raw hex, raw `px`, and off-system fonts. *Test:*
  the adherence linter (REQ-F001-044) reports zero violations over `web/src/`; every color/spacing/
  type value resolves to a DS token via `var()`.

### §6.2 Component migration

- REQ-F001-019 — **Migrate the five feature areas + shell + auth onto governing components.** Each
  migration site (REQ-F001-010) across the five feature areas (REQ-F001-012), the App shell, and the
  auth screens is re-expressed using a recreated DS component (REQ-F001-045) or a DS-token-based
  composition, replacing the corresponding one-off `className`. *Test:* per **REQ-F001-010's**
  `className` inventory, every `className` site resolves to a DS component/token usage or the single
  documented raw-editor bridge (REQ-F001-046); the adherence linter (REQ-F001-044) passes and the
  count of unaccounted-for ad-hoc classes is zero.
- REQ-F001-020 — **Migrate the three shared components, preserving contract.** `DangerConfirm`,
  `ErrorBanner`, and `SetNotSetBadge` (REQ-F001-011) are re-implemented on the recreated DS
  primitives (REQ-F001-045) with their public props/contract and behavior UNCHANGED. In particular:
  `DangerConfirm`
  keeps typed-token and acknowledge-toggle arming and the parent §8 semantics (parent
  REQ-078c/080/081); `ErrorBanner` keeps `role="alert"` and verbatim message rendering (parent
  REQ-097a); `SetNotSetBadge` keeps set/not-set semantics and never reveals a secret (parent
  REQ-060). *Test:* the existing component tests
  (`DangerConfirm.test.tsx`, `ErrorBanner.test.tsx`, and secret-badge behavior) pass unchanged
  against the migrated components (allowing only DOM-structure updates the tests do not assert on).

### §6.3 Behavior & workflow preservation (no regression)

- REQ-F001-021 — **No behavioral / workflow regression.** The migration MUST NOT change any
  operator-observable behavior: reachable views, navigation, form fields and their order, client-side
  validation (e.g. parent REQ-035 numeric bounds, REQ-096 key validation), danger-confirm gating,
  partial-success/verify UI semantics (parent REQ-098/098a/098b), keyboard operability, and focus
  behavior are all preserved. *Test:* the existing `web/` test suite
  (`*.test.tsx`/`*.test.ts`, including `SettingsPage`, `WorkspaceSettings`, `UserList`,
  `MultiUserGate`, `KnowledgePanel`, `RawEnvEditor`, `LoginPage`, `EnrollMfa`, `AuthContext`,
  `client`, `leakage`) passes after migration; any test change is limited to DOM-structure/selector
  updates and never relaxes an asserted behavior.
- REQ-F001-022 — **Behavior-preserving, testably.** "No visual/behavioral regression" is made
  concrete as: (a) the same views render for the same state (§1.2); (b) the same interactions
  produce the same outcomes and the same rendered text (BFF `{ message }` still verbatim, parent
  REQ-097a); and (c) accessibility operability does not regress (REQ-F001-030). Pure appearance
  changes (color/spacing/typography now sourced from the governing system) are EXPECTED and are not
  regressions; changes to what an operator can do or read ARE regressions. *Test:* a screen-by-screen
  migration checklist records, per screen, that (a)/(b)/(c) hold; a reviewer can confirm no workflow
  step was added, removed, or reordered.

### §6.4 Dual-theme preservation

- REQ-F001-023 — **Preserve dark-default + light dual-theme (ESTABLISHED — the DS ships both).** The
  console MUST continue to render correctly in BOTH themes after migration: dark as default, light
  via `[data-theme='light']` and via `prefers-color-scheme` (REQ-F001-013). The DS token CSS defines
  **both** a dark theme (`:root`) and a light theme (`[data-theme="light"]`) using the SAME `--theme-*`
  names the console already uses (`web/vendor/design-system/project/_ds_manifest.json` token list,
  `scope:"[data-theme=\"light\"]"` entries) — so both themes are driven by adopted DS tokens with **no
  theme bridging required**. *Test / harness:* for each migrated screen a reviewer confirms correct,
  legible rendering in both theme paths under a defined check: (i) render with no attribute (dark
  default), (ii) render under `[data-theme='light']`, (iii) render under simulated
  `prefers-color-scheme: light` with no `data-theme` set; each of the console's `--theme-*` custom
  properties resolves to a defined DS value in every path (no unresolved/empty custom property, no
  black-on-black); text/background pairs meet the REQ-F001-030 contrast floor (AA-or-no-regression).
- REQ-F001-024 — **Theme mechanism unchanged.** F-001 MUST NOT introduce an in-app theme switcher,
  change the default theme, or change how the theme is selected, unless such a change is explicitly
  ruled in (none is assumed). *Test:* no new runtime `data-theme` setter or theme-toggle control is
  added by the migration; dark remains the default.

### §6.5 Durable re-sync (consume, don't fork)

- REQ-F001-025 — **Re-sync is a first-class, designed property (mechanism ESTABLISHED — diff-based;
  cadence RESOLVED — on-demand, ruling OQ-3).** The adoption MUST be structured so a SUBSEQUENT DS update can be
  absorbed at low marginal cost, without a screen-by-screen manual reapplication. Because the DS is a
  **static handoff bundle to be recreated** (not a live dependency), the re-sync mechanism is now
  known and defined as: **re-export a fresh handoff bundle → diff it against the vendored reference at
  `web/vendor/design-system/` → re-apply the deltas** into the adopted token CSS and recreated
  components under `web/src/`. Keeping the vendored reference un-forked (REQ-F001-015) is what keeps
  this diff meaningful and cheap. The re-sync **cadence** (how often DS updates are pulled) is ruled
  **on-demand** (§9 OQ-3, RESOLVED) and gates no build requirement. *Test (structural, since a
  real upstream update may be unavailable):* the re-sync procedure is documented and repeatable; a
  simulated token change applied to the adopted token CSS propagates to all consuming screens WITHOUT
  per-screen edits (screens reference the token layer, not copies of values); no step of the procedure
  requires hand-editing `web/vendor/design-system/`.
- REQ-F001-026 — **Bridge layer isolates and audits residual gaps (bounded by the adherence linter).**
  A **bridge entry** is a local adaptation that remains only where the DS genuinely does not cover a
  pattern (REQ-F001-016) — NOT a general escape hatch. All bridge entries live in a SINGLE, explicitly
  isolated, documented bridge layer under `web/src/`, separate from the adopted DS tokens/components
  and from ordinary screen code. The bound on this layer is **not a size budget but the adherence
  linter (REQ-F001-044)**: because that linter forbids raw hex, raw `px`, off-system fonts, and
  off-contract DS props, a bridge entry cannot legally reproduce a full pre-migration ad-hoc ruleset —
  every hex/px literal in such a ruleset would trip a rule. The "move all 723 lines of `index.css`
  into a `bridge.css`" loophole therefore **fails the lint** (it is dense with hex and `px` literals),
  which is what makes migration completeness testable. Concretely, the only DS gap anticipated is the
  raw/code-editor surface (REQ-F001-046). *Test:* all bridge entries are locatable in one identifiable
  bridge layer, each with a recorded reason; the adherence linter (REQ-F001-044) passes over the whole
  of `web/src/` including the bridge layer; no bridge entry reproduces a pre-migration ad-hoc ruleset.
- REQ-F001-046 — **The raw/code-editor surface is the one named legitimate bridge candidate.** The DS
  ships no dedicated raw/code-editor component; the console's raw env editor
  (`web/src/features/raweditor/`) is the single pattern for which a bridge entry is expected, built by
  composing the DS `Textarea` (its closest primitive) plus DS tokens, and documented as such in the
  bridge layer. Any bridge entry OTHER than the raw editor must be explicitly justified against a
  named, demonstrable DS coverage gap. *Test:* the migration record lists the raw editor as the
  expected bridge; if any additional bridge entry exists, it names the specific DS component/token it
  could not use and why; the raw-editor bridge itself still passes the adherence linter (REQ-F001-044)
  — it uses DS tokens/`Textarea`, not raw literals.

### §6.6 Migration completeness (the adherence-linter adoption floor)

- REQ-F001-044 — **The adherence linter is a REQUIRED CI lint gate over `web/src/` (the adoption
  floor).** F-001 adopts the shipped adherence config
  `web/vendor/design-system/project/_adherence.oxlintrc.json` as a **required CI gate** run over
  `web/src/`. It enforces, mechanically: (i) **no raw hex colors** — every color must be a DS token
  via `var()`; (ii) **no raw `px` values** — every spacing must be a DS spacing token via `var()`;
  (iii) **font-family must be `Plus Jakarta Sans`**; (iv) **DS component props/variants restricted to
  the declared sets** (e.g. `Button.variant ∈ {cta,solid,ghost,danger,login}`, `Badge.tone ∈
  {info,success,warn,danger,neutral}`, `Toggle.size ∈ {sm,md,lg}`, etc.); and (v) **no importing DS
  component internals** (screens import from the DS barrel, not `components/**` paths). This gate is
  what makes "migration complete / no ad-hoc CSS" testable without a size cap. *Test:* the adherence
  linter runs in CI against `web/src/` and reports **zero violations**; a deliberately-introduced raw
  hex, raw `px`, off-system font, off-contract DS prop, or DS-internal import each fails the gate.
- REQ-F001-027 — **No residual ad-hoc styling after the migration completes (lint-bound).** At
  completion (or at completion of each phase, REQ-F001-028), the migrated scope contains no orphaned
  ad-hoc styling: every migration site (REQ-F001-009/010) is either (a) migrated to a DS token/
  component, (b) the single documented raw-editor bridge (REQ-F001-046), or (c) removed as dead. The
  ~723-line `index.css` is correspondingly reduced to (at most) the adopted DS token CSS import plus
  the small documented bridge layer. Completeness is bound by the adherence linter (REQ-F001-044), not
  a proportional cap: a "bridge.css" that merely re-hosts the old ad-hoc rules fails the lint (dense
  with hex/`px` literals) and so cannot pass this requirement. *Test:* the adherence linter
  (REQ-F001-044) passes over `web/src/` with zero violations AND a static scan finds zero ad-hoc
  `className`/CSS rules unaccounted for by the migration inventory; the residual local CSS is only the
  adopted DS token import and the documented bridge layer.

### §6.7 Phasing

- REQ-F001-028 — **Phased area-by-area migration is acceptable, bounded by a hard GTM completion
  gate (RESOLVED — rulings OQ-8 + OQ-7, 2026-07-07).** Per **ruling OQ-8**, F-001 MAY be delivered
  incrementally, one feature area at a time. Each phase MUST itself be behavior-preserving (§6.3) and
  independently shippable, and the console MUST remain fully functional and dual-theme-correct at
  every intermediate state (mixed migrated/un-migrated screens are tolerated visually but never
  behaviorally broken). **However, per ruling OQ-7 the October 2026 GTM is a HARD gate**: phasing is a
  scheduling latitude only — **all five feature areas MUST reach full design-system compliance before
  the October 2026 GTM**, which cannot ship with any area un-migrated. (This is the reconciliation of
  the two rulings: phased delivery is permitted, but the phase sequence has a fixed completion
  deadline rather than being open-ended; see REQ-F001-028a.) *Test:* if phased, after any single-area
  phase the full console still builds, passes its test suite, and renders in both themes; the migrated
  area uses the governing system while un-migrated areas remain behaviorally intact — AND, at the GTM
  gate, zero feature areas remain on ad-hoc styling (the REQ-F001-044 adherence linter passes
  repo-wide, not just per-migrated-area).
- REQ-F001-028a — **October 2026 GTM is a hard compliance gate (RESOLVED — ruling OQ-7,
  2026-07-07).** Full F-001 design-system compliance across all five feature areas is a **release
  blocker** for the October 2026 GTM, not a soft target. Partial migration MAY ship in intermediate
  internal releases (REQ-F001-028) but MUST NOT be the state at GTM. *Test:* a GTM-readiness check
  confirms the repo-wide adherence linter (REQ-F001-044) is green and no feature area retains ad-hoc
  CSS/className styling outside the bounded bridge/raw-editor exceptions (REQ-F001-026/046).

---

## §7 Web UI Requirements

- REQ-F001-029 — **Frontend-only boundary (restated for enforcement).** Every F-001 change is
  confined to `web/src/` presentation concerns (tokens, components, class usages, the bridge layer,
  and their tests). No F-001 change adds a network call, a product route, an engine reference (parent
  REQ-021a), or alters a product type consumed across the BFF boundary. *Test:* the parent REQ-021a
  no-engine-leakage scan passes; the migration diff introduces no new `/api/*` call and no `bff/`
  edit.
- REQ-F001-030 — **Accessibility: WCAG 2.1 AA target, non-gating; hard floor is no regression
  (RESOLVED — ruling OQ-6, 2026-07-07).** The migration MUST NOT regress existing accessibility
  affordances: `DangerConfirm`'s `role="dialog"`/`aria-modal`/labeling, `ErrorBanner`'s
  `role="alert"`, form labels, focus behavior, and keyboard operability are all preserved or improved
  (REQ-F001-020/021). Per **ruling OQ-6**, the console **TARGETS WCAG 2.1 AA** as the accessibility
  bar the governing system is expected to satisfy (e.g. contrast, non-color-only status encoding).
  This AA target is **non-gating**: it is a design direction, not a CI/release gate. The only hard,
  enforceable requirement is **"do not regress from today"** — AA gaps that predate this migration are
  not F-001 blockers. *Test:* current a11y affordances still present and operable after migration;
  where the governing system supplies AA-compliant tokens/components, they
  are used; contrast/keyboard checks show no regression versus the pre-migration baseline.
- REQ-F001-031 — **Layout & responsiveness parity at the desktop viewport range.** Migrated screens
  preserve their functional layout (sidebar + main panel shell, list/detail workspace view,
  provider-group settings forms) and do not lose usable behavior across the **supported desktop
  viewport range**. That range is pinned to: a **reference viewport of 1280×720** (the DS admin UI
  kit's declared target — `web/vendor/design-system/project/_ds_manifest.json` `viewport:"1280x720"`)
  as the baseline, and **usable down to 1024px wide and up to at least 1920px wide** at ≥720px tall.
  The console is a desktop operator tool; sub-1024px (tablet/mobile) layouts are out of scope
  (REQ-F001-005/008) and no responsive-breakpoint behavior below 1024px is added or required. *Test:*
  the app shell (252px sidebar + rounded panel), workspace list/detail, and settings forms remain
  usable and correctly laid out — no clipping, overlap, or horizontal scroll of primary content — at
  1024×720, 1280×720 (reference), and 1920×1080; no requirement is placed on widths below 1024px.

---

## §8 Non-Functional Requirements

- REQ-F001-032 — **Custody boundary inherited (unchanged).** The migration preserves parent
  REQ-013/021/021a/026 verbatim: the browser never receives the API key and calls only product
  `/api/*` routes; no engine identifier enters `web/`. A styling migration has no legitimate reason
  to weaken this and MUST NOT. *Test:* parent REQ-021/021a scans still pass post-migration.
- REQ-F001-033 — **Performance no-regression (with a concrete bundle budget).** Read views (workspace
  list, user list, settings) continue to meet the parent read-view budget (parent REQ-100: p95 <
  1500 ms render with seeded data) after migration; the DS adoption MUST NOT introduce a rendering or
  bundle regression that breaches it. The bundle budget is concrete: the **gzipped production
  JS + CSS bundle MUST be ≤ the pre-migration baseline + 10%**, where the baseline is measured on the
  pre-migration `web/` production build. Recreating 11 components and adopting the token CSS is
  expected to fit inside this tolerance (the DS uses `@phosphor-icons/react`, already an
  intended dependency). *Test:* post-migration p95 render for the parent REQ-100 views remains under
  1500 ms; the gzipped production JS + CSS bundle is ≤ pre-migration baseline + 10% (both measured on
  a production build with the same seeded data).
- REQ-F001-034 — **Build & type health preserved.** After migration the `web/` package builds,
  type-checks, and lints clean, and its existing test suite passes (subject to REQ-F001-021's
  allowed structural-selector updates). *Test:* `web` build/type-check/lint/test all pass on the
  migrated tree.
- REQ-F001-035 — **Maintainability outcome is measurable (falsifiable, per the brief's rationale).**
  The adoption is structured so the per-screen cost of a future styling change is lower than the
  ad-hoc baseline — the brief's engineering-velocity and maintenance-cost claims. This spec does not
  assert the improvement as fact; it requires the migration to be shaped so the claim is later
  measurable. *Test (defined change set, not a cherry-pick):* editing the values of the
  `--theme-button-primary` (primary accent) and `--theme-bg-primary` (primary background) tokens in
  the single adopted DS token CSS location takes effect across **all** screens serving the §5 pattern
  list (tables, danger-confirm modal, badges, settings/provider forms, app shell/sidebar, and the raw
  editor) with **no** per-screen edit; the change touches exactly one file and propagates via the
  shared `var()` references.

---

## §9 Open Questions / Assumptions for Human Ruling — ALL RESOLVED (2026-07-07)

Two items the prior revision carried as ASSUMPTIONs (A1, A7) were **RESOLVED** by the vendored bundle
and folded into established, cited facts. The six items this revision carried as open questions
(OQ-3–OQ-8) were **RESOLVED by human ruling on 2026-07-07** and are recorded below with their
rulings; the dependent requirements above now cite the ruling rather than a provisional assumption.
Ids are never reused/renumbered. **No open question remains** — F-001 is fully ruled and
implementable.

- REQ-F001-036 — **OQ-1 / former ASSUMPTION A7 — DS contents & pattern coverage — RESOLVED.** The DS
  ships a full token set plus 11 components that map 1:1 onto the console's patterns
  (`web/vendor/design-system/project/_ds_manifest.json`; `readme.md`). This is now an established fact
  cited in REQ-F001-016/045; the one known coverage gap is the raw/code-editor surface (REQ-F001-046).
  No ruling needed — A7 is no longer an assumption.
- REQ-F001-037 — **OQ-2 / former ASSUMPTION A1 — Dual-theme coverage — RESOLVED.** The DS token CSS
  defines BOTH dark (`:root`) and light (`[data-theme="light"]`) themes using the SAME `--theme-*`
  names the console already uses (manifest token list, `scope:"[data-theme=\"light\"]"` entries). Both
  themes are driven by adopted DS tokens with no theme bridging required — established fact cited in
  REQ-F001-017/023. No ruling needed — A1 is no longer an assumption.
- REQ-F001-038 — **OQ-3 — Re-sync cadence — RESOLVED (ruling: on-demand).** The mechanism was
  already known — the DS is a static handoff bundle recreated in `web/src/`, and re-sync is the
  diff-based procedure (re-export bundle → diff against the vendored reference → re-apply deltas), NOT
  an MCP `npm update` (REQ-F001-025). *Ruling (2026-07-07):* re-sync happens **on-demand** when a DS
  update is known to be relevant, not on a fixed schedule. Gates no build requirement; recorded for
  ongoing-effort planning.
- REQ-F001-039 — **OQ-6 — Accessibility standard — RESOLVED (ruling: WCAG 2.1 AA, non-gating).**
  *Ruling (2026-07-07):* the console **targets WCAG 2.1 AA**, but the target is **non-gating** (a
  design direction, not a CI/release gate); the only hard, enforceable requirement is **no regression
  from today** (REQ-F001-030). Pre-existing AA gaps are not F-001 blockers.
- REQ-F001-040 — **OQ-7 — GTM hardness — RESOLVED (ruling: HARD gate).** *Ruling (2026-07-07):* the
  **October 2026 GTM is a HARD compliance gate** — full F-001 design-system compliance is a release
  blocker, not a soft target (REQ-F001-028a). This tightens phasing: phasing remains permitted
  (OQ-8) but all phases MUST complete before GTM (see REQ-F001-028 for the reconciliation).
- REQ-F001-041 — **OQ-8 — Phasing acceptability — RESOLVED (ruling: phased acceptable).** *Ruling
  (2026-07-07):* a phased, feature-area-by-feature-area migration **is acceptable** (REQ-F001-028) —
  bounded, per OQ-7, by the hard GTM completion gate (all five areas compliant before October 2026).
- REQ-F001-042 — **OQ-4 — Customer-facing exposure path — RESOLVED (ruling: internal-only).**
  *Ruling (2026-07-07):* there is **no customer-facing exposure path**; the F-001 benefit is recorded
  as **strictly internal** (engineering velocity + internal credibility). F-001 is staff-only
  regardless, so this changes no REQ above; recorded for prioritization honesty.
- REQ-F001-043 — **OQ-5 — Operator-base size — RESOLVED (ruling: small, <25).** *Ruling
  (2026-07-07):* the internal staff/operator user base is **small (fewer than 25)**. Changes no REQ
  above; recorded for prioritization (bounds reach).

---

## §10 Traceability to the Brief

| Brief element | Addressed by |
|---|---|
| Problem: UI assembled ad hoc; no governing system; ~723-line `index.css`; ~143 `className` sites; three shared components; five feature areas diverge | §4 REQ-F001-009/010/011/012; §5 REQ-F001-014; §6.1/§6.2/§6.6 |
| Problem: no single source of truth for color/spacing/typography/component behavior | §1.1 REQ-F001-001; §5 REQ-F001-014; §6.1 REQ-F001-017/018 |
| Problem: no mechanism to stay in sync with an evolving external design source | §6.5 REQ-F001-025/026/046; §6.6 REQ-F001-044 |
| Affected Users: internal staff/operators, all five areas; base size small (<25, ruled) | §4 REQ-F001-012; §9 REQ-F001-043 (OQ-5, RESOLVED) |
| Business Rationale: engineering velocity / maintenance cost (falsifiable) | §8 REQ-F001-035 |
| Business Rationale: durable design-currency (absorb subsequent updates cheaply) | §6.5 REQ-F001-025; §8 REQ-F001-035 |
| Business Rationale: internal credibility / professional impression (ruled internal-only) | §1.1 REQ-F001-001; §9 REQ-F001-042 (OQ-4, RESOLVED) |
| Preserves the intentional "reads like native AnythingLLM" look (DS derived from AnythingLLM's admin surface) | Intro "Native-look preservation"; §3 Definitions; §6.4 REQ-F001-023 |
| Timing: October 2026 GTM — ruled a HARD compliance gate | §6.7 REQ-F001-028/028a; §9 REQ-F001-040 (OQ-7, RESOLVED) |
| Existing Evidence: vendored DS handoff bundle (`web/vendor/design-system/`) as the system to adopt | §3 Definitions; §5 REQ-F001-015/045; §6.6 REQ-F001-044 |
| Existing Evidence: current-state baseline (index.css, className count, shared components, dual-theme) | §4 REQ-F001-009..013 |
| Proposed Direction: adopt tokens verbatim + recreate components as React/TS; map onto five areas; replace ad-hoc CSS/className | §5 REQ-F001-014/015/016/045; §6.1 REQ-F001-017/018; §6.2 REQ-F001-019/020 |
| Proposed Direction: phased area-by-area migration — ruled acceptable (bounded by hard GTM gate) | §6.7 REQ-F001-028; §9 REQ-F001-041 (OQ-8, RESOLVED) |
| Proposed Direction: structure so future updates flow through (consume-don't-fork, diff-based re-sync) | §6.5 REQ-F001-025/026; §5 REQ-F001-015 |
| Adoption floor: adherence linter as a required CI gate (bounds the bridge layer) | §6.6 REQ-F001-044; §6.5 REQ-F001-026/046 |
| Design Considerations: systematization/migration — changes what screens are built from, not what they do | §1.2 REQ-F001-002; §6.3 REQ-F001-021/022 |
| Design Considerations: complexity dominated by breadth + component mapping onto existing patterns | §4 REQ-F001-010/012; §5 REQ-F001-016/045 |
| Design Considerations: dual-theme preservation, no behavioral regression | §6.3 REQ-F001-021/022; §6.4 REQ-F001-023/024 |
| Design Considerations: accessibility posture (WCAG) — ruled WCAG 2.1 AA target, non-gating | §7 REQ-F001-030; §9 REQ-F001-039 (OQ-6, RESOLVED) |
| Design Considerations: keep re-sync cheap (consume-don't-fork) as a design goal | §6.5 REQ-F001-025/026 |
| Out of Scope: no change to AnythingLLM app/native theme | §2 REQ-F001-004 |
| Out of Scope: no net-new features / operator behavior | §2 REQ-F001-005/008 |
| Out of Scope: no backend/BFF changes | §2 REQ-F001-006; §7 REQ-F001-029; §8 REQ-F001-032 |
| Out of Scope: no rebrand / no logo (DS ships none) | §2 REQ-F001-007 |
| Resolved (was Open Q) — system contents/coverage | §9 REQ-F001-036 (OQ-1, RESOLVED); §5 REQ-F001-016 |
| Resolved (was Open Q) — light+dark coverage | §9 REQ-F001-037 (OQ-2, RESOLVED); §6.4 REQ-F001-023 |
| Resolved (ruled) — re-sync cadence = on-demand | §9 REQ-F001-038 (OQ-3, RESOLVED) |
| Resolved (ruled) — exposure = internal-only | §9 REQ-F001-042 (OQ-4, RESOLVED) |
| Resolved (ruled) — operator-base size = small (<25) | §9 REQ-F001-043 (OQ-5, RESOLVED) |
| Resolved (ruled) — a11y = WCAG 2.1 AA target, non-gating | §9 REQ-F001-039 (OQ-6, RESOLVED) |
| Resolved (ruled) — GTM = hard compliance gate | §9 REQ-F001-040 (OQ-7, RESOLVED); §6.7 REQ-F001-028a |
| Resolved (ruled) — phased acceptable (bounded by GTM gate) | §9 REQ-F001-041 (OQ-8, RESOLVED) |

---

### Self-check note (per analyst workflow step 5)

The requirements most at risk of divergent implementation are the ones a "styling migration" tends
to leave vague: (1) **what "done" means** — pinned by the concrete migration surface in §4 (exact
file set, the 143-site / 22-file count, the three named components) PLUS the **adherence-linter
adoption floor** (REQ-F001-044): completeness is no longer bounded by a soft "auditable and small"
bridge, but by a mechanical CI gate that forbids raw hex/`px`/off-system fonts/off-contract props —
so the "re-host `index.css` as `bridge.css`" loophole now fails the lint (REQ-F001-026/027) and two
engineers cannot both claim compliance with wildly different residual CSS; (2) **"no regression"** —
pinned to the existing `web/` test suite and a per-screen (a)/(b)/(c) checklist (REQ-F001-021/022);
(3) **dual-theme** — now an established DS fact plus a defined three-path render/contrast harness
(REQ-F001-023); (4) **durable re-sync** — pinned to the known diff-based procedure and a structural
propagation test, with the vendored bundle kept immutable (REQ-F001-015/025); and (5) **the bridge
escape hatch** — closed to a single named candidate (the raw editor, REQ-F001-046) and bounded by the
linter. The facts about the DS that were previously unverified (contents/coverage, dual-theme, re-sync
mechanism) are now ESTABLISHED against the vendored bundle and cited; and the six items this spec
previously carried as open questions (re-sync **cadence**, accessibility standard, GTM hardness,
phasing, exposure path, operator-base size) are now **RESOLVED by the 2026-07-07 human rulings**
(§9). Every dependent requirement cites its ruling rather than a provisional assumption, so no
unratified decision is baked into a "compliant" implementation. The one ruling that changed a working
assumption — OQ-7, GTM is a **hard** gate (spec had assumed soft) — is reconciled with the phasing
ruling (OQ-8) in REQ-F001-028/028a: phased delivery stays permitted, but all five feature areas MUST
reach full compliance before the October 2026 GTM.
