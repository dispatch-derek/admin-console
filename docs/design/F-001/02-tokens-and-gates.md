# F-001 — Token Model & Two-Gate CI Wiring

**Status:** All design decisions in this document have been resolved by spec rev 6. RISK-1
(prefers-color-scheme preservation) is resolved by ruling OQ-11 (REQ-F001-052, carve-out C). All
orphaned token mappings (RISK-2) are resolved by ruling OQ-12 (REQ-F001-053). CSS adherence gating
(OQ-9) is resolved by stylelint (REQ-F001-047).

## 1. Token custom-property model (REQ-F001-017, -023)

The adopted token layer is the four vendored token files copied verbatim into
`web/src/design-system/tokens/` (carve-outs A/B only), imported once:

```
main.tsx
  import './design-system/tokens/tokens.css';   // replaces the ad-hoc token block in index.css
tokens.css
  @import './fonts.css';       /* @font-face — carve-out A (font asset url) */
  @import './colors.css';      /* :root (dark) + [data-theme="light"] --theme-* / --alm-* families */
  @import './typography.css';  /* --font-*, --fw-*, --fs-*, --lh-*, --tracking-* */
  @import './spacing.css';     /* --space-*, --radius-*, --control-*, --input-pad, --shadow-*, --gradient-* */
```

- **Dual-theme scoping (REQ-F001-023).** `colors.css` defines the `--theme-*` family under `:root`
  (dark default) and re-declares it under `[data-theme="light"]`. Screens/components reference only
  the semantic `--theme-*` (and `--alm-*`/spacing/type) tokens via `var()`, so a theme switch is a
  pure custom-property cascade with no per-screen branching. Single-file token edit → repaints all
  screens (propagation test, REQ-F001-035).
- **`--theme-*` name continuity (REQ-F001-037).** For the `--theme-*` names the console already uses,
  the definition source changes but the name does not — those `var(--theme-*)` references keep
  working unchanged. This is asserted **only** for `--theme-*` (REQ-F001-017), and only for the
  subset the DS actually ships — see RISK-2 in `00-design.md` for the `--theme-*` names the DS does
  **not** define (`--theme-home-bg-card`, `--theme-button-text`, `--theme-button-*-hover-*`).
- **Carve-out A (REQ-F001-017 A / F-3).** `PlusJakartaSans.ttf` is co-vendored at
  `web/src/design-system/assets/fonts/` so the `../assets/fonts/PlusJakartaSans.ttf` relative `url()`
  in `fonts.css` resolves with the CSS byte-unchanged. If the Vite asset layout can't honor that
  path, the single permitted edit is that one `url()` string.
- **`prefers-color-scheme` fallback — RESOLVED (RISK-1, OQ-11, 2026-07-08).** The DS `colors.css` has no
  `@media (prefers-color-scheme: light)` block, but the current app does (REQ-F001-013). Per ruling OQ-11,
  a bridge-layer `@media (prefers-color-scheme: light)` block in `web/src/bridge/prefers-color-scheme.css`
  (REQ-F001-052, carve-out C) re-points every `--theme-*` token to the DS light value for OS-light users.
  Raw values are held in a path-exempt light-source token file; the block itself is `var()`-only and passes
  the CSS gate. The verbatim token files are unchanged.

## 2. Orphan-token mapping (REQ-F001-048, ratified OQ-10)

Carve-out B lives at the **consuming call sites** (not in the token files). Every reference is
re-pointed and the `--success*`/`--danger*` names are retired; zero `var(--success…)`/`var(--danger…)`
may survive (REQ-F001-017 test, REQ-F001-023 harness).

| Retired property | Current consumers in `web/src` | Re-point to DS token |
|---|---|---|
| `--success` | `.success` (line 351), `.verify-ok` (596); via `SetNotSetBadge`→`.badge-set` fg | `--theme-badge-success-text` |
| `--success-bg` | `.badge-set` (376) → `SetNotSetBadge` | `--theme-badge-success-bg` |
| `--danger` | `.field-error` (334), `.error-banner` fg+border (342–343) → `ErrorBanner`; `.danger-button` fg+border (424–425) → `DangerConfirm` | `--theme-badge-danger-text` |
| `--danger-bg` | `.error-banner` bg (341) → `ErrorBanner`; `.danger-button:hover` bg (429) → `DangerConfirm` | `--theme-badge-danger-bg` |
| `--danger-strong` | defined, **no** `var()` consumer | remove as dead; if a use surfaces → `--alm-error` |

Concrete component impact (REQ-F001-020):
- **`SetNotSetBadge`** → `<Badge tone="success">` (set) / `<Badge tone="neutral">` (not set); the DS
  `--theme-badge-*` tokens back the tones; secret value never rendered.
- **`ErrorBanner`** → keeps `role="alert"` + verbatim message; fill/border from
  `--theme-badge-danger-bg`/`-text` (DS `Badge`/token composition), no `var(--danger*)`.
- **`DangerConfirm`** → `Modal` + destructive `<Button variant="danger">`; danger affordance from
  `--theme-badge-danger-*`. **Disclosed color shift accepted** (OQ-10): danger foreground moves from
  ad-hoc `#f97066`/`#b42318` to `--theme-badge-danger-text` (`#f87171` dark / `#b91c1c` light).

## 3. Two-gate CI wiring (REQ-F001-044, -047)

### Gate 1 — oxlint (JS/TS/JSX), REQ-F001-044
- **Config:** `web/.oxlintrc.json` — the adopted copy of
  `web/vendor/design-system/project/_adherence.oxlintrc.json` (vendored file never edited,
  REQ-F001-015).
- **Scope:** `web/src/**/*.{ts,tsx,js,jsx}`.
- **Run mode (F-4):** invoke with `--deny-warnings` so the all-`warn` config yields a **non-zero exit
  on any violation** (equivalently the adopted copy sets severities to `error`). A single violation
  fails CI.
- **Import-pattern remap (F-5):** replace the vendored `no-restricted-imports` groups
  (`components/data-display/**`, `components/forms/**`, `components/navigation/**`,
  `components/overlays/**`, `ui_kits/admin-console/**`) with the recreated internals path
  (`web/src/design-system/components/**`), and move the barrel exemption from `**/index.js` to
  `web/src/design-system/index.ts`/`index.tsx`. Layout-independent rules (hex/`px`/font/prop/variant)
  are adopted unchanged.
- **Enforces:** no raw hex, no raw `px`, `Plus Jakarta Sans`-only, DS prop/variant allow-lists, no
  deep DS-internal imports — all in JS/TS only (oxlint cannot see `.css`).

### Gate 2 — stylelint (CSS), REQ-F001-047 (OQ-9)
- **Config:** `web/.stylelintrc.json`.
- **Scope:** `web/src/**/*.css`.
- **Rules (mirror oxlint i–iii for CSS):** no raw hex in values, no raw `px` in values,
  `font-family` must resolve to the DS `--font-sans`/`--font-mono` / adopted `@font-face` family.
- **Exemption — PATH-scoped, NOT content-scoped (NEW-1):** exempt exactly the four adopted token files
  by file/path glob (`web/src/design-system/tokens/{colors,spacing,typography,fonts}.css`) via
  `overrides`/`ignoreFiles`. A `--*`-declaration/content-type exemption is **forbidden** (it would let
  `:root{--x:#fff}` be laundered into any file). Every other `.css` (incl. a hypothetical
  `bridge.css`) is fully scanned — closing the "re-host `index.css` as `bridge.css`" loophole
  (REQ-F001-026).
- **Exit contract:** non-zero exit on any violation, same as Gate 1.

### npm scripts + build wiring (REQ-F001-034)
```jsonc
// web/package.json "scripts"
"lint:ds":  "oxlint --deny-warnings -c .oxlintrc.json src",
"lint:css": "stylelint \"src/**/*.css\"",
"lint":     "eslint . && npm run lint:ds && npm run lint:css",   // existing eslint retained
"build":    "npm run lint:ds && npm run lint:css && tsc && vite build"
```
- CI runs `npm run lint:ds` and `npm run lint:css`; **zero violations required**, any violation = CI
  fail. Both are release-blocking at the GTM gate repo-wide (REQ-F001-028/028a).
- New devDependencies (`oxlint`, `stylelint` + a config preset) are added by the implementer — this
  design does not modify dependencies.
- **RISK-5:** both scopes include `*.test.*`; confirm whether test files need a path exclusion.
