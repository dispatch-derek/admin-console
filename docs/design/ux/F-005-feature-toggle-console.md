# F-005 Per-Customer Feature Toggle Console — UX Design

**Rev 2 (2026-07-12)** — records the human rulings on this doc's four design open questions
(OQ-1..OQ-4, all RATIFIED 2026-07-12) and aligns the design to them. Changes from rev 1:
(OQ-1) the design-system `Toggle` is **extended in F-005's implementation scope** to bind its label
programmatically, and the row now assumes a properly-named switch — no row-level workaround;
(OQ-2) the per-row "Reset to default" action is confirmed and kept as designed;
(OQ-3) effective-state-unchanged resets confirm through the same dialog with explicit
"no change to customer-visible state" copy — never silent, never hidden;
(OQ-4) **against this doc's rev-1 recommendation**, the confirm copy now **asserts immediate effect**
in the customer-facing app (a recorded forward constraint on the future customer app — being pinned
in the spec as a new REQ). No other design changes.

Spec (authoritative): `specs/F-005-per-customer-feature-toggle-console.md` (Draft rev 3, all OQs
REQ-F005-043..052 RATIFIED at their recommended defaults; adopted defaults are requirements).
Architect contract: `docs/design/08-F005-feature-toggle-console.md` (§1.2 web files, §4.1 service,
§7.1 product types). App conventions: `docs/design/05-web-architecture.md`; design-system contracts
`docs/design/F-001/01-component-contracts.md`.

Design references bundle (`docs/design/ux/references/`): **none present** — designed from spec +
existing app idioms.

This surface is the **second** entry under the already-existing "Customer-wide" sidebar section
(the first being F-002 Baseline Prompt, `App.tsx` `NAV`). It reuses the established shell
(`ac-app-main` + `PageHeader` via `ac-page-header` + `ac-page-body`), the design-system `Toggle`
(`role="switch"`), `Badge`, `Button`, `Modal`, and the shared `ErrorBanner`. It introduces **no new
design tokens** and only feature-scoped plain-CSS classes in `web/src/index.css` (the app's
detected feature-styling idiom; design-system internals use CSS-modules + tokens, feature surfaces
use `.ac-*`/plain classes referencing `--theme-*`/`--space-*`/`--fs-*`/`--radius-*`).

**Scope discipline (simplicity tradeoffs chosen).** The spec defines a flat roster of catalog
features, immediate per-toggle apply (REQ-F005-022), a lightweight non-typed confirm (REQ-F005-034/
047), a first-class empty state (REQ-F005-024), and hidden orphans (REQ-F005-025). I therefore do
**not** add: category **grouping/sections** (`category` is optional metadata, no spec requirement to
group — rendered as a subtle per-row tag only), a batched multi-toggle "save," a "retired features"
view (REQ-F005-049 defers it), search/filter, pagination (perf N ≤ 500 loads whole, REQ-F005-040),
or the parent §8 `DangerConfirm` typed-token gate (explicitly reserved for irreversible ops;
a toggle is reversible, REQ-F005-047). Those are deliberate omissions matched to the feature's
actual scale, not gaps.

---

## 1. User flows (textual, one per journey)

**F1 — View the roster (REQ-F005-019/020/027/036).** Operator opens *Feature Toggles* from the
"Customer-wide" sidebar section → a loading affordance shows while `GET /api/feature-toggles` is in
flight → the surface renders the **customer/install label** ("Acting on: …", REQ-F005-027), a
**counts summary** ("N enabled · M disabled · T total", effective-state based REQ-F005-019), and one
row per catalog feature with its effective on/off state and provenance (operator-set vs default,
REQ-F005-020). Orphan overrides never appear (REQ-F005-025).

**F2 — Enable / disable a feature (REQ-F005-021/022/034/035/042).** Operator activates a row's
`Toggle` (click or keyboard) → a **lightweight confirm dialog** opens (focus moves in), naming the
feature and the customer/install and stating the capability will become **immediately available /
withheld** in that customer's app (REQ-F005-034; immediate-effect wording per OQ-4) → on *Confirm*,
the client `PUT`s the **percent-encoded**
`featureKey` (REQ-F005-028); the row shows a "Saving…" pending affordance with its switch disabled →
on success the row reflects the new effective state + provenance and the change is announced in an
ARIA live region (REQ-F005-042); focus returns to the switch → on failure the dialog stays open with
the BFF `{ message }` verbatim in an `ErrorBanner` and the row is left at its **prior** state (no
stranded optimistic "saved," REQ-F005-035). *Cancel* leaves the prior state and returns focus.

**F3 — Reset a feature to its declared default (REQ-F005-023/020).** For an **operator-set** row
(`hasOverride:true`) a *Reset to default* action is offered → the same lightweight confirm opens,
stating the resulting effective state → on confirm the client `DELETE`s the override; the row reverts
to `hasOverride:false` and the catalog default effective state. (Surfacing the override-clear route
in the UI is flagged as **OQ-2** — §8 does not explicitly require it.)

**F4 — Empty catalog (today's expected reality) (REQ-F005-024/036).** With zero declared features,
the surface loads successfully and renders the first-class **empty state** ("No features are defined
for this install yet"), still showing the customer label — never an error banner, never a blank
panel.

---

## 2. Screen / view inventory

One view, one route (in-app `View` switch — no router library, matching `App.tsx`). Regions stack
vertically inside the standard `ac-page-body`.

| Region | Purpose (one sentence) | Spec |
|---|---|---|
| Customer/install label | Names which customer a change binds to, so the operator knows whom they are acting on. | REQ-F005-027 |
| Counts summary | At-a-glance effective-state tally (enabled / disabled / total) over the rendered features. | REQ-F005-019 |
| Feature roster | One row per catalog feature: `Toggle`, display name/description, effective state, provenance, override meta, reset action. | REQ-F005-019/020/032/033 |
| Empty state | First-class "no features declared yet" panel replacing the roster when the catalog is empty. | REQ-F005-024/036 |
| Confirm dialog | Lightweight (non-typed) consequence-framed confirmation for each set/clear. | REQ-F005-034/042/047 |

---

## 3. Layout & responsive strategy

Reuses the shell exactly: dark sidebar + single scrolling `.ac-app-main`, content in `.ac-page-body`.
The regions stack in one column at every breakpoint — this is a settings roster, not a list/detail
split, so single-column is the correct simpler choice (mirrors F-002's decision).

**Navigation entry (REQ-F005-031).** Add a `featureToggles` member to `App.tsx`'s `View` union, a
`{ id: 'featureToggles', label: 'Feature Toggles' }` item **into the existing "Customer-wide"
`NAV` section** (alongside `baseline`), a `PAGE_META` entry, and a render branch
`{view === 'featureToggles' && <FeatureTogglesPage />}`. This satisfies "reachable from top-level
navigation, not workspace-bound" with the smallest change — the section already exists.

**Breakpoints** (mobile-first; the app has no formal breakpoint tokens — reuse the single **40rem**
value F-002 already introduced in feature CSS, for consistency):

| Width | Behavior |
|---|---|
| Base (< 40rem) | Single column. Each feature row **stacks**: display name + description + provenance on top, the `Toggle` + On/Off label + reset action below, so nothing is cramped or needs horizontal scroll. Counts summary wraps. |
| ≥ 40rem | Each row is a two-column flex (`space-between`): name/description/provenance on the left, `Toggle` + state label + reset on the right — the same shape as the design-system `Toggle` `variant="horizontal"`. |
| ≥ 56rem | Content sits within the existing `.ac-page-body` width; no further change. |

Reading/DOM order within the view is: customer label → counts → roster (→ empty state) — the mobile
order is the source order (no reordering needed). Touch targets: the `Toggle` and buttons follow the
existing design-system sizing; the roster row's tap area for the switch is the `Toggle` control
itself (verify ≥ 44px at implementation — flagged for the a11y audit).

**Roster as a list, not a data table (key decision).** Rows are rendered as a semantic list
(`<ul>`/`<li>` with an accessible group label), **not** the design-system `Table`. Rationale: each
row is an interactive switch plus a multi-line description and provenance — a settings-row idiom, not
tabular data; the `Table`'s `minWidth:640` horizontal-scroll model fights the stacked mobile layout.
Alternative (design-system `Table`, as F-002's drift list used) considered and rejected as the wrong
shape for interactive toggle rows.

---

## 4. Component inventory

### 4.1 Reused as-is (no changes)

- **`Toggle`** (design-system, `role="switch"` + `aria-checked`, `onChange(next:boolean)`,
  keyboard-operable via Space/Enter) — the per-feature control (REQ-F005-032). Controlled by the
  row's effective `enabled`; see §5 for why it is **not** flipped optimistically. **Extended in
  F-005's implementation scope (OQ-1 ruling):** the design-system `Toggle` is amended so its `label`
  is programmatically bound to the switch element (`aria-labelledby` or equivalent), and the F-001
  component contract is updated accordingly. This is a small DS enhancement owned by this feature's
  implementation; the row below therefore relies on the DS to name the switch and adds no row-level
  labelling workaround.
- **`Badge`** (design-system, `tone` ∈ info/success/warn/danger/neutral) — the provenance chip
  (Default vs Operator-set), carrying a glyph **and** text so it is non-color-only (REQ-F005-033).
- **`Modal`** (design-system) — the chrome for `ToggleConfirm` (see §4.2 for the focus wrapper).
- **`Button`** (design-system) — confirm/cancel/reset actions.
- **`ErrorBanner`** (`components/ErrorBanner.tsx`) — verbatim BFF `{ message }` on load/write
  failure (parent REQ-097a, REQ-F005-035).
- **`PageHeader`** — already rendered by the shell from `PAGE_META['featureToggles']`.

The parent `DangerConfirm` is **deliberately not reused** — this feature's gate is lightweight and
non-typed (REQ-F005-034/047); `DangerConfirm`'s typed-token/acknowledge gate is for irreversible ops.

### 4.2 New components (`web/src/features/feature-toggles/`)

Matches the architect's §1.2 file list. Product types mirrored into `api/types.ts` from
`product-types.ts` §7.1 (web needs `FeatureToggle` + `FeatureToggleListView`; the catalog-entry type
is BFF-only). New API-client functions `getFeatureToggles`, `putFeatureToggle`,
`clearFeatureToggleOverride` — the last two **percent-encode** the `featureKey` path segment
(`encodeURIComponent`, REQ-F005-028), matching the existing `encodeURIComponent(id)` idiom in
`api/client.ts`.

**Also in F-005's implementation scope (OQ-1 ruling):** a small design-system change to `Toggle`
(and its F-001 contract) so the switch element carries a programmatic accessible name derived from
its `label`. This is the one edit outside `web/src/features/feature-toggles/`; it is a shared DS fix
that also benefits every other `Toggle` consumer.

```ts
// api/types.ts (mirrored §7.1) — used by the components below
export interface FeatureToggle {
  featureKey: string;
  displayName: string;
  description: string | null;
  category: string | null;
  defaultEnabled: boolean;
  enabled: boolean;          // effective state (override ?? default, REQ-F005-017)
  hasOverride: boolean;      // explicit operator override exists (REQ-F005-020)
  updatedAt: string | null;  // ISO-8601 of override write; null if none
  updatedBy: string | null;  // staff id of override write; null if none
}
export interface FeatureToggleListView {
  customerLabel: string;
  features: FeatureToggle[];
  counts: { enabled: number; disabled: number; total: number };
}
```

**`FeatureTogglesPage`** — stateful shell; owns all data + flow state. Presentational children
receive data + callbacks.

```ts
export function FeatureTogglesPage(): JSX.Element;
// No props. Owns:
//   listView: FeatureToggleListView | null      (GET /api/feature-toggles)
//   loading: boolean; loadError: string | null
//   pending: ToggleConfirmAction | null          (which set/clear is awaiting confirm; null = closed)
//   writing: boolean; writeError: string | null  (in-flight write + verbatim failure message)
//   announcement: string                          (ARIA live-region text, REQ-F005-042)
// Renders customer label + counts + roster (or EmptyFeaturesState), and the ToggleConfirm dialog
// when pending != null. On confirm: call client with the percent-encoded key; on success refetch
// (or patch the row from the returned FeatureToggle) + announce; on failure keep the dialog open
// with writeError and leave the row at its prior state (REQ-F005-035).
```

**`FeatureToggleRow`** — presentational; one feature row.

```ts
export interface FeatureToggleRowProps {
  feature: FeatureToggle;
  busy: boolean;                          // this row's write is in flight → switch disabled, "Saving…"
  disabled: boolean;                      // a confirm/write for another row is active (single-flight)
  onRequestChange: (next: boolean) => void;  // Toggle.onChange → opens the set confirm
  onRequestReset: () => void;                // "Reset to default" (rendered only when hasOverride)
}
// Renders design-system <Toggle enabled={feature.enabled} label={feature.displayName}
//   description={feature.description ?? undefined} disabled={busy || disabled} onChange={onRequestChange}/>,
// a text On/Off state label (non-color-only, REQ-F005-033), a provenance <Badge> (glyph+text:
// "● Operator-set" info tone / "○ Default" neutral tone, REQ-F005-020/033), the optional category as
// a subtle tag, "Set by {updatedBy} · {updatedAt}" meta when hasOverride, and (hasOverride only) a
// ghost "Reset to default" Button. The switch's accessible name comes from the DS Toggle's
// programmatic label binding (OQ-1 ruling); the row passes label={displayName} and adds no workaround.
```

**`ToggleConfirm`** — lightweight, non-typed confirmation dialog with focus management. Discriminated
by action (natural discriminated union).

```ts
export type ToggleConfirmAction =
  | { kind: 'set';   featureKey: string; displayName: string; nextEnabled: boolean }
  | { kind: 'reset'; featureKey: string; displayName: string; resultEnabled: boolean };

export interface ToggleConfirmProps {
  action: ToggleConfirmAction;
  customerLabel: string;      // named in the consequence copy (REQ-F005-034)
  busy: boolean;              // write in flight → Confirm disabled
  error: string | null;       // verbatim BFF { message } on failed write, in-dialog (REQ-F005-035)
  onConfirm: () => void;
  onCancel: () => void;
}
// Wraps the design-system <Modal>; footer = ghost Cancel + PRIMARY (not danger) Confirm.
// Copy names the feature + customerLabel and ASSERTS IMMEDIATE EFFECT (OQ-4 ruling), e.g.
//   set→enable:  "‹displayName› will be IMMEDIATELY AVAILABLE in ‹customerLabel›'s app."
//   set→disable: "‹displayName› will be IMMEDIATELY WITHHELD from ‹customerLabel›'s app."
//   reset (effective change):    states the resulting immediate available/withheld effect.
//   reset (effective UNCHANGED): "This clears the operator override; there is NO CHANGE to
//                                 customer-visible state." (OQ-3 ruling — always shown, never silent.)
// This immediate-effect wording is a recorded FORWARD CONSTRAINT: the future customer-facing app
// MUST consume toggle state near-real-time (being pinned in the spec as a new REQ). Focus: moves into
// the dialog on open, returns to the triggering control on any close (mirrors the focus wrapper
// DangerConfirm already implements over the un-managed DS Modal, REQ-F005-042).
```

**`EmptyFeaturesState`** — presentational, no props. First-class empty panel ("No features are
defined for this install yet"), `role="status"`, not an error (REQ-F005-024/036).

```ts
export function EmptyFeaturesState(): JSX.Element;
```

### 4.3 Component boundaries (React realities)

- **All state lifted into `FeatureTogglesPage`** (listView, loading/error, the single `pending`
  confirm action, `writing`/`writeError`, the live-region string). Rationale: only one confirm/write
  is in flight at a time (single-flight, immediate-apply REQ-F005-022); holding `pending` and
  `writing` in the page makes focus-return targeting and the "disable other rows" behavior
  unambiguous — the same reasoning F-002 used to keep `confirmOpen` in the page rather than the child.
- **Presentational:** `FeatureToggleRow`, `EmptyFeaturesState`. **Stateful-but-local:** none beyond
  the page — `ToggleConfirm` holds no business state (its focus refs are local mechanics only).
- **No React context** — the tree is shallow and single-consumer; context would be over-engineering
  (composition beats configuration here).
- **Confirmed-only, never optimistic:** the `Toggle` is a controlled input bound to `feature.enabled`
  and is **not** flipped until the write succeeds and data refreshes. Because a confirm dialog already
  interrupts every flip, optimistic UI buys nothing and would risk exactly the "stranded optimistic
  saved" state REQ-F005-035 forbids. In-flight, the row shows "Saving…" with the switch disabled;
  the value only changes on confirmed success.

---

## 5. Interaction states

**Global page states.**
- **loading:** `GET` in flight → "Loading…" affordance (existing idiom); customer label may render as
  soon as available. Not an error.
- **load error:** page-level `ErrorBanner` verbatim (REQ-097a).
- **empty:** `features.length === 0` → `EmptyFeaturesState` (REQ-F005-024/036); customer label +
  a "0 enabled · 0 disabled · 0 total" counts line still render; **no** error.
- **loaded:** customer label + counts + roster.

**FeatureToggleRow**
- **default:** `Toggle` reflects effective `enabled`; On/Off text label; provenance Badge; category
  tag (if any); override meta when `hasOverride`.
- **hover/focus:** row/`Toggle` use existing design-system focus-visible outline
  (`--theme-button-primary`); no bespoke hover state needed.
- **busy (this row writing):** `Toggle` disabled, inline "Saving…" text; other rows receive
  `disabled` (single-flight) so a second confirm can't open mid-write.
- **operator-set (`hasOverride:true`):** provenance Badge "● Operator-set" (info tone) + meta +
  "Reset to default" action.
- **default (`hasOverride:false`):** provenance Badge "○ Default" (neutral tone); no reset action;
  no meta.
- **error:** the write's failure is surfaced **in the confirm dialog** (below), not inline on the row;
  the row itself simply stays at its prior confirmed state.

**ToggleConfirm**
- **open:** focus moves in (Confirm or dialog heading); Cancel + Confirm enabled.
- **busy:** Confirm shows in-flight; Cancel remains available.
- **error:** BFF `{ message }` verbatim via `ErrorBanner` **inside** the dialog; dialog stays open so
  the operator can retry or cancel; the row is unchanged (REQ-F005-035).
- **close (cancel / escape / successful confirm):** focus returns to the triggering `Toggle`
  (or, for reset, the reset button); prior state preserved on cancel (REQ-F005-034).

**Success reflection & announcement.** On a confirmed write the page updates the row from the
returned `FeatureToggle` (or refetches the list) and writes a concise string into the `aria-live`
region — e.g. "Feature ‹displayName› enabled for ‹customerLabel›" (REQ-F005-035/042).

**Error-code → surface mapping (spec REQ-F005-030 codes).**
- **400** ("enabled must be true or false" / "malformed feature key") — should not arise from this UI
  (it always sends a boolean and percent-encodes the key), but if returned it renders verbatim in the
  confirm dialog and the row stays put.
- **404** ("unknown feature") — the feature was removed from the catalog between load and write;
  render verbatim in the dialog, and on close **refetch** the list so the now-absent row drops
  (orphan handling is server-side, REQ-F005-025).
- **500** ("could not confirm the change was saved") — store-confirm failure (REQ-F005-021); render
  verbatim in the dialog; row stays at prior state; no event was emitted (REQ-F005-037) — nothing to
  reconcile client-side.
- **401** — the shared client's global unauthorized handler routes to login (existing REQ-012/014
  behavior); no feature-specific handling.

**Which states map to props vs runtime.** The `set | reset` distinction is a **discriminated-union
prop** (`ToggleConfirmAction`). Effective on/off and `hasOverride` provenance are **runtime data**
from the API, not variant props. `busy`/`writing`/`writeError` are runtime flow state in the page.

---

## 6. Design tokens

**No new tokens.** The existing design-system token set covers every state. Mapping:

| Use | Existing token / component |
|---|---|
| Provenance "Operator-set" chip | design-system `Badge tone="info"` (`--theme-badge-info-*`) + "●" glyph + text |
| Provenance "Default" chip | design-system `Badge tone="neutral"` (`--theme-bg-secondary` / `--theme-text-secondary`) + "○" glyph + text |
| On/Off state text label | `--theme-text-primary` (on) / `--theme-text-secondary` (off) — text, not color-only |
| Toggle track on/off | design-system `Toggle` internal tokens (`--theme-badge-success-text` on / `--theme-placeholder` off) |
| Customer label region | `--theme-bg-secondary` panel + `--border-hairline` (reuse the `.baseline-region` idiom) |
| Counts summary | `--theme-text-secondary`, `<strong>` for numerals (mirrors F-002 `.baseline-counts`) |
| Error surfaces | shared `.ac-error-banner` (`--theme-badge-danger-*`) |
| Empty state panel | `--theme-bg-secondary` + `--theme-text-secondary` |

New CSS classes are **behavioral only** (no new tokens), added to `web/src/index.css` following the
existing sectioned-comment plain-CSS idiom: `.feature-toggles-page`, `.feature-customer-label`,
`.feature-counts`, `.feature-roster`, `.feature-toggle-row`, `.feature-row-meta`,
`.feature-empty`. Type scale, spacing, radii, and button styles are inherited from tokens/DS. The
provenance chip is intentionally the design-system `Badge` (reuse-first) rather than a bespoke
`.sync-chip`-style class, so no chip CSS is duplicated.

---

## 7. Accessibility notes (WCAG 2.1 AA design inputs)

- **Non-color-only encoding (REQ-F005-033):** effective on/off is conveyed by the switch position
  **and** an explicit "On"/"Off" text label; provenance is a `Badge` carrying a glyph **and** the
  words "Operator-set" / "Default" (glyph `aria-hidden`, text is the accessible content). Both remain
  distinguishable in grayscale / color-blind simulation.
- **Switch keyboard operation & accessible name (REQ-F005-032/042):** the design-system `Toggle` is
  Space/Enter operable and exposes `role="switch"` + `aria-checked`; the roster is fully
  keyboard-navigable and a feature can be flipped and confirmed keyboard-only. Per the OQ-1 ruling the
  `Toggle` is extended (in F-005's implementation scope, with a matching F-001 contract update) to bind
  its `label` programmatically as the switch's accessible name, so each switch announces its
  `displayName` — no row-level labelling workaround is used.
- **Focus management (REQ-F005-042):** `ToggleConfirm` moves focus into the dialog on open and returns
  it to the triggering control on any close — implemented via the same external focus-wrapper pattern
  `DangerConfirm` already applies over the un-managed design-system `Modal` (which has no built-in
  focus trap). Escape cancels; Tab is trapped within the dialog.
- **Live-region announcement (REQ-F005-042):** an `aria-live="polite"` region on the page announces
  each confirmed set/clear result so screen-reader users get the outcome without inspecting the row.
- **Landmarks/structure:** the surface sits in the existing `<main class="ac-app-main">`; the roster
  is a labelled list (`<ul aria-label="Declared features">` / `<li>`), each row a labelled group; the
  empty state is `role="status"`.
- **Contrast:** all colors use tokens already shipped in both themes; the two to verify at
  implementation are the neutral "Default" badge (secondary text on secondary bg) and the "Off" state
  label (secondary text) against 4.5:1 — flagged for the independent a11y audit; this doc does not
  certify built contrast.
- **Reduced motion:** the only motion is the `Toggle`'s 0.2s track/knob transition (design-system);
  no new essential animation is introduced.

Note: the accessibility-reviewer audits the **built** UI independently; the above are design inputs,
not a pass judgment.

---

## 8. Key decisions (alternatives considered → why rejected)

- **Lightweight non-typed confirm, not `DangerConfirm`.** A toggle is highly reversible
  (REQ-F005-047); the typed-token/acknowledge gate is reserved for irreversible ops. Rejected reusing
  `DangerConfirm` because forcing a typed token would over-gate a reversible change and contradict
  REQ-F005-034's "lightweight" ruling. The confirm still names feature + customer and frames the
  consequence.
- **Confirmed-only (pessimistic) toggle, not optimistic.** Rejected optimistic flip because a confirm
  dialog already interrupts every change (so optimism saves no perceived latency) and an optimistic
  flip is exactly the "stranded as saved on failure" state REQ-F005-035 forbids.
- **Flat roster, not category sections.** `category` is optional catalog metadata with no spec
  requirement to group (REQ-F005-016); rendered as a per-row tag. Grouping is a spec-neutral future
  enhancement, omitted to match current scale.
- **Semantic list, not the design-system `Table`.** Interactive switch rows with descriptions are a
  settings-row idiom; the `Table`'s fixed `minWidth` scroll model fights the stacked mobile layout.
- **Reuse the existing "Customer-wide" sidebar section**, not a new section — F-002 already created
  it; F-005 is a natural second above-workspaces surface (REQ-F005-031).
- **Surface override-clear as a per-row "Reset to default" action.** The `DELETE` route
  (REQ-F005-023) and visible provenance (REQ-F005-020) imply an operator can revert; the design
  exposes it on operator-set rows. **RATIFIED (OQ-2):** keep the action as designed.
- **Confirm copy asserts immediate effect (OQ-4 ruling, against this doc's rev-1 recommendation).**
  Rev 1 recommended neutral, decision-only wording that avoided promising runtime timing (deferring to
  REQ-F005-009). The human ruling reversed this: the confirm MUST state the capability becomes
  **immediately available/withheld** in the customer-facing app. This records a **forward constraint**
  — the future customer app must consume toggle state near-real-time — being pinned in the spec as a
  new REQ. The design copy is updated accordingly (§1 F2, §4.2 `ToggleConfirm`).
- **Effective-state-unchanged reset still confirms (OQ-3 ruling).** A "Reset to default" whose result
  equals the current effective state routes through the same dialog with explicit "no change to
  customer-visible state" copy — never applied silently, never hidden.

---

## 9. Traceability (surface ↔ spec)

| Requirement | Where satisfied |
|---|---|
| REQ-F005-019 | Counts summary + roster (effective-state counts over rendered features) |
| REQ-F005-020 | Provenance Badge (Operator-set vs Default) + override meta |
| REQ-F005-022 | Immediate per-toggle apply; no batched save |
| REQ-F005-023 | "Reset to default" action → `DELETE .../override` (OQ-2) |
| REQ-F005-024/036 | `EmptyFeaturesState`; loading affordance; neither is an error |
| REQ-F005-025 | Orphans excluded server-side; UI renders only `features[]` |
| REQ-F005-027 | Customer/install label region (from `listView.customerLabel`) |
| REQ-F005-028 | Client percent-encodes the `featureKey` path segment |
| REQ-F005-031 | New nav item under existing "Customer-wide" section; not workspace-bound |
| REQ-F005-032 | `FeatureToggleRow` renders the design-system `Toggle` (`role="switch"`) |
| REQ-F005-033 | On/Off text label + glyph+text provenance chip (non-color-only) |
| REQ-F005-034/047 | `ToggleConfirm` lightweight non-typed confirm naming feature + customer |
| REQ-F005-035 | Success reflects new state; failure = verbatim `ErrorBanner`, prior state kept |
| REQ-F005-042 | Focus in/out of dialog; `aria-live` announcement; keyboard-operable switch |
| REQ-097a / REQ-012/014 | `ErrorBanner` verbatim; 401 → existing global auth handler |

---

## 10. Open questions for the spec owner

**Status: ALL RESOLVED — human ruling (2026-07-12).** All four design open questions were ratified;
the design body above (rev 2) is aligned to these rulings. Retained here for traceability.

- **OQ-1 — design-system `Toggle` accessible name.** The recreated design-system `Toggle` renders
  `role="switch"` but does **not** programmatically bind its `label` to the switch element (no
  `aria-labelledby`/`aria-label` — the label is a visual sibling span), so a screen reader announces
  an **unnamed switch**, failing REQ-F005-032/042's "labeled with the feature `displayName`."
  **RESOLVED → extend the DS `Toggle`.** The `Toggle` (and its F-001 component contract) is amended so
  the switch carries a programmatic accessible name from its `label`; this DS change is **in F-005's
  implementation scope**. The row assumes a properly-named switch — no row-level workaround. (Benefits
  every `Toggle` consumer.) Reflected in §4.1, §4.2 (`FeatureToggleRow`), and §7.
- **OQ-2 — is a UI override-clear affordance required?** §8 (REQ-F005-031..036) does not name a
  control to clear an override / revert to default, yet §6.2 REQ-F005-023 defines the `DELETE .../
  override` route and REQ-F005-020 makes provenance visible. **RESOLVED → keep the per-row "Reset to
  default" action as designed** for operator-set rows (§1 F3, §4.2, §8).
- **OQ-3 — confirm an effective-state-unchanged reset?** A "Reset to default" on an override whose
  value **equals** the default produces **no** effective change (REQ-F005-037) yet still writes/audits.
  **RESOLVED → route it through the same confirm with explicit "no change to customer-visible state"
  copy — never silent, never hidden** (§4.2 `ToggleConfirm`, §8).
- **OQ-4 — consequence copy vs runtime timing.** Rev 1 recommended neutral, decision-only wording that
  avoided asserting runtime timing (deferring to REQ-F005-009). **RESOLVED → AGAINST that
  recommendation:** the confirm copy **MUST assert immediate effect** ("will be immediately
  available/withheld in the customer-facing app"). This records a **forward constraint** — the future
  customer app must consume toggles near-real-time — **being pinned in the spec as a new REQ**.
  Reflected in §1 F2 and §4.2 `ToggleConfirm`.
