# Design System Layer (F-001)

This directory contains the Admin Console's **governing design system**, the single source of truth
for the console's color, spacing, typography, and component behavior (REQ-F001-001, REQ-F001-014).

## Consumption

**The barrel (`index.ts`) is the ONLY import surface.** Screens import DS primitives exclusively from
here, never from component internals:

```typescript
import { Button, Badge, Table, Input, Modal } from '../../design-system';
```

Deep imports (e.g. `import { Button } from '../../design-system/components/Button'`) are forbidden
and will fail the oxlint adherence gate (REQ-F001-044 F-5). This constraint keeps the recreation
layer un-forked and protects future re-syncs (REQ-F001-025/015).

## Architecture

### Components (11 recreated DS primitives)

The vendored handoff bundle at `web/vendor/design-system/` ships 11 React component prototypes with
prop contracts (`.d.ts`). These are recreated as production-ready TypeScript under `components/`,
matching their vendored contracts and variant sets:

| Component | Variants / Notes | Roles |
|---|---|---|
| `Badge` | `tone ∈ {info,success,warn,danger,neutral}` | status indicators, set/not-set badges, semantic color encoding |
| `Button` | `variant ∈ {cta,solid,ghost,danger,login}`, `size ∈ {sm,md,lg}` | primary/secondary/destructive actions; danger variant uses re-mapped `--theme-badge-danger-*` tokens (REQ-F001-048) |
| `IconButton` | `variant ∈ {solid,ghost}`, `size ∈ {sm,md,lg}` | compact icon-only actions |
| `Input` | Text inputs, password, numeric, one-time-code (via `inputMode`) | form fields, validation hooks, a11y label/error wiring |
| `Select` | Dropdown select; optional hint text | dropdown fields with label/hint a11y integration (WCAG 3.3.1 `aria-describedby`) |
| `Textarea` | Multi-line text, read-only (`readOnly`), spellcheck toggle (`spellCheck`) | form fields, raw-editor bridge surface (REQ-F001-046) |
| `Toggle` | `size ∈ {sm,md,lg}`, uncontrolled switch | settings toggles (contract-fidelity `name` prop is unused; see `web/src/bridge/README.md §3`) |
| `Table` | Rows (`Table.Row`), cells (`Table.Cell`) with semantic data-grid roles | data tables, entity lists, membership/document lists |
| `PageHeader` | Heading + optional button set | screen titles, header affordances |
| `Modal` | Dialog with a `title` prop, accessible naming (`role="dialog"`, `aria-modal`, accessible name from `title`) | `DangerConfirm` (destructive action confirmation), generic overlays |
| `SidebarItem` | Navigational link with state (active/inactive) | app shell sidebar navigation (keyboard-operable per REQ-F001-030) |

**Contract extensions (RISK-4 — adopted-only, not in the vendored reference):** Several components'
contracts are extended with props the current console needs (e.g. `Input.readOnly`, `Input.min/max`,
`Input.aria-invalid`, `Textarea.spellCheck`). See `web/src/bridge/README.md §3` for the complete list
and re-sync implications.

### Token Layer (4 adopted + 1 bridge file)

The adopted token CSS (`tokens/`) is the console's token layer, replacing the ad-hoc ~723-line
`web/src/index.css` token block (REQ-F001-017):

```
tokens/
  fonts.css              @font-face + font-family tokens (--font-sans, --font-mono)
                         Verbatim EXCEPT one carve-out: the relative url() to PlusJakartaSans.ttf
                         is adjusted if Vite's asset layout requires it (REQ-F001-017 carve-out A).
  colors.css             Dark (:root) + light ([data-theme="light"]) --theme-* custom properties.
                         Adopted byte-for-byte verbatim (REQ-F001-017).
  typography.css         Type-scale tokens: --fs-*, --fw-*, --lh-*, --tracking-* (font sizes,
                         weights, line heights, letter spacing).
  spacing.css            Spacing + radius + shadow + gradient tokens: --space-*, --radius-*,
                         --control-*, --input-pad, --shadow-*, --gradient-*.
  tokens.css             Barrel that @imports the four above in order; imported by main.tsx.
  light-source.css       Bridge-layer file (REQ-F001-052, carve-out C): holds the raw DS light-
                         palette values as --theme-light-* tokens, referenced by the
                         @media(prefers-color-scheme:light) block in web/src/bridge/prefers-color-
                         scheme.css. Exempt from the CSS gate by path (one of five path-scoped
                         exempt files, REQ-F001-047).
```

**Consumed via `var()` only:** Every color, spacing, type value in recreated components and screens
references these tokens via CSS custom properties (`var(--token-name)`), never raw hex/`px`/font
literals. The adherence gates (REQ-F001-044 oxlint over JS/TS; REQ-F001-047 stylelint over CSS)
enforce this mechanically (REQ-F001-018).

**Orphaned token mapping (REQ-F001-048, REQ-F001-053):** The ad-hoc `--success*`/`--danger*` and
seven `--theme-*` custom properties the DS does not define are mapped onto named DS tokens at consuming
call sites and retired (no surviving `var(--success…)` may escape the migration). See
`web/src/bridge/README.md` and `web/src/index.css` for the ratified mappings.

## Dual-Theme Preservation

The console supports dark (default) + light themes, driven by the adopted `colors.css` token layer
(REQ-F001-023):

- **Dark (default):** `:root` scope in `colors.css`.
- **Light:** `[data-theme="light"]` scope in `colors.css` (no runtime theme switcher; external tool sets the attribute).
- **OS fallback:** Bridge-layer `@media (prefers-color-scheme: light)` block in `web/src/bridge/prefers-color-scheme.css`
  (REQ-F001-052, carve-out C) re-points every `--theme-*` to the DS light value for OS-light users with no `data-theme` set.

Every component and screen references the same semantic token names (`var(--theme-bg-primary)`,
`var(--theme-text-primary)`, etc.) across both themes; the custom-property cascade handles the
switch. A single token edit propagates to all screens in both themes (REQ-F001-035).

## Adherence Gates (the adoption floor)

Migration completeness is enforced by **two complementary linters** (REQ-F001-044, REQ-F001-047):

### Gate 1: oxlint over JS/TS (REQ-F001-044)

```bash
npm run lint:ds
```

Scans `web/src/**/*.{ts,tsx,js,jsx}` with `web/.oxlintrc.json` (the adopted copy of the vendored
`web/vendor/design-system/project/_adherence.oxlintrc.json`). Run mode: `--deny-warnings` (all-warn
severities become failures). Enforces:

- **(i) No raw hex colors** — every color must be a DS `var(--token-name)`
- **(ii) No raw `px` values** — every length must be a DS spacing `var(--space-*, --control-*, etc.)`
- **(iii) Plus Jakarta Sans only** — no other font-family in JS/TS literals
- **(iv) DS prop/variant restrict lists** — e.g. `Button.variant ∈ {cta,solid,ghost,danger,login}` (REQ-F001-044 iv)
- **(v) No deep DS imports** — screens import from the barrel, not `design-system/components/*` internals

### Gate 2: stylelint over CSS (REQ-F001-047)

```bash
npm run lint:css
```

Scans `web/src/**/*.css` with `web/.stylelintrc.json`. Mirrors oxlint's token-adherence rules for CSS
(no raw hex, no raw `px`, `Plus Jakarta Sans`-only). **Path-scoped exemption** (not content-scoped)
for exactly five files — the four adopted DS token files plus the bridge light-source file:

```
ignoreFiles: [
  'web/src/design-system/tokens/{colors,spacing,typography,fonts}.css',
  'web/src/design-system/tokens/light-source.css'
]
```

Every other `.css` is fully scanned. This closes the "re-host `index.css` as `bridge.css`" loophole:
a bridge CSS file dense with hex/`px` literals would fail (REQ-F001-026, REQ-F001-047).

## Re-Sync Procedure (REQ-F001-025)

When a future DS update is available, absorption is a diff-and-reapply, not a merge:

1. **Export a fresh handoff bundle** from Claude Design (the DS source).
2. **Place it alongside the current vendored reference** (e.g. in a temp directory).
3. **Diff the fresh bundle against the vendored reference** at `web/vendor/design-system/`:
   ```bash
   diff -r <fresh-bundle>/project <path-to-repo>/web/vendor/design-system/project
   ```
4. **Identify the deltas** — changes to token values, component prop updates, new icon glyphs, etc.
5. **Re-apply the deltas** into the adopted layer under `web/src/`:
   - **Token deltas** → update the corresponding adopted token file (e.g. if a DS spacing token's value
     changed, update the same property in `web/src/design-system/tokens/spacing.css`).
   - **Component deltas** → update the corresponding `.tsx` file; if a prop interface changed, update
     the `Props` interface; if markup changed, update the JSX.
   - **Bridge coupling (REQ-F001-052, REQ-F001-025):** the bridge `light-source.css` file duplicates the
     DS `[data-theme="light"]` light-palette values. If a DS light value changed, re-apply the same delta.
   - **Contract extensions (REQ-F001-025, RISK-4):** the adopted component prop interfaces carry
     extensions not in the vendored `.d.ts` (REQ-4 list in `web/src/bridge/README.md §3`). Preserve
     these across the re-sync — they are adoption-only deltas.
6. **Verify the adoption layer is still un-forked:** confirm `web/vendor/design-system/` is unchanged
   (the reference stays immutable; all edits live in `web/src/`).
7. **Re-run the adherence gates** and tests to confirm the deltas propagate correctly:
   ```bash
   npm run lint:ds && npm run lint:css && npm test
   ```

This procedure is **repeatable** (no hand-edited vendored files to merge against) and **low-cost**
(token/component changes flow through the shared layer to all consumers via `var()` references and
component imports).

## Testing

**Unit tests:** Each component carries unit tests under `components/*.test.tsx` (internal behavior,
edge cases, contract validation).

**Integration tests:** Screen-level migration is validated by the existing `web/src/**/*.test.tsx`
suite. The migration preserves every screen's contract and behavior (REQ-F001-021).

**E2E tests:** Real-browser smoke tests run from `tests/e2e/` (app boot, dual-theme rendering,
keyboard navigation, form submission). See `tests/e2e/README.md`.

**Adherence gates are CI requirements:** Both `npm run lint:ds` and `npm run lint:css` must pass
(zero violations, non-zero exit on any violation) for the build to succeed (REQ-F001-034).

## Bridge Layer (Intentional Exceptions)

The DS has exactly one known coverage gap: the raw/code-editor surface (`web/src/features/raweditor/`).
This is composed with the DS `Textarea` (its closest primitive) plus DS tokens for code affordances
(monospace via `--font-mono`, `white-space: pre`, spellCheck off). The bridge entry is documented
in `web/src/bridge/README.md` and must pass both adherence gates (REQ-F001-046).

The `prefers-color-scheme` bridge block (`web/src/bridge/prefers-color-scheme.css`) restores OS-driven
light-theme selection dropped by verbatim token adoption. It holds only `var()` re-points and passes
the CSS gate (REQ-F001-052).

No other bridge entries are permitted without justifying a named, demonstrable DS coverage gap.

## Quick Reference: Tokens by Category

### Color (`colors.css`)

Semantic `--theme-*` tokens (dark `:root` + light `[data-theme="light"]`):
- **Primary surfaces:** `--theme-bg-primary`, `--theme-bg-secondary` (raised panels)
- **Text:** `--theme-text-primary`, `--theme-text-secondary` (muted), `--theme-text-tertiary` (faintest)
- **Buttons:** `--theme-button-cta` (accent cyan), `--theme-button-primary`, `--theme-button-secondary`
- **Status badges:** `--theme-badge-{info,success,warn,danger}-{text,bg}` (status semantic colors)
- **Legacy support:** `--alm-*` tokens (for edges the `--theme-*` family doesn't cover)

### Spacing (`spacing.css`)

`--space-*` (8px base step): `--space-1` (8px), `--space-2` (16px), `--space-3` (24px), `--space-4`
(32px), `--space-5` (40px), `--space-6` (48px), `--space-8` (64px).

`--control-*` (form control padding): `--control-sm`, `--control-md`, `--control-lg`.

`--radius-*`, `--input-pad`, `--shadow-*`, `--gradient-*`.

### Typography (`typography.css`)

`--fs-*` (font sizes): `--fs-xs`, `--fs-sm`, `--fs-md`, `--fs-lg`, `--fs-xl`, `--fs-2xl`.

`--fw-*` (font weights): `--fw-400` (regular), `--fw-500` (medium), `--fw-600` (semibold).

`--lh-*` (line heights): `--lh-sm`, `--lh-md`, `--lh-lg`.

`--tracking-*` (letter spacing): `--tracking-tight`, `--tracking-normal`.

### Fonts (`fonts.css`)

`--font-sans` (`Plus Jakarta Sans`), `--font-mono` (monospace).

---

**Spec:** `specs/F-001-adhere-to-design-system.md` (rev 6)
**Bridge layer:** `web/src/bridge/README.md`
**Component contracts:** `web/src/bridge/README.md §3` (adopted extensions)
**Vendored reference:** `web/vendor/design-system/`
