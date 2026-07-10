# F-001: Adhere to a Design System — Specification

Status: Draft rev 6 — resolves the **two spec defects Phase 1 architecture surfaced** (RISK-1 and
RISK-2 in `docs/design/F-001/00-design.md`), both **ruled by the human on 2026-07-08** and recorded in
§9 as OQ-11 (RISK-1) and OQ-12 (RISK-2), each RESOLVED. Builds on rev 5, which folded in the human
rulings of **2026-07-08** on OQ-9 and OQ-10 (both ratified as the recommended defaults) and cleared the
two non-blocking findings of the rev-4 re-review `docs/spec-review-F001-rev4.md` (verdict ACCEPT; NEW-1,
NEW-2), preserving the full rev-3/rev-4/rev-5 lineage below. **§9 still carries zero open questions —
F-001 is fully ruled and implementation-ready.** For implementation and QA review.

**Revision history.**
- rev 3 → resolved the earlier spec-review `docs/spec-review-F001.md` (B1–B5, M1–M2, N1–N4), folded
  in the vendored DS ground truth at `web/vendor/design-system/`, and applied the six §9 human
  rulings of 2026-07-07 (OQ-3 on-demand re-sync; OQ-4 internal-only exposure; OQ-5 small operator
  base <25; OQ-6 WCAG 2.1 AA, non-gating; OQ-7 GTM is a **hard gate**; OQ-8 phasing acceptable).
- **rev 4 (this revision)** — resolves the rev-3 adversarial review. All rev-3 §9 rulings
  (OQ-3…OQ-8) are preserved verbatim and every rev-3 REQ id is retained (no renumbering). Changes:
  - **F-1** (blocking — the adopted oxlint config is JS/TS-only and cannot scan `.css`, so the
    CSS-completeness / anti-`bridge.css` guarantee in REQ-F001-026/027/018/044 was untestable):
    the adherence floor is now a **two-gate model** — the vendored oxlint config over JS/TS/JSX **plus
    a new CSS-aware gate (stylelint) over `web/src/**/*.css`** (new REQ-F001-047) mirroring the
    hex/`px`/font rules. REQ-F001-018/026/027/044 rewritten to rest the CSS guarantee on the gate that
    actually scans CSS. Surfaced as new §9 open question **OQ-9** (REQ-F001-050) with recommended
    default.
  - **F-2** (blocking — `--success*`/`--danger*` custom properties used by `index.css` have no DS
    equivalent, so "adopt verbatim / same names / all color resolves through DS tokens" was
    unsatisfiable): a concrete **orphaned-token → DS-token mapping** is specified (new REQ-F001-048),
    REQ-F001-017's language is corrected to be true only for the `--theme-*` family, REQ-F001-020
    (DangerConfirm/ErrorBanner) cites the mapping, and REQ-F001-023's unresolved-var harness is
    extended to cover the mapped tokens. Surfaced as new §9 open question **OQ-10** (REQ-F001-051)
    with recommended default.
  - **F-3** (major — `tokens/fonts.css` `@font-face` uses a relative `url("../assets/fonts/…")` that
    breaks on byte-for-byte copy): REQ-F001-017 now carves the `@font-face` `src` `url()` out of
    "verbatim" and requires the `.ttf` asset be co-vendored so the relative path resolves.
  - **F-4** (major — all vendored oxlint rules are severity `warn`, so oxlint exits 0 and "fails the
    gate" was false): REQ-F001-044 now mandates a **`--deny-warnings` run mode** (warnings become
    failures) without hand-editing the vendored config.
  - **F-5** (major — the vendored `no-restricted-imports` patterns key to the bundle's JS layout, not
    the recreated `web/src/design-system/` TS barrel): REQ-F001-044(v) now specifies the
    import-pattern/barrel remapping for the recreated layout.
  - **N-1** — "small bridge layer" wording reconciled against the no-size-budget rule (REQ-F001-026/027).
  - **N-2** — pre-migration baseline (a11y/contrast snapshot + gzipped bundle size) must be captured
    as an artifact **before** migration begins (new REQ-F001-049, referenced by REQ-F001-030/033).
- **rev 5 (this revision)** — resolves the rev-4 re-review (`docs/spec-review-F001-rev4.md`, verdict
  **ACCEPT**) and applies the **2026-07-08 human rulings** on the two open questions rev 4 surfaced.
  All rev-3/rev-4 §9 rulings (OQ-3…OQ-8) and every REQ id are preserved (no renumbering). Changes:
  - **OQ-9 → RESOLVED (ruling: stylelint CSS gate).** The REQ-F001-047 stylelint gate over
    `web/src/**/*.css` is ratified. Folds in re-review finding **NEW-1**: REQ-F001-047's token-CSS
    exemption is corrected from "exactly one file scope" to a **path/file-glob scope naming all FOUR
    adopted DS token files** (`colors.css`, `spacing.css`, `typography.css`, `fonts.css` — since
    REQ-F001-017 adopts four files verbatim), and is explicitly **path-scoped, NOT content-scoped**
    (a `--*`-declaration-type exemption is forbidden because it would reopen a custom-property
    laundering path in any file). §9 REQ-F001-050 flipped OPEN → RESOLVED.
  - **OQ-10 → RESOLVED (ruling: badge-token mapping as tabled).** The REQ-F001-048 mapping table is
    ratified as-is (`--success`→`--theme-badge-success-text`, `--success-bg`→`--theme-badge-success-bg`,
    `--danger`→`--theme-badge-danger-text`, `--danger-bg`→`--theme-badge-danger-bg`, `--danger-strong`
    removed as dead / `--alm-error` fallback), retaining the disclosed danger-foreground color-shift
    note. §9 REQ-F001-051 flipped OPEN → RESOLVED.
  - **NEW-2** (stale cross-ref) — REQ-F001-014/016/019 updated to cite **both** gates
    ("REQ-F001-044 and REQ-F001-047") so their completeness/coverage tests include CSS, matching the
    §3 two-gate model.
- **rev 6 (this revision)** — resolves the **two spec defects Phase 1 architecture surfaced and the
  human ruled on 2026-07-08** (`docs/design/F-001/00-design.md` RISK-1, RISK-2), both verified against
  disk. All rev-3/rev-4/rev-5 §9 rulings (OQ-1…OQ-10) and every prior REQ id are preserved verbatim (no
  renumbering); new REQ ids are appended. Changes:
  - **RISK-1 → RESOLVED (ruling OQ-11, 2026-07-08: bridge `@media` block).** The vendored DS
    `tokens/colors.css` ships `:root` (dark) + `[data-theme="light"]` but **no
    `@media (prefers-color-scheme: light)` block**, whereas the app today auto-selects light from the OS
    via that media query (`web/src/index.css` lines 79–107) and has no runtime theme setter / switcher
    (REQ-F001-013/024). Byte-for-byte verbatim adoption (REQ-F001-017) would drop OS auto-detection →
    OS-light users render dark → regresses REQ-F001-013/023/024. **Resolution:** keep `colors.css`
    verbatim and add a documented **bridge-layer `@media (prefers-color-scheme: light)` block** (new
    **REQ-F001-052**, carve-out C, analogous to the carve-out A font-URL handling) that re-points the
    `--theme-*` custom properties to the SAME light values the DS defines under `[data-theme="light"]`.
    REQ-F001-023's harness is extended to assert every `--theme-*` also resolves under the
    `prefers-color-scheme: light` media path; REQ-F001-017 notes the OS-light fallback is provided by
    the bridge block (not by editing the verbatim file); REQ-F001-026/047 mark the block as **expected
    bridge content, not ad-hoc drift**.
  - **RISK-2 → RESOLVED (ruling OQ-12, 2026-07-08: map to DS tokens — same class as F-2).** Beyond the
    `--success*`/`--danger*` family (REQ-F001-048), **seven more custom properties** consumed/defined by
    `web/src/index.css` are undefined in the DS token files, so verbatim adoption leaves them undefined:
    `--theme-home-bg-card`, `--theme-button-text`, `--theme-button-code-hover-text`,
    `--theme-button-disable-hover-text`, `--theme-button-disable-hover-bg`,
    `--theme-button-delete-hover-text`, `--theme-button-delete-hover-bg`. **Resolution:** new
    **REQ-F001-053** extends the orphaned-token mapping to all seven, each onto its nearest existing DS
    token, and states the mapping table (REQ-F001-048 + REQ-F001-053 together) is **exhaustive as of the
    rev-6 `var()` audit**, citing the reproducible audit method.
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
on rather than a provisional assumption. The rev-4 review surfaced **two new correctness-bearing
decisions** — how to gate CSS adherence (OQ-9) and how each orphaned `--success*`/`--danger*` custom
property maps onto a DS token (OQ-10) — each of which this spec resolved with an explicit **recommended
default** in §9 rather than silently baking it in as fact. Both were **ratified by human ruling on
2026-07-08** (OQ-9 = the stylelint CSS gate; OQ-10 = the badge-token mapping table), and the dependent
requirements now cite those rulings. **Phase 1 architecture then surfaced two further
correctness-bearing decisions** — how to preserve OS-driven light-theme selection under verbatim token
adoption (OQ-11 / RISK-1) and how to map the **seven additional** non-DS custom properties beyond the
`--success*`/`--danger*` family (OQ-12 / RISK-2, the same defect class as F-2) — each **ratified by
human ruling on 2026-07-08** (OQ-11 = the bridge `@media (prefers-color-scheme: light)` block,
REQ-F001-052; OQ-12 = the seven-token nearest-DS mapping, REQ-F001-053), with the dependent
requirements citing those rulings. **No open question remains.**

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
- **Adherence gates (the two-gate adoption floor)** — F-001's mechanical adoption floor is enforced
  by **two** complementary linters, because no single adopted tool scans both source languages:
  - **(1) the JS/TS adherence linter** — the shipped oxlint config
    `web/vendor/design-system/project/_adherence.oxlintrc.json`, adopted by F-001 as a REQUIRED CI
    gate over `web/src/**/*.{ts,tsx,js,jsx}` (REQ-F001-044). oxlint parses **JS/TS/JSX/TSX only**; it
    does **not** parse `.css` files. Its AST rules forbid raw hex colors, raw `px` values,
    non-`Plus Jakarta Sans` fonts **in JS/TS source** (e.g. inline `style={{…}}` objects), off-contract
    DS component props/variants, and imports of DS component internals.
  - **(2) the CSS-aware adherence gate** — a stylelint gate over `web/src/**/*.css` (REQ-F001-047,
    ruled OQ-9) that mirrors rules (i)–(iii) — no raw hex, no raw `px`, `Plus Jakarta Sans`-only — for
    CSS, which oxlint cannot see. It exempts, **by path/file glob (not by content)**, exactly the four
    adopted DS token files (`colors.css`, `spacing.css`, `typography.css`, `fonts.css`) — plus, from rev
    6, the one bridge light-source token file that backs the `prefers-color-scheme` block (REQ-F001-052)
    — where raw color/length values legitimately live as token definitions; a
    content/`--*`-declaration-scoped exemption is forbidden (it would reopen a custom-property
    laundering path — REQ-F001-047).
  Together they pin the adoption floor testably across both JS/TS and CSS (REQ-F001-044/047). Where
  this spec previously said "the adherence linter," read "the adherence gates" (both), and where a
  clause is specifically about CSS residue, read the CSS-aware gate (REQ-F001-047).
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
- **Bridge entry** — an explicitly isolated, documented local adaptation that remains **after**
  the adherence gates pass (REQ-F001-044 and REQ-F001-047): i.e. a gap the DS genuinely does not cover
  (the raw/code-editor surface is the one named candidate, REQ-F001-046). It is kept in one identifiable
  bridge layer so gaps are auditable and a re-sync cannot silently overwrite them (§6.5,
  REQ-F001-026). The **adherence gates** (both — REQ-F001-044 JS/TS and REQ-F001-047 CSS) — not a
  size budget — are what bound this layer; any residual `.css` in the bridge layer is scanned by the
  CSS-aware gate and so cannot legally re-host raw hex/`px` rules.
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
  (REQ-F001-026), and **both adherence gates (REQ-F001-044 over JS/TS and REQ-F001-047 over `.css`)**
  pass.
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
  (REQ-F001-046); **both adherence gates (REQ-F001-044 and REQ-F001-047)** pass over the migrated
  scope.

---

## §6 Functional Requirements

### §6.1 Token migration

- REQ-F001-017 — **Adopt the DS token CSS as the console's token layer (verbatim, with two named,
  bounded carve-outs).** The DS token CSS
  (`web/vendor/design-system/project/tokens/{fonts,colors,typography,spacing}.css`) is adopted into
  `web/src/` as the console's token layer, replacing the ad-hoc token block currently hand-authored in
  `web/src/index.css` (REQ-F001-009). Adoption is **byte-for-byte verbatim** EXCEPT for exactly two
  explicitly-named, bounded deviations, and no others:
  - **(carve-out A — the font asset URL, resolves F-3)** `tokens/fonts.css` line 6 is
    `src: url("../assets/fonts/PlusJakartaSans.ttf") format("truetype")`, a path relative to the
    bundle's `tokens/` directory (the asset exists at
    `web/vendor/design-system/project/assets/fonts/PlusJakartaSans.ttf`). On adoption, the
    `PlusJakartaSans.ttf` asset MUST be co-vendored into `web/src/` at the location that makes this
    relative `url()` resolve from the adopted `fonts.css` (the **recommended default**: place the
    `.ttf` so the same `../assets/fonts/PlusJakartaSans.ttf` string still resolves, keeping the CSS
    unchanged). If the console's asset/build layout cannot honor that relative path, the SINGLE
    permitted CSS edit is adjusting that one `url()` string to the correct adopted asset path; no other
    byte of the token CSS may change. *Test:* the adopted `fonts.css` differs from the vendored
    reference in at most the one `@font-face src url()` string, the `Plus Jakarta Sans` face loads at
    runtime (no missing-font fallback), and no other token file differs from the reference.
  - **(carve-out B — the orphaned `--success*`/`--danger*` family, resolves F-2)** The ad-hoc block
    being replaced defines and uses `--success`, `--success-bg`, `--danger`, `--danger-bg`, and
    `--danger-strong` (`web/src/index.css` lines 31–35 / 70–74 / 100–104, consumed at lines 334, 341–343,
    351, 376–377, 424–425, 429, 596). The DS token CSS defines **no** `--success*`/`--danger*` family
    (it ships `--alm-*` and `--theme-badge-*`), so these five custom properties have no verbatim DS
    equivalent. They are therefore NOT adopted as-is: every consuming reference is re-pointed to the
    mapped DS token per **REQ-F001-048**, and no `--success*`/`--danger*` custom property survives the
    migration. The DS token CSS itself is still adopted verbatim (this carve-out lives at the *consuming*
    call sites, not in the token file).

  For the **`--theme-*` family only**, the DS tokens reuse the **same names the console already uses**,
  so those screens keep referencing the same custom-property names and only the definition source
  changes; the "same names / verbatim" claim is asserted for `--theme-*` and is explicitly NOT claimed
  for `--success*`/`--danger*` (see carve-out B / REQ-F001-048), and is asserted **only for the subset
  of `--theme-*` the DS actually ships** — the seven non-DS `--theme-*` custom properties are handled by
  **REQ-F001-053** (RISK-2), not adopted verbatim. **OS-driven light-theme selection is preserved outside
  the verbatim files:** the vendored `colors.css` defines light only under `[data-theme="light"]` and
  ships **no** `@media (prefers-color-scheme: light)` block, but the console MUST keep auto-selecting
  light from the OS (REQ-F001-013/023/024). This is provided by the bridge-layer `@media` block of
  **REQ-F001-052** (carve-out C) — a separate bridge file, **not** an edit to the verbatim token file —
  so the "byte-for-byte verbatim save carve-outs A/B" guarantee for the token files themselves is
  unaffected. *Test:* after migration the console's
  token definitions are the adopted DS token CSS (matching the vendored reference save for carve-out A);
  no `--theme-*`, `--success*`, or `--danger*` block remains hand-authored in the old `index.css`;
  every `--theme-*` reference resolves through the adopted DS tokens; and a static scan finds **zero**
  surviving `var(--success…)` / `var(--danger…)` references (all re-pointed per REQ-F001-048).
- REQ-F001-018 — **No hardcoded off-system values (gate-enforced, in BOTH source languages).**
  Migrated `web/src/` code MUST NOT contain raw color/spacing/type literals that bypass the token layer
  (e.g. inline `#0e0f0f`, ad-hoc `12px` spacings, a non-`Plus Jakarta Sans` font-family), **whether the
  literal lives in JS/TS/JSX or in `.css`**. This is enforced mechanically by the **two adherence
  gates**: raw hex/`px`/off-system-font literals **in JS/TS/JSX** are flagged by the oxlint gate
  (REQ-F001-044); the same literals **in `.css`** are flagged by the CSS-aware gate (REQ-F001-047),
  which oxlint cannot see. The only place raw color/length values legitimately appear is the path-exempt
  token-definition files — the four adopted DS token files (`colors.css`, `spacing.css`,
  `typography.css`, `fonts.css`) plus, from rev 6, the one bridge light-source token file backing the
  `prefers-color-scheme` block (REQ-F001-052) — which the CSS gate exempts **by path** (REQ-F001-047).
  *Test:* both adherence gates (REQ-F001-044 over JS/TS, REQ-F001-047 over `.css`) report zero violations
  over `web/src/`; outside the path-exempt token files, every color/spacing/type value resolves to a DS
  token via `var()`.
- REQ-F001-048 — **Orphaned `--success*`/`--danger*` custom properties map onto named DS tokens
  (RESOLVED — ruling OQ-10, 2026-07-08; correctness-bearing).** Because the DS ships no
  `--success*`/`--danger*` family (F-2), each of the five orphaned custom properties is migrated to a
  named DS token, applied by re-pointing every consuming reference (§6.1 REQ-F001-017 carve-out B); the
  `--success*`/`--danger*` names are then retired. The **ratified mapping** (ruling OQ-10, each chosen
  as the nearest semantic and visual DS equivalent in BOTH themes) is:

  | Orphaned property (current dark / light) | Role in `index.css` | → DS token (dark / light) |
  |---|---|---|
  | `--success` (`#22c55e` / `#039855`) | success foreground/icon (lines 351, 596) | `--theme-badge-success-text` (`#4ade80` / `#047857`) |
  | `--success-bg` (`rgba(34,197,94,.12)` / `rgba(3,152,85,.1)`) | success panel/badge fill (line 376) | `--theme-badge-success-bg` (`rgba(22,163,74,.2)` / `rgba(5,150,105,.12)`) |
  | `--danger` (`#f97066` / `#b42318`) | danger foreground + border (lines 334, 342–343, 424–425) | `--theme-badge-danger-text` (`#f87171` / `#b91c1c`) |
  | `--danger-bg` (`rgba(249,112,102,.12)` / `rgba(180,35,24,.08)`) | danger panel fill (lines 341, 429) | `--theme-badge-danger-bg` (`rgba(220,38,38,.2)` / `rgba(220,38,38,.12)`) |
  | `--danger-strong` (`#dc2626` / `#b42318`) | **defined but unused** (no `var(--danger-strong)` in `index.css`) | removed as dead (REQ-F001-009); if a use is discovered, map to `--alm-error` (`#b42318`) |

  This mapping is **correctness-bearing** (it changes exact status colors — notably `--danger` moves
  from its ad-hoc foreground/border value to the `--theme-badge-danger-text` tone) and was **ratified by
  human ruling on 2026-07-08** (§9 REQ-F001-051, OQ-10); the disclosed danger-foreground color shift is
  accepted. *Test:* after migration, no `--success*`/`--danger*`
  custom property is defined or referenced anywhere in `web/src/`; each former consuming rule now
  references the mapped DS token above (or, for `--danger-strong`, is removed / re-pointed to
  `--alm-error`); the danger/success surfaces render a defined, legible color in both themes
  (REQ-F001-023).
- REQ-F001-053 — **Seven additional non-DS `--theme-*` custom properties map onto named DS tokens
  (RESOLVED — ruling OQ-12, 2026-07-08; correctness-bearing; RISK-2, same defect class as F-2).** Beyond
  the `--success*`/`--danger*` family (REQ-F001-048), the ad-hoc block being replaced defines **seven
  `--theme-*` custom properties the DS token CSS does NOT define** (`web/src/index.css` lines 23–29 dark /
  62–68 light). Because the DS `colors.css` is adopted verbatim, these definitions vanish on adoption,
  so any surviving reference would be undefined and would fail the REQ-F001-023 harness. They are
  therefore migrated exactly as the REQ-F001-048 family is: every consuming reference is re-pointed to
  the mapped DS token and the orphaned name is retired. The **ratified mapping** (ruling OQ-12; each
  chosen as the nearest semantic + visual DS equivalent in BOTH themes, every target token verified to
  exist on disk in `web/vendor/design-system/project/tokens/colors.css`) is:

  | Orphaned `--theme-*` property (dark / light) | Role in `index.css` | Consumed via `var()`? | → DS token (dark / light) |
  |---|---|---|---|
  | `--theme-home-bg-card` (`#1a1b1b` / `#edf2fa`) | raised card/panel fill (`.create-workspace`, `.workspace-settings`, section cards, `.provider-group-header`; lines 523, 562, 654) | **yes** (3 sites) | `--theme-bg-secondary` (`#1b1b1e` / `#ffffff`) — the DS "raised panel" surface token |
  | `--theme-button-disable-hover-text` (`#fec84b` / `#854708`) | caution/warn foreground (`.warning`, `.verify-pending`; lines 355, 601) | **yes** (2 sites) | `--theme-badge-warn-text` (`#facc15` / `#a16207`) — the DS warn foreground |
  | `--theme-button-text` (`#a8a9ab` / `#6f6f71`) | muted button label text | no (defined, unused) | `--theme-text-secondary` (`rgba(255,255,255,.6)` / `#7a7d7e`) — the DS muted-text token |
  | `--theme-button-code-hover-text` (`#7cd4fd` / `#0ba5ec`) | cyan code-button hover accent | no (defined, unused) | `--theme-button-cta` (`#7cd4fd` / `#7cd4fd`) — the DS CTA cyan accent |
  | `--theme-button-disable-hover-bg` (`#3a3128` / `#fef7e6`) | warn panel fill (disable-hover) | no (defined, unused) | `--theme-badge-warn-bg` (`rgba(202,138,4,.2)` / `rgba(202,138,4,.12)`) — the DS warn fill |
  | `--theme-button-delete-hover-text` (`#f97066` / `#b42318`) | danger delete-hover foreground | no (defined, unused) | `--theme-badge-danger-text` (`#f87171` / `#b91c1c`) — the DS danger foreground |
  | `--theme-button-delete-hover-bg` (`#37282b` / `#fee4e2`) | danger delete-hover fill | no (defined, unused) | `--theme-badge-danger-bg` (`rgba(220,38,38,.2)` / `rgba(220,38,38,.12)`) — the DS danger fill |

  Of the seven, **exactly two are actually consumed** (`--theme-home-bg-card`, 3 sites; and
  `--theme-button-disable-hover-text`, 2 sites) and MUST be re-pointed to the mapped token; the other
  five are **defined-but-unused (dead)** — analogous to `--danger-strong` (REQ-F001-048) — and are
  removed as dead (REQ-F001-009), with the tabled mapping the ratified recommended default should any
  use surface. This mapping is **correctness-bearing** and was **ratified by human ruling on 2026-07-08**
  (§9 REQ-F001-055, OQ-12); the disclosed shifts are accepted: `--theme-home-bg-card`'s light card fill
  moves `#edf2fa` → `#ffffff` (a raised white card on the `#f9fbfd` container) and its dark fill
  `#1a1b1b` → `#1b1b1e` (near-identical); the caution text moves to the DS warn tone.
  **Exhaustiveness (critical).** The union of REQ-F001-048 (five `--success*`/`--danger*`) and this
  REQ-F001-053 (seven `--theme-*`) is the **complete** set of custom properties consumed anywhere under
  `web/src/**` that are undefined after verbatim adoption of the four DS token files — i.e. this mapping
  is **exhaustive as of the rev-6 audit (2026-07-08)**; no third orphan class exists. *Reproducible
  audit method:* enumerate every consumed property with `rg -oN 'var\(--[A-Za-z0-9-]+' web/src`
  (result: all `var()` usage lives in `web/src/index.css`; **zero** in `.ts/.tsx`), take the unique set,
  and subtract the union of custom properties **defined** by the four adopted DS token files
  (`colors.css`, `spacing.css`, `typography.css`, `fonts.css` — e.g.
  `rg -oN '^\s*--[A-Za-z0-9-]+\s*:' web/vendor/design-system/project/tokens/*.css`); the remainder is
  exactly the twelve properties tabled in REQ-F001-048 + REQ-F001-053 and nothing else. *Test:* after
  migration, none of the seven `--theme-*` orphan properties is defined or referenced anywhere in
  `web/src/`; each of the two consumed properties' former rules now references the mapped DS token above;
  the affected card/warn/danger surfaces render a defined, legible color in both themes (REQ-F001-023);
  and a re-run of the audit method finds **zero** consumed-but-undefined custom properties (no third
  orphan).

### §6.2 Component migration

- REQ-F001-019 — **Migrate the five feature areas + shell + auth onto governing components.** Each
  migration site (REQ-F001-010) across the five feature areas (REQ-F001-012), the App shell, and the
  auth screens is re-expressed using a recreated DS component (REQ-F001-045) or a DS-token-based
  composition, replacing the corresponding one-off `className`. *Test:* per **REQ-F001-010's**
  `className` inventory, every `className` site resolves to a DS component/token usage or the single
  documented raw-editor bridge (REQ-F001-046); **both adherence gates (REQ-F001-044 over JS/TS and
  REQ-F001-047 over `.css`)** pass and the count of unaccounted-for ad-hoc classes is zero.
- REQ-F001-020 — **Migrate the three shared components, preserving contract.** `DangerConfirm`,
  `ErrorBanner`, and `SetNotSetBadge` (REQ-F001-011) are re-implemented on the recreated DS
  primitives (REQ-F001-045) with their public props/contract and behavior UNCHANGED. In particular:
  `DangerConfirm`
  keeps typed-token and acknowledge-toggle arming and the parent §8 semantics (parent
  REQ-078c/080/081); `ErrorBanner` keeps `role="alert"` and verbatim message rendering (parent
  REQ-097a); `SetNotSetBadge` keeps set/not-set semantics and never reveals a secret (parent
  REQ-060). Because `DangerConfirm` and `ErrorBanner` are the specific surfaces that consume the
  orphaned `--danger*`/`--success*` custom properties today, their migration MUST re-point those
  references to the mapped DS tokens per **REQ-F001-048** (no `var(--danger)`/`var(--success)` may
  survive in either component). *Test:* the existing component tests
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
  `prefers-color-scheme: light` with no `data-theme` set. In every path, the harness asserts that
  **every custom property the migrated screens reference resolves to a defined value** — this covers
  (a) each `--theme-*` property; (b) each DS token the former `--success*`/`--danger*` references were
  re-pointed to per **REQ-F001-048** (`--theme-badge-success-text/-bg`, `--theme-badge-danger-text/-bg`,
  and `--alm-error` if used); and (c) each DS token the seven orphaned non-DS `--theme-*` properties
  were re-pointed to per **REQ-F001-053** (`--theme-bg-secondary`, `--theme-badge-warn-text/-bg`,
  `--theme-text-secondary`, `--theme-button-cta`, `--theme-badge-danger-text/-bg`) — with **no
  unresolved/empty custom property; no surviving `var(--success…)`/`var(--danger…)` reference; and no
  surviving reference to any of the seven RISK-2 orphan `--theme-*` names** (each of which, being
  undefined after verbatim adoption, would resolve to nothing and render broken card/warn/danger
  colors), and no black-on-black; text/background pairs meet the REQ-F001-030 contrast floor
  (AA-or-no-regression). **Path (iii) explicitly exercises the REQ-F001-052 bridge block:** under
  simulated `prefers-color-scheme: light` with no `data-theme` set, the harness MUST confirm that
  **every `--theme-*` the migrated screens reference resolves to the DS light value** (not the dark
  default) — i.e. the bridge `@media (prefers-color-scheme: light)` block re-points the `--theme-*`
  family for the OS-light path, matching what `[data-theme='light']` (path (ii)) yields. A screen that
  renders dark under path (iii) is a REQ-F001-013/052 regression.
- REQ-F001-024 — **Theme mechanism unchanged.** F-001 MUST NOT introduce an in-app theme switcher,
  change the default theme, or change how the theme is selected, unless such a change is explicitly
  ruled in (none is assumed). *Test:* no new runtime `data-theme` setter or theme-toggle control is
  added by the migration; dark remains the default.
- REQ-F001-052 — **Bridge-layer `@media (prefers-color-scheme: light)` block preserves OS-driven
  light-theme selection (carve-out C; RESOLVED — ruling OQ-11, 2026-07-08; RISK-1; correctness-bearing).**
  The console today auto-selects the light theme from the OS for users who have set no `data-theme`
  attribute, via a `@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) { … } }` block
  (`web/src/index.css` lines 79–107), and it has **no runtime theme setter and no switcher**
  (REQ-F001-013/024). The vendored DS `tokens/colors.css` defines light **only** under
  `[data-theme="light"]` and ships **no** `prefers-color-scheme` block, so byte-for-byte verbatim
  adoption (REQ-F001-017) would drop OS auto-detection and render **dark for every OS-light user with no
  `data-theme`** — a regression of REQ-F001-013/023/024. **Resolution (ruling OQ-11):** keep the adopted
  token files byte-for-byte verbatim (REQ-F001-017), and add a **documented bridge-layer
  `@media (prefers-color-scheme: light)` block** — a **carve-out C addition** analogous to the
  carve-out A font-URL handling — that lives in the **bridge/app CSS layer, NOT edited into the verbatim
  token file**, scoped to `:root:not([data-theme='dark'])` (mirroring today's selector) and re-pointing
  **every `--theme-*` custom property the migrated screens consume to the SAME light value the DS defines
  under its `[data-theme="light"]` scope**, so an OS-light user with no `data-theme` renders the light
  theme identically to path (ii) of the REQ-F001-023 harness.
  **Gate compatibility (REQ-F001-047, gate-clean, no laundering).** The bridge `@media` block is within
  the CSS-aware gate's normal scope (it is not one of the path-exempt token files) and MUST pass it:
  it therefore contains **only `var()` re-points and NO raw hex/`px`** — each `--theme-*` is set to
  `var(--<ds-light-source-token>)`. The raw DS light values it references are **not** restated in the
  bridge block; they live only in path-exempt token-definition CSS. Because the DS does not expose its
  pale light palette (`#ffffff`, `#edf2fa`, `#f9fbfd`, `#7a7d7e`, `#d3d4d4`, …) as separately-named
  reusable tokens, the recommended default is a single co-located **light-source token file** in the
  adopted token layer (holding those raw light values as named `--theme-light-*` tokens) added to
  REQ-F001-047's **path-scoped** exemption list as a **fifth explicitly-named file** — keeping the
  exemption path-scoped, never content-scoped (no `:root{--x:#fff}` laundering path is reopened), exactly
  the discipline REQ-F001-047 already applies to the four DS token files. This is **expected bridge
  content, not ad-hoc drift** (REQ-F001-026/047). No byte of the verbatim DS token files changes.
  (Re-sync note, REQ-F001-025: the light-source token file duplicates the DS light values, so a re-sync
  that changes a DS light value must re-apply the same delta to it; this coupling is documented in the
  bridge README.) *Test:* (a) the adopted DS token files remain byte-for-byte verbatim (save carve-outs
  A/B); (b) under simulated `prefers-color-scheme: light` with no `data-theme` set, every `--theme-*` the
  migrated screens reference resolves to the DS light value (REQ-F001-023 harness path (iii)), i.e. the
  console renders light, not dark; (c) under an explicit `[data-theme='dark']` the block does **not**
  apply (dark wins) and dark remains the default when neither the attribute nor OS-light is present; (d)
  the bridge `@media` block passes the stylelint gate (REQ-F001-047) — it contains no raw hex/`px`, and
  the CSS-gate exemption remains path-scoped, naming the four DS token files plus the one bridge
  light-source token file and nothing else.

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
- REQ-F001-026 — **Bridge layer isolates and audits residual gaps (bounded by the adherence gates).**
  A **bridge entry** is a local adaptation that remains only where the DS genuinely does not cover a
  pattern (REQ-F001-016) — NOT a general escape hatch. All bridge entries live in a SINGLE, explicitly
  isolated, documented bridge layer under `web/src/`, separate from the adopted DS tokens/components
  and from ordinary screen code. The bound on this layer is **not a size budget but the two adherence
  gates (REQ-F001-044 over JS/TS and REQ-F001-047 over `.css`)**: together they forbid raw hex, raw
  `px`, and off-system fonts **in both source languages**, plus off-contract DS props in JS/TS, so a
  bridge entry cannot legally reproduce a full pre-migration ad-hoc ruleset — every hex/`px` literal in
  such a ruleset would trip a rule regardless of whether the ruleset is written as inline JS/TS styles
  (caught by REQ-F001-044) or as CSS (caught by REQ-F001-047). In particular the "move all 723 lines of
  `index.css` into a `web/src/bridge.css`" loophole **fails the CSS-aware gate** (REQ-F001-047 — that
  file is dense with hex and `px` literals and is NOT the exempt token-definition CSS), which is what
  makes migration completeness testable in CSS. Concretely, the DS gaps anticipated are exactly two,
  both pre-authorized and documented in the bridge layer: (1) the raw/code-editor surface
  (REQ-F001-046), and (2) the **`@media (prefers-color-scheme: light)` block** that restores OS-driven
  light-theme selection dropped by verbatim token adoption (REQ-F001-052, carve-out C). Both are
  **expected bridge content, not ad-hoc drift**, and both pass the adherence gates (the raw editor uses
  DS `Textarea`/tokens; the `@media` block uses only `var()` re-points, no raw hex — REQ-F001-052). The
  bridge layer is expected to be **modest** as a
  *consequence* of the gates (few legitimate gaps survive them), but note that "modest/small" is a
  descriptive expectation, **not** an enforced budget — the gates, not any line count, are the bound
  (N-1). *Test:* all bridge entries are locatable in one identifiable bridge layer, each with a
  recorded reason; **both** adherence gates (REQ-F001-044 and REQ-F001-047) pass over the whole of
  `web/src/` including the bridge layer; no bridge entry — in JS/TS or `.css` — reproduces a
  pre-migration ad-hoc ruleset.
- REQ-F001-046 — **The raw/code-editor surface is the one named legitimate bridge candidate.** The DS
  ships no dedicated raw/code-editor component; the console's raw env editor
  (`web/src/features/raweditor/`) is the single pattern for which a bridge entry is expected, built by
  composing the DS `Textarea` (its closest primitive) plus DS tokens, and documented as such in the
  bridge layer. Any bridge entry OTHER than the raw editor must be explicitly justified against a
  named, demonstrable DS coverage gap. *Test:* the migration record lists the raw editor as the
  expected bridge; if any additional bridge entry exists, it names the specific DS component/token it
  could not use and why; the raw-editor bridge itself still passes **both** adherence gates
  (REQ-F001-044 over its JS/TS and REQ-F001-047 over any of its `.css`) — it uses DS tokens/`Textarea`,
  not raw literals.

### §6.6 Migration completeness (the adherence-linter adoption floor)

- REQ-F001-044 — **The JS/TS adherence linter is a REQUIRED CI gate over `web/src/**/*.{ts,tsx,js,jsx}`
  (the JS/TS half of the adoption floor).** F-001 adopts the shipped adherence config
  `web/vendor/design-system/project/_adherence.oxlintrc.json` as a **required CI gate** run over the
  JS/TS/JSX sources under `web/src/`. oxlint parses **JS/TS/JSX/TSX only and does not scan `.css`
  files** — CSS residue is covered by the companion CSS-aware gate (REQ-F001-047), not by this one; do
  not rely on this gate to bound CSS. It enforces, mechanically, over JS/TS: (i) **no raw hex colors**
  in JS/TS literals — every color must be a DS token via `var()`; (ii) **no raw `px` values** in JS/TS
  literals; (iii) **font-family must be `Plus Jakarta Sans`** in JS/TS literals; (iv) **DS component
  props/variants restricted to the declared sets** (e.g. `Button.variant ∈ {cta,solid,ghost,danger,
  login}`, `Badge.tone ∈ {info,success,warn,danger,neutral}`, `Toggle.size ∈ {sm,md,lg}`, etc.); and
  (v) **no importing DS component internals** (screens import from the DS barrel, not deep component
  paths).
  Two run-mode facts are load-bearing and MUST be honored when this config is adopted as a gate:
  - **(F-4 — severity/exit mode)** Every rule in the vendored config is severity `"warn"`, and oxlint
    **exits 0 on warnings**, so run as-is the gate would pass even with violations. The gate MUST
    therefore be run in a **`--deny-warnings` mode** (warnings are treated as failures / non-zero exit).
    The **recommended default** is to invoke oxlint with `--deny-warnings` against the adopted config,
    which requires **no hand-edit of the vendored file** (preserving consume-don't-fork, REQ-F001-015);
    equivalently the *adopted* (non-vendored) config copy may set the severities to `"error"`. Either
    way the requirement is: a single lint violation yields a non-zero CI exit.
  - **(F-5 — import-pattern remapping for the recreated layout)** The vendored `no-restricted-imports`
    patterns key to the bundle's JS layout (`components/data-display/**`, `components/forms/**`,
    `components/navigation/**`, `components/overlays/**`, `ui_kits/admin-console/**`) and exempt the
    barrel `**/index.js`. The recreated DS lives under `web/src/design-system/` as `.tsx` with a **TS
    barrel** (`web/src/design-system/index.ts` or `index.tsx`, REQ-F001-045). The adopted rule MUST be
    remapped to the recreated layout: forbid deep imports into the recreated internals
    (`web/src/design-system/components/**`, or wherever internals are placed) while exempting the TS
    barrel (`web/src/design-system/index.ts`/`index.tsx`), so that "screens import from the DS barrel,
    not internals" actually fires. *(This is the one adopted rule whose *patterns* must be adjusted for
    the target layout; the hex/`px`/font/prop rules are layout-independent and adopted unchanged.)*
  This gate, together with REQ-F001-047, is what makes "migration complete / no ad-hoc styling"
  testable without a size cap. *Test:* the oxlint gate runs in CI against `web/src/**/*.{ts,tsx,js,jsx}`
  in `--deny-warnings` mode (or with error-severity) and reports **zero violations with a non-zero exit
  on any violation**; a deliberately-introduced raw hex, raw `px`, off-system font, off-contract DS
  prop **in JS/TS**, or a deep import of a recreated DS internal each **fails the gate** (non-zero exit).
- REQ-F001-047 — **A CSS-aware adherence gate (stylelint) is a REQUIRED CI gate over
  `web/src/**/*.css` (the CSS half of the adoption floor; resolves F-1; RESOLVED — ruling OQ-9,
  2026-07-08).** Because the oxlint config (REQ-F001-044) cannot parse `.css`, F-001 adds a
  **stylelint gate** (ruled OQ-9, §9 REQ-F001-050) run over `web/src/**/*.css` that mirrors, for CSS,
  the token-adherence rules oxlint applies to JS/TS: (i) **no raw hex colors** in CSS property values —
  colors must be a DS token via `var()`; (ii) **no raw `px` values** in CSS property values — lengths
  must be a DS spacing token via `var()`; (iii) **font-family declarations must resolve to
  `Plus Jakarta Sans`** (i.e. the DS `--font-sans`/`--font-mono` tokens or the adopted `@font-face`
  family). **Exemption — path-scoped, NOT content-scoped (resolves NEW-1).** The gate exempts exactly
  the **four adopted DS token-definition files** that REQ-F001-017 adopts verbatim —
  `colors.css`, `spacing.css`, `typography.css`, and `fonts.css` (as adopted under `web/src/`) — by a
  **file/path glob naming those files** (e.g. a stylelint `ignoreFiles`/`overrides` entry scoped to the
  adopted token-CSS directory), because those files are entirely legitimate raw-value custom-property
  and `@font-face` definitions (`colors.css` is raw hex, `spacing.css`/`typography.css` are raw `px`).
  The exemption MUST be expressed as a **path/file scope**, NOT as a content/declaration-type exemption
  (e.g. "ignore hex/`px` inside any `--*` custom-property declaration"): a content-scoped exemption
  would exempt custom-property definitions in *any* file and thereby reopen a custom-property
  laundering path (`:root{--x:#fff}` dropped into `bridge.css`), which this requirement forbids.
  **One additional path-scoped exemption (rev 6, REQ-F001-052 / OQ-11).** The `@media
  (prefers-color-scheme: light)` bridge block (REQ-F001-052) references its raw DS light values from a
  single co-located **bridge light-source token-definition file**; that one file is added to the
  exemption list as an explicitly-named **fifth** file, so the exemption now names **exactly five files**
  (the four adopted DS token files + the one bridge light-source token file) — still **path-scoped, never
  content-scoped**, so no laundering path is reopened. The bridge `@media` block itself is **not**
  exempt: it is scanned and passes because it holds only `var()` re-points (no raw hex/`px`).
  Everywhere else in `web/src/**/*.css` — every file other than those five exempt token files — raw
  hex/`px`/off-system-font values are forbidden regardless of whether they appear in a custom-property
  declaration or a regular property. This gate is what closes the "re-host `index.css` as `bridge.css`"
  loophole (REQ-F001-026): such a file is scanned, is not one of the four exempt token files, and fails
  on its hex/`px` literals. Like REQ-F001-044 it MUST fail CI (non-zero
  exit) on any violation. *Test:* the CSS gate runs in CI against `web/src/**/*.css`, exempts by
  **file/path glob exactly the four adopted DS token files** (`colors.css`, `spacing.css`,
  `typography.css`, `fonts.css`) **plus the one bridge light-source token file (REQ-F001-052)** and
  nothing else, and reports **zero violations with a non-zero exit
  on any violation**; a deliberately-introduced raw hex or raw `px` in any non-token `.css` file
  (including a hypothetical `web/src/bridge.css`) — **whether inside a `--*` custom-property declaration
  or a regular property** — or an off-system `font-family`, each **fails the gate**; the exemption is
  verified to be path-scoped (a raw hex placed in a `--*` declaration in a non-token file still fails).
- REQ-F001-027 — **No residual ad-hoc styling after the migration completes (gate-bound, both source
  languages).** At completion (or at completion of each phase, REQ-F001-028), the migrated scope
  contains no orphaned ad-hoc styling: every migration site (REQ-F001-009/010) is either (a) migrated
  to a DS token/component, (b) the single documented raw-editor bridge (REQ-F001-046), or (c) removed
  as dead. The ~723-line `index.css` is correspondingly reduced to (at most) the adopted DS
  token-definition CSS plus the documented bridge layer. Completeness is bound by the **two adherence
  gates (REQ-F001-044 over JS/TS and REQ-F001-047 over `.css`)**, not by a proportional cap or line
  count: a `web/src/bridge.css` that merely re-hosts the old ad-hoc rules fails the **CSS-aware gate**
  (REQ-F001-047 — dense with hex/`px` literals, not the exempt token CSS), and inline JS/TS style
  objects re-hosting the same rules fail the **oxlint gate** (REQ-F001-044); either way it cannot pass
  this requirement. (The residual is expected to be modest, but that is a consequence of the gates,
  **not** an enforced size budget — N-1.) *Test:* **both** adherence gates (REQ-F001-044 over
  `web/src/**/*.{ts,tsx,js,jsx}` and REQ-F001-047 over `web/src/**/*.css`) pass with zero violations
  and non-zero exit on any violation, AND a static scan finds zero ad-hoc `className`/CSS rules
  unaccounted for by the migration inventory; the residual local CSS is only the adopted
  token-definition CSS and the documented bridge layer.

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
  gate, zero feature areas remain on ad-hoc styling (**both** adherence gates — REQ-F001-044 over
  JS/TS and REQ-F001-047 over `.css` — pass repo-wide, not just per-migrated-area).
- REQ-F001-028a — **October 2026 GTM is a hard compliance gate (RESOLVED — ruling OQ-7,
  2026-07-07).** Full F-001 design-system compliance across all five feature areas is a **release
  blocker** for the October 2026 GTM, not a soft target. Partial migration MAY ship in intermediate
  internal releases (REQ-F001-028) but MUST NOT be the state at GTM. *Test:* a GTM-readiness check
  confirms **both** repo-wide adherence gates (REQ-F001-044 over JS/TS and REQ-F001-047 over `.css`)
  are green and no feature area retains ad-hoc CSS/className styling outside the bounded
  bridge/raw-editor exceptions (REQ-F001-026/046).

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
  are used; contrast/keyboard checks show no regression versus the **captured pre-migration baseline
  (REQ-F001-049)**.
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
  1500 ms; the gzipped production JS + CSS bundle is ≤ **the captured pre-migration baseline
  (REQ-F001-049)** + 10% (both measured on a production build with the same seeded data).
- REQ-F001-049 — **Capture the pre-migration baseline as an artifact BEFORE migration begins (N-2).**
  The "no accessibility regression" floor (REQ-F001-030) and the "≤ baseline + 10%" bundle budget
  (REQ-F001-033) both compare against a **pre-migration baseline** that ceases to be reconstructable
  once migration starts. Therefore, before the first migration change lands, the following MUST be
  captured and committed as a dated artifact under `docs/` (or a comparable tracked location): (a) the
  **gzipped production JS + CSS bundle size** of the current `web/` production build; and (b) an
  **accessibility/contrast snapshot** of the current console — the automated-a11y results and the
  contrast measurements for the status/danger/success and text-on-background pairs — for the parent
  REQ-100 read views plus `DangerConfirm`/`ErrorBanner`/`SetNotSetBadge`, measured on a production
  build with the standard seeded data. Post-migration comparisons (REQ-F001-030/033) are made against
  this committed artifact, not a re-measured or reconstructed value. *Test:* a dated pre-migration
  baseline artifact exists in the repo (bundle size + a11y/contrast snapshot), captured before the
  first migration commit; REQ-F001-030 and REQ-F001-033 comparisons cite it.
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

## §9 Open Questions / Assumptions for Human Ruling — ALL RESOLVED (OQ-1…OQ-8: 2026-07-07; OQ-9…OQ-12: 2026-07-08)

Two items the prior revision carried as ASSUMPTIONs (A1, A7) were **RESOLVED** by the vendored bundle
and folded into established, cited facts. The six items rev 3 carried as open questions (OQ-3–OQ-8)
were **RESOLVED by human ruling on 2026-07-07** and are recorded below with their rulings; the two
items rev 4 surfaced (OQ-9, OQ-10) were **RESOLVED by human ruling on 2026-07-08** (each ratifying the
recommended default). The two spec defects Phase 1 architecture surfaced (OQ-11 / RISK-1, OQ-12 /
RISK-2) were likewise **RESOLVED by human ruling on 2026-07-08** and are recorded below. Ids are never
reused/renumbered. The dependent requirements above cite the ruling rather than a provisional
assumption. **No open question remains — F-001 is fully ruled and implementation-ready.**

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
- REQ-F001-050 — **OQ-9 — How to gate CSS adherence — RESOLVED (ruling: stylelint CSS gate,
  2026-07-08).** The adopted oxlint config (`_adherence.oxlintrc.json`) parses **JS/TS/JSX only and
  cannot scan `.css`** (review F-1), so it cannot by itself enforce the no-raw-hex/`px`/off-font floor
  in CSS or close the "re-host `index.css` as `bridge.css`" loophole. The options considered were:
  **(a)** add a **CSS-aware gate (stylelint)** over `web/src/**/*.css` mirroring the hex/`px`/font
  rules; **(b)** require ALL residual styling to live in JS/TS so oxlint's AST rules apply; **(c)**
  narrow the completeness guarantee's scope to JS/TS only (weakens the floor). *Ruling (2026-07-08):*
  **option (a) — a stylelint CSS gate (REQ-F001-047).** Rationale: the DS adoption model is
  fundamentally CSS-custom-property-based (adopt token CSS verbatim; screens reference tokens via
  `var()` in CSS); option (b) would fight that model and option (c) weakens a load-bearing guarantee.
  The ruling **incorporates re-review finding NEW-1**: the gate's token-CSS exemption MUST be
  **path-scoped to the four adopted DS token files** (`colors.css`, `spacing.css`, `typography.css`,
  `fonts.css`), NOT content/`--*`-declaration-scoped (which would reopen a custom-property laundering
  path). REQ-F001-018/026/027/044/047 are written to this ruling; REQ-F001-047 records the exemption
  fix.
- REQ-F001-051 — **OQ-10 — `--success*`/`--danger*` → DS-token mapping — RESOLVED (ruling: badge-token
  mapping as tabled, 2026-07-08).** The DS ships no `--success*`/`--danger*` family (review F-2), so
  the five orphaned custom properties MUST be mapped onto named DS tokens; the mapping is
  **correctness-bearing** (it changes exact status colors on `DangerConfirm`, `ErrorBanner`, and status
  surfaces). *Ruling (2026-07-08):* ratify the **REQ-F001-048 mapping table as-is** —
  `--success`→`--theme-badge-success-text`, `--success-bg`→`--theme-badge-success-bg`,
  `--danger`→`--theme-badge-danger-text`, `--danger-bg`→`--theme-badge-danger-bg`,
  `--danger-strong`→removed as dead (or `--alm-error` if a use is found) — each chosen as the nearest
  semantic + visual DS equivalent in both themes. The disclosed **danger-foreground color shift** is
  accepted (`--danger` moves from its ad-hoc value / border use to the `--theme-badge-danger-text`
  tone; the stronger `--alm-danger` `#f04438` alternative was considered and not selected). Every
  target token is verified to exist on disk with the cited dark/light values (re-review, 2026-07-08).
- REQ-F001-054 — **OQ-11 — OS-driven light-theme selection under verbatim token adoption — RESOLVED
  (ruling: bridge `@media (prefers-color-scheme: light)` block, 2026-07-08; RISK-1).** Phase 1
  architecture (`docs/design/F-001/00-design.md` RISK-1) surfaced a genuine spec conflict, verified
  against disk: the vendored DS `tokens/colors.css` ships `:root` (dark) + `[data-theme="light"]` but
  **no** `@media (prefers-color-scheme: light)` block, while the app today selects light purely from the
  OS via that media query (`web/src/index.css` lines 79–107) and has no runtime theme setter / switcher
  (REQ-F001-013/024). Byte-for-byte verbatim adoption (REQ-F001-017) would drop OS auto-detection →
  OS-light users render dark → regresses REQ-F001-013/023/024. Options considered: **(a)** keep
  `colors.css` verbatim and add a documented **bridge-layer** `@media (prefers-color-scheme: light)`
  block (outside the verbatim files); **(b)** edit a third carve-out into the verbatim token file
  (violates REQ-F001-017's "no other byte"); **(c)** drop the OS fallback (regresses REQ-F001-013).
  *Ruling (2026-07-08):* **option (a) — the bridge `@media` block (REQ-F001-052, carve-out C).** It
  re-points every `--theme-*` the screens consume to the SAME DS light value, lives in the bridge/app CSS
  (not the verbatim token file), is **expected bridge content, not ad-hoc drift** (REQ-F001-026/047),
  and is kept gate-clean by holding only `var()` re-points (no raw hex) with its raw light values in a
  single **path-scoped-exempt** bridge light-source token file (the CSS-gate exemption grows from four to
  five explicitly-named files, still path-scoped — no content-scoped laundering path, REQ-F001-047). The
  REQ-F001-023 harness path (iii) is extended to assert every `--theme-*` resolves to its DS light value
  under simulated `prefers-color-scheme: light`. *Implementation note (surfaced to the architect):* the
  pure-`var()`-only-in-scope form the ruling describes is satisfiable only because the raw DS light
  palette (`#ffffff`/`#edf2fa`/`#f9fbfd`/…) is placed in that one path-exempt light-source token file —
  the DS does **not** expose those pale light values as named tokens, so the `@media` block cannot
  reference them without such a source; the light-source file duplicates the DS light values, a
  documented re-sync coupling (REQ-F001-025/052).
- REQ-F001-055 — **OQ-12 — seven additional non-DS `--theme-*` custom properties → DS-token mapping —
  RESOLVED (ruling: map to nearest DS tokens as tabled, 2026-07-08; RISK-2, same defect class as F-2).**
  Phase 1 architecture (`docs/design/F-001/00-design.md` RISK-2) surfaced, verified against disk, that
  beyond the `--success*`/`--danger*` family (REQ-F001-048) **seven** further custom properties used/
  defined by `web/src/index.css` are undefined in the DS token files, so verbatim adoption leaves them
  undefined: `--theme-home-bg-card`, `--theme-button-text`, `--theme-button-code-hover-text`,
  `--theme-button-disable-hover-text`, `--theme-button-disable-hover-bg`,
  `--theme-button-delete-hover-text`, `--theme-button-delete-hover-bg`. This is a correctness-bearing
  color decision of the same class as OQ-10. *Ruling (2026-07-08):* **ratify the REQ-F001-053 mapping
  table** — each orphan mapped onto its nearest semantic + visual DS token in both themes
  (`--theme-home-bg-card`→`--theme-bg-secondary`; `--theme-button-disable-hover-text`→
  `--theme-badge-warn-text`; `--theme-button-text`→`--theme-text-secondary`;
  `--theme-button-code-hover-text`→`--theme-button-cta`; `--theme-button-disable-hover-bg`→
  `--theme-badge-warn-bg`; `--theme-button-delete-hover-text`→`--theme-badge-danger-text`;
  `--theme-button-delete-hover-bg`→`--theme-badge-danger-bg`). Two of the seven are actually consumed
  (`--theme-home-bg-card` ×3, `--theme-button-disable-hover-text` ×2) and are re-pointed; the other five
  are defined-but-unused and removed as dead (mapping retained if a use surfaces), analogous to
  `--danger-strong`. The disclosed color shifts (notably the light card fill `#edf2fa`→`#ffffff`) are
  accepted. **Exhaustiveness (ruled critical after two prior review rounds missed this defect class):**
  the union of REQ-F001-048 (5) + REQ-F001-053 (7) = **12** properties is the complete set of
  consumed-but-undefined custom properties as of the rev-6 `var()` audit (method in REQ-F001-053); the
  audit found **no third orphan class** (every other consumed `--theme-*` is DS-defined, and no `var()`
  is consumed outside `web/src/index.css`).

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
| Adoption floor: adherence gates as required CI gates (bound the bridge layer) — oxlint over JS/TS + stylelint over CSS | §6.6 REQ-F001-044/047; §6.5 REQ-F001-026/046 |
| Orphaned `--success*`/`--danger*` custom properties → DS-token mapping (F-2) | §6.1 REQ-F001-017/048; §6.2 REQ-F001-020; §6.4 REQ-F001-023; §9 REQ-F001-051 (OQ-10, RESOLVED) |
| Seven additional non-DS `--theme-*` custom properties → nearest-DS-token mapping (RISK-2, same class as F-2) | §6.1 REQ-F001-017/053; §6.4 REQ-F001-023; §9 REQ-F001-055 (OQ-12, RESOLVED) |
| Exhaustive `var()` audit (12 orphans total; no third orphan class) — mapping is exhaustive as of rev 6 | §6.1 REQ-F001-053 (audit method); §9 REQ-F001-055 (OQ-12) |
| OS-driven light-theme selection preserved under verbatim adoption — bridge `@media (prefers-color-scheme: light)` block (RISK-1) | §6.1 REQ-F001-017; §6.4 REQ-F001-052/023; §6.5 REQ-F001-026; §6.6 REQ-F001-047; §9 REQ-F001-054 (OQ-11, RESOLVED) |
| Font `@font-face` asset-URL handling on verbatim adoption (F-3) | §6.1 REQ-F001-017 (carve-out A) |
| Pre-migration baseline captured as an artifact before migration (N-2) | §8 REQ-F001-049; REQ-F001-030/033 |
| Resolved (ruled) — CSS adherence gate = stylelint, path-scoped exemption of 4 token files (NEW-1) | §9 REQ-F001-050 (OQ-9, RESOLVED); §6.6 REQ-F001-047 |
| Resolved (ruled) — `--success*`/`--danger*` mapping = badge-token table | §9 REQ-F001-051 (OQ-10, RESOLVED); §6.1 REQ-F001-048 |
| Resolved (ruled) — OS-light preservation = bridge `@media (prefers-color-scheme: light)` block (RISK-1) | §9 REQ-F001-054 (OQ-11, RESOLVED); §6.4 REQ-F001-052 |
| Resolved (ruled) — seven non-DS `--theme-*` orphans = nearest-DS-token table (RISK-2) | §9 REQ-F001-055 (OQ-12, RESOLVED); §6.1 REQ-F001-053 |
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
file set, the 143-site / 22-file count, the three named components) PLUS the **two-gate adherence
adoption floor** (REQ-F001-044 oxlint over JS/TS **and** REQ-F001-047 stylelint over CSS): completeness
is bounded by mechanical CI gates that forbid raw hex/`px`/off-system fonts in **both** source
languages (plus off-contract DS props in JS/TS) — rev 4 fixes review F-1 by adding the CSS-aware gate,
so the "re-host `index.css` as `bridge.css`" loophole now fails the **CSS** gate (REQ-F001-026/027/047)
rather than resting on an oxlint config that never scanned CSS, and two engineers cannot both claim
compliance with wildly different residual CSS. Rev 4 also fixes the token-migration testability the
review flagged: the orphaned `--success*`/`--danger*` custom properties (no DS equivalent, review F-2)
now have an explicit DS-token mapping (REQ-F001-048), the "verbatim" claim is scoped to where it is
actually true and carves out the font asset URL (review F-3, REQ-F001-017), the oxlint gate is run in
`--deny-warnings` mode so warnings actually fail CI (review F-4), and its import-restriction patterns
are remapped to the recreated `web/src/design-system/` barrel (review F-5). Two of these remedies embed
correctness-bearing decisions that rev 4 carried as §9 open questions with recommended defaults — OQ-9
(CSS gate = stylelint, REQ-F001-050) and OQ-10 (the mapping table, REQ-F001-051); **both were ratified
by human ruling on 2026-07-08** (OQ-9 also folding in re-review NEW-1: the stylelint token-CSS
exemption is path-scoped to the four adopted token files, not content-scoped), so the human — not the
implementer — settled them, and rev 5 further cites both gates in the completeness/coverage tests of
REQ-F001-014/016/019 (re-review NEW-2). **Rev 6** closes the two defects Phase 1 architecture surfaced,
both of the same "verbatim DS adoption vs. current-app behavior/gates" class: **RISK-1** (verbatim
`colors.css` ships no `@media (prefers-color-scheme: light)` block, so verbatim adoption would render
dark for OS-light users) is resolved by a gate-clean bridge-layer `@media` block (REQ-F001-052) whose
effect is asserted by the extended REQ-F001-023 harness path (iii); **RISK-2** (seven more non-DS
`--theme-*` orphans) extends the orphan mapping (REQ-F001-053). Because two prior review rounds missed
this orphan-token defect class, rev 6 makes the mapping **provably exhaustive** via a reproducible
`var()` audit (REQ-F001-053) — enumerate every consumed custom property under `web/src/**` (all in
`index.css`; none in `.tsx`), subtract the DS-defined union, and the remainder is exactly the twelve
tabled properties and nothing else — so no third orphan can surface at implementation time. Both were
**ratified by human ruling on 2026-07-08** (OQ-11, OQ-12). (2) **"no regression"** —
pinned to the existing `web/` test suite and a per-screen (a)/(b)/(c) checklist (REQ-F001-021/022);
(3) **dual-theme** — now an established DS fact plus a defined three-path render/contrast harness
(REQ-F001-023); (4) **durable re-sync** — pinned to the known diff-based procedure and a structural
propagation test, with the vendored bundle kept immutable (REQ-F001-015/025); and (5) **the bridge
escape hatch** — closed to exactly two named, pre-authorized entries (the raw editor, REQ-F001-046, and
the `prefers-color-scheme` `@media` block, REQ-F001-052) and bounded by both adherence gates (the
`@media` block is `var()`-only and gate-clean, and the CSS-gate exemption stays path-scoped — five named
files, REQ-F001-047). The facts about the DS that were previously unverified (contents/coverage, dual-theme, re-sync
mechanism) are now ESTABLISHED against the vendored bundle and cited; and the six items this spec
previously carried as open questions (re-sync **cadence**, accessibility standard, GTM hardness,
phasing, exposure path, operator-base size) are now **RESOLVED by the 2026-07-07 human rulings**
(§9). The four decisions the reviews and Phase 1 architecture surfaced — OQ-9, OQ-10 (rev 4/5) and
OQ-11, OQ-12 (rev 6, RISK-1/RISK-2) — were **ratified by human ruling on 2026-07-08**, so every
dependent requirement now cites a ruling rather than a provisional assumption and **no open question
remains**. The one ruling that changed a working
assumption — OQ-7, GTM is a **hard** gate (spec had assumed soft) — is reconciled with the phasing
ruling (OQ-8) in REQ-F001-028/028a: phased delivery stays permitted, but all five feature areas MUST
reach full compliance before the October 2026 GTM.
