# E2E Test Harness for F-001 Design System Migration

Real-browser smoke tests for the admin-console web frontend, validating the F-001 design-system
migration. Tests run against a **production `vite preview` build** with `/api/*` routes mocked via
Playwright route interception — no live BFF, upstream, or auth stack required.

**Framework:** Playwright (chromium headless by default).

## Quick Start

```bash
# From the repo root:
cd tests/e2e

# Install dependencies (one-time)
npm install

# Run all tests (headless)
npm test

# Run with headed browser (inspect, debug)
npm run test:headed
```

## Test Coverage

The harness validates F-001 design-system adoption across the critical paths:

### 1. App Shell Boot & Navigation (`tests/app-shell.spec.ts`)

- App shell boots without console/runtime errors
- Sidebar renders and mounts each feature-area view without error
- Page title renders with heading semantics (`role="heading"`, `<h1>` on screens using `PageHeader`)
- Sidebar nav items are keyboard-operable (Tab, Enter, Arrow keys; `role="button"` or semantic
  interactive element; not dead `<div>` ARIA-only — REQ-F001-030)

### 2. Dual-Theme Preservation (`tests/theming.spec.ts`, REQ-F001-023/052)

The harness exercises the three theme paths that verify OS-driven light-theme selection is preserved
under verbatim token adoption:

- **Path (i):** Dark is the default theme with no `data-theme` attribute
- **Path (ii):** `[data-theme="light"]` renders a distinct, legibly-styled light theme
- **Path (iii):** `@media (prefers-color-scheme: light)` with no `data-theme` set matches the
  `[data-theme="light"]` rendering (bridge `@media` block re-points `--theme-*` tokens to DS light
  values correctly) — REQ-F001-052

Each path verifies:
- Correct theme is applied to UI elements (color assertions)
- Text/background pairs meet legibility baselines
- Bridge-layer `prefers-color-scheme` block (REQ-F001-052) provides the OS-light fallback, not
  editing the verbatim token file

Additional: Explicit `[data-theme="dark"]` wins over OS `prefers-color-scheme: light` (dark remains
the default when neither attribute nor OS-light is present).

### 3. Component Rendering (`tests/danger-confirm-modal.spec.ts`, `tests/settings-form.spec.ts`, etc.)

- `DangerConfirm` (DS `Modal` + `Button.danger`) opens above the page and dismisses correctly
- Settings form renders DS `Input` / `Select` fields with visible, associated labels (a11y
  integration)
- Provider-group headers toggle their visibility (interaction preserved)
- Form submission works end-to-end (no behavioral regression)

### 4. Asset & Font Loading (`tests/fonts.spec.ts`)

- Plus Jakarta Sans font loads from the built assets (no fallback font, no FOUT)
- Font applies correctly to the shell (visual regression catch)

## Setup & Prerequisites

**Node.js:** 18+ (same as `web/`).

**Build artifact:** Tests run against a **production Vite build**. The harness automatically:

1. Builds the production bundle (`vite build` in the web/ root)
2. Starts a `vite preview` server on a local port
3. Runs Playwright tests against it
4. Tears down the preview server

No manual build step needed — just run `npm test` from `tests/e2e/`.

**Mocking:** `/api/*` routes are intercepted and mocked with canned response fixtures
(`tests/e2e/fixtures/`) to avoid a live BFF. Tests are fast (~5s for 12 tests) and isolated.

## Configuration

**`playwright.config.ts`:**

- **Base URL:** `http://localhost:5173` (vite preview default)
- **Timeout:** 30s per test, 5s per action
- **Retries:** None (deterministic tests, no flake tolerance)
- **Browsers:** Chromium only (representative for desktop operator tool)
- **Headless:** Default, `--headed` flag for inspection

**Screenshots/video:** Failing tests capture screenshots and video to `test-results/` for debugging.

## Fixture Data

Mock API responses live in `fixtures/` (e.g., workspace list, user list, settings). Playwright
route interception serves these as responses to `/api/...` calls, avoiding a live server.

## Running Specific Tests

```bash
# Single test file
npx playwright test tests/app-shell.spec.ts

# Specific test by name (regex)
npx playwright test -g "dual-theme"

# Debug mode (inspector opens)
npx playwright test --debug
```

## CI Integration

The test harness is CI-ready. The typical CI flow:

```bash
cd tests/e2e
npm install                   # install e2e test dependencies
npm test                      # run all 12 tests; exit 0 on pass, 1 on fail
```

Failing tests emit exit code 1 and log test-results (screenshots, video, error messages) to
`test-results/` for post-mortem analysis.

## F-001 Validation Checklist

This harness validates the spec's core adoption gates:

- ✓ App shell boots (REQ-F001-021 no behavioral regression)
- ✓ All five feature areas mount without error (REQ-F001-019 migration completeness)
- ✓ Dual-theme rendering paths all work (REQ-F001-023, REQ-F001-052 OS-light fallback)
- ✓ Component interactions preserved (REQ-F001-020/021)
- ✓ Form fields have a11y labels + hints (REQ-F001-030 a11y hooks)
- ✓ Sidebar nav is keyboard-operable (REQ-F001-030 keyboard operability)
- ✓ Plus Jakarta Sans font loads (REQ-F001-017 font asset URL, carve-out A)

The **adherence gates** (`npm run lint:ds`, `npm run lint:css`) are enforced as separate CI steps
in the `web/` build and validate syntactic completeness; this harness validates semantic
correctness in the running app.

---

**Spec:** `specs/F-001-adhere-to-design-system.md`
**Design-system layer:** `web/src/design-system/`
**Bridge layer:** `web/src/bridge/`
