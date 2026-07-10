# F-001 Accessibility Review (WCAG 2.1 AA) — branch `feature/F-001-design-system`

Scope: uncommitted working-tree diff of F-001 (design-system migration) — `web/src/design-system/**`,
`web/src/bridge/**`, and the migrated screens under `web/src/{App.tsx,auth,components,features}/**`,
reviewed against `main` (pre-migration baseline) per REQ-F001-030 (no-regression, AA non-gating) and
REQ-F001-023/052 (dual-theme legibility).

Scanners run:
- `npx oxlint --deny-warnings -c .oxlintrc.json src` (REQ-F001-044 gate) — 0 violations, exit 0.
- `npx stylelint "src/**/*.css"` (REQ-F001-047 gate) — 0 violations, exit 0.
  (Neither gate scans for accessibility semantics — they enforce token/color/px/font adherence only,
  ~0% a11y coverage. No axe-core/pa11y/eslint-plugin-jsx-a11y is wired into this repo; not run.)
- Remainder of this review is manual: component source read, `git diff main` per migrated file, and
  contrast computed by hand from `web/src/design-system/tokens/colors.css` /
  `web/src/bridge/prefers-color-scheme.css` against the pre-migration `web/src/index.css` baseline.

---

## BLOCKER findings (regressions)

**[BLOCKER] WCAG 2.1.1 Keyboard, 4.1.2 Name, Role, Value — `web/src/design-system/components/SidebarItem.tsx:33`**
`SidebarItem` — now the sole control for all primary app navigation (`web/src/App.tsx`, `NAV` items,
consumed at App.tsx ~line 122) — renders as `<div className={classes} onClick={onClick}>` with no
`tabIndex`, no `role`, and no `onKeyDown`. It is not part of the tab order and cannot be activated by
Enter/Space. **This is a direct regression**: `git diff main -- web/src/App.tsx` shows the pre-migration
nav item was a native `<button type="button" className="sidebar-item...">` — fully keyboard-reachable
and operable. Post-migration, a keyboard-only or switch-access user cannot change views at all (every
settings/workspaces/users/raw/diagnostics view is gated behind this control).
Remediation: render the interactive root as a native `<button type="button">` (preferred — matches the
component's own click semantics and requires no extra ARIA), or, if the visual layout requires a `div`,
add `role="button" tabIndex={0}` plus an `onKeyDown` handler firing `onClick` on `Enter`/`Space` (and
`e.preventDefault()` on Space to stop page scroll). While in the file, also add
`aria-current={active ? 'page' : undefined}` so assistive tech perceives which view is selected (today
conveyed by CSS class only — see MINOR note below; not a regression, but zero-cost to fix alongside).

**[BLOCKER] WCAG 2.1.1 Keyboard, 4.1.2 Name, Role, Value — `web/src/design-system/components/Toggle.tsx:65-75`**
`Toggle` renders `role="switch" aria-checked={enabled}` on a `<div onClick={...}>` with no `tabIndex`
and no `onKeyDown`. It can never receive keyboard focus, so it can never be operated by keyboard —
worse than having no ARIA role at all, because `role="switch"` explicitly promises assistive tech a
focusable, Space-toggleable widget (ARIA APG) that this markup does not deliver. Consumed at
`web/src/features/settings/SettingsPage.tsx:202-209` for every boolean setting across every settings
category/provider group. **Direct regression**: `git diff main -- web/src/features/settings/SettingsPage.tsx`
shows the pre-migration boolean control was a native `<input type="checkbox">` inside a `<label>` —
fully keyboard-operable and natively announced ("checkbox, checked/unchecked"). Post-migration, no
boolean setting on the Settings page can be toggled without a mouse.
Remediation: add `tabIndex={disabled ? -1 : 0}` to the `role="switch"` div and an `onKeyDown` handler
that calls `onChange?.(!enabled)` on `Enter`/`Space` (preventDefault on Space); ensure the element shows
a visible `:focus-visible` outline (`Toggle.module.css` currently defines none — see MINOR). Until
fixed, `SettingsPage` should not adopt `Toggle` for the boolean control (the checkbox it replaced was
correct and accessible); reverting that one call site to the native checkbox is the lowest-risk
immediate mitigation if `Toggle` cannot be fixed before the area's compliance deadline.

---

## MAJOR findings

**[MAJOR] WCAG 1.3.1 Info and Relationships — carry-forward #1: list→table conversion**
`WorkspaceList`, `MembershipPanel`, `ChatOversight` were semantic lists (`<ul>`/`<ol>`) and are now DS
`<Table>` — but **none of the three passes a `columns` prop**, so `Table` (which only emits a `<thead>`
when `columns.length > 0`, `web/src/design-system/components/Table.tsx:29`) renders a headerless
`<table>`. Every other Table adoption in this migration (`UserList.tsx:116`, `InviteList.tsx:89`,
`RawEnvEditor.tsx:91`, `DiagnosticsPage.tsx:59`) correctly supplies `columns`; these three do not.
Per-view assessment and recommendation:
- `ChatOversight.tsx:75-81` — was `<ol className="chat-list">` of `<pre>{JSON.stringify(chat)}}</pre>`
  (sequence matters; single "column"). Now a headerless one-column `<table>`. This is not tabular data
  and the ordered-list semantics (position-in-sequence, useful when paging) are lost for no benefit.
  **Recommend revert to `<ol>`** (the one-line revert the carry-forward note anticipates).
- `WorkspaceList.tsx:62-73` — was `<ul className="entity-list">` of name-button + delete-button pairs.
  Two ad-hoc, unlabeled columns in a headerless table give an AT user table-navigation commands
  (next/prev cell, "column 1 of 2") with no header context — strictly worse than the list's natural
  "list, 2 items" navigation for what is still fundamentally a list of actions, not a data grid.
  **Recommend revert to `<ul>`.**
- `MembershipPanel.tsx:118-127` — was `<ul className="member-list">` of username + Remove-button. Most
  defensible as tabular (member ↔ action row-data), but still ships with no header row today.
  **Recommend either revert to `<ul>` (simplest, matches WorkspaceList's disposition) or, if kept as a
  table, add `columns={['Member', 'Actions']}`** so it is at minimum consistent with every other Table
  usage in the codebase.
Regardless of the keep/revert call, shipping a `<Table>` with zero columns is inconsistent with the
component's own contract and the pattern used everywhere else in this migration — the header omission
should not ship either way.

**[MAJOR] WCAG 3.3.1 Error Identification / 1.3.1 Info and Relationships — `web/src/design-system/components/Input.tsx:94-95` (+ `Select.tsx` has no error support at all)**
`Input`'s `hint`/`error` text renders as a plain `<p>` with no `id`, and nothing wires it to the control
via `aria-describedby` — `aria-invalid` is set (line 91) but the *reason* is never programmatically
associated with the field. Affects every validated field in `WorkspaceSettings.tsx` (displayName,
temperature, historyWindow, retrievalThreshold, retrievalTopN, retrievalMode — lines 218/233/262/271/
280/289), `SettingsPage.tsx:378` (saveError), and `OllamaModelSelect.tsx:66`. `Select` doesn't accept an
`error` prop at all, so a Select-rendered setting has no path to surface a validation error to any user.
This is not a clean regression — the pre-migration pattern (e.g. `git show main:web/src/features/
workspaces/WorkspaceSettings.tsx` lines ~218-226) rendered the error `<span className="field-error">`
as a sibling *inside the same wrapping `<label>`* as the input, so it was at least in the label's
accessible-name/description computation path; post-migration the DS `Input`'s `<label>` and its error
`<p>` are structurally disconnected siblings with no relationship at all. Net effect for screen-reader
users is unchanged-to-worse — flagging as MAJOR AA gap bordering on regression.
Remediation: in `Input`/`Textarea`, generate a stable id for the hint/error paragraph (e.g.
`${inputId}-hint` / `${inputId}-error`) and default `aria-describedby` to reference whichever is present
(merging with any caller-supplied `aria-describedby`); add the same `error`/`aria-describedby` support to
`Select`. This single fix in the three DS field components remediates every consuming call site at once.

**[MAJOR, pre-existing — Modal has no focus trap / Escape / focus-return; not a regression]**
Confirmed via `Modal.unit.test.tsx` and `git diff main -- web/src/components/DangerConfirm.tsx`: the DS
`Modal` (`web/src/design-system/components/Modal.tsx`) sets `role="dialog"`/`aria-modal="true"`/
accessible name from `title` correctly, but has no focus trap (Tab cycles out to the page behind the
backdrop), no `Escape`-to-close, and does not return focus to the trigger element on close. The
**pre-migration `DangerConfirm`** (`git show main:web/src/components/DangerConfirm.tsx`) was an equally
bare `<div role="dialog" aria-modal="true">` with the same three gaps — no focus trap, no Escape
handler, no focus management anywhere in the file. **This is therefore NOT a regression** (confirmed by
reading the full pre-migration file, not just the diff — no removed `useEffect`/keydown code exists).
Per REQ-F001-030 (AA target, non-gating), this is guidance, not a blocker: WCAG 2.1.2 No Keyboard Trap
is technically satisfied (focus isn't trapped, it leaks — the opposite failure) but 2.4.3 Focus Order
and 2.1.1 Keyboard operability for dialogs are AA-recommended practice the DS `Modal` doesn't meet.
Because `Modal` is now the *shared* primitive (not just `DangerConfirm`'s private markup), fixing it once
benefits every future dialog. Remediation (design direction, non-gating): on open, move focus to the
dialog (e.g. the first focusable element or the card itself via a set `tabIndex={-1}` + `.focus()`);
add an `Escape` `keydown` listener calling `onClose`/a passed close callback (note `DangerConfirm` does
not pass `onClose` to `Modal` today, so Cancel is presently the only exit — Escape should be wired to
the same handler as Cancel); trap Tab/Shift+Tab within the dialog while open; restore focus to the
element that had focus before the dialog opened, on close.

---

## MINOR findings

**[MINOR, non-regression] WCAG 1.4.3 Contrast (Minimum) — light-theme secondary/muted text**
`--theme-text-secondary` in the light theme is `#7a7d7e`. Computed against a `#ffffff` background this
is ≈4.2:1, just under the 4.5:1 AA floor for normal-size text (large text/UI-component 3:1 floor is
met). Verified via `git show main:web/src/index.css` (`:root[data-theme='light'] { --theme-text-secondary:
#7a7d7e; ... }`) that this exact value pre-dates F-001 — **not a regression**, an inherited AA gap
(non-gating per ruling OQ-6/REQ-F001-030). Used for hint text (`Field.module.css:.hint`), which
compounds with the Input/Select `aria-describedby` gap above (MAJOR) — sighted low-vision users in light
mode get a hint that is both under-contrast and, for AT users, disconnected from its field.
Remediation (guidance only): if a future DS re-sync offers a darker light-theme muted-text value, adopt
it; otherwise reserve `--theme-text-secondary` for non-essential/decorative text and use
`--theme-text-primary` for anything conveying required information (e.g. required-field notes).

**[MINOR] Selection-state indicator silently dropped — `web/src/features/workspaces/WorkspaceList.tsx:64`**
`Table.Row className={ws.id === selectedId ? 'selected' : undefined}` passes a bare global class name
that has no corresponding rule anywhere in the new component CSS; the only matching selector left in
`web/src/index.css:339` is `.ac-entity-list li.selected`, which no longer matches anything since the
list markup was replaced by a table. The result: the currently-selected workspace has **no visual
indicator at all** (not a WCAG citation by itself — this is a functional/visual regression — but it
compounds 4.1.2 concerns since neither the old `<li>` nor the new `<tr>` ever set `aria-current`/
`aria-selected` for AT users either, so the selection state was never AT-perceivable before or after).
Remediation: give `Table.Row`'s `selected`/current-row case a real style hook (a CSS-module class or a
`selected` boolean prop) and set `aria-current="true"` (or `aria-selected` if adopting a `role="row"`
selection model) on the selected row.

**[MINOR, non-regression] WCAG 2.4.7 Focus Visible — no component-level focus style on Button/SidebarItem/IconButton/Table row**
`Button.module.css`, `SidebarItem.module.css`, `IconButton.module.css`, and `Table.module.css` define no
`:focus`/`:focus-visible` rule; these controls rely entirely on the browser's default focus ring (no
global `outline: none` reset exists in the migrated CSS that would suppress it — confirmed by grep).
Only the `Input`/`Select`/`Textarea` `.control:focus` rule is explicitly styled (`Field.module.css:29-32`,
a clear 2px outline in the button-primary token color — good, and unchanged in spirit from the
pre-migration `.field input:focus` rule at `web/src/index.css:194-197`). Not a regression, but worth
tightening for a consistent, on-brand focus indicator once SidebarItem/Toggle keyboard support is added
(BLOCKER items above) — an unreachable control's missing focus style is moot until it's reachable.

---

## Non-findings verified as correct (per instructions)

- `Toggle` correctly uses `role="switch"` + `aria-checked` (semantics right; keyboard support is the
  BLOCKER above, not the role choice).
- Acknowledge checkboxes (`DangerConfirm`, `AdvancedModeGate`, `EnrollMfa`, `MultiUserGate`-adjacent
  flows) correctly remain native `<input type="checkbox">` — not migrated to `Toggle`. Correct per the
  DangerConfirm migration comment (`web/src/components/DangerConfirm.tsx:9-11`): `Toggle`'s
  `role="switch"` would change the component's semantics/contract.
  `SetNotSetBadge`/`Badge` convey state via a text label ("set"/"not set") plus tone, not color alone —
  satisfies 1.4.1 Use of Color.
- `ErrorBanner` still renders `role="alert"` verbatim (`git diff` shows only a class-name rename).
- `Input`/`Select`/`Textarea` correctly associate `label`/`htmlFor`/generated `id` (via `useId`) even
  when no `id` prop is supplied — this part of the contract is solid.
- No icon-only (`IconButton`) controls are actually consumed by any migrated screen today (grep found
  zero usages outside the DS's own tests and `Modal`'s hardcoded `aria-label="Close"` X button), so
  there is no live icon-only-control accessible-name gap to flag in this migration's actual surface.
- Dual-theme bridge (`web/src/bridge/prefers-color-scheme.css` + `light-source.css`) correctly
  re-points every `--theme-*` alias to the DS light value under `prefers-color-scheme: light` with
  `var()`-only references (no raw hex), matching REQ-F001-052/REQ-F001-023 path (iii); spot-checked
  contrast pairs (`--theme-text-primary`/`-secondary` on `--theme-bg-primary`/`-secondary`, danger/
  success badge text on their badge backgrounds) pass AA (≥6:1) in both dark and light, in both the
  `[data-theme]`-attribute path and the OS-`prefers-color-scheme` bridge path.
- Both adherence gates (oxlint REQ-F001-044, stylelint REQ-F001-047) pass with zero violations,
  confirming no raw hex/px/off-system-font literal reintroduced by the migration.

---

## Verdict

**BLOCK.**

Two genuine, high-traffic keyboard-operability regressions (SidebarItem = all primary navigation,
Toggle = every boolean Settings control) mean a keyboard-only or switch-access operator cannot complete
core tasks (change views; flip any setting) after this migration — this fails REQ-F001-030's hard,
non-negotiable "no regression from today" floor regardless of AA's non-gating status. These two fixes
are small and localized (add `tabIndex`/`onKeyDown` to two DS component files) and should land before
this branch merges. The list→table header omissions (MAJOR) and the Input/Select error-association gap
(MAJOR) are also worth fixing pre-merge — none of them requires new design, only bringing the DS
components in line with the pattern already used correctly elsewhere in the same migration (compare
`Table` usages in `UserList`/`InviteList`; compare `Input`'s existing `aria-invalid` wiring). The Modal
focus-trap/Escape gap is real but is confirmed non-regressing (the pre-migration dialog had the same
gap) and is reported as AA guidance per the spec's non-gating ruling, not a blocker.
