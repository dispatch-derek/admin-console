# F-001 Bridge Layer

The single, identifiable bridge layer (REQ-F001-026). A **bridge entry** is a local adaptation that
remains only where the governing design system genuinely does not cover a pattern — NOT a general
escape hatch. Every entry is listed here with its named DS coverage gap so an auditor can trace it,
and a re-sync (REQ-F001-025) cannot silently overwrite it. Both adherence gates
(REQ-F001-044 over JS/TS and REQ-F001-047 over `.css`) — not a size budget — bound this layer: no
entry may reproduce a pre-migration ad-hoc ruleset, because every raw hex/`px` literal would trip a
gate.

There are exactly **two** pre-authorized entries, both anticipated by the spec:

## 1. `RawEditorSurface.tsx` (+ `RawEditorSurface.module.css`) — the raw/code-editor surface (REQ-F001-046)

The DS ships no dedicated raw/code-editor component. The console's raw env editor
(`web/src/features/raweditor/`) is the single pattern for which a bridge entry is expected. It is
built by composing the DS `Textarea` (its closest primitive, imported from the DS barrel — never a
deep internal path) plus DS tokens for code-editor affordances (monospace family via `--font-mono`,
`white-space: pre`, spellCheck off). `RawEditorSurface.module.css` holds only token-referencing
rules (no raw hex/`px`), so it passes the CSS-aware gate (REQ-F001-047).

## 2. `prefers-color-scheme.css` — OS-driven light-theme selection (REQ-F001-052, carve-out C)

The vendored DS `colors.css` defines light **only** under `[data-theme="light"]` and ships **no**
`@media (prefers-color-scheme: light)` block, but the console must keep auto-selecting the light
theme from the OS for users who have set no `data-theme` attribute (REQ-F001-013/023/024). Byte-for-
byte verbatim adoption (REQ-F001-017) would drop that OS auto-detection and render dark for OS-light
users — a regression. Per ruling OQ-11, `prefers-color-scheme.css` restores it with a bridge-layer
`@media (prefers-color-scheme: light)` block, scoped to `:root:not([data-theme='dark'])` (mirroring
the pre-migration selector), that re-points every `--theme-*` custom property to the SAME DS light
value using **`var()` re-points only** (no raw hex/`px`) — so it is scanned by and passes the CSS
gate.

The raw DS light values the block references live in the path-exempt light-source token file
`../design-system/tokens/light-source.css` (the **fifth** explicitly-named file in the CSS gate's
path-scoped exemption, alongside the four adopted DS token files). Keeping the exemption path-scoped
(never content-scoped) preserves the anti-laundering discipline of REQ-F001-047.

**Re-sync coupling (REQ-F001-025/052):** `light-source.css` duplicates the DS `[data-theme="light"]`
values, so a re-sync that changes a DS light value MUST re-apply the same delta to `light-source.css`.
This is the one intentional duplication in the adoption and is disclosed here so it is not lost.

## 3. RISK-4 — adopted-contract prop extensions (re-sync deltas)

`docs/design/F-001/01-component-contracts.md §3` flagged that several current console usages need
props the vendored `.d.ts` does **not** declare. Per the human ruling, the **adopted** typed contract
(under `web/src/design-system/components/`, the source of truth `tsc` enforces) is extended to add
these props and wire them straight through to the underlying element; the **vendored reference stays
immutable** (never edited). Each extension below is a re-sync delta: a fresh DS export will not carry
these, so they must be re-applied after a diff. All extended props are standard DOM attributes wired
1:1 to the native element — no DS visual/behavioral semantic is changed, so no wrapper was required.

| Component | Added prop(s) | Needed by | Notes |
|---|---|---|---|
| `Input` | `readOnly` | `SecretField` / read-only env fields (parent REQ-060/078a) | drives `.control:read-only` |
| `Input` | `min` / `max` / `step` / `inputMode` | numeric-bounds validation (parent REQ-035), numeric/one-time-code fields | wired to `<input>` |
| `Input` | `onBlur`, `aria-describedby`, `aria-invalid`, `error` | validation/a11y hooks (`.field-error`) | `error` renders a token-styled `.error` line and defaults `aria-invalid`; the hint/error nodes carry generated ids that are auto-referenced from the control's `aria-describedby` (an explicit `aria-describedby` is merged, not replaced) — WCAG 3.3.1 |
| `Input` | `autoComplete` | login/enroll forms (password-manager + one-time-code) | standard attribute, benign |
| `Textarea` | `readOnly`, `spellCheck` | raw/code-editor bridge, masked diff (REQ-F001-046) | code-editor affordances |
| `Textarea` | `aria-invalid`, `error` | baseline-prompt whitespace-only validation (REQ-F002-018) | mirrors `Input`'s `error` extension above: renders a token-styled `.error` line and defaults `aria-invalid`; the error node's generated id is auto-referenced from the control's `aria-describedby` — WCAG 3.3.1 |
| `Button` | `title`, `aria-label` | icon-bearing / a11y buttons (REQ-F001-030) | accessible-name hooks |
| `Button` | `aria-describedby` | baseline-prompt "Apply baseline" hint association (REQ-F002-034) | WCAG 3.3.1; wired straight to `<button>` |

`Select` and `Textarea` likewise generate an id for their optional `hint` node and reference it from
the control's `aria-describedby` when a hint is present (WCAG 3.3.1). This is internal a11y wiring, not
a contract extension — no new prop is added; both keep their vendored `.d.ts` prop set intact.

`Toggle.name` is a **contract-fidelity prop, accepted-but-unused**. The vendored `forms/Toggle.d.ts`
declares it and the vendored `forms/Toggle.jsx` prototype destructures it, but the prototype never
wires it anywhere — the switch is a `role="switch"` `<div>`, not a native form control, so there is no
hidden input to bind `name` to. The adopted recreation keeps `name` in `ToggleProps` for contract
fidelity (a re-sync must not drop it) but likewise does not wire it; inventing form-submission
behavior beyond the prototype is out of scope.

`Modal` a11y (`role="dialog"` + `aria-modal` + accessible name from `title`) is provided **internally**
by the recreation without adding an off-contract prop, so it required no contract extension; the
vendored allow-list (no `style`, no `aria-*`) is preserved. The `Toggle` was intentionally **not**
substituted into `DangerConfirm`/`EnrollMfa`'s acknowledgement affordance because it renders
`role="switch"`, which would change those components' contract (their tests and parent §8 semantics
assert a native `role="checkbox"`); the native checkbox is retained there.
