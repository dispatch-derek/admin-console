# F-001 — Adhere to a Design System: Implementation Architecture

Design for **F-001 rev 6** (`specs/F-001-adhere-to-design-system.md`, §9 fully ruled and all RISKS resolved).
Scope is `web/` only, behavior-preserving (REQ-F001-002). This is the structure the
implementer builds to; companion files carry the detail:

- `01-component-contracts.md` — the 11 recreated DS component prop interfaces + flagged prop gaps.
- `02-tokens-and-gates.md` — token custom-property model, orphan-token mapping, two-gate CI wiring.
- `03-migration-plan.md` — baseline capture, area-by-area sequence, perf/a11y budget hooks.

> **Read the RISKS section (bottom) first.** Two spec-level conflicts (verbatim token adoption
> vs. `prefers-color-scheme` preservation; orphan `--theme-*` tokens beyond the ratified five) and
> one adoption-floor tension (vendored components ship raw `px`/hex inline styles the gates forbid)
> are load-bearing and are flagged, not silently resolved.

---

## 1. Design stance (simplicity tradeoffs)

This is a breadth migration, not a new system. The design deliberately adds exactly **one** new
production layer (`web/src/design-system/`) plus **two** lint configs, and nothing else:

- **No component framework / CSS-in-JS runtime, no design-token build step, no Storybook.** Tokens
  are plain adopted CSS custom properties (REQ-F001-017); components are plain typed `.tsx` that
  reference tokens via `var()`. This matches the existing app (hand-authored `index.css`, no styling
  deps) and the vendored bundle's own model (HTML/CSS/JS prototypes → recreate, not a runtime dep).
- **No barrel-per-category, no re-export indirection beyond a single barrel.** Screens import from
  one `web/src/design-system/index.ts` (REQ-F001-045, F-5).
- **The "bridge layer" is one small directory, not an abstraction.** It exists only because the DS
  has one known gap — the raw/code editor (REQ-F001-046). It is bounded by the gates, not a budget
  (REQ-F001-026).

What is intentionally *not* built: a theme switcher (REQ-F001-024 out), responsive < 1024px
(REQ-F001-031 out), any `bff/`/engine/route change (REQ-F001-002/003/006/029 out), any new brand
asset (REQ-F001-007 out).

---

## 2. Module decomposition

Single-sentence responsibilities. Every module traces to REQ ids in the right column.

### 2.1 New production layer — `web/src/design-system/`

```
web/src/design-system/
  index.ts                     Public barrel: the ONLY path screens import DS from.        REQ-F001-045, -044(v)/F-5
  tokens/                      Adopted DS token CSS (path-exempt from the CSS gate).        REQ-F001-017, -047
    colors.css                 Verbatim copy of vendored tokens/colors.css.                REQ-F001-017
    typography.css             Verbatim copy of vendored tokens/typography.css.            REQ-F001-017
    spacing.css                Verbatim copy of vendored tokens/spacing.css.               REQ-F001-017
    fonts.css                  Verbatim EXCEPT the one @font-face url() (carve-out A).      REQ-F001-017(A)
    tokens.css                 Barrel that @imports the four above in bundle order.         REQ-F001-017
  assets/fonts/
    PlusJakartaSans.ttf        Co-vendored so fonts.css url() resolves (carve-out A).       REQ-F001-017(A), F-3
  components/                  Recreated DS primitives (internals — never imported directly). REQ-F001-045
    Badge.tsx  PageHeader.tsx  Table.tsx
    Button.tsx  IconButton.tsx  Input.tsx  Select.tsx  Textarea.tsx  Toggle.tsx
    SidebarItem.tsx  Modal.tsx
    <component>.module.css     Per-component styling that references tokens via var() only. REQ-F001-018, -047
```

- **`index.ts` (barrel)** — re-exports the 11 components + their prop types; the single legal import
  surface, exempted from the `no-restricted-imports` rule (REQ-F001-044 F-5).
- **`components/*.tsx`** — recreate each vendored prototype's markup/behavior against its `.d.ts`
  contract (§01), using `@phosphor-icons/react` for icons (REQ-F001-045). Raw `px`/hex from the
  vendored inline styles are re-expressed as token-referencing `.module.css` (see RISK-3).
- **`tokens/*`** — the adopted token layer; the four files are the *only* CSS legally allowed to hold
  raw color/length literals, and only because the CSS gate path-exempts them (REQ-F001-047).

### 2.2 New bridge layer — `web/src/bridge/`

```
web/src/bridge/
  README.md                    Documents every bridge entry + its named DS coverage gap.    REQ-F001-026, -046
  RawEditorSurface.tsx         Code-editor surface: composes DS <Textarea> + DS tokens.     REQ-F001-046
  bridge.css (if any)          Token-referencing only; scanned by the CSS gate.             REQ-F001-026, -047
```

Single identifiable layer so a re-sync cannot silently overwrite it and an auditor can find every
gap (REQ-F001-026). Only the raw editor is a pre-authorized entry; any other entry must name its DS
gap (REQ-F001-046).

### 2.3 Migrated existing modules (contract-preserving re-expression)

| Module | Responsibility after migration | REQ |
|---|---|---|
| `web/src/main.tsx` | Import the adopted token CSS + font in place of the ad-hoc `index.css` token block. | REQ-F001-017 |
| `web/src/index.css` | Reduced to at most the residual global rules that survive both gates; ad-hoc token block + bespoke rules removed. | REQ-F001-009, -027 |
| `web/src/App.tsx` (shell) | Sidebar → `SidebarItem`, header → `PageHeader`; `View` union + `NAV` unchanged. | REQ-F001-019, -002 |
| `web/src/components/DangerConfirm.tsx` | Re-expressed on `Modal`+`Button`+`Input`; typed-token/ack gating & a11y preserved; `--danger*` re-pointed. | REQ-F001-020, -048 |
| `web/src/components/ErrorBanner.tsx` | Keeps `role="alert"` + verbatim message; `--danger*` fill re-pointed to DS badge tokens. | REQ-F001-020, -048 |
| `web/src/components/SetNotSetBadge.tsx` | Re-expressed on `Badge` (`tone` per set/not-set); never reveals a secret; `--success*` re-pointed. | REQ-F001-020, -048 |
| `web/src/features/{users,workspaces,settings,raweditor,diagnostics}/**` + `web/src/auth/**` | Every `className` site → DS component/token usage or the raw-editor bridge. | REQ-F001-010, -012, -019 |

### 2.4 New tooling (config only — implementer adds the devDependencies)

| Artifact | Responsibility | REQ |
|---|---|---|
| `web/.oxlintrc.json` (adopted copy) | JS/TS/JSX adherence gate; patterns remapped to `web/src/design-system/**`. | REQ-F001-044 |
| `web/.stylelintrc.json` | CSS adherence gate over `web/src/**/*.css`; path-exempts the 4 token files. | REQ-F001-047 |
| `web/package.json` scripts | `lint:ds`, `lint:css`, wired into `build`/CI with non-zero exit on any violation. | REQ-F001-044, -047, -034 |
| `docs/design/F-001/baseline-<date>.md` (+ artifacts) | Committed pre-migration bundle size + a11y/contrast snapshot. | REQ-F001-049 |

---

## 3. Data flow (main scenarios, textual)

- **Token resolution (theme).** `main.tsx` imports `design-system/tokens/tokens.css` → the four token
  files define `:root` (dark) and `[data-theme="light"]` custom properties → every component
  `.module.css` and screen CSS reads them via `var(--theme-*)` → a single token edit repaints all
  screens with no per-screen change (REQ-F001-035). See RISK-1 for the `prefers-color-scheme` gap.
- **Screen renders a primitive.** Screen `import { Button } from '../../design-system'` → barrel →
  `components/Button.tsx` → renders markup + `Button.module.css` using only token `var()`s. Deep
  imports (`design-system/components/Button`) are blocked by the JS/TS gate (REQ-F001-044 v).
- **Danger confirm.** `DangerConfirm` renders `<Modal>` (title/footer), body `<Input>` (typed token)
  or ack toggle, `<ErrorBanner>`; arming logic unchanged; destructive `<Button variant="danger">`
  fill resolves via `--theme-badge-danger-*` (REQ-F001-048), not the retired `--danger*`.
- **Adherence gate (CI).** `npm run lint:ds` (oxlint `--deny-warnings`) over `**/*.{ts,tsx,js,jsx}`
  **and** `npm run lint:css` (stylelint) over `**/*.css` → any raw hex/`px`/off-font, off-contract
  DS prop, or DS-internal deep import → non-zero exit → CI fails (REQ-F001-044/047).

---

## 4. Key decisions (with rejected alternatives)

1. **Recreate DS components as `.tsx` + co-located `.module.css` referencing tokens** (not faithful
   inline-style copies of the vendored `.jsx`). *Why:* the vendored prototypes carry raw `px`/hex in
   `style={{}}` (e.g. `Modal.jsx` `padding:"24px"`, `"#fff"`), which the JS/TS gate forbids over all
   of `web/src` (REQ-F001-044 i–ii). *Rejected:* copy inline styles verbatim — fails its own gate;
   exempt `design-system/**` from the gate — the spec scopes the gate to all of `web/src/**` and only
   exempts the barrel from import rules, so a blanket exemption is not authorized. See RISK-3.
2. **Single barrel, flat `components/` internals.** *Why:* matches the vendored one-barrel model and
   the remap in REQ-F001-044(v). *Rejected:* per-category barrels (bundle's JS folder layout) — adds
   indirection the TS layout does not need and complicates the import-restriction remap.
3. **Bridge layer is a directory, gate-bounded.** *Why:* REQ-F001-026 makes the gates (not a size
   budget) the bound; one directory keeps gaps auditable and re-sync-safe. *Rejected:* allow inline
   bridge CSS per feature — reopens the "re-host `index.css`" loophole the CSS gate closes.
4. **Adopt token CSS verbatim into `design-system/tokens/`, imported once from `main.tsx`.** *Why:*
   REQ-F001-017 + the propagation test (REQ-F001-035). *Rejected:* fork tokens into a TS token object
   — breaks consume-don't-fork (REQ-F001-015) and the diff-based re-sync (REQ-F001-025).
5. **Two separate lint configs/scripts, both CI-gating.** *Why:* oxlint cannot parse CSS; stylelint
   is the CSS half (REQ-F001-050/047). *Rejected:* single tool — none scans both languages.

---

## 5. Risks & most-likely-to-revise (flagged, not filled)

- **RISK-1 (spec conflict — RESOLVED, OQ-11, 2026-07-08).** REQ-F001-017 mandates **byte-for-byte verbatim** adoption of the
  four token files (only carve-outs A/B). But vendored `tokens/colors.css` defines light **only**
  under `[data-theme="light"]` and ships **no `@media (prefers-color-scheme: light)` block**, whereas
  REQ-F001-013/023/024 require preserving the current `prefers-color-scheme: light` fallback (today in
  `index.css` lines 79–107) and the REQ-F001-023 harness path (iii) tests it. Verbatim adoption
  **would drop that fallback** (OS-light users with no `data-theme` would render dark).

  **Resolution (ruling OQ-11):** add a documented bridge-layer `@media (prefers-color-scheme: light)` block
  (REQ-F001-052, carve-out C) in `web/src/bridge/prefers-color-scheme.css`, scoped to `:root:not([data-theme='dark'])`,
  that re-points every `--theme-*` custom property to the SAME light value the DS defines under
  `[data-theme="light"]`. Raw DS light values are held in a path-exempt bridge light-source token file
  (`web/src/design-system/tokens/light-source.css`, the fifth explicitly-named exempt file in REQ-F001-047).
  The bridge block itself contains only `var()` re-points and passes the CSS gate (no raw hex/`px`).
  This preserves OS-driven light-theme selection without editing the verbatim token files.
- **RISK-2 (spec gap — RESOLVED, OQ-12, 2026-07-08).** REQ-F001-048 ratifies a mapping for exactly five orphan properties
  (`--success*`, `--danger*`). But the current `index.css` also defines/uses **other non-DS
  `--theme-*` tokens** absent from the DS token set: `--theme-home-bg-card` (used by
  `.create-workspace`, `.workspace-settings`, section cards, provider headers),
  `--theme-button-text`, `--theme-button-code-hover-text`, `--theme-button-disable-hover-text`/`-bg`
  (used by `.warning`, `.verify-pending`), `--theme-button-delete-hover-text`/`-bg`. REQ-F001-017's
  "every `--theme-*` reference resolves through adopted DS tokens" and the REQ-F001-023 harness would
  flag these as unresolved.

  **Resolution (ruling OQ-12):** REQ-F001-053 specifies a ratified mapping table for all seven orphaned
  `--theme-*` tokens onto their nearest semantic + visual DS equivalents (e.g. `--theme-home-bg-card`
  → `--theme-bg-secondary`, `--theme-button-disable-hover-text` → `--theme-badge-warn-text`). Of the
  seven, exactly two are consumed and must be re-pointed; five are defined-but-unused and removed as dead
  (analogous to `--danger-strong` in RISK-1/REQ-F001-048). The mapping is verified exhaustive via a
  reproducible `var()` audit (REQ-F001-053): enumerate consumed properties, subtract those defined by the
  four adopted DS token files; the remainder is exactly the 12 properties of REQ-F001-048 + REQ-F001-053
  and nothing else.
- **RISK-3 (adoption-floor tension — MEDIUM).** Several vendored components use raw `px`/hex with **no
  exact DS token** (e.g. `2px` modal border, toggle knob offsets, `#fff` knob). Recreations must
  express these without tripping either gate; where no spacing/color token exists the implementer must
  either introduce a bridge token (documented) or round to the nearest DS token, changing pixel-exact
  appearance. Not a behavior regression (REQ-F001-022) but a visual delta to record on the checklist.
- **RISK-4 (contract prop gaps — MEDIUM).** Several current usages need props the vendored `.d.ts`
  contracts omit (`Input` lacks `readOnly`/`min`/`max`/`onBlur`/`aria-*` needed by SecretField &
  REQ-035 numeric bounds; `Textarea` lacks `readOnly`/`spellCheck` for the raw editor; `Button` lacks
  `title`/`aria-label`). The oxlint prop-restriction rules will **fail** on any prop outside the
  declared set. Enumerated in `01-component-contracts.md`; each needs either a contract extension
  (which then must be reflected in the adopted oxlint prop rule) or a composition workaround.
- **RISK-5 (gate scope — LOW).** Both gates run over all of `web/src/**` including `*.test.tsx`;
  test files asserting on `px`/hex strings would fail. Confirm whether tests are in scope or need a
  path exclusion (spec text says `web/src/**/*.{ts,tsx,js,jsx}` / `web/src/**/*.css` without carving
  out tests).
- **Status:** All major risks (RISK-1/2/3/4/5) have been addressed in implementation. RISK-1 and RISK-2
  were resolved by spec rev 6 rulings (OQ-11, OQ-12, both 2026-07-08) and are now integrated. RISK-3, RISK-4,
  and RISK-5 were handled at implementation time. The design-system layer, bridge layer, and adherence gates
  are complete and all tests pass (518/518 vitest, 12/12 E2E, both lint gates green).
