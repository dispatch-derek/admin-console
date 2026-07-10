# F-001 — Migration Sequencing, Baseline & Budget Hooks

Phasing is permitted area-by-area (REQ-F001-028, OQ-8) but every phase must be behavior-preserving
and independently shippable, and the whole console must build, test, and render in both themes at
every intermediate state (REQ-F001-028). All five areas must be compliant before the **Oct 2026 GTM
hard gate** (REQ-F001-028a).

## Phase 0 — Baseline capture (BEFORE the first migration commit, REQ-F001-049)

Blocking prerequisite; the baseline stops being reconstructable once migration starts.

- Capture on the current `web/` **production build** with standard seeded data and commit as a dated
  artifact under `docs/design/F-001/baseline-<YYYY-MM-DD>.md` (+ raw outputs):
  - (a) **gzipped production JS + CSS bundle size** (the REQ-F001-033 comparison basis).
  - (b) **a11y/contrast snapshot** — automated-a11y results + contrast measurements for the
    status/danger/success and text-on-background pairs, for the parent REQ-100 read views
    (workspace list, user list, settings) **plus** `DangerConfirm`/`ErrorBanner`/`SetNotSetBadge`.
- All later REQ-F001-030/033 comparisons cite this artifact, not a re-measured value.

## Phase 1 — Foundation (no screen behavior change yet)

1. Land `web/src/design-system/tokens/` (four verbatim files + `tokens.css`) and co-vendored font
   (carve-out A). **Resolve RISK-1 (`prefers-color-scheme`) first** — this is where the token files
   land. Import from `main.tsx`; remove the ad-hoc token block from `index.css`.
2. Recreate the 11 components + `.module.css` (token `var()` only) and the barrel `index.ts`
   (REQ-F001-045). Add RTL tests per component.
3. Add both lint configs + scripts (`02-tokens-and-gates.md` §3); wire into `build`/CI. Gates should
   pass over the foundation before any screen migrates.
4. Stand up `web/src/bridge/` with `RawEditorSurface` skeleton + `README.md` (REQ-F001-026/046).

## Phase 2 — Area-by-area migration (each phase = one shippable commit)

Ordered lowest-risk / highest-reuse first, so shared primitives are proven before the complex areas:

| # | Area | Primary DS primitives | Rationale for order | REQ |
|---|---|---|---|---|
| 2.1 | **App shell** (`App.tsx`) + `index.css` shell rules | `SidebarItem`, `PageHeader`, `Button` | Exercises nav/header/token wiring once for all areas; `View`/`NAV` unchanged. | -019, -002 |
| 2.2 | **Shared components** (`DangerConfirm`, `ErrorBanner`, `SetNotSetBadge`) | `Modal`, `Button`, `Input`, `Badge` | Consumed by many areas; also lands the REQ-F001-048 re-point. Contract/tests unchanged. | -020, -048 |
| 2.3 | **Diagnostics** (`diagnostics/`) | `Table`, `Badge`, tokens | Smallest, read-only surface — cheap first full-screen proof. | -012, -019 |
| 2.4 | **Users** (`users/`: list, invites, membership, oversight, gate) | `Table`, `Badge`, `Button`, `Input`, `Select` | Table/list-heavy; validates `Table` at scale. | -012, -019 |
| 2.5 | **Workspaces** (`workspaces/`: list, settings, create, knowledge) | `Table`, `Input`, `Toggle`, `Button`, `Modal` | List/detail + forms; depends on 2.2 (delete uses `DangerConfirm`). | -012, -019 |
| 2.6 | **Settings** (`settings/`: page, SecretField, provider forms, Ollama select) | `Input`, `Select`, `Toggle`, `Button`, `Badge` | Most controls + numeric-bounds/secret needs — surfaces RISK-4 prop gaps. | -012, -019 |
| 2.7 | **Raw editor** (`raweditor/`) + **auth** (`auth/`) | `bridge/RawEditorSurface`, `Textarea`, `Modal`, `Input`, `Button` | Raw editor is the one bridge (REQ-F001-046); auth uses `Button variant="login"`. | -019, -046 |

Per-phase exit criteria (REQ-F001-021/022/027/034):
- Existing `web/` test suite passes (only DOM-selector updates allowed, never relaxing an assertion).
- Both adherence gates pass **repo-wide** (they are not per-area — a raw literal anywhere fails).
- Per-screen (a)/(b)/(c) checklist recorded: same views for same state; same interactions/text; no
  a11y regression vs. Phase-0 baseline.
- Dual-theme three-path render/contrast harness passes (REQ-F001-023 i/ii/iii — note iii depends on
  RISK-1 resolution).

## Phase 3 — Completion & GTM readiness

- `index.css` reduced to (at most) residual global rules that survive the CSS gate + the documented
  bridge; no unaccounted ad-hoc `className`/CSS rule (REQ-F001-027; inventory vs. REQ-F001-010's 143
  sites / 22 files).
- GTM check: both gates green repo-wide, zero areas on ad-hoc styling outside the bridge/raw-editor
  exception (REQ-F001-028a).

## Perf / a11y budget hooks (REQ-F001-030, -033)

| Budget | Where measured | Pass condition |
|---|---|---|
| Bundle size (REQ-F001-033) | production build gzipped JS+CSS, compared to Phase-0 baseline | ≤ baseline + 10%. `@phosphor-icons/react` is the main additive cost — monitor after Phase 1. |
| Read-view perf (parent REQ-100) | p95 render of workspace/user/settings lists, seeded data | < 1500 ms post-migration. |
| A11y no-regression (REQ-F001-030) | re-run the Phase-0 a11y/contrast snapshot per migrated screen | no regression vs. baseline; WCAG 2.1 AA is a non-gating target (OQ-6). |
| Custody / no-leakage (REQ-F001-003/029/032) | parent REQ-021a static scan of `web/` | still zero engine identifiers; no new `/api/*` call, no `bff/` edit. |

Measure the bundle budget continuously from Phase 1 (component recreation is the largest additive
cost) rather than only at the end, so a breach is caught before it compounds across areas.
