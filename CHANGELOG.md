# Changelog

All notable changes to the Admin Console are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

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
