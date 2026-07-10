# F-002 Customer-Wide Baseline System Prompt — UX Design

Spec (authoritative): `specs/F-002-customer-system-prompt.md` (Draft rev 9, final), §8 Web UI
Requirements. Architect contract: `docs/design/07-F002-baseline-prompt.md` (§1.2 web files, §4.1
product types). App conventions: `docs/design/05-web-architecture.md`.

Design references bundle (`docs/design/ux/references/`): **none present** — designed from spec +
existing idioms.

This surface is the app's **first above-workspaces (non-workspace-scoped) settings home**
(REQ-F002-029). It reuses the established shell (`App.tsx` sidebar + `page-header` + `page-body`),
`DangerConfirm`, `ErrorBanner`, `FieldValidation`/`aria-invalid`, `entity-table`, and the
`modal-overlay` dialog idiom verbatim. Only two genuinely new visual patterns are introduced (a
non-color sync-state chip and a current-vs-composed diff block); both are justified below because
nothing existing serves them.

**Scope discipline.** The spec provides exactly one operator per apply, a derived (never
hand-picked) target set (REQ-F002-052), a synchronous single-request apply (REQ-F002-058), and no
pagination (REQ-F002-039). I do **not** add workspace multi-select, per-workspace apply buttons,
progress bars, wizards, or a separate "re-sync" screen — re-sync is the same preview→apply flow run
again (REQ-F002-027), so it is the same UI, not a new one. That simplicity is a deliberate tradeoff
matched to a ≤200-workspace single-tenant feature.

---

## 1. User flows (textual, one per journey)

**F1 — Define / replace the baseline (REQ-F002-015/016/018).** Operator opens *Baseline Prompt*
from the sidebar → sees the always-present native-default advisory (REQ-F002-060) → sees current
baseline text + `updatedAt`/`updatedBy` (or "Not yet defined") in the editor → edits the textarea →
Save. Client rejects whitespace-only before send (REQ-F002-018); on success the editor shows the
new metadata and a transient "Saved." No workspace prompt changes yet (REQ-F002-016).

**F2 — Clear the baseline (REQ-F002-046).** In the editor, operator clicks *Clear baseline* → a
lightweight confirm (this is NOT a §8 danger op — it writes no engine state, REQ-F002-017/046) →
baseline set to null; status list will now show previously-synced workspaces as `stale`. Copy tells
the operator the strip only happens on the next apply (REQ-F002-046/053).

**F3 — Review drift (REQ-F002-024/023/026).** Operator reads the status list: every live workspace
with its sync state (`synced` / `stale` / `overridden` / `never-applied`), each encoded by
text + icon + color (never color alone, REQ-F002-033). Newly created workspaces appear as
`never-applied` (REQ-F002-026). This view is a bare read — no `mode`, no token minted.

**F4 — Preview → confirm → apply (REQ-F002-030/031/032/019/034).**
1. Operator picks an apply **mode** (prepend default / overwrite / fill) (REQ-F002-055).
2. Operator clicks *Preview changes* → `GET /preview?mode=` runs, mints the `confirmToken`, returns
   per-workspace diffs + affected/unchanged counts (REQ-F002-019/020). Until this resolves, the
   *Apply* control is inert (REQ-F002-030).
3. Preview panel lists each affected workspace's current-vs-composed diff. For a `prepend`-resolved
   **overridden** workspace, a **preserve / discard** choice is shown inline (REQ-F002-025/050);
   `baseline-only`/`inherit`-resolved and non-overridden workspaces show **no** such control
   (REQ-F002-050/059 exemption).
4. Operator clicks *Apply baseline* → the `DangerConfirm` dialog opens (focus moves in,
   REQ-F002-034), naming the destructive blast radius (REQ-F002-031) and requiring the operator to
   type the server-issued `confirmationPhrase` (REQ-F002-048).
5. On confirm, `POST /apply` fires once (synchronous, REQ-F002-058). Focus returns to the trigger;
   the per-workspace outcome list renders and is announced via an ARIA live region (REQ-F002-034),
   never a single "all saved" banner on partial failure (REQ-F002-032/022a).

**F5 — Re-sync after a baseline change (REQ-F002-027).** Identical to F4 — after editing the
baseline (F1), previously-synced workspaces read `stale`; the operator runs the same preview→apply.
No separate screen.

---

## 2. Screen / view inventory

One view, four stacked regions inside the standard `page-body`. Single route; no sub-routing.

| Region | Purpose (one sentence) | Spec |
|---|---|---|
| Native-default advisory | Persistent, always-rendered callout that the native instance-level Default System Prompt is a separate, console-unreachable setting the baseline does not account for. | REQ-F002-060 |
| Baseline editor | View/define/replace/clear the single baseline text with trimmed non-empty validation and last-edited metadata. | REQ-F002-015/016/018/046 |
| Drift/status list | At-a-glance per-workspace sync state across all live workspaces, non-color-only. | REQ-F002-024/023/026/033 |
| Preview → apply | Mode selector, mandatory pre-write preview/diff, per-override resolution, danger-gated apply, per-workspace outcome result. | REQ-F002-019/030/031/032/034/055 |

---

## 3. Layout & responsive strategy

Reuses the shell exactly: dark sidebar + single scrolling `.app-main`, content capped by the
existing `.page-body { max-width: 56rem }`. The four regions stack vertically (single column) at all
breakpoints — this is a settings surface, not a list/detail split like Workspaces, so a one-column
flow is the correct, simpler choice.

**Navigation entry (REQ-F002-029).** Add a new top-level sidebar section so the surface is reachable
and visibly *not* workspace-bound. Proposed: a **"Baseline Prompt"** item under a new
**"Customer-wide"** section in `App.tsx`'s `NAV` (placed above "Admin"). Add the matching `View`
union member, `PAGE_META` entry, and render branch. This is the smallest change that satisfies
"reachable from top-level navigation and not bound to a single workspace."

**Breakpoints** (mobile-first; the app has no formal breakpoint tokens today — I introduce two
minimal ones scoped to this feature's CSS, matching the existing hand-rolled responsive style):

| Width | Behavior |
|---|---|
| Base (< 40rem) | Single column. Status list renders as **stacked cards** (label/value pairs), not a wide table, so it stays legible without horizontal scroll. Diff shows current and composed **stacked** (before above after). Mode selector is a full-width segmented radio group. |
| ≥ 40rem | Status list becomes the `.entity-table` (workspace name, state chip, remainder indicator columns). Diff shows current and composed **side-by-side** two-column. |
| ≥ 56rem | Content hits the `page-body` max-width cap; no further change. |

Mobile-first ordering within the view is the reading order: advisory → editor → status → preview
→ apply. Touch targets on the mode radios, preserve/discard controls, and buttons follow the
existing ≥ `0.45rem 0.9rem` button padding (meets 44px with line-height); verify at implementation.

---

## 4. Component inventory

### 4.1 Reused as-is (no changes)

- `DangerConfirm` (`components/DangerConfirm.tsx`) — the apply gate. Its `expectedToken` typed-token
  mode is exactly the two-artifact pattern: `expectedToken={confirmationPhrase}` (the server-issued
  human phrase the operator types → submitted as `typedConfirmation`), while the opaque
  `confirmToken` is held in component state and never shown (REQ-F002-031/048). `children` carries
  the destructive blast-radius summary. Mirrors `MaskedDiffConfirm`'s composition of DangerConfirm.
- `ErrorBanner` — verbatim BFF `{ message }` for load/preview/apply/save failures (REQ-097a).
- `entity-table`, `modal-overlay`/`modal`, `.field`, `.field-error`, `.badge*`, `.danger-button`,
  `.primary-button`, `.success`, `.warning` classes — reused from `index.css`.
- `validation.ts` idiom — trimmed/non-empty check for the baseline textarea (REQ-F002-018), same
  `aria-invalid` + `.field-error` pattern as `WorkspaceSettings`.

### 4.2 New components (`web/src/features/baseline-prompt/`)

Matches the architect's §1.2 file list. Product types imported from `api/types.ts` (mirroring
`product-types.ts` §7.1). All props below reference those exact types.

```ts
// api/types.ts (mirrored from product-types.ts §7.1) — used by the components below
type BaselineSyncState = 'synced' | 'stale' | 'overridden' | 'never-applied';
type OperatorMode = 'prepend' | 'overwrite' | 'fill';
type OverrideResolution = 'preserve' | 'discard';
type BaselineApplyOutcome = 'applied' | 'failed' | 'skipped' | 'diverged';
// BaselinePrompt, BaselineWorkspaceStatus, BaselineStatusView, BaselinePreviewItem,
// BaselinePreview, BaselineApplyResultItem, BaselineApplyResult per §7.1 verbatim.
```

**`BaselinePromptPage`** — stateful shell; owns the top-level fetches and the flow state machine.
Presentational children receive data + callbacks.

```ts
export function BaselinePromptPage(): JSX.Element;
// No props. Owns:
//   baseline: BaselinePrompt | null           (GET /api/baseline-prompt)
//   status: BaselineStatusView | null          (GET /status)
//   preview: BaselinePreview | null            (GET /preview?mode=) — null until previewed
//   mode: OperatorMode                          (default 'prepend', REQ-F002-055)
//   overrides: Record<workspaceId, OverrideResolution>
//   confirmOpen: boolean; result: BaselineApplyResult | null
//   load/preview/apply error strings (verbatim)
// Renders the persistent advisory (REQ-F002-060) UNCONDITIONALLY at top.
```

**`NativeDefaultAdvisory`** — presentational, always rendered (REQ-F002-060).

```ts
export function NativeDefaultAdvisory(): JSX.Element;
// No props, no dismiss control, no state. Static informational callout (role="note").
// Renders whenever the surface renders (not a toast, not dismissible) — the exemption-proof
// against REQ-F002-060's "persistent whenever shown" test.
```

**`BaselineEditor`** — labeled textarea + define/replace/clear (REQ-F002-015/016/018/046).

```ts
export interface BaselineEditorProps {
  baseline: BaselinePrompt;               // text|null + updatedAt|null + updatedBy|null
  busy: boolean;
  onSave: (text: string) => Promise<void>;   // PUT (trimmed, non-empty; whitespace blocked client-side)
  onClear: () => Promise<void>;              // DELETE (REQ-F002-046); confirmed but NOT §8-danger
  saveError: string | null;
}
// Presentational + local draft state only. Mirrors the WorkspaceSettings systemPrompt <textarea>
// idiom. "Clear baseline" is a link-button that opens a lightweight confirm (native-style), NOT
// DangerConfirm — clearing writes no engine state (REQ-F002-017). Shows updatedAt/updatedBy or
// "Not yet defined" (REQ-F002-015).
```

**`BaselineStatusList`** — drift table (REQ-F002-024/033). Presentational.

```ts
export interface BaselineStatusListProps {
  status: BaselineStatusView;   // workspaces[], counts: Record<BaselineSyncState, number>
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}
// Header shows per-state counts (e.g. "12 synced · 3 stale · 1 overridden · 2 never-applied").
// One row per workspace: displayName, <SyncStateChip>, remainder indicator (hasWorkspaceRemainder).
// entity-table at >=40rem, stacked cards below. Empty state: "No workspaces found."
```

**`SyncStateChip`** — non-color-only state encoding (REQ-F002-033), discriminated by state.

```ts
export interface SyncStateChipProps { state: BaselineSyncState; }
// Renders icon glyph + text label + color class. Text label is always present so grayscale/
// color-blind users read the state (REQ-F002-033). Glyph is decorative (aria-hidden); the text
// is the accessible name. Mapping:
//   synced        ✓  "Synced"        (success token)
//   stale         ↻  "Stale — re-sync needed"  (warning token)
//   overridden    ✎  "Overridden"    (danger token)
//   never-applied ○  "Never applied" (neutral/secondary token)
```

**`BaselinePreviewApply`** — mode selector, preview/diff, per-override choice, danger gate,
result region (REQ-F002-019/030/031/032/034/055). This is the flow's engine; stateful for the
preview/confirm/result sub-states, but delegates the confirm to `DangerConfirm`.

```ts
export interface BaselinePreviewApplyProps {
  mode: OperatorMode;
  onModeChange: (m: OperatorMode) => void;        // changing mode INVALIDATES a loaded preview (REQ-F002-055)
  preview: BaselinePreview | null;                // null until previewed → Apply inert (REQ-F002-030)
  previewing: boolean; previewError: string | null;
  onPreview: () => void;                          // GET /preview?mode=
  overrides: Record<string, OverrideResolution>;  // only for prepend-resolved overridden items (REQ-F002-050)
  onOverrideChange: (workspaceId: string, r: OverrideResolution) => void;
  applying: boolean; applyError: string | null;
  onApply: (typedConfirmation: string) => void;   // POST /apply {confirmToken, typedConfirmation, mode, overrides}
  result: BaselineApplyResult | null;             // per-workspace outcomes (REQ-F002-032)
}
```

**`ModeSelector`** — segmented radio group (`fieldset`/`legend` + radios), `prepend` default.

```ts
export interface ModeSelectorProps {
  value: OperatorMode; onChange: (m: OperatorMode) => void; disabled: boolean;
}
// Three options; 'overwrite' is visibly flagged destructive (danger-colored label + inline
// "destroys per-workspace prompts" hint, REQ-F002-055/056). Radios, not a native <select>, so the
// destructive option's warning is always visible (not hidden in a closed dropdown).
```

**`PreviewDiffItem`** — one workspace's current-vs-composed diff (REQ-F002-019). Discriminated by
`resolvedMode`.

```ts
export interface PreviewDiffItemProps {
  item: BaselinePreviewItem;                      // carries resolvedMode + candidates
  resolution?: OverrideResolution;                // controlled only when the preserve/discard UI applies
  onResolutionChange?: (r: OverrideResolution) => void;
}
// Branches on item.resolvedMode (a discriminated union of behavior, REQ-F002-059):
//   'prepend' + not overridden      → single current-vs-item.composedPrompt diff.
//   'prepend' + overridden          → preserve/discard radio; diff shows the SELECTED candidate
//                                      (composedIfPreserve | composedIfDiscard) (REQ-F002-019/025).
//   'baseline-only'                 → single current-vs-B diff; NO preserve/discard control
//                                      (EXEMPT, REQ-F002-050/059); marked "inherit — content dropped".
//   'overwrite'                     → current-vs-B diff with an explicit DESTROY marker on `current`.
//   'fill', willChange=true         → "will be filled" current(empty)-vs-B.
//   'fill', willChange=false        → "skipped (already has a prompt)" + item.message (no diff).
```

### 4.3 Component boundaries (React realities)

- **State lives in `BaselinePromptPage`** (lifted): baseline, status, mode, preview, overrides,
  confirm-open, result, and all three error strings. Rationale: mode change must invalidate the
  preview (REQ-F002-055) and apply consumes preview + overrides, so these must co-reside above the
  children. No context needed — the tree is shallow and single-consumer; context would be
  over-engineering (composition beats configuration here).
- **Presentational:** `NativeDefaultAdvisory`, `BaselineStatusList`, `SyncStateChip`, `ModeSelector`,
  `PreviewDiffItem`. **Stateful-but-local:** `BaselineEditor` (draft text) and `BaselinePreviewApply`
  (holds the typed-phrase input via `DangerConfirm`, and the confirm-open boolean can live here or
  in the page — put it in the page so focus-return targeting is unambiguous).
- **The opaque `confirmToken` never enters a presentational prop or the DOM** — it lives only in the
  page's `preview.confirmToken` and is passed straight to `onApply`'s request body (REQ-F002-031/048).

---

## 5. Interaction states (per component)

**Global page states.** Loading (baseline+status fetch in flight → "Loading…" per existing idiom);
load error → `ErrorBanner` verbatim; the advisory renders in **every** state including loading and
error (REQ-F002-060 "whenever shown").

**BaselineEditor**
- default / editing: textarea populated; Save enabled only when the trimmed draft differs and is
  non-empty (REQ-F002-018).
- disabled: Save/Clear disabled while `busy`.
- validation error: whitespace-only draft → `aria-invalid` + `.field-error` "Baseline cannot be
  empty; use Clear to remove it." (blocks submit, REQ-F002-018).
- empty (never defined): textarea empty + "Not yet defined" note; Clear hidden/disabled.
- save error: `ErrorBanner` verbatim; textarea keeps the operator's draft (no-partial-success
  posture, REQ-098).

**ModeSelector**
- default: `prepend` selected. `overwrite` label danger-styled with visible destructive hint
  (REQ-F002-055). disabled while previewing/applying.

**Preview (in BaselinePreviewApply)**
- idle (no preview yet): *Apply* control **inert/disabled** with hint "Preview to enable apply"
  (REQ-F002-030).
- loading: *Preview changes* shows busy; region shows "Loading preview…".
- loaded: header "N affected · M unchanged" (REQ-F002-019); item list of `PreviewDiffItem`.
- empty (affectedCount 0, or cleared baseline + nothing tracked): "No workspaces would change." —
  *Apply* stays disabled (nothing to do; cleared-with-nothing-tracked mirrors the BFF's empty-items
  case, REQ-F002-046).
- error: `ErrorBanner` verbatim (e.g. 400 unknown mode). Changing mode clears a loaded preview and
  re-disables Apply (REQ-F002-055).

**Per-override (prepend overridden items only)**
- unresolved: preserve/discard radios with **no default selected**; the item is visibly marked
  "choose preserve or discard." If left unresolved at apply, the BFF reports it `skipped`
  (REQ-F002-050) — the UI surfaces that in the result, and MAY pre-warn "unresolved → will be
  skipped." (Design does not force a default — the spec makes absence a legitimate skip, not an
  error; forcing a default would change observable behavior. See Open Question OQ-3.)

**DangerConfirm (apply gate)**
- opens on *Apply baseline*; focus moves into the dialog (REQ-F002-034).
- `children` = destructive blast-radius summary: the count and names of workspaces whose content is
  discarded with no preserve/discard choice — (a) every `overwrite`-resolved item, and (b) every
  `overridden` `baseline-only` item (REQ-F002-031(a)/(b)); plus the irreversibility statement
  (engine writes have no native undo; the console is the sole record of prior content,
  REQ-F002-038).
- armed only when typed text === `confirmationPhrase` (REQ-F002-048); confirm disabled otherwise
  and while `applying`.
- error: apply failure `{ message }` verbatim inside the dialog.
- close (cancel or completion): focus returns to the *Apply baseline* trigger (REQ-F002-034).

**Result region (after apply)**
- rendered in an `aria-live="polite"` region (REQ-F002-034) — a single completed announcement, no
  progress stream (apply is one blocking request, REQ-F002-058).
- per-workspace outcome list: `applied` / `failed` / `skipped` / `diverged`, with counts header and
  each failed/diverged/skipped `message` rendered verbatim (REQ-F002-032/022a/097a).
- **Never a single "all saved" banner when any item failed or diverged** (REQ-F002-032/022a). A
  fully-clean all-applied result MAY show a success summary. Failed workspaces are named so the
  operator can re-run apply against the still-drifted set (REQ-F002-022b) — the same F4 flow.

**Sync-state → surface mapping (which state shows where)**
- Status list: all four states via `SyncStateChip` (REQ-F002-023/024).
- Preview: `overridden` drives the preserve/discard branch (prepend) or the destructive-count branch
  (baseline-only); `never-applied`/`synced`/`stale` just diff normally.
- Result: outcomes are the apply-time classification (`diverged` = out-of-band edit since preview,
  REQ-F002-047), distinct from sync states.

**Error-code → surface mapping (spec-defined codes)**
- 400 unknown/absent mode, whitespace baseline, malformed token, illegal `overrides` (naming a
  non-prepend/baseline-only ws) → preview or apply `ErrorBanner` verbatim.
- 409 stale/superseded token, `mode` mismatch, wrong `typedConfirmation`, `overrides` naming a
  non-overridden ws → apply `ErrorBanner`; a stale token means the operator must re-preview (the UI
  should clear the stale `preview` and re-disable Apply so F4 restarts cleanly).
- 401 anywhere → global auth handler routes to login (existing REQ-014 behavior).

---

## 6. Design tokens

No new color tokens required — the existing `index.css` `:root` set covers every state. Mapping:

| Use | Existing token |
|---|---|
| `synced` chip | `--success` / `--success-bg` |
| `stale` chip | `--theme-button-disable-hover-text` (amber, the app's "warning") / `.warning` |
| `overridden` chip | `--danger` / `--danger-bg` |
| `never-applied` chip | `--theme-text-secondary` on `--theme-bg-secondary` (neutral, reuse `.badge-notset`) |
| `overwrite` mode label + DESTROY markers | `--danger` / `--danger-strong` |
| Advisory callout (REQ-F002-060) | neutral info — `--theme-home-bg-card` bg + `--theme-sidebar-border`, left accent `--theme-button-primary`; NOT danger (it is informational, not a warning of operator action) |
| Diff `current` panel | subtle `--danger-bg` tint when being replaced/destroyed; neutral otherwise |
| Diff `composed` panel | subtle `--success-bg` tint |

Chips **must not rely on color alone** — each carries a glyph + text label (REQ-F002-033). Reuse the
`.badge` shape/type-scale; add `.badge-synced/.badge-stale/.badge-overridden/.badge-neverapplied`
alongside the existing `.badge-set/.badge-notset/.badge-active`. Type scale, spacing, radii,
button styles all inherited — new feature CSS lives in `index.css` following the existing sectioned
comment style (no new styling system; the app uses plain CSS with CSS custom-property tokens —
detected, matched).

New CSS classes (behavioral, not new tokens): `.baseline-advisory`, `.sync-chip`, `.mode-selector`,
`.preview-diff`, `.diff-current`, `.diff-composed`, `.override-resolution`, `.outcome-list`,
`.outcome-<applied|failed|skipped|diverged>`.

---

## 7. Accessibility notes (WCAG 2.1 AA design inputs)

- **Non-color-only status (REQ-F002-033):** every `SyncStateChip` and every diff marker
  (DESTROY / will-be-filled / skipped) pairs an icon glyph + text label with color; states remain
  distinguishable in grayscale. Glyphs are `aria-hidden`; text is the accessible name.
- **Focus management (REQ-F002-034):** opening the preview is inline (no dialog), but the
  **DangerConfirm dialog** moves focus into itself on open (it already renders
  `role="dialog" aria-modal="true"`; the implementer must set initial focus to the typed-phrase
  input or dialog heading and restore focus to the *Apply baseline* trigger on close). The result
  region receives focus is **not** required — instead it is announced (below).
- **Live-region announcement (REQ-F002-034):** the apply result container is `aria-live="polite"`
  (single completed result including the failure breakdown; no incremental progress, REQ-F002-058).
  Announce a concise summary ("Applied 3, failed 1: <names>") so screen-reader users get the
  partial-failure fact, mirroring REQ-F002-032's no-uniform-success rule.
- **Keyboard path:** editor → mode radios (arrow-key group) → *Preview changes* → per-override radios
  → *Apply baseline* → dialog (Tab within, Esc cancels, Enter on armed confirm) → result. Full
  preview→confirm→result cycle is keyboard-only completable (REQ-F002-034 test).
- **Landmarks/structure:** the surface sits in the existing `<main class="app-main">`; regions use
  headings (`<h2>`/`<h3>`) and the status list is a real `<table>` (≥40rem) with `<th scope>` /
  `<caption>` (the counts), so it is navigable structurally.
- **Contrast:** all text/label colors use existing tokens already used elsewhere in the app; the
  `stale` amber-on-dark and `never-applied` secondary-on-secondary combinations are the two to
  verify against 4.5:1 at implementation (secondary text on secondary bg is the risk). Flagged for
  the independent accessibility audit — this doc does not certify the built contrast.
- **Reduced motion:** no essential animation is introduced; any hover/expand transition must respect
  `prefers-reduced-motion` (the existing button transitions are already subtle).

Note: the accessibility-reviewer audits the **built** UI independently; the above are design inputs,
not a pass judgment.

---

## 8. Key decisions (alternatives considered → why rejected)

- **One stacked view, not a list/detail split** (unlike Workspaces). The surface is a settings home
  with a single baseline and a read-only drift roster; there is no per-workspace editing here
  (REQ-F002-007). A detail pane would imply per-workspace actions the spec forbids
  (REQ-F002-052 has no per-workspace opt-out). Rejected list/detail as over-built.
- **Radio "segmented" ModeSelector, not a `<select>`.** `overwrite` is destructive (REQ-F002-055/056);
  its warning must be visible at rest, which a collapsed dropdown hides. Radios keep the danger
  copy on-screen. Costs a little vertical space — accepted.
- **Reuse `DangerConfirm` verbatim for the apply gate**, composing the blast-radius summary via its
  `children` (exactly as `MaskedDiffConfirm` does). Alternative — a bespoke apply dialog — rejected:
  it would fork the typed-token pattern the parent spec standardizes (REQ-078c/081) and this spec
  explicitly echoes (REQ-F002-031). The server-issued `confirmationPhrase` maps onto `expectedToken`
  directly; no new dialog primitive needed.
- **Preview diff inline (not in a dialog).** REQ-F002-034 names the "preview dialog, confirm dialog,
  and result region" as requiring focus management, which reads as up to three dialogs. I chose an
  **inline** preview panel + a **DangerConfirm** dialog + an inline live-region result. Rationale:
  the preview is long (per-workspace diffs) and must remain visible while the operator resolves
  overrides and then reads the danger dialog; trapping it in a modal harms comprehension and the
  override-resolution flow. This is a defensible reading — flagged as OQ-1 for confirmation.
- **No forced default on preserve/discard.** The spec makes an unresolved override a legitimate
  `skipped` outcome (REQ-F002-050), not an error. Auto-selecting a default would change observable
  apply behavior (silently preserving or discarding). Left unresolved-by-default with a pre-warning;
  flagged OQ-3.
- **`mode` included in the apply request body.** The architect's §4 apply body includes `mode`
  (correct per REQ-F002-021/055/047), while the spec's §7.2 route-table body omits it. I designed to
  the requirement text (mode required, bound, 400 if absent). Flagged OQ-2 as a spec/table
  inconsistency for the owner, not silently resolved in behavior — the design simply sends what
  REQ-F002-021 mandates.
- **New sidebar section rather than nesting under Admin.** REQ-F002-029 stresses "not bound to a
  single workspace" and "above-workspaces scope." A distinct "Customer-wide" section makes the new
  altitude legible. Minor: it is the app's first such section (intended).

---

## 9. Traceability (surface ↔ spec)

| Requirement | Where satisfied |
|---|---|
| REQ-F002-015/016/018 | `BaselineEditor` view/define/replace + trimmed non-empty validation |
| REQ-F002-046 | `BaselineEditor` Clear action (lightweight confirm, not §8) |
| REQ-F002-017 | Clear/save are staff-auth (session guard) and not danger-gated |
| REQ-F002-023/024/026 | `BaselineStatusList` + `SyncStateChip` (four states, new-ws = never-applied) |
| REQ-F002-033 | `SyncStateChip` glyph+text+color; diff markers non-color-only |
| REQ-F002-019/030 | `BaselinePreviewApply` mandatory preview gates the inert Apply control |
| REQ-F002-055/056 | `ModeSelector`, `overwrite` visibly destructive |
| REQ-F002-059 | `PreviewDiffItem` branches on `resolvedMode` (incl. baseline-only exemption) |
| REQ-F002-025/050 | Per-override preserve/discard only for prepend-resolved overridden items |
| REQ-F002-031/048 | `DangerConfirm` blast-radius `children` + typed `confirmationPhrase` |
| REQ-F002-038 | Irreversibility copy in the confirm dialog |
| REQ-F002-032/022a | Per-workspace outcome list; no uniform success on partial failure |
| REQ-F002-034 | Focus into/out of dialog; `aria-live` result announcement |
| REQ-F002-060 | `NativeDefaultAdvisory` rendered persistently in every page state |
| REQ-F002-029 | New top-level sidebar entry, single un-scoped settings view |
| REQ-097a / REQ-014 | `ErrorBanner` verbatim; 401 → existing auth handler |

---

## 10. Open questions for the spec owner (not resolved in this design)

- **OQ-1 — Preview presentation: dialog vs inline.** REQ-F002-034 lists a "preview dialog, confirm
  dialog, and result region" as focus-managed surfaces, implying the preview may be a modal. This
  design makes the preview **inline** (only the confirm is a modal) because the diff must stay
  visible during override resolution and confirmation. Confirm the inline preview is acceptable, or
  require a modal preview (which would change the focus-management surface count).
- **OQ-2 — Apply request body `mode`.** The spec's §7.2 route-table apply body reads
  `{ confirmToken, typedConfirmation, overrides? }` (no `mode`), but REQ-F002-021/055/047/048 and the
  architect's §4 require `mode` in the body (400 if absent, 409 on token mismatch). The design sends
  `mode` per the requirement text. Please reconcile the §7.2 table with REQ-F002-021 so the contract
  is unambiguous.
- **OQ-3 — Unresolved override default.** An `overridden` (prepend) workspace with no preserve/discard
  choice is `skipped` (REQ-F002-050). Should the UI (a) leave it unresolved and let it skip with a
  pre-warning [this design], (b) force the operator to choose before Apply enables, or (c) default to
  `discard`/`preserve`? (b) and (c) change observable behavior, so I did not pick them.
- **OQ-4 — Clear-baseline confirmation weight.** REQ-F002-046/017 says clearing is *not* a §8 danger
  op (no engine write), yet it makes previously-synced workspaces `stale` and a later apply strips
  the baseline. I used a lightweight confirm. Confirm that a plain confirm (not DangerConfirm) is the
  intended weight for Clear.
- **OQ-5 — Status list scale / no pagination.** REQ-F002-039 returns status whole (≤200 ceiling, no
  pagination). At 200 rows the stacked-card mobile layout is long. Confirm no client-side
  filtering/grouping (e.g. "show only drifted") is required for this revision — I deliberately did
  not add filtering to avoid inventing behavior, but a "drifted only" filter would be a natural,
  spec-neutral affordance if desired.
```
</invoke>
