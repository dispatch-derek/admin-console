# Spec Review — F-001: Adhere to a Design System

Spec under review: `specs/F-001-adhere-to-design-system.md`
Brief: `briefs/F-001-adhere-to-design-system.md`
Parent spec: `specs/admin-console.md` (v1, rev 7)
Reviewer: spec-reviewer (adversarial pass)
Date: 2026-07-07

## Verdict: ACCEPT-WITH-CHANGES

The spec is structurally strong: the factual baseline is accurate, parent references are valid,
the ASSUMPTION mechanism genuinely fails safe, and it resists most of the "adopt a design system is
untestable" trap by pinning to the concrete migration surface and the existing test suite. It cannot
go to implementation as-is because of five blocking items.

## Factual verification (all confirmed against the codebase)

- `className` count: exactly **143 across 22 files** (verified).
- `web/src/index.css`: **723 lines**; dual-theme mechanism is `:root` (dark default),
  `:root[data-theme='light']`, and `@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) }`.
- `main.tsx` only mounts `App` and imports `index.css`; no `.ts/.tsx` source sets `data-theme` at
  runtime — the **"no in-app theme switcher"** claim is true.
- Three shared components exist with the asserted a11y affordances: `ErrorBanner` `role="alert"`,
  `DangerConfirm` `role="dialog" aria-modal="true"`.
- Every cited parent id (REQ-013/021/021a/026/035/060/078c/080/081/096/097a/098/098a/098b/100) exists
  and means what F-001 claims; the `REQ-F001-###` namespace does not collide.
- ASSUMPTION discipline is sound: A1, A2, A3, A4, A5, A7 each fail safe. No disguised unilateral decisions.
- OQ-4 (customer exposure) and OQ-5 (operator-base size) genuinely change no build requirement.

## Blocking findings (must fix before implementation)

### B1 — [AMBIGUOUS/GAP] §5–§6.6, REQ-F001-014/016/018/026/027 — the "bridge layer" escape hatch is unbounded
Every completeness/"no-ad-hoc" test has a third exit: "captured as a documented bridge (REQ-F001-026)."
REQ-F001-026 requires the bridge be "auditable and small" but never quantifies "small" and sets no cap.
Two implementations both pass every §6 test: (A) genuinely re-expresses screens on governing
tokens/components with a handful of bridge entries; (B) moves the existing ~723-line `index.css`
verbatim into a file labeled "bridge layer," adds a one-line comment per rule, and adopts essentially
nothing — both satisfy REQ-F001-027 because everything is "accounted for" as a bridge. This is exactly
the "ad-hoc CSS silently creeps back" risk.
**Resolution:** add a concrete adoption floor — a numeric/proportional cap on bridge-layer size
relative to the pre-migration surface, or require each named §5 pattern (tables, danger-confirm,
badges, forms, shell, raw editor) to be served by a governing component/token composition and forbid a
bridge entry that reproduces a full pre-migration ad-hoc ruleset.

### B2 — [CONTRADICTION/cross-ref] §6.3, REQ-F001-022(c) — accessibility acceptance test points at the wrong requirement
REQ-F001-022(c) reads "accessibility operability does not regress (REQ-F001-028)," but REQ-F001-028 is
the §6.7 *phasing* requirement. Accessibility is **REQ-F001-030** (§7).
**Resolution:** change the reference in REQ-F001-022(c) to REQ-F001-030.

### B3 — [cross-ref/GAP] §6.2, REQ-F001-019 — test cites the wrong inventory
REQ-F001-019's test says "per REQ-F001-006's inventory…," but REQ-F001-006 is "No backend/BFF change"
and defines no inventory. The `className` inventory is **REQ-F001-010**.
**Resolution:** change "REQ-F001-006's inventory" to "REQ-F001-010's inventory."

### B4 — [UNTESTABLE] §8, REQ-F001-033 — bundle-size criterion has no threshold and a dangling escalation
The test requires bundle size "does not regress beyond an agreed tolerance (see §9 if a hard budget is
required)," but §9 contains no bundle-budget open question and no tolerance is stated anywhere. The
p95-render half (parent REQ-100) is testable; the bundle half is not.
**Resolution:** state a concrete tolerance (e.g. "gzipped bundle ≤ baseline + X%") or add a real §9
open question and mark the bundle criterion provisional on it.

### B5 — [UNTESTABLE/GAP] §7, REQ-F001-031 — "currently-supported viewport range" is undefined
The requirement and its test hinge on "the viewport sizes the console supports today," but no baseline
enumerates that range and `index.css` is not shown to define responsive breakpoints. No concrete test
can be derived.
**Resolution:** pin the supported viewport range (specific min/max widths or a named baseline).

## Medium findings

### M1 — [weak testability] §8, REQ-F001-035 — "a representative styling change" is undefined
The maintainability test passes if *one* chosen token change propagates without per-screen edits.
"Representative" is unspecified, so a tester can cherry-pick a single centralized token and pass even if
most styling is bridged/ad-hoc (interacts with B1).
**Resolution:** bind the test to a defined change set (e.g. "changing the primary background and
primary accent tokens takes effect on all screens in §5's pattern list") or tie it to the B1 floor.

### M2 — [weak testability] §6.4, REQ-F001-023 — "renders correctly / legible" has no harness or baseline
The only concrete floor is "no black-on-black." Otherwise this relies on unstated manual judgment; no
visual-regression baseline or contrast tool is specified.
**Resolution:** state the check method — per-screen manual reviewer sign-off in both theme paths (if
named) or automated contrast assertions tied to REQ-F001-030's "AA-or-no-regression" floor.

## Notes (non-blocking)

- **N1 — §9 / intro:** assumption **A6 is never defined**. The intro references "ASSUMPTIONs (A1–A7)"
  but only A1, A2, A3, A4, A5, A7 exist; A6 is a dangling label. Renumber or add the missing item.
- **N2 — §5, REQ-F001-016 header:** "(conditional — ASSUMPTION A1/A7)" cites A1 spuriously; the body
  only invokes A7 (A1 is the dual-theme assumption, relevant to REQ-F001-023).
- **N3 — §8, REQ-F001-032 test:** "parent REQ-011/021a scans" mis-cites REQ-011 (staff login), which
  is not a scan and not in the body's list (013/021/021a/026); likely intended REQ-021.
- **N4 — Deliberately-abandoned design intent, unacknowledged.** `index.css:2` and the brief state the
  console's current styling intentionally "reads as an extension of AnythingLLM's native settings UI."
  Adopting Claude Design abandons that. Verified this is *not* a contradiction with any parent REQ (no
  parent requirement mandates visual resemblance; parent "native UI" references are about AnythingLLM's
  own app). Flagging so the human is aware this consequence is intended and unstated, not overlooked.

## Blocking items to resolve
1. **B1** — bound the bridge layer / add an adoption floor (the core untestability).
2. **B2** — fix REQ-F001-022(c) accessibility reference (→ REQ-F001-030).
3. **B3** — fix REQ-F001-019 inventory reference (→ REQ-F001-010).
4. **B4** — give REQ-F001-033 a real bundle-size threshold or a §9 open question.
5. **B5** — define the supported viewport range for REQ-F001-031.

---

## Re-review (rev 2) — 2026-07-07

Scope: verification pass over the revised spec (Status "Draft rev 2") against the now-vendored ground
truth at `web/vendor/design-system/`. Confirmed each prior finding, verified the two promoted facts
(former A1 dual-theme, former A7 coverage) against the bundle, and stress-tested the new
adherence-linter machinery (REQ-F001-044/045/046). Read-only on the spec.

### Ground-truth citations verified against the bundle (all TRUE)

- **11 components** (REQ-F001-045): manifest `components[]` lists exactly `Badge, PageHeader, Table,
  Button, IconButton, Input, Select, Textarea, Toggle, SidebarItem, Modal`; each has a real `.jsx` +
  `.d.ts` prop contract under `project/components/**`. Confirmed.
- **Variant sets** (REQ-F001-044/045): `Button.variant ∈ {cta,solid,ghost,danger,login}`,
  `Badge.tone ∈ {info,success,warn,danger,neutral}`, `Toggle.size ∈ {sm,md,lg}` all match the
  `no-restricted-syntax` selectors in `_adherence.oxlintrc.json` (lines 49/57/113). Confirmed.
- **Dual-theme (former A1 → REQ-F001-023/037)**: `colors.css`/manifest define `:root` (dark) plus
  `scope:"[data-theme=\"light\"]"` entries, and `themes:[{selector:"[data-theme=\"light\"]"}]`; the
  token names are the SAME `--theme-*` names the console already ships (`--theme-bg-primary`,
  `--theme-button-primary`, …). Confirmed — "no theme bridging required" is accurate.
- **Coverage (former A7 → REQ-F001-016/036)**: full token set (colors incl. light, type, spacing,
  radius, shadow, gradients) + 11 components. Confirmed. The named raw/code-editor gap is real (no
  code-editor component ships; `Textarea` is the closest primitive).
- **Reference viewport 1280×720 (REQ-F001-031)**: manifest admin-console card `viewport:"1280x720"`.
  Confirmed.
- **Font `Plus Jakarta Sans` (REQ-F001-018/044)**: `fonts[]`/`brandFonts[]`/`--font-sans`. Confirmed.
- **No brand mark (REQ-F001-007)**: `readme.md` lines 7/101 "Branding: not yet determined … 'Admin
  Console' renders in plain type." Confirmed.
- **DS derived from AnythingLLM admin surface**: `readme.md` "Sources" (lines 3, 11–18). Confirmed.
- **Component-internals import ban (REQ-F001-015/044)**: `no-restricted-imports` patterns block
  `components/**`, `ui_kits/**` (lines 13–29). Confirmed.

### Per-prior-finding status

- **B1 — PARTIAL (residual blocker, reframed).** The revision genuinely tightens the loophole in
  prose: bridges are now restricted to the single raw/code-editor pattern (REQ-F001-016/046), and
  REQ-F001-027's test adds a second clause ("static scan finds zero ad-hoc className/CSS rules
  unaccounted for … residual local CSS is only the adopted DS token import and the documented bridge
  layer"). Those are real constraints a diligent reviewer can enforce. **However, the spec's
  headline mechanical claim — that the adherence linter makes the "re-host `index.css` as
  `bridge.css`" loophole *fail the lint* (REQ-F001-026, -027, and the §self-check) — is FALSE.** See
  new finding NR-1 below; the linter is an oxlint JS/JSX config that does not parse `.css` files, so
  a `bridge.css` full of raw hex/`px` passes the gate with zero violations. B1 is therefore not
  closed by the mechanism the revision advertises; it is only narrowed by the (softer, reviewer-
  judgment) raw-editor-only rule and the manual static scan. This must be fixed.
- **B2 — RESOLVED.** REQ-F001-022(c) now cites REQ-F001-030 (accessibility). Correct target.
- **B3 — RESOLVED.** REQ-F001-019's test now cites "REQ-F001-010's `className` inventory." Correct.
- **B4 — RESOLVED.** REQ-F001-033 now states a concrete bound: "gzipped production JS + CSS bundle
  MUST be ≤ pre-migration baseline + 10%," measured on a production build with the same seeded data.
  Testable.
- **B5 — RESOLVED.** REQ-F001-031 pins the range: reference 1280×720 (cited to the manifest), usable
  1024–1920px wide at ≥720px tall, sub-1024px explicitly out of scope. Testable at three named sizes.
- **M1 — RESOLVED.** REQ-F001-035 is now bound to a defined change set (`--theme-button-primary` +
  `--theme-bg-primary`) propagating across the §5 pattern list with no per-screen edit and touching
  exactly one file. Both tokens exist in the manifest. Falsifiable.
- **M2 — RESOLVED.** REQ-F001-023 now defines a three-path render harness (no-attr dark / `[data-
  theme='light']` / simulated `prefers-color-scheme:light`) with a per-custom-property resolution
  check and a contrast floor tied to REQ-F001-030. Testable.
- **N1 — RESOLVED.** No dangling A6: the intro now enumerates A1, A2, A3, A4, A5, A7 only.
- **N2 — RESOLVED.** REQ-F001-016 header now reads "(ESTABLISHED …)" and cites the bundle, not A1.
- **N3 — RESOLVED.** REQ-F001-032 test now cites parent REQ-021/021a scans (not REQ-011).
- **N4 — carried (non-blocking, unchanged).** Now explicitly reframed as "Native-look preservation
  (not a risk)" in the intro with the DS-derived-from-AnythingLLM provenance; the human-awareness
  point stands but is now acknowledged in the spec rather than silent.

### New findings introduced by the revision

- **NR-1 — [CONTRADICTION, blocking] §3/§6.1/§6.5/§6.6, REQ-F001-018/026/027/044 — the adherence
  linter cannot enforce "no raw hex / no raw px" over CSS, so the flagship loophole is not closed.**
  The shipped adherence config `_adherence.oxlintrc.json` is an **oxlint** config: `plugins:["react",
  "import"]`, and its hex/`px`/font rules are `no-restricted-syntax` selectors over the JS/JSX AST
  (`Literal[value=/#[0-9a-fA-F]{3,8}/]`, `Literal[value=/\d+px/]`, and `JSXOpeningElement…` prop
  selectors). oxlint does not parse `.css` files. **Internal proof this is so:** REQ-F001-017 adopts
  the DS token CSS **verbatim** into `web/src/`, and that CSS (`tokens/colors.css`) is dense with raw
  hex (`--alm-ink:#0e0f0f;`, `--alm-surface:#1b1b1e;`, … dozens more). REQ-F001-018/044 require the
  linter to report **zero** raw-hex violations over `web/src/`. These two requirements can only both
  hold if the linter does **not** scan CSS — otherwise the required, adopted-verbatim token layer
  would itself fail the required gate. Consequently:
  - Reading A (intended): screens recreated on DS components; ad-hoc `index.css` deleted; only token
    CSS + a tiny raw-editor bridge remain. Lint passes.
  - Reading B (gamed): move the ~723-line ad-hoc `index.css` into `web/src/bridge/bridge.css`, keep
    every `className` reference (string literals that match no hex/`px` regex), recreate nothing real.
    oxlint scans only `.ts/.tsx` and reports **zero** violations because all the raw hex/`px` live in
    a `.css` file it never reads. Reading B passes REQ-F001-044 *and* the linter-based test of
    REQ-F001-018/027 identically to Reading A.
  The spec repeatedly asserts the opposite ("the 'move all 723 lines of `index.css` into a
  `bridge.css`' loophole therefore **fails the lint** … which is what makes migration completeness
  testable," REQ-F001-026; echoed in REQ-F001-027 and the self-check). That assertion is false as
  written, and it is load-bearing — downstream agents will read "adherence lint passes ⇒ no ad-hoc
  CSS," which does not hold for CSS-resident styling (the exact medium of the pre-migration surface
  and of the contemplated residual bridge layer).
  **Resolution options:** (a) add a CSS-aware gate (e.g. stylelint with equivalent no-raw-hex /
  no-raw-`px` / font-whitelist rules over `web/src/**/*.css`, with the adopted token CSS explicitly
  allowlisted) and make REQ-F001-044 name both linters; or (b) drop the claim that the oxlint gate
  closes the `bridge.css` loophole and rest completeness explicitly on the raw-editor-only bridge rule
  (REQ-F001-016/046) plus a *defined* static scan, stating plainly that the oxlint gate covers JS/JSX
  literals and JSX props only. Either restores a truthful, testable completeness bound.

- **NR-2 — [NOTE, non-blocking] REQ-F001-044/045 — `Select` has no prop/variant lint rule.** The
  linter restricts props for `Badge/Button/IconButton/Input/Modal/PageHeader/SidebarItem/Table/
  Textarea/Toggle` and for `SelectOption`, but there is **no** `JSXOpeningElement[name.name='Select']`
  rule, while `Select.d.ts` defines a real `SelectProps` contract. REQ-F001-045's test ("passes the
  adherence linter's prop/variant rules") is vacuously true for `Select` — off-contract `Select`
  props would not be caught. Not a contradiction; flag so the prop-contract guarantee isn't assumed
  uniform across all 11 components.

- **NR-3 — [NOTE, non-blocking] REQ-F001-018 var()-resolution claim vs. token CSS.** REQ-F001-018's
  test says "every color/spacing/type value resolves to a DS token via `var()`." The adopted token
  CSS itself necessarily contains the raw literal *definitions* (`#0e0f0f`, `4px`, …); the intended
  reading is clearly "in consuming code, values reference tokens via `var()`, while the token layer
  holds the primitives." The prose does not state that carve-out. Low risk of misreading, but pairs
  with NR-1: the token-layer file is the one place raw literals must live, and it is also the one the
  linter cannot see.

### New contradictions / cross-references / untestable requirements introduced: none beyond NR-1

Spot-checked the reframed consumption model (recreate in `web/src/design-system/` + immutable vendored
reference + diff-based re-sync, REQ-F001-015/025/038): internally consistent. The "consume, don't
fork" definition (§3), REQ-F001-015 (no edits under `web/vendor/design-system/`), and REQ-F001-025
(re-export → diff against reference → re-apply deltas) agree; the re-sync test is structural and does
not depend on an unavailable upstream. REQ-F001-046 (raw-editor bridge composed from `Textarea` + DS
tokens) is consistent with the manifest gap. New REQ-F001-045 matches the manifest 1:1. All §-refs
introduced by the revision (REQ-F001-044/045/046 back-references, the RESOLVED markers in §9 pointing
at REQ-F001-016/023/017) resolve to sections that say what the referring text implies.

### Fresh overall verdict: ACCEPT-WITH-CHANGES

Five of the six prior blockers (B2, B3, B4, B5) and both mediums (M1, M2) and all four notes are
cleanly resolved and their new numeric/harness bounds check out against the vendored bundle. The two
promoted facts (dual-theme, coverage) are accurately cited. One blocker remains, reframed: **B1 is
only PARTIALLY closed**, because the revision's advertised mechanism for closing it (NR-1) rests on a
false premise — the oxlint adherence gate does not scan CSS, so a `bridge.css` re-host of the ad-hoc
styling still passes the lint. This is a targeted, single-issue correction (add a CSS-aware gate, or
restate the completeness bound to rely on the raw-editor-only rule + a defined static scan and scope
the oxlint claim to JS/JSX), not a wholesale revise. Fix NR-1 (with the residual B1 language) and the
spec is implementation-ready.
