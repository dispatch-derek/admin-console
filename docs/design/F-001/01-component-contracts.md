# F-001 — Recreated DS Component Contracts

The 11 components under `web/src/design-system/components/`, recreated to match their vendored
`.d.ts` (REQ-F001-045) and the oxlint prop/variant rules (REQ-F001-044 iv). Types are re-declared in
TS (not imported from the vendored bundle — consume-don't-fork, REQ-F001-015) and exported from the
barrel. All must satisfy the strict `tsconfig` incl. `noUncheckedIndexedAccess`-class strictness and
pass RTL tests.

**Contract source of truth:** the vendored `.d.ts` + `_adherence.oxlintrc.json` prop allow-lists.
**Do not add or rename props without also updating the adopted oxlint prop rule** — the gate fails on
any attribute outside the declared set (RISK-4).

---

## 1. The 11 interfaces (as declared by the bundle)

```ts
// data-display
interface BadgeProps      { children?: ReactNode; tone?: 'info'|'success'|'warn'|'danger'|'neutral'; className?: string; style?: CSSProperties; }
interface PageHeaderProps { title: string; description?: string; action?: ReactNode; className?: string; style?: CSSProperties; }
interface TableProps      { columns?: string[]; children?: ReactNode; minWidth?: number; className?: string; style?: CSSProperties; }
interface TableRowProps   { children?: ReactNode; className?: string; style?: CSSProperties; }
interface TableCellProps  { children?: ReactNode; header?: boolean; style?: CSSProperties; }   // Table.Row / Table.Cell namespace

// forms
interface ButtonProps     { children?: ReactNode; variant?: 'cta'|'solid'|'ghost'|'danger'|'login'; size?: 'sm'|'md'|'lg'; disabled?: boolean; full?: boolean; icon?: ReactNode; onClick?: (e: MouseEvent)=>void; type?: 'button'|'submit'|'reset'; className?: string; style?: CSSProperties; }
interface IconButtonProps { children?: ReactNode; onClick?: (e: MouseEvent)=>void; size?: number; shape?: 'square'|'circle'; variant?: 'default'|'menu'; title?: string; className?: string; style?: CSSProperties; }
interface InputProps      { label?: string; hint?: string; type?: string; value?: string|number; defaultValue?: string|number; onChange?: (e: ChangeEvent<HTMLInputElement>)=>void; placeholder?: string; name?: string; disabled?: boolean; required?: boolean; id?: string; className?: string; style?: CSSProperties; }
interface SelectOption    { value: string; label: string; }
interface SelectProps     { label?: string; hint?: string; value?: string; defaultValue?: string; onChange?: (e: ChangeEvent<HTMLSelectElement>)=>void; name?: string; disabled?: boolean; id?: string; children?: ReactNode; options?: (SelectOption|string)[]; className?: string; style?: CSSProperties; }
interface TextareaProps   { label?: string; hint?: string; value?: string; defaultValue?: string; onChange?: (e: ChangeEvent<HTMLTextAreaElement>)=>void; placeholder?: string; name?: string; rows?: number; disabled?: boolean; id?: string; className?: string; style?: CSSProperties; }
interface ToggleProps     { enabled?: boolean; onChange?: (next: boolean)=>void; disabled?: boolean; size?: 'sm'|'md'|'lg'; label?: string; description?: string; variant?: 'default'|'horizontal'; name?: string; className?: string; style?: CSSProperties; }

// navigation / overlays
interface SidebarItemProps{ label: string; icon?: ReactNode; active?: boolean; caret?: boolean; expanded?: boolean; isChild?: boolean; onClick?: (e: MouseEvent)=>void; className?: string; style?: CSSProperties; }
interface ModalProps      { open?: boolean; title?: string; onClose?: ()=>void; children?: ReactNode; footer?: ReactNode; width?: number; className?: string; }   // NOTE: no `style` in allow-list
```

Behavior notes carried from the vendored `.jsx` (recreate faithfully):
- **Toggle** renders `role="switch"` + `aria-checked`; `onChange(next: boolean)`; `default` = switch
  first, `horizontal` = label left / switch right.
- **Modal** renders a fixed backdrop (click = `onClose`), a titled card with an `X` close button, a
  scrollable body, and an optional `footer` row; returns `null` when `!open`.
- **Table** uses `columns` for the header row and `Table.Row`/`Table.Cell` for the body;
  `Cell header` renders a `<th>`.

---

## 2. Migration mapping — current pattern → DS component (REQ-F001-016)

| Current site (className / component) | DS primitive | Notes |
|---|---|---|
| `.app-sidebar`, `.sidebar-item(.active)`, `.sidebar-section*` (App.tsx) | `SidebarItem` (+ plain section headers) | `active` from `view===id`; section labels stay text. |
| `.page-header`, `h1`, `.page-description` (App.tsx) | `PageHeader` | `title`/`description` from `PAGE_META`; `action` slot optional. |
| `.entity-table`, `.entity-list`, member/document/chat lists | `Table` + `Table.Row`/`Table.Cell` | List-shaped views map to Table rows or token-composed lists. |
| `.badge*`, `SetNotSetBadge`, `.badge-active` | `Badge` | `tone`: set→`success`, not-set→`neutral`, active→`info`. |
| `.modal*`, `DangerConfirm` | `Modal` (+ `Button`, `Input`) | Footer = Cancel `ghost` + confirm `danger`/`solid`. |
| `.field` input/select/textarea, `SecretField`, provider forms | `Input`/`Select`/`Textarea`/`Toggle` | `label`/`hint` props replace `.field`/`.hint` markup. |
| `button`, `.primary-button`, `.danger-button`, `.link-button` | `Button` | primary→`cta`/`solid`, danger→`danger`, link→`ghost`. |
| icon-only controls (carets, close, row actions) | `IconButton` | `shape`/`variant` per use. |
| `.provider-group*` collapsible caret | `SidebarItem caret/expanded` or `IconButton` + tokens | Provider grouping stays structural (REQ-F001-002). |
| `web/src/features/raweditor/**` (code editor) | **bridge** `RawEditorSurface` = `Textarea` + tokens | The one named DS gap (REQ-F001-046). |

---

## 3. Props current usages need that the bundle contract does NOT declare (RISK-4)

Each of these will trip the oxlint prop allow-list unless the contract **and** the adopted oxlint
rule are extended together, or the usage is reworked. Flagged for a decision — not resolved here.

| Component | Missing prop(s) | Needed by | Consequence if unaddressed |
|---|---|---|---|
| `Input` | `readOnly` | `SecretField`, read-only env fields (`.field input:read-only`, REQ-060/078a) | read-only inputs cannot be expressed; gate fails if prop added ad hoc. |
| `Input` | `min` / `max` / `step` / `inputMode` / `onBlur` / `aria-describedby` | numeric-bounds validation (parent REQ-035) surfaced by settings | client-side bounds UI can't attach without them. |
| `Input` | `error` / `aria-invalid` | `.field-error` display | validation error state has no prop hook. |
| `Textarea` | `readOnly`, `spellCheck`, `wrap` | raw env editor bridge, masked diff | code-editor affordances unavailable. |
| `Button` | `title` / `aria-label` | icon-bearing buttons, a11y (REQ-F001-030) | accessible name may regress vs. today. |
| `Modal` | `style`, `aria-label`/`aria-labelledby`, `initialFocus` | `DangerConfirm` a11y parity (`role="dialog"`, `aria-modal`, labeling — REQ-F001-020/030) | dialog labeling/focus parity at risk; `style` not in allow-list. |
| `Select` | (native `Select` has no oxlint prop rule) | provider selectors, `OllamaModelSelect` | lower risk, but `required`/`aria-*` still absent from contract. |
| `Badge` | non-color status affordance (icon/text) | non-color-only status encoding (REQ-F001-030 AA target) | color-only status if not addressed. |

**Guidance for the implementer:** prefer extending the contract *and* the matching
`no-restricted-syntax` allow-list entry in the adopted `.oxlintrc.json` in lockstep (the vendored
config is never edited — the adopted copy is; REQ-F001-044 F-4). Where a prop cannot be added without
diverging from the DS contract, compose around it (e.g. wrap `Input` for read-only) and record it as
a bridge decision (REQ-F001-026). Any contract change is a re-sync consideration (REQ-F001-025).
