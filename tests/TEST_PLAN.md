# F-001 "Adhere to a Design System" — Test Plan

Spec: `specs/F-001-adhere-to-design-system.md` (rev 6, fully ruled, §9 zero open questions).
Design (implementation-location reference only, spec is authoritative on conflict):
`docs/design/F-001/00-design.md`, `01-component-contracts.md`, `02-tokens-and-gates.md`,
`03-migration-plan.md`.
Ground truth: `web/vendor/design-system/` (vendored, immutable reference).

## Stack & conventions

- **vitest + @testing-library/react + jsdom**, run with `npm test` from `web/` (existing convention;
  15 pre-existing test files / 259 passing tests were the green baseline before this task; the repo
  as inspected for this task already carried an additional untracked, in-progress batch of F-001
  component tests under `web/src/design-system/components/*.test.tsx` + `index.test.ts` — those were
  reviewed, left in place, and are covered below rather than duplicated).
- New F-001 tests are colocated `*.test.ts(x)` next to the source they exercise
  (`web/src/design-system/tokens/`, `web/src/bridge/`, `web/src/components/`), per project
  convention, **plus** two repo-root harness directories the spec's own two-gate / inventory
  requirements need but that don't belong to any single source module:
  - `web/tests/inventory/` — whole-tree migration-completeness scans (REQ-F001-009/010/019/027, App
    shell/View inventory).
  - `web/tests/gates/` — the two adherence-gate configs (`web/.oxlintrc.json` /
    `web/.stylelintrc.json` live at the `web/` package root, not under `src/`), vendor-immutability
    hash pin, and the pre-migration baseline-artifact existence check.
  Both directories are picked up automatically by vitest's default `include` glob (no `test.include`
  override in `web/vite.config.ts`), so `npm test` runs them like any other suite.
- **This is a pre-implementation snapshot.** No F-001 production code exists yet (no
  `web/src/design-system/components/*.tsx`, no `web/src/bridge/`, no `web/.oxlintrc.json` /
  `.stylelintrc.json`, no `docs/design/F-001/baseline-*.md`). Every test below that targets
  not-yet-created implementation artifacts is **expected to fail now** — that failure is the correct,
  spec-derived signal, not a broken test. Tests are written to assert the SPEC's observable
  requirement so they pass unmodified once a correct implementation lands.
- Every new test cites its `REQ-F001-###` in a comment. `SPEC-DEFERRED` in a file's header comment
  marks tests that cannot run to completion until implementation exists.

## Suite status as of this run

```
Test Files  19 failed | 17 passed (36)
     Tests  56 failed | 278 passed (334)
```

- All **241** pre-existing tests (the original 15 files, matching the exact list REQ-F001-021 cites —
  `SettingsPage`, `WorkspaceSettings`, `UserList`, `MultiUserGate`, `KnowledgePanel`, `RawEnvEditor`,
  `LoginPage`, `EnrollMfa`, `AuthContext`, `client`, `leakage`, plus `DangerConfirm`, `ErrorBanner`,
  `validation`, and the two auth/API files) **still pass unchanged** — the REQ-F001-021
  behavior-preservation baseline is green.
- **37 new tests pass now** (structural/regression-guard tests that hold in the current, unmigrated
  tree: `SetNotSetBadge.test.tsx`, `vendor-immutability.test.ts`, the `REQ-F001-010` baseline-lock
  count, the `REQ-F001-024` no-theme-switcher guard, a subset of the dual-theme/orphan checks that
  are vacuously true pre-migration, etc.).
- **56 tests fail**, all for the expected reason: they assert a post-migration state (adopted token
  files, recreated DS components, the bridge layer, the two lint gates, the baseline artifact) that
  does not exist yet. None fail on a syntax/import crash in the test code itself — the design-system
  component tests convert "module doesn't exist" into an explicit, labeled thrown error inside the
  test body (see `web/src/design-system/index.test.ts`), and the gate-execution tests convert
  "binary/config not installed" into an explicit `expect.fail(...)` with a diagnostic message, rather
  than letting `execSync`/import machinery crash the runner.

## Traceability matrix (REQ-F001-### → test)

Legend: **NEW** = test added by this task. **EXISTING** = pre-existing test, unchanged, cited as the
requirement's regression guard. **DEFERRED** = fails until implementation exists (expected).
**PASSES NOW** = a regression guard that already holds in the current tree.
**PROCESS/OUT-OF-BAND** = not unit-testable in this harness; the exact command or review step is
given instead (per the QA brief's explicit allowance).

### §1 Overview & Scope

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-001 | One governing DS; every migrated screen derives tokens/components from it | `web/src/design-system/tokens/adopted-tokens.test.ts` (single source of truth), `web/tests/inventory/migration-completeness.test.ts` (no legacy ad-hoc class survives), `web/tests/gates/adherence-gates.test.ts` (both gates pass) — jointly | DEFERRED |
| REQ-F001-002 | Frontend-only; behavior-preserving; `View`/nav unchanged | `web/tests/inventory/migration-completeness.test.ts` → `REQ-F001-002/008/012` block (pinned View-id list); `bff/` untouched — PROCESS/OUT-OF-BAND: `git diff --stat -- bff/` against the pre-migration commit must be empty | PASSES NOW (View check) / PROCESS (bff diff) |
| REQ-F001-003 | No new engine write/route/custody path | `web/src/leakage.test.ts` (EXISTING) | PASSES NOW |

### §2 Out of Scope

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-004 | No change to AnythingLLM's own app/native theme | PROCESS/OUT-OF-BAND — no AnythingLLM instance is reachable from this test harness; verified by PR-diff scope review (diff touches only this repo's `web/`) | UNTESTABLE-AS-WRITTEN here |
| REQ-F001-005 | No new operator functionality | Existing 241-test baseline (capability set unchanged) + `migration-completeness.test.ts` View/nav check | PASSES NOW |
| REQ-F001-006 | No backend/BFF change | PROCESS/OUT-OF-BAND: `git diff --stat -- bff/` empty across the migration | PROCESS |
| REQ-F001-007 | No rebrand/logo; plain type wherever the DS has none | No dedicated test — the DS ships no brand asset and F-001 introduces none; best covered by the `bridge/README.md` audit (`web/src/bridge/bridge.test.ts`) confirming no undocumented new asset/entry | UNTESTABLE-AS-WRITTEN (see Ambiguities) |
| REQ-F001-008 | Not an IA/flow redesign; screen/field/nav inventory preserved | `web/tests/inventory/migration-completeness.test.ts` → View-id pin | PASSES NOW |

### §4 Current-state baseline

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-009 | `index.css` ad-hoc baseline fully accounted for | `web/tests/inventory/migration-completeness.test.ts` → `REQ-F001-009/027` block (no ad-hoc token block, no bespoke selectors survive); the **143/22 figure itself** is now a static baseline-of-record, see REDESIGN 2 below | DEFERRED (live checks) / PASSES NOW (static baseline-doc check) |
| REQ-F001-010 | 143 `className` sites / 22 files inventoried; each migrates to a DS component/token usage, a documented bridge, or a removal — none unaccounted | `migration-completeness.test.ts` → static baseline-of-record check (reads `docs/design/F-001/baseline-classname-inventory-2026-07-07.md`, PASSES NOW) **+** the className disposition/accounting gate over the CURRENT tree (count-independent; DEFERRED — see REDESIGN 2 below) | Mixed |
| REQ-F001-011 | Three shared components re-expressed, contract unchanged | `web/src/components/DangerConfirm.test.tsx` (EXISTING), `ErrorBanner.test.tsx` (EXISTING), `SetNotSetBadge.test.tsx` (**NEW**, was previously untested) | PASSES NOW (pre-migration contract); must keep passing post-migration |
| REQ-F001-012 | Five feature areas + shell + auth in scope | `migration-completeness.test.ts` → directory-existence check | PASSES NOW |
| REQ-F001-013 | Dual-theme mechanism preserved | `web/src/design-system/tokens/dual-theme-harness.test.ts` | DEFERRED |

### §5 Adoption model

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-014 | Single source of truth; both gates pass | `adopted-tokens.test.ts` (single-source-of-truth), `adherence-gates.test.ts` | DEFERRED |
| REQ-F001-015 | Consume-don't-fork; vendored bundle immutable; recreated layer single barrel | `web/tests/gates/vendor-immutability.test.ts` (**PASSES NOW** — hash-pins the 5 vendored files this feature depends on), `web/src/design-system/index.test.ts` (barrel, EXISTING draft, DEFERRED) | Mixed |
| REQ-F001-016 | Coverage-scoped adoption; raw editor is the one gap | `web/src/bridge/bridge.test.ts` (only two named bridge entries), the 11 component contract tests (existence/shape) | DEFERRED |
| REQ-F001-045 | Recreate 11 DS components as typed `.tsx` matching `.d.ts` + oxlint prop rules | `web/src/design-system/components/{Badge,PageHeader,Table,Button,IconButton,Input,Select,Textarea,Toggle,SidebarItem,Modal}.test.tsx` + `index.test.ts` (barrel, all 11 exports + `Table.Row`/`Table.Cell`) | DEFERRED |

### §6.1 Token migration

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-017 | Verbatim token adoption + carve-out A (font url) | `adopted-tokens.test.ts` (byte-diff vs vendor, font url resolution, asset co-vendoring) | DEFERRED |
| REQ-F001-018 | No hardcoded off-system values (gate-enforced, both languages) | `adherence-gates.test.ts` (both gates) | DEFERRED |
| REQ-F001-048 | `--success*`/`--danger*` → DS token mapping (OQ-10) | `web/src/design-system/tokens/orphan-mapping.test.ts` | DEFERRED |
| REQ-F001-053 | Seven more `--theme-*` orphans → DS token mapping (OQ-12, RISK-2) + exhaustiveness audit | `orphan-mapping.test.ts` (per-name retirement + exhaustiveness block) | DEFERRED |

### §6.2 Component migration

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-019 | Five areas + shell + auth migrated onto DS; both gates pass | `migration-completeness.test.ts` (className disposition/accounting gate, count-independent — see REDESIGN 2), `adherence-gates.test.ts` | DEFERRED |
| REQ-F001-020 | Three shared components migrated, contract unchanged, orphans re-pointed | `DangerConfirm.test.tsx`/`ErrorBanner.test.tsx` (EXISTING, must keep passing), `SetNotSetBadge.test.tsx` (**NEW**), `orphan-mapping.test.ts` (no `var(--danger)`/`var(--success)` survive) | Mixed |

### §6.3 Behavior & workflow preservation

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-021 | No behavioral/workflow regression | The full existing 241-test suite passing unchanged **IS** this test, per the QA brief | PASSES NOW (baseline) |
| REQ-F001-022 | (a)/(b)/(c) checklist per screen | PROCESS/OUT-OF-BAND — a screen-by-screen migration checklist is a review artifact, not a unit test; (a) is covered by the View-inventory test, (b) by `ErrorBanner`'s verbatim-message test + the existing behavior suite, (c) by REQ-F001-030's baseline comparison | PROCESS (partially covered) |

### §6.4 Dual-theme preservation

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-023 | Three-path harness (dark / `[data-theme='light']` / OS-light); no unresolved var; no orphan survives | `dual-theme-harness.test.ts` (all three paths); `orphan-mapping.test.ts` (exhaustiveness) | DEFERRED |
| REQ-F001-024 | No in-app theme switcher / runtime `data-theme` setter introduced | `migration-completeness.test.ts` → `REQ-F001-024` block (**NEW**) | PASSES NOW |
| REQ-F001-052 | Bridge `@media (prefers-color-scheme: light)` block (OQ-11, RISK-1, carve-out C) | `dual-theme-harness.test.ts` → path-(iii) block (block exists, selector shape, gate-clean var()-only content, resolves to light value, dark-wins structural check) | DEFERRED |

### §6.5 Durable re-sync

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-025 | Re-sync is diff-based; no vendor hand-edit; single-edit propagation | `vendor-immutability.test.ts` (**PASSES NOW**), `adopted-tokens.test.ts` (single-source-of-truth propagation proxy) | Mixed |
| REQ-F001-026 | Bridge layer isolates/documents gaps; bound by both gates, not a size budget | `web/src/bridge/bridge.test.ts` | DEFERRED |
| REQ-F001-046 | Raw editor is the one named bridge candidate, composes `Textarea` + tokens | `bridge.test.ts` → raw-editor block | DEFERRED |

### §6.6 Migration completeness (adherence gates)

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-044 | JS/TS gate — rules i-iii (raw hex/px/off-system-font) enforced by whichever tool `npm run lint:ds` invokes (ESLint `no-restricted-syntax`, per ruling 1); rules iv/v (prop/variant, `no-restricted-imports` barrel) remain oxlint's; F-4 `--deny-warnings` run mode; F-5 import remap; seeded-violation exit codes | `web/tests/gates/adherence-gates.test.ts`: (a) rules i-iii — **tool-agnostic, behavior-based** (REDESIGN 1 below): seeds a raw-hex + raw-px + off-system-font-family `.tsx` fixture under `web/src/`, runs the real `npm run lint:ds`, asserts exit code only; (b) rules iv/v + F-4/F-5 run-mode — still legitimately inspects `.oxlintrc.json` directly, since oxlint remains the designated tool for those two rules | DEFERRED |
| REQ-F001-047 | stylelint CSS gate: scope, 5-file path-scoped exemption (NEW-1 + rev-6 5th file), seeded-violation exit codes | `adherence-gates.test.ts` (config existence, exemption shape, seeded-violation execution) — **unchanged by REDESIGN 1** | DEFERRED |
| REQ-F001-027 | No residual ad-hoc styling; both gates pass; index.css reduced | `migration-completeness.test.ts` + `adherence-gates.test.ts` | DEFERRED |

### §6.7 Phasing

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-028 | Phased migration acceptable; console builds/tests/renders at every intermediate state | PROCESS — "builds/tests at every intermediate state" is continuously verified by running the FULL suite (including these new F-001 tests) at every phase commit, not a single new test | PROCESS |
| REQ-F001-028a | Hard GTM gate: both gates green repo-wide, zero un-migrated areas | Composite of `adherence-gates.test.ts` + `migration-completeness.test.ts` (same executable checks; the spec's own test text for 028a restates 027/044/047) | DEFERRED |

### §7 Web UI Requirements

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-029 | Frontend-only boundary restated | `web/src/leakage.test.ts` (EXISTING) | PASSES NOW |
| REQ-F001-030 | A11y: no regression vs. captured baseline; AA target non-gating | `web/tests/gates/baseline-artifact.test.ts` (artifact existence, prerequisite); `DangerConfirm`/`ErrorBanner` existing a11y assertions (`role="dialog"`/`role="alert"`) as regression guards. **The actual contrast/AT re-measurement requires a real browser and is OUT-OF-BAND** — see Ambiguities/Untestable below for the exact recommended command (axe-core + a contrast-ratio script against the committed baseline) | Mixed / PROCESS for the numeric comparison |
| REQ-F001-031 | Layout/responsiveness parity at 1024/1280/1920 | **UNTESTABLE-AS-WRITTEN** in vitest+jsdom (no real layout engine/viewport). Recommended out-of-band check: a Playwright (or equivalent) visual/layout smoke test rendering the app shell, workspace list/detail, and settings forms at `1024×720`, `1280×720`, `1920×1080`, asserting no horizontal overflow of `document.scrollWidth` and no element clipping | UNTESTABLE-AS-WRITTEN here |

### §8 Non-Functional Requirements

| REQ | Requirement | Test(s) | Status |
|---|---|---|---|
| REQ-F001-032 | Custody boundary unchanged | `leakage.test.ts` (EXISTING) | PASSES NOW |
| REQ-F001-033 | Bundle budget ≤ baseline+10%; read-view p95 <1500ms | `baseline-artifact.test.ts` (prerequisite artifact existence only). **Numeric comparison is OUT-OF-BAND**: `npm run build` then `gzip -c dist/assets/*.js dist/assets/*.css \| wc -c`, compared against the committed baseline artifact's recorded value; p95 render requires a real-browser perf harness (e.g. Playwright `page.evaluate(() => performance...)`), not vitest+jsdom | UNTESTABLE-AS-WRITTEN here (artifact prerequisite only) |
| REQ-F001-034 | Build/type-check/lint/test all pass | PROCESS/OUT-OF-BAND — the genuinely-runnable check IS the existing script: `npm run build && npm test` from `web/` (wrapping `tsc`/`vite build`/gates inside a vitest test would just re-spawn the same tools redundantly and slowly) | PROCESS (documented command) |
| REQ-F001-035 | Maintainability: single token edit propagates, no per-screen edit | `adopted-tokens.test.ts` → single-source-of-truth block (structural proxy: the token is declared in exactly one adopted file) | DEFERRED |
| REQ-F001-049 | Pre-migration baseline artifact captured BEFORE migration | `baseline-artifact.test.ts` | DEFERRED (blocking prerequisite) |

### §9 Open Questions (all RESOLVED) — ruling-record requirements

These restate already-ratified rulings; each is exercised via the REQ it resolves, not independently:

| REQ | Ruling | Covered via |
|---|---|---|
| REQ-F001-036 (OQ-1) | DS coverage established | REQ-F001-016/045 tests |
| REQ-F001-037 (OQ-2) | Dual-theme coverage established | REQ-F001-023 tests (`dual-theme-harness.test.ts`) |
| REQ-F001-038 (OQ-3) | Re-sync cadence on-demand | REQ-F001-025 tests (no build gate to test; recorded) |
| REQ-F001-039 (OQ-6) | A11y WCAG 2.1 AA, non-gating | REQ-F001-030 |
| REQ-F001-040 (OQ-7) | GTM hard gate | REQ-F001-028a |
| REQ-F001-041 (OQ-8) | Phasing acceptable | REQ-F001-028 |
| REQ-F001-042 (OQ-4) | Internal-only exposure | not code-testable; prioritization record only |
| REQ-F001-043 (OQ-5) | Small operator base | not code-testable; prioritization record only |
| REQ-F001-050 (OQ-9) | Stylelint CSS gate ratified, path-scoped (NEW-1) | REQ-F001-047 tests |
| REQ-F001-051 (OQ-10) | Badge-token mapping ratified | REQ-F001-048 tests |
| REQ-F001-054 (OQ-11) | Bridge `@media` block ratified (RISK-1) | REQ-F001-052 tests |
| REQ-F001-055 (OQ-12) | Seven-token mapping ratified (RISK-2) | REQ-F001-053 tests |

## Phase 4 follow-up (2026-07-09/10) — two human rulings, two test redesigns

Two areas of the suite were found, on QA review, to mis-encode the spec. Both were corrected per
explicit human ruling (never weakened — each correction makes the test a MORE faithful, not looser,
check of its governing REQ).

### REDESIGN 1 — the JS/TS adherence gate moves to ESLint; `adherence-gates.test.ts`'s JS/TS
assertions are now tool-agnostic

**Ruling:** REQ-F001-044's raw-literal floor (rules i-iii — no raw hex, no raw `px`, no off-system
`font-family` in JS/TS/JSX) is enforced by ESLint's native `no-restricted-syntax` (oxlint 1.73 has no
equivalent AST rule). oxlint is retained ONLY for rule iv (prop/variant restriction) and rule v
(`no-restricted-imports` barrel discipline). The command contract for the JS/TS gate, regardless of
which tool(s) it wraps, is **`npm run lint:ds`** (run from `web/`), which MUST exit non-zero on ANY
violation.

**What changed in `web/tests/gates/adherence-gates.test.ts`:** the "Gate execution" describe block's
JS/TS test no longer invokes oxlint directly against a hand-built `-c <config>` CLI call, nor asserts
on `.oxlintrc.json` rule content for rules i-iii. It now:
1. Seeds a single throwaway fixture `web/src/__f001_gate_fixture__.tsx` containing a combined raw-hex +
   raw-`px` + off-system-`font-family` literal (all three of rules i-iii at once).
2. Invokes the REAL `npm run lint:ds` command (the same command CI/`build` runs) and asserts its exit
   code is non-zero.
3. Overwrites the fixture with clean code and re-asserts `npm run lint:ds` exits zero.
4. Removes the fixture in a `finally` block regardless of outcome.

Rules iv/v and the F-4 (`--deny-warnings` run mode) / F-5 (import-pattern remap) checks are UNCHANGED
and still legitimately inspect `.oxlintrc.json` directly — oxlint remains the designated tool for
those two rules, so asserting on its config there is not "asserting on tool internals" in the sense
the ruling forbids; that prohibition applies specifically to the rules i-iii floor that moved to
ESLint. The REQ-F001-047 stylelint CSS-gate assertions are byte-for-byte unchanged.

**Command contract assumed:** `npm run lint:ds` = the JS/TS gate (whatever it wraps); `npm run
lint:css` = the stylelint CSS gate (unchanged). Both already exist in `web/package.json` today
(`lint:ds` currently = oxlint only); Round B's implementer job is to make `lint:ds` also invoke
whatever enforces rules i-iii (e.g. `eslint . && oxlint ...`), not to rename the script.

**Result:** this test is RED as of this run (2026-07-10) — `npm run lint:ds` does not yet catch the
seeded literal (oxlint alone, today's `lint:ds`, has no i-iii rules), which is the correct
pre-implementation signal per REQ-F001-044(i-iii) not yet being wired via ESLint.

### REDESIGN 2 — the className count-lock becomes an accounting/disposition gate;
`migration-completeness.test.ts`

**Ruling:** the original test asserted `className` count `=== 143` across `=== 22` files against LIVE
disk. This over-constrains the spec: REQ-F001-019/-016 REQUIRE componentization (replacing one-off
`className`s with DS component usage), which necessarily SHRINKS the live count — a live count-lock
forbids the very migration the spec mandates.

**What changed:**
1. The 143/22 figure is preserved as REQ-F001-009's **baseline of record** in a new static, dated doc:
   `docs/design/F-001/baseline-classname-inventory-2026-07-07.md` (records the count, the file scope,
   and the ~40 bespoke selector names being migrated from). The first describe block in
   `migration-completeness.test.ts` now asserts ONLY against this doc's own content (existence, the
   `143`/`22` figures, the `2026-07-07` date, a `REQ-F001-009` citation) — **never** against a live
   `web/src` scan. This test **PASSES NOW** and will keep passing regardless of how far the live count
   shrinks, because it no longer touches live disk at all.
2. REQ-F001-010's actual *Test* clause ("a static inventory enumerates every className site; each maps
   to a governing-system component or token usage, an isolated bridge, or a removal — none is left as
   an unaccounted-for ad-hoc class") is now enforced as a **disposition/accounting gate** over the
   CURRENT tree, in a new second describe block, replacing the old fixed-blacklist "no legacy adhoc
   class survives" check (which could only catch reintroduction of the ORIGINAL 143 class names, not a
   brand-new ad-hoc class). The new mechanical check, per literal `className` token used in a
   screen/shared-component source file:
   - Builds a registry of every CSS class selector defined anywhere in the non-token-exempt
     `web/src` `.css`/`.module.css` tree (excluding the five REQ-F001-047 path-exempt DS-token files,
     which mirrors — by independent duplication, not cross-import, to keep the two suites
     decoupled — the exemption list in `adherence-gates.test.ts`), together with whether EVERY rule
     defining that class, tree-wide, is free of raw hex/`px` in its declaration body.
   - A `className` token PASSES only if it is defined by at least one CSS rule AND every rule that
     defines it is hex/`px`-clean (i.e. genuinely DS-token-referencing composition — `var(...)` — not
     an ad-hoc rule wearing a new class name). This is exactly why the pre-migration `index.css`
     (still raw-hex/`px`, not exempt) correctly makes every legacy class FAIL today — the check is not
     vacuously satisfied by "the class exists somewhere."
   - A token that is undefined anywhere, or defined only by an unclean rule, is reported as an
     unaccounted-for ad-hoc class and fails the gate.
   - This is **count-independent**: DS-component substitution that removes `className` sites entirely,
     or re-expresses them as token-referencing composition classes, both pass; a brand-new ad-hoc class
     the 2026-07-07 inventory never saw still fails on its own (lack of) merits.
3. The `REQ-F001-009/027 — index.css reduced to token layer + documented residual only` block (checks
   that `index.css` no longer *defines* the ~40 legacy selectors) and the View/nav-inventory and
   theme-switcher-guard blocks are **unchanged** — they were not implicated by the ruling.

**Mechanical-check limitation (documented per QA brief):** this is a static, textual CSS-rule scan
(brace-matching + regex), not a real CSS parser/cascade resolver — it does not resolve selector
specificity, `@supports`, preprocessor features, or a `className` string assembled from more than one
template-literal expression at a usage site (an inherited limitation of the existing
`extractClassNameTokens` helper, unchanged from before this redesign). It also does not itself
re-verify `font-family` per class — that dimension is already covered, gate-wide over ALL non-exempt
CSS, by REQ-F001-047's own execution test in `adherence-gates.test.ts`, so re-checking it here would be
redundant rather than additive. These are flagged as remaining review-artifact territory rather than
silently assumed sound.

**Result:** this test is RED as of this run (2026-07-10) for a genuine, informative reason — the
in-progress first-pass token-composition migration already introduced several literal `className`
strings with NO backing CSS rule anywhere in the tree (`ac-page-description` in `App.tsx`,
`danger-consequence` in `DangerConfirm.tsx`, `ac-set-badge` in `SetNotSetBadge.tsx`, `secret-field` in
`SecretField.tsx`, `settings-page` in `SettingsPage.tsx`, `attached`/`available` in
`KnowledgePanel.tsx`). This is exactly the class of gap REQ-F001-010/019 requires the gate to catch;
it is real signal for the next implementer round, not a test defect.

## Files created by this task

```
tests/TEST_PLAN.md                                              (this file)

web/src/test/fsScan.ts                                          shared test-only fs-scan helpers (not a test file itself)

web/src/design-system/tokens/adopted-tokens.test.ts              REQ-F001-014/017/018/035
web/src/design-system/tokens/orphan-mapping.test.ts              REQ-F001-048/053
web/src/design-system/tokens/dual-theme-harness.test.ts          REQ-F001-023/052

web/src/bridge/bridge.test.ts                                    REQ-F001-026/046

web/src/components/SetNotSetBadge.test.tsx                       REQ-F001-011/020 (parent REQ-060)

web/tests/inventory/migration-completeness.test.ts               REQ-F001-002/008/009/010/012/019/024/027
web/tests/gates/adherence-gates.test.ts                          REQ-F001-044/047
web/tests/gates/vendor-immutability.test.ts                      REQ-F001-015/025
web/tests/gates/baseline-artifact.test.ts                        REQ-F001-049

docs/design/F-001/baseline-classname-inventory-2026-07-07.md    REQ-F001-009 baseline of record (static, dated; see REDESIGN 2)
```

Pre-existing, reviewed-not-duplicated (found already present, untracked, in the working tree at task
start — high quality, spec-cited, correctly `SPEC-DEFERRED`-labeled; left as-is):

```
web/src/design-system/index.test.ts
web/src/design-system/components/{Badge,Button,IconButton,Input,Modal,PageHeader,Select,SidebarItem,Table,Textarea,Toggle}.test.tsx
```

## Ambiguities / untestable-as-written requirements needing human ruling or acknowledgement

1. **REQ-F001-004 / REQ-F001-007** (no change to AnythingLLM's own app; no rebrand/logo) — these are
   negative claims about things OUTSIDE this repo (a separate AnythingLLM instance) or about the
   ABSENCE of a future authoring decision. Neither is mechanically checkable by a static scan of this
   repo with high confidence (a logo asset could be added under many different paths/names). Flagged
   as untestable-as-written rather than guessed at with a brittle check. Recommend: PR-review-time
   scope check (diff touches only `web/`) for -004, and a manual design-review sign-off for -007.
2. **REQ-F001-022** ("(a)/(b)/(c) screen-by-screen checklist") is explicitly a reviewer-facing
   process artifact in the spec's own text ("a reviewer can confirm no workflow step was added,
   removed, or reordered"), not a mechanical test. I did not invent a mechanical proxy beyond what's
   already covered elsewhere (View inventory, verbatim-message tests) to avoid asserting something
   the spec did not actually fix.
3. **REQ-F001-030 / REQ-F001-033** (a11y contrast measurement; bundle-size/perf measurement) — both
   require a real browser + production build pipeline, which is out of scope for vitest+jsdom. I
   wrote the prerequisite-artifact-existence check (REQ-F001-049) as the unit-testable slice and
   documented the exact out-of-band commands rather than simulating browser measurement with a fake
   number, which would give false confidence.
4. **REQ-F001-031** (viewport layout parity) is likewise a real-layout-engine concern; documented the
   recommended Playwright-based check rather than attempting a jsdom approximation that wouldn't
   actually exercise CSS layout.
5. **RISK-4 prop gaps** (`docs/design/F-001/01-component-contracts.md` §3 — `Input.readOnly`,
   numeric-bounds props, `Modal.style`/`aria-label`, `Button.title`/`aria-label`, etc., needed by
   current usages but absent from the vendored `.d.ts`): the pre-existing component test files
   (`Input.test.tsx`, `Modal.test.tsx`, etc.) correctly assert ONLY the props the vendored `.d.ts`
   declares, per REQ-F001-045's letter ("matching each component's `.d.ts` prop contract"). This is
   the most defensible reading, but it means these tests do NOT guard against a real integration gap
   (e.g. `SecretField`'s need for `Input readOnly`) — that gap is a genuine open design question the
   architect flagged (RISK-4) and explicitly left unresolved ("flagged for a decision — not resolved
   here"). **This is not a spec ambiguity** (the spec's contract-matching text is clear) but IS a
   design-doc-flagged risk that should get an explicit human/architect ruling before Phase 1 lands,
   analogous to how OQ-9..OQ-12 were resolved. Recommend routing RISK-4 for a ruling the same way.
6. **Design-doc staleness note (not a spec conflict):** `docs/design/F-001/00-design.md` §5 still
   lists RISK-1 (`prefers-color-scheme` gap) and RISK-2 (seven extra `--theme-*` orphans) as
   **UNRESOLVED**, and `02-tokens-and-gates.md` §1 says the `prefers-color-scheme` fallback is
   "UNRESOLVED (RISK-1)". The SPEC (rev 6) has since resolved both via REQ-F001-052/053 (rulings
   OQ-11/OQ-12). Per this task's own instruction ("the SPEC is authoritative; if the design doc
   conflicts with the spec, the spec wins"), all tests here follow the spec's rev-6 resolution, NOT
   the design doc's stale unresolved framing. Flagging so the design docs get refreshed to rev 6
   before implementation starts, to avoid an implementer building against the stale RISK framing.
7. **REQ-F001-053's exact bridge light-source token file name/location** is not pinned by the spec
   (only described conceptually: "a single co-located light-source token file... added to
   REQ-F001-047's exemption list as a fifth explicitly-named file"). `dual-theme-harness.test.ts` and
   `adherence-gates.test.ts` therefore locate it structurally (any `.css` under `web/src` containing
   the `@media (prefers-color-scheme: light)` block; any 5th exemption glob beyond the four named
   token files) rather than assuming an implementer-chosen filename — this is the most defensible
   reading given the spec leaves the name to the implementer.
8. **(Phase 4 follow-up, REDESIGN 2) The className disposition/accounting gate's "gate-clean" check is
   a self-contained approximation of REQ-F001-047, not a re-invocation of the real stylelint gate.**
   `migration-completeness.test.ts` scans CSS rule bodies for raw hex/`px` textually (its own regex),
   rather than shelling out to `stylelint`. This is intentional (keeps the accounting gate fast and
   independent of the stylelint gate's execution/availability) but means the two checks could in
   principle diverge if stylelint's real rule set grows beyond hex/`px`/font (e.g. a future
   `color-no-hex`-adjacent rule). Recommend an occasional manual cross-check that the two stay in sync,
   or that a future revision has the accounting gate re-run its "clean" predicate by literally invoking
   stylelint per matched file (a stronger but slower design left open for maintainer discretion).
9. **(Phase 4 follow-up, REDESIGN 2) "Component usage" (disposition (a)) is not independently checked
   by name.** The accounting gate only inspects literal `className` string tokens; it does not verify
   that a given screen actually renders the intended DS React component (e.g. `<Table>` vs. a bare
   `<div>` with a composition class). That distinction is covered elsewhere (the per-component contract
   tests + a reviewer's screen-by-screen migration record, REQ-F001-022) rather than duplicated here —
   documented as a review-artifact boundary, not silently assumed.
