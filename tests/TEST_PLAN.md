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

---

# TEST_PLAN — F-002 Customer-Wide Baseline System Prompt

Spec: `specs/F-002-customer-system-prompt.md` (Draft rev 9, ratified, no open blocking questions)
Parent spec: `specs/admin-console.md` (v1, rev 7)

## Framework & harness choice

This repo already has two established, working suites:

- BFF: `vitest` (node environment), route/integration style, driven through
  `buildApp()` + `app.inject()`, with the engine adapter mocked at the module boundary
  (`vi.mock('../../src/engine/adapter.js', ...)`) and real SQLite in a per-test tmp dir.
  Convention file: `bff/test/routes/workspaces.routes.test.ts`.
- Web: `vitest` + `@testing-library/react` (jsdom environment), colocated `*.test.tsx`
  files next to components (e.g. `web/src/components/DangerConfirm.test.tsx`).

F-002 has **no implementation yet** in either package: no `bff/src/routes/baseline-prompt*`,
no `bff/src/services/baseline*`, no `web/src/features/baseline-prompt/`. `buildApp()`
(`bff/src/index.ts`) does not register any baseline route. This is expected — the suite
below is written strictly from the spec and MUST fail (404 / missing route / assertion
failures), not error on syntax/import problems in the test files themselves, until F-002
ships.

Per the repo's own vitest `include` globs (`bff/vitest.config.ts` → `test/**/*.test.ts`;
`web` has no explicit `include`, colocated `*.test.tsx` is the working convention), the
executable BFF suite is placed under `bff/test/` (mirroring `bff/test/routes/*.test.ts`
and `bff/test/store/baseline-migration.test.ts`, which already seeds/migrates the
`baseline_prompt` / `workspace_baseline_state` tables this feature needs) so `npm test`
in `bff/` actually discovers and runs it. This `tests/` directory holds this plan plus
any test-role artifacts that are not framework-executable BFF/web specs.

Because the web UI (REQ-F002-029 through REQ-F002-034, REQ-F002-060) has zero scaffolding
to target (no route, no component, no `features/baseline-prompt/` directory, no app-level
(non-workspace) settings nav item to hook a `render()` into), those requirements cannot be
turned into an executable RTL test without inventing a component path/shape the spec does
not specify. They are covered instead as UI-level / e2e / manual checklist items at the
bottom of this plan (see "UI-level checks — not automated here"), consistent with the
instruction to note such cases rather than fabricate implementation shape.

All BFF requirements — including the API contract (§7), composition semantics (§5),
drift/override (§6.4), the danger gate (§6.3/§8's server-side half), events/audit (§9), and
non-functional bounds (§10) — ARE testable purely against the documented route surface and
are included below as executable `app.inject()` integration tests.

## Traceability: requirement -> planned test(s)

Legend: file = `bff/test/routes/baseline-prompt.routes.test.ts` unless noted.

| REQ | Requirement (short) | Test name(s) |
|---|---|---|
| REQ-F002-001 | Baseline persists once per deployment; apply writes engine `openAiPrompt` via PATCH settings | `apply writes the composed prompt to the engine via PATCH /settings, never from the browser` |
| REQ-F002-002 | Best-effort, not tamper-proof; out-of-band edit not blocked, workspace becomes `overridden` | `an out-of-band edit after a successful apply is not blocked and reports overridden, not synced` |
| REQ-F002-003 | No new engine capability/custody path — only PATCH /settings + console store | `no new engine call shape is introduced by the fan-out beyond PATCH /settings` (static/behavioral check via mock call assertions across the suite) |
| REQ-F002-004 | Native default system prompt / prompt variables unreachable; MUST NOT be read/written | `no F-002 route or service path touches /system/default-system-prompt or /system/prompt-variables` (static grep-style test) |
| REQ-F002-005 | Tamper-proof enforcement is a non-goal | covered by REQ-F002-002 test (no prevention mechanism exists) |
| REQ-F002-006 | No continuous/automatic enforcement; apply/re-sync always explicit | `creating a workspace does not trigger any automatic engine write` (covered jointly with REQ-F002-026) |
| REQ-F002-007 | Per-workspace prompt editing unchanged (parent territory) | out of scope for F-002 suite (parent-owned; not re-tested here) |
| REQ-F002-008 | No chat UI change | non-testable via BFF/route surface; UI-level note only |
| REQ-F002-009 | Cross-deployment sharing out of scope | `baseline_prompt is a true singleton (only one row, no per-customer key)` (covered by migration test, already exists) |
| REQ-F002-010 | Store adds `baseline_prompt` + `workspace_baseline_state`; singleton; "not defined" before any write | covered by existing `bff/test/store/baseline-migration.test.ts`; route-level: `GET /api/baseline-prompt before any write reports not defined` |
| REQ-F002-010a | Drift computed from fresh engine read, not cached prompt | `status reflects a live engine prompt change without any console write in between` |
| REQ-F002-010b | Baseline content not redacted in events/audit | `admin.baseline_prompt.updated event and audit entry carry the baseline content reference, not redacted` |
| REQ-F002-010c | SHA-256 lowercase-hex hash; identical composed text -> identical hash; 1-byte diff -> different hash | `two applies producing byte-identical composed prompts record identical applied_composed_hash`; `a one-byte differing composed prompt produces a different applied_composed_hash` |
| REQ-F002-010d | `composition_mode` read-only for F-002, null-safe, never written/defaulted by F-002 | `F-002 never writes composition_mode`; `a NULL/absent composition_mode resolves exactly as rev-3 (operator mode)` (also see REQ-F002-059) |
| REQ-F002-011 | `compose` prepend: cleared baseline -> R; empty R -> B; both non-empty -> B+SENTINEL+R | `prepend: baseline+sentinel+remainder byte-for-byte`; `prepend: empty remainder -> baseline exactly`; `prepend: cleared baseline -> remainder exactly (or empty string)` |
| REQ-F002-012 | First-apply structural remainder capture + double-prepend guard (prepend only) | `first apply, empty prompt -> empty remainder`; `first apply, plain prompt (no sentinel) -> captured verbatim as remainder`; `first apply, prompt already B+SENTINEL+Y -> remainder=Y, no doubled baseline` |
| REQ-F002-013 | Re-sync recomposes from stored remainder per mode (prepend/overwrite/fill) | `re-sync after baseline change updates baseline segment, leaves remainder byte-identical (prepend)`; `re-sync in overwrite mode writes new baseline alone` |
| REQ-F002-014 | No silent remainder mutation outside capture/override-resolve | `baseline-only change + re-sync leaves every stored remainder unchanged` |
| REQ-F002-015 | GET /api/baseline-prompt view (not-defined vs defined) | `GET before any set reports not defined`; `GET after a set shows stored text + metadata` |
| REQ-F002-016 | PUT create/replace; console-store only; zero engine writes | `PUT updates stored baseline and issues zero engine PATCH calls` |
| REQ-F002-017 | Staff-auth required; audited; not itself a danger op | `unauthenticated PUT -> 401`; `a successful PUT produces one audit entry and no engine mutation` |
| REQ-F002-018 | Whitespace-only rejected 400; clearing not via PUT | `whitespace-only baseline -> 400`; `non-empty baseline accepted`; `PUT cannot clear the baseline` |
| REQ-F002-046 | DELETE clears to NULL; console-store only; synced->stale; apply w/ never-defined+no-tracked -> 400 | `DELETE sets baseline to null and issues zero engine writes`; `DELETE marks previously-synced workspaces stale`; `apply after clear rewrites tracked workspaces to remainder alone`; `apply with baseline never defined and no tracked workspace -> 400` |
| REQ-F002-019 | Preview: affected/unchanged counts, per-workspace diff, mode-resolved branches, zero engine writes | `preview issues zero engine writes`; `affected count equals workspaces whose compose(...) differs from live`; `prepend: overridden item carries both composedIfPreserve/composedIfDiscard`; `overwrite: item shows current-vs-B with destruction`; `fill: non-empty workspaces marked skipped` |
| REQ-F002-020 | confirmToken binds snapshot incl. mode/target-set/baseline/hashes/resolvedMode; absent->400; stale->409 | `preview returns non-empty confirmToken and confirmationPhrase`; `apply with missing token -> 400, zero writes`; `apply with superseded token -> 409, zero writes` |
| REQ-F002-021 | Apply route; danger gate 3 artifacts; validation order; synchronous 200 result | `fan-out withheld until valid confirmToken+typedConfirmation+mode`; `stale token or mode mismatch -> 409, zero writes`; `valid apply -> 200 BaselineApplyResult with per-workspace outcomes` |
| REQ-F002-022 | Per-workspace verify-after-write; failed write leaves prior prompt, no state update | `one workspace PATCH forced to fail -> that workspace failed, engine prompt unchanged, state row not updated, others applied` |
| REQ-F002-022a | No atomicity; per-workspace outcome list; never a single "all applied" on partial failure | `3-of-4 apply renders 3 applied + 1 failed with the failed workspace named` |
| REQ-F002-022b | Re-tryability; idempotent re-run | `re-running apply after partial failure targets only still-drifted workspaces, skips already-synced` |
| REQ-F002-023 | Sync-state classification via classifyMode ONLY, first-match-wins precedence | `overridden: out-of-band edit matching neither reconstruction nor last-applied hash`; `stale: unchanged since apply but baseline edited afterward`; `synced: untouched current`; `never-applied: no state row`; `baseline-only/inherit synced with retained remainder reports synced not overridden`; `stale-vs-overridden precedence worked example (operator overwrite/fill, unedited, baseline changes -> stale not overridden)`; `classification never consults resolvedMode (status surface has no mode param)` |
| REQ-F002-024 | Drift visibility surface; 4 states distinguishable, not color-only | `status view lists every workspace with its sync state and all 4 states` (color-only encoding is a UI-level check) |
| REQ-F002-025 | Override resolution (prepend-resolved): preserve/discard mandatory; baseline-only exempt | `prepend-resolved overridden workspace not applied without explicit resolution`; `preserve makes out-of-band text the new remainder`; `baseline-only overridden workspace requires no resolution and an overrides entry naming it is 400` |
| REQ-F002-026 | New-workspace inheritance surfaced as never-applied, not auto-applied | `workspace created after baseline exists lists as never-applied and only receives baseline after explicit apply` |
| REQ-F002-050 | Overrides binding: prepend-only; overwrite/fill overrides must be empty (400); missing resolution -> skipped; overrides on non-overridden -> 409; baseline-only overrides entry -> 400 | `prepend: missing resolution for overridden target skips just that workspace, others apply`; `overrides naming a non-overridden workspace -> 409`; `overwrite/fill mode with non-empty overrides -> 400`; `overrides entry naming a baseline-only workspace -> 400` |
| REQ-F002-027 | Re-sync after baseline change: stale->synced, remainders preserved, per-workspace outcomes | `after baseline edit, previously-synced workspaces report stale`; `re-sync returns them to synced with remainders preserved` |
| REQ-F002-028 | Every route BFF-brokered; apply's engine traffic is exactly per-workspace PATCH calls | `apply's only engine calls are per-workspace PATCH /settings-equivalent adapter calls` |
| REQ-F002-029 | Console-level settings surface | UI-level check (not automated here — no scaffolding to target) |
| REQ-F002-030 | Preview mandatory before apply enabled in UI | UI-level check |
| REQ-F002-031 | Danger gate; destructive blast-radius = union(resolvedMode=overwrite, overridden baseline-only) | `blast-radius count over overwrite-resolved + overridden baseline-only workspaces, excluding synced baseline-only and excluding stored-append workspaces even under operator overwrite` — modeled at the preview/apply-result level since the dialog itself is UI; `fan-out only fires after typed phrase + confirmToken match` (server-side half, via apply route) |
| REQ-F002-032 | UI partial-failure legibility | UI-level check (server-side data already covered by REQ-F002-022a) |
| REQ-F002-033 | Non-color-only drift status | UI-level check |
| REQ-F002-034 | Accessibility: focus mgmt, ARIA live region, sync result announcement | UI-level check |
| REQ-F002-035 | Event catalog: `admin.baseline_prompt.updated` (set/cleared), `admin.baseline_prompt.applied` | `PUT emits one admin.baseline_prompt.updated (cleared:false) and zero engine events`; `DELETE emits one with cleared:true`; `apply changing 3 workspaces emits 3 admin.workspace.updated + 1 admin.baseline_prompt.applied with correct/disjoint id lists` |
| REQ-F002-036 | Audit: baseline set + every apply/re-sync, with per-workspace breakdown on partial apply | `a baseline set produces one audit entry`; `a partial apply produces an audit entry with per-workspace applied/failed breakdown` |
| REQ-F002-037 | Custody boundary restated | covered structurally: all engine calls flow through the mocked adapter only, never a raw browser-reachable engine URL (implicit in every test using `app.inject` against `/api/*`) |
| REQ-F002-038 | Reversibility caveat stated in confirm dialog copy | UI-level check |
| REQ-F002-039 | Perf bounds (preview p95<3000ms, per-ws write+verify p95<1500ms) | `preview responds within budget under a bounded workspace count`; `per-workspace write+verify completes within budget` — implemented as generous smoke-level latency assertions, not a load-test (see Notes) |
| REQ-F002-040 | Concurrency/staleness: per-workspace divergence reported, not whole-apply reject | `editing a workspace out-of-band between preview and apply -> that item diverged (no write), others apply` |
| REQ-F002-041..045, 053, 054 | Open-questions section — ratified rulings, not independently testable; behavior is captured by the REQ ids they govern (055/059/046/058 etc.) | no standalone test; traced via governing REQ tests |
| REQ-F002-047 | Token staleness vs per-workspace divergence; mode-change divergence in resolved-branch vocabulary | `baseline or mode change after preview -> 409, zero writes`; `single workspace out-of-band edit after preview -> token stays valid, that item diverged, rest apply`; `stored composition_mode change between preview/apply that changes resolved branch -> diverged`; `stored composition_mode change that resolves to same branch -> NOT diverged, proceeds` |
| REQ-F002-048 | Two artifacts (confirmToken machine value + typedConfirmation human phrase); mode is 3rd bound param | `valid confirmToken + wrong typedConfirmation -> 409, zero writes`; `matching pair proceeds` |
| REQ-F002-049 | DEPRECATED — no async job model | `no F-002 route returns 202 or a jobId`; `no GET /api/baseline-prompt/apply/:jobId route exists`; `no F-002 response carries nextCursor` |
| REQ-F002-051 | Orphaned-state cleanup on admin.workspace.deleted | `deleting a tracked workspace removes its workspace_baseline_state row`; `status/preview omit a workspace no longer in the engine list` |
| REQ-F002-052 | Target set = all live workspaces; no per-workspace opt-out; cleared baseline restricts to tracked | `preview/apply consider every live workspace`; `only changed workspaces are written`; `no per-workspace include/exclude parameter is honored` |
| REQ-F002-055 | Operator-selectable mode; preview/apply mode agreement; absent/unknown mode -> 400; stored mode overrides operator mode | `preview and apply must agree on operator mode (mismatch -> 409)`; `apply with missing/unknown mode -> 400`; `stored-mode workspace composed under stored mode not operator mode` |
| REQ-F002-056 | `compose` overwrite: B replaces field entirely, no sentinel/remainder; cleared baseline -> R; remainder emptied on verified apply | `overwrite: composed equals baseline exactly regardless of prior prompt, remainder emptied`; `overwrite with cleared baseline -> R (clear-then-apply strips field)` |
| REQ-F002-057 | `compose` fill: empty prompt -> B; non-empty -> skipped; null baseline -> all skipped | `fill: empty-prompt workspace receives baseline alone`; `fill: non-empty-prompt workspace skipped, engine prompt unchanged`; `fill with null baseline -> every workspace skipped` |
| REQ-F002-058 | Synchronous bounded apply: ceiling, time bound, batched concurrency | `apply over N seeded workspaces returns 200 BaselineApplyResult synchronously using concurrent (overlapping) writes, not strictly serial` (modeled at reduced N for test speed; see Notes) |
| REQ-F002-059 | Per-workspace effective-mode resolution (stored mode authoritative; F-003 append/inherit mapping; NULL fallback; out-of-domain defense; snapshot binding) | `(a) F-003 absent -> operator mode for every workspace`; `(b) stored append workspace keeps prepend composition under operator overwrite`; `(c) never-touched workspace uses operator overwrite`; `(d) stored inherit workspace -> baseline-only, remainder retained`; `(e) stored mode change after preview -> diverged, rest apply`; `(f) out-of-domain stored mode (e.g. 'override') falls back to operator mode, never reaches overwrite via stored-mode path` |
| REQ-F002-060 | UI native-default advisory, persistent | UI-level check (no scaffolding to target; documented below) |

Total REQ ids covered: 60/60 (REQ-F002-001 through REQ-F002-060, all sub-lettered items
under 010/022 included). Of these, the following are UI-only and are not independently
executable as BFF or currently-scaffolded web tests, and are listed under "UI-level
checks" below instead of being force-fit into a test that would target invented
component internals: REQ-F002-008, 029, 030, 031 (UI-half only — the server-side half IS
covered), 032, 033, 034, 038, 060. All other 51 requirement ids have concrete executable
tests below.

## Test files

- `bff/test/store/baseline-migration.test.ts` — PRE-EXISTING (not written by this task);
  covers the schema half of REQ-F002-010/010c/010d. Not duplicated here.
- `bff/test/routes/baseline-prompt.routes.test.ts` — NEW. The bulk of the executable
  suite: `GET/PUT/DELETE /api/baseline-prompt`, `GET /api/baseline-prompt/status`,
  `GET /api/baseline-prompt/preview`, `POST /api/baseline-prompt/apply`. Covers §5, §6,
  §7, §9, and the server-observable half of §8/§10.
- `bff/test/routes/baseline-prompt.compose.test.ts` — NEW. Focused, denser coverage of
  the composition-function matrix (§5: prepend/overwrite/fill, cleared-baseline domain,
  first-apply structural capture, double-prepend guard) exercised end-to-end through
  preview/apply, since no pure `compose()` module exists yet to unit-test directly. This
  file is deliberately split out because the composition function is the spec's own
  self-check's #1 divergence risk and benefits from an isolated, example-dense file.
- `bff/test/routes/baseline-prompt.resolution.test.ts` — NEW. REQ-F002-059 per-workspace
  effective-mode resolution matrix (a)-(f), REQ-F002-023 sync-state classification
  precedence, REQ-F002-047 divergence-vs-staleness, and REQ-F002-031's destructive
  blast-radius union — the spec's named highest-risk areas — isolated for the same reason.
  Simulates F-003 (unbuilt) by writing `composition_mode` directly via raw SQL onto the
  shared `workspace_baseline_state` row, exactly as F-003's editor-save path would
  (REQ-F002-010d) — F-002 code itself must only ever READ this column.
- `bff/test/routes/baseline-prompt.performance.test.ts` — NEW. REQ-F002-058 (batched
  concurrency, observed via overlapping in-flight PATCH windows) and REQ-F002-039/049
  (synchronous single-response smoke-level latency, explicitly NOT a load test).

## Design notes / how ambiguity was handled

- The route contract is taken from REQ-F002-021/047/048/055 prose (mode is a required,
  bound, validated apply parameter) rather than the abbreviated §7.2 table example, per
  explicit instruction. Every apply request body in these tests includes `mode`.
- `resolvedMode` (preview/apply-only, folds in operator mode) and `classifyMode`
  (status-only, no operator mode) are tested as strictly separate notions per rev 8's
  explicit fix: `baseline-prompt.resolution.test.ts` asserts the status surface never
  varies with the operator-selected mode query param, and the preview surface's
  `resolvedMode` is asserted directly on `BaselinePreviewItem`.
- REQ-F002-058's "batched, not serial" concurrency requirement is tested behaviorally: the
  engine-adapter mock's `updateWorkspace` records timestamps/in-flight overlap so the test
  can assert concurrent (overlapping) invocation rather than asserting wall-clock timing
  against production-scale (200) workspace counts, which would make the suite slow and
  flaky in CI. A reduced-but-plural workspace count (e.g. 6-10) with an artificial
  per-write delay in the mock is used to make overlap observable and deterministic. This
  is a SPEC-AMBIGUITY-adjacent judgment call, not a weakening: the spec's own *Test*
  clause for REQ-F002-058 asks to "observe overlapping in-flight PATCHes," which this
  approach does directly, without requiring an actual 200-workspace/60s run in the unit
  suite. The literal ≤200-workspace / p95<60s ceiling is left to a dedicated
  perf/load-test run outside this unit suite (noted, not silently dropped).
- REQ-F002-039's p95 latency bounds are asserted as generous smoke-level ceilings (an
  order of magnitude looser than the spec's p95 numbers) against a handful of mocked
  (near-instant) engine calls, since a real p95 measurement requires load-test tooling
  and many samples, not a unit test. This is flagged in the test file comments so it is
  not mistaken for a real performance/load-test guarantee.
- REQ-F002-004's "no F-002 code path references `/system/default-system-prompt` or
  `/system/prompt-variables`" and REQ-F002-003's "no new engine `/v1/*` path" are static
  checks. Since there is no F-002 source yet, these are written as tests that will scan
  `bff/src/routes`, `bff/src/services`, and `web/src` for the forbidden substrings once
  the feature exists — they pass trivially today (nothing to scan matches) and start
  doing real work the moment F-002 source lands. This mirrors the existing static-scan
  style already used for other REQ ids' *Test* clauses.

## SPEC-AMBIGUITY findings requiring human ruling

None found that block writing a concrete test. All REQ ids in scope for BFF/API-level
testing have a *Test:* clause specific enough to derive an assertion from, INCLUDING the
four priority areas called out in the task (composition matrix, REQ-F002-059 resolution,
REQ-F002-023 classification precedence, and the two-artifact danger gate) — rev 8/9 of
this spec exist specifically to close the ambiguities a prior review round found in these
areas (the `resolvedMode`-vs-`classifyMode` contradiction and the `stale`-vs-`overridden`
precedence order), and both fixes are stated as explicit, worked examples the tests below
encode directly.

One item is flagged for awareness (not a blocker, not treated as ambiguous): the §7.2
route table's abbreviated apply-body example omits `mode`. Per instruction, this is
resolved as prose-governs and every apply test includes `mode`; this is a documentation
inconsistency in the spec, not a behavioral ambiguity, so no test was weakened or
`SPEC-AMBIGUITY`-tagged for it.

---

# TEST_PLAN — F-005 Per-Customer Feature Toggle Console

Spec: `specs/F-005-per-customer-feature-toggle-console.md` (Draft rev 5 — all open questions
RATIFIED 2026-07-12; REQ-F005-053..057 are binding human rulings, treated as normal REQs)
Parent spec: `specs/admin-console.md` (v1, rev 7). Grounding refs: `docs/governing-architecture.md`,
`docs/design/03-data-models.md`, `docs/design/02-product-api.md`, `docs/design/05-web-architecture.md`,
`docs/design/F-001/01-component-contracts.md`. Event bus: `specs/F-004-production-event-bus.md`.

## Framework & harness choice

Same two established suites as F-002 (see above): BFF `vitest` (node env) via `buildApp()` +
`app.inject()`, and web `vitest` + `@testing-library/react` (jsdom) with colocated `*.test.tsx`
files. This feature adds NO new framework.

A migration test for the F-005 store table already exists —
`bff/test/store/feature-toggle-migration.test.ts` — written by the migration agent and **left
untouched** by this task (covers REQ-F005-012/014/015/018/021/025 at the schema/repository level:
table shape, LWW upsert, byte-for-byte key matching, delete-is-idempotent, rollback/roundtrip). It is
cited below wherever it already satisfies a REQ's *Test* clause so no test is duplicated.

No F-005 implementation exists yet in either package: no `bff/src/routes/feature-toggles*`, no
`bff/src/catalog/*` (or wherever the manifest loader lands), no `web/src/features/featureToggles/`.
`buildApp()` does not register any `/api/feature-toggles*` route. Every test below is written
strictly from the spec, BEFORE reading any implementation, and is expected to fail now (404 / missing
route / undefined body / missing component module) — not on a syntax/import error in the test files
themselves. Confirmed by running the full suites: BFF 49 failed / 16 passed across the 5 new F-005
files (738 pre-existing BFF tests unaffected); web 3 failed (+ 1 failed-to-load suite) across the 2
new F-005 web files (525 pre-existing web tests unaffected). No failure is a `SyntaxError`,
`ReferenceError`, or "Cannot find module" **in a test file's own code** — the one legitimate
"Cannot find module" case (`FeatureTogglesPage.test.tsx` failing to resolve
`./FeatureTogglesPage`) is the explicitly-sanctioned "component module not found" RED signal.

## Test files

- `bff/test/store/feature-toggle-migration.test.ts` — PRE-EXISTING (migration agent, not touched).
- `bff/test/routes/feature-toggles.helpers.ts` — NEW, shared test-only manifest-seeding helper (not
  itself a suite; mirrors `web/src/test/fsScan.ts`'s role for F-001). See its header for the
  SPEC-AMBIGUITY note on the manifest env var name / JSON shape.
- `bff/test/routes/feature-toggles.routes.test.ts` — NEW. §7 route surface end-to-end: auth (401),
  `GET` list view, `PUT` set, `DELETE` clear (incl. idempotent-success no-override case), the opaque
  `featureKey` percent-encoding contract, request validation/error mapping, durability across a
  restart, and the custody/scope non-functional assertions observable at the route level.
- `bff/test/routes/feature-toggles.resolution.test.ts` — NEW. The spec's own self-identified
  highest-risk areas (effective-state resolution REQ-F005-017, provenance REQ-F005-020,
  orphan/new-feature handling REQ-F005-025/026), isolated into a dense, example-heavy file — mirrors
  `baseline-prompt.resolution.test.ts`'s rationale for F-002.
- `bff/test/routes/feature-toggles.catalog.test.ts` — NEW. REQ-F005-053's manifest load-failure
  posture (unset / absent / malformed / schema-invalid / coercion-is-not-a-failure) and the
  REQ-F005-016 `defaultEnabled` coercion boundary.
- `bff/test/routes/feature-toggles.events.test.ts` — NEW. §9 events/audit: `admin.feature_toggle.
  changed` effective-delta-only emission (REQ-F005-037), the `AdminEventName` union static scan, and
  audit-is-the-complete-record (REQ-F005-038).
- `bff/test/routes/feature-toggles.performance.test.ts` — NEW. REQ-F005-040 smoke-level perf at the
  spec's N=500 features / ≤500 overrides sizing.
- `web/src/design-system/components/Toggle.a11y-label.test.tsx` — NEW, additive (does not touch the
  existing F-001 `Toggle.test.tsx`/`Toggle.unit.test.tsx`). REQ-F005-054's DS `Toggle`
  accessible-name-binding extension.
- `web/src/features/featureToggles/FeatureTogglesPage.test.tsx` — NEW. §8 web UI requirements
  (REQ-F005-031..036/042/054..057) against the HTTP/DOM contract, with an explicit `vi.mock` factory
  for the API client (see file header for the SPEC-AMBIGUITY note on client function names/component
  path).

## Traceability: requirement → planned test(s) → level

Legend for **level**: `bff-http` = `app.inject()` route-contract test; `bff-unit-boundary` = store/
migration/static-source-scan test below the HTTP layer; `web-component` = RTL component test against
the HTTP/DOM contract; `e2e-deferred` = cannot be honestly executed without inventing implementation
shape not pinned by the spec (real nav wiring, a real browser/visual-diff harness, a real load-test
run) — Phase 6 (e2e) owns these, not faked here.

| REQ | Requirement (short) | Test(s) | Level |
|---|---|---|---|
| REQ-F005-001 | Console persists+exposes per-feature overrides; view/set surface | `feature-toggles.routes.test.ts` GET+PUT flow | bff-http (full open→flip→reopen operator workflow is e2e-deferred) |
| REQ-F005-002 | Single-install scope by construction | `feature-toggles.routes.test.ts` "custody & scope boundary" block | bff-http |
| REQ-F005-003 | No engine read/write, no engine field/path | `feature-toggles.routes.test.ts` custody block (no engine adapter mocked or called anywhere in the F-005 bff suite) | bff-http (web-bundle static leakage scan, mirroring `web/src/leakage.test.ts`, is e2e-deferred — no F-005 web source exists yet to scan) |
| REQ-F005-004 | No fleet-wide/multi-customer/bulk action | `feature-toggles.routes.test.ts` "no multi-customer selector/parameter" test | bff-http |
| REQ-F005-005 | No customer-facing settings surface (non-goal) | implicit: every route requires staff auth (REQ-012 block) and no non-staff route exists | bff-http (implicit) |
| REQ-F005-006 | Billing system itself is a non-goal | not independently tested (nothing to assert against a system this feature does not build) | not applicable |
| REQ-F005-007 | The customer-facing app/features are a non-goal | not independently tested | not applicable |
| REQ-F005-008 | Catalog authoring is a non-goal | `feature-toggles.resolution.test.ts` "no route to create/edit a catalog entry" | bff-http |
| REQ-F005-009 | Customer-app consumption mechanism deferred | not independently tested; narrowed (not overridden) by REQ-F005-057 | traced via REQ-F005-057 |
| REQ-F005-010 | No AnythingLLM engine flagging | same evidence as REQ-F005-003 | bff-http |
| REQ-F005-011 | No cross-deployment/central-plane build this rev | realized minimally by REQ-F005-015 | traced via REQ-F005-015 |
| REQ-F005-012 | Store table shape; no-row→no-override; write→exactly one row | `feature-toggle-migration.test.ts` (PRE-EXISTING) | bff-unit-boundary |
| REQ-F005-013 | Catalog not copied as authoritative; effective always recomputed | `feature-toggles.resolution.test.ts` "REQ-F005-013" blocks (both directions: override-exists vs no-override) | bff-http |
| REQ-F005-014 | Retained history; orphan override rows not deleted | `feature-toggles.resolution.test.ts` orphan-retained test; `feature-toggles.events.test.ts` audit+event-on-toggle tests; `feature-toggle-migration.test.ts` rollback-retention tests | bff-http + bff-unit-boundary |
| REQ-F005-015 | PK = stable global featureKey, no tenant surrogate | `feature-toggle-migration.test.ts` PK/type assertions | bff-unit-boundary |
| REQ-F005-016 | Catalog shape; `defaultEnabled` coercion; console can't author | `feature-toggles.resolution.test.ts` "catalog shape & coercion" block; `feature-toggles.catalog.test.ts` coercion-boundary test | bff-http |
| REQ-F005-017 | Effective-state resolution (`override ?? default`) | `feature-toggles.resolution.test.ts` "REQ-F005-017" block | bff-http |
| REQ-F005-018 | feature_key/featureKey shared identifier space; orphan definition | `feature-toggles.resolution.test.ts` orphan block; `feature-toggle-migration.test.ts` byte-for-byte match test | bff-http + bff-unit-boundary |
| REQ-F005-019 | `GET` list view shape + count semantics | `feature-toggles.routes.test.ts` "GET /api/feature-toggles" block | bff-http |
| REQ-F005-020 | State provenance (`hasOverride`) visible | `feature-toggles.routes.test.ts` provenance test; `FeatureTogglesPage.test.tsx` REQ-F005-033 test | bff-http + web-component |
| REQ-F005-021 | `PUT` sets state; store-confirmed; idempotent re-write/LWW | `feature-toggles.routes.test.ts` PUT block; `feature-toggle-migration.test.ts` LWW-upsert test | bff-http + bff-unit-boundary |
| REQ-F005-022 | Immediate-apply, per-feature (no batching) | `feature-toggles.routes.test.ts` sibling-independence tests (PUT and DELETE blocks) | bff-http |
| REQ-F005-023 | `DELETE .../override` clears; idempotent-success no-override case | `feature-toggles.routes.test.ts` "DELETE" block (incl. the no-override-200 test) | bff-http |
| REQ-F005-024 | Empty state (zero declared features) | `feature-toggles.routes.test.ts` empty-state test; `FeatureTogglesPage.test.tsx` empty-state test | bff-http + web-component |
| REQ-F005-025 | Orphan overrides hidden from active list, not deleted | `feature-toggles.resolution.test.ts` orphan block | bff-http |
| REQ-F005-026 | Newly-declared features appear at default, no auto-override | `feature-toggles.resolution.test.ts` newly-declared block | bff-http |
| REQ-F005-027 | Customer/install label affordance | `feature-toggles.routes.test.ts` label test; `FeatureTogglesPage.test.tsx` label test | bff-http + web-component |
| REQ-F005-028 | Opaque `featureKey` percent-encode/decode contract | `feature-toggles.routes.test.ts` "Opaque featureKey" block | bff-http |
| REQ-F005-029 | Every route BFF-brokered, staff-authenticated | `feature-toggles.routes.test.ts` REQ-012 401 block | bff-http (web-side "browser calls only product routes" static scan is e2e-deferred, no F-005 web source yet) |
| REQ-F005-030 | Validation & error mapping (400/404/500) | `feature-toggles.routes.test.ts` validation block; `feature-toggles.events.test.ts` no-event-on-rejected-write test | bff-http |
| REQ-F005-031 | New nav-reachable section, not workspace-scoped | `FeatureTogglesPage.test.tsx` "not workspace-scoped" test (renders with zero route params) | web-component (top-level nav reachability itself is e2e-deferred — no `App.tsx` wiring exists to target without inventing its shape) |
| REQ-F005-032 | DS `Toggle` reuse, `role="switch"`, keyboard-operable | `FeatureTogglesPage.test.tsx` switch-role tests; DS `Toggle.test.tsx`/`Toggle.unit.test.tsx` (EXISTING, keyboard-operability already pinned there) | web-component |
| REQ-F005-033 | Non-color-only state+provenance encoding | `FeatureTogglesPage.test.tsx` "legible without color alone" test | web-component (grayscale/color-blind visual SIMULATION is e2e-deferred, needs real rendering) |
| REQ-F005-034 | Confirmation names feature+customer before commit | `FeatureTogglesPage.test.tsx` confirm-dialog tests | web-component |
| REQ-F005-035 | Success/failure reflection; verbatim error; no stranded optimistic state | `FeatureTogglesPage.test.tsx` failure-reflection test | web-component |
| REQ-F005-036 | Loading & empty states | `FeatureTogglesPage.test.tsx` loading/empty tests | web-component |
| REQ-F005-037 | `admin.feature_toggle.changed` — effective-delta-only emission | `feature-toggles.events.test.ts` event-emission block; `AdminEventName` union static scan | bff-http + bff-unit-boundary |
| REQ-F005-038 | Audit = complete operator-action record (bus is not) | `feature-toggles.events.test.ts` audit block | bff-http |
| REQ-F005-039 | Custody boundary restated (browser never calls engine/holds key) | `feature-toggles.routes.test.ts` custody block (implicit: every test only ever calls `/api/*` via `inject()`) | bff-http (bundle/API-key-leakage web scan is e2e-deferred) |
| REQ-F005-040 | Perf: list render + toggle round trip, p95<1500ms, N=500/500 | `feature-toggles.performance.test.ts` | bff-http (smoke-level bound only; a statistically rigorous p95 over many samples is e2e/load-test-deferred) |
| REQ-F005-041 | Durability across a restart; immediate GET reflection | `feature-toggles.routes.test.ts` "durability across a restart" test | bff-http |
| REQ-F005-042 | A11y: switch semantics, dialog focus mgmt, ARIA live region | `FeatureTogglesPage.test.tsx` focus-management tests | web-component (focus-in/focus-return only; full keyboard-only-operator flow across the real app + AT-audible live-region announcement is e2e-deferred) |
| REQ-F005-043 | (OQ) Feature granularity — RATIFIED flag-level, granularity-agnostic mechanism | traced via REQ-F005-016/017 (any granularity works mechanically) | traced, not independent |
| REQ-F005-044 | (OQ) Catalog source = deployment manifest — RATIFIED | the manifest-file seeding mechanism itself (`feature-toggles.helpers.ts`) is the concrete realization exercised by every bff-http test | bff-http (mechanism, via helper) |
| REQ-F005-045 | (OQ) Billing via read API + audit log, no shared schema — RATIFIED | traced via REQ-F005-038 (audit completeness) + REQ-F005-019 (read API) | traced, not independent |
| REQ-F005-046 | (OQ) Immediate-apply, no batched save — RATIFIED | traced via REQ-F005-022 | traced, not independent |
| REQ-F005-047 | (OQ) Lightweight non-typed confirmation — RATIFIED | traced via REQ-F005-034 (`FeatureTogglesPage.test.tsx` models this as `DangerConfirm`'s existing checkbox/toggle mode — SPEC-AMBIGUITY, see below) | traced, not independent |
| REQ-F005-048 | (OQ) Config-driven customer label — RATIFIED | traced via REQ-F005-027 | traced, not independent |
| REQ-F005-049 | (OQ) Off-by-default; hide orphans — RATIFIED | traced via REQ-F005-016 (coercion test) + REQ-F005-025 (orphan-hidden test) | traced, not independent |
| REQ-F005-050 | (OQ) Minimal fleet-readiness measure sufficient — RATIFIED | traced via REQ-F005-015 | traced, not independent |
| REQ-F005-051 | (OQ) Audit log/event stream sufficient depth — RATIFIED | traced via REQ-F005-038 | traced, not independent |
| REQ-F005-052 | (OQ) `__unkeyed__` ordering, F-004 not extended — RATIFIED | not independently re-tested (F-004-OWNED ordering-key derivation is F-004's own test surface); noted in `feature-toggles.events.test.ts`'s header that F-005 adds no keying rule | not applicable here (F-004-owned) |
| REQ-F005-053 | Manifest load-failure posture (split: absent=empty+start; broken=refuse) | `feature-toggles.catalog.test.ts` — all four *Test*-clause scenarios | bff-http |
| REQ-F005-054 | DS `Toggle` programmatic accessible name = `displayName` | `Toggle.a11y-label.test.tsx` (DS-contract level); `FeatureTogglesPage.test.tsx` accessible-name tests (integration level) | web-component |
| REQ-F005-055 | Per-row "Reset to default", gated on `hasOverride` | `FeatureTogglesPage.test.tsx` "Reset to default" block | web-component |
| REQ-F005-056 | Effective-unchanged reset still confirmed, never silent | `FeatureTogglesPage.test.tsx` REQ-F005-056 test (web); `feature-toggles.events.test.ts` "provenance-only transition" test (bff: audited, zero events) | web-component + bff-http |
| REQ-F005-057 | Confirm copy asserts immediate effect; forward constraint on customer app | `FeatureTogglesPage.test.tsx` REQ-F005-057 test (copy assertion) | web-component (the "forward requirement pinned on the future customer app" clause is a documentation/traceability point already satisfied by the spec text itself — not independently unit-testable) |

Total REQ ids in scope: 57 (REQ-F005-001 through REQ-F005-057). Of these: 6 are true non-goals with
nothing to assert against (004's siblings 005/006/007, plus 009/011 narrative-only — each traced to
the REQ that operationalizes it where applicable); REQ-F005-043..052 (the open-questions section) are
traced through the REQ ids that adopted each ratified default rather than independently tested, per
the F-002 `TEST_PLAN.md` precedent above; REQ-F005-052 is explicitly F-004-owned. Every remaining REQ
id has at least one concrete, executable test at the bff-http, bff-unit-boundary, or web-component
level. E2E-deferred slices (Phase 6): full nav-reachability wiring (REQ-F005-031), grayscale/
color-blind visual simulation (REQ-F005-033), full keyboard-only operator flow + AT-audible live-region
announcement (REQ-F005-042), a statistically rigorous p95 load-test (REQ-F005-040), and the web-bundle
engine-leakage/API-key static scans (REQ-F005-003/029/039) that need real F-005 web source to scan.

## Design notes / how ambiguity was handled

- **Catalog seeding & load timing.** REQ-F005-053's own *Test* clause frames manifest (re)load as a
  STARTUP-time event ("the BFF starts... fails startup/readiness") and REQ-F005-013's *Test* clause
  frames a catalog-default change as happening "e.g. a redeploy." Every bff-http test therefore seeds
  the manifest file BEFORE calling `buildApp()`, and a "catalog changed mid-test" scenario is modeled
  as an explicit `restart()` (close app, rewrite manifest, rebuild against the same DB file) rather
  than a live/hot per-request reload — the most defensible reading of the spec's own language, though
  not the only possible one (see SPEC-AMBIGUITY below).
- **Session reuse across `restart()`.** The `restart()` helper reuses the ORIGINAL session cookie
  against the rebuilt app instance rather than performing a second login+MFA round trip. A second real
  MFA round trip moments after the first collides with this codebase's own (correct, pre-existing,
  security-review-driven) TOTP anti-replay guard (`last_totp_step`, sec review H-1 —
  `test/auth/mfa.service.test.ts`, `test/routes/auth.routes.test.ts` "TOTP replay prevention"), which
  is not an F-005 concern to route around expensively (a real 30s wait would work but is needlessly
  slow repeated across ~8 call sites; faking timers was tried and hangs Fastify's/better-sqlite3's own
  real-timer internals). Reusing the cookie is both correct (a `SESSION_SECRET`-signed stateless
  cookie legitimately survives a process restart with the same secret) and the realistic production
  scenario this test wants to model.
- **REQ-F005-052 (event ordering key)** is explicitly F-004-owned per the spec's own ratified
  resolution ("F-004 §3 is NOT extended now"); `feature-toggles.events.test.ts` asserts event delivery
  but does not re-derive or assert F-004's ordering-key function, which is that spec's own test
  surface.
- **Perf (REQ-F005-040)** follows the exact precedent of `baseline-prompt.performance.test.ts`: a
  generous smoke-level latency assertion against a real (not mocked) in-process SQLite store at the
  spec's own N=500/500 sizing, explicitly not a load-test. No skip/tag convention for perf tests exists
  in this repo (no `.skip`/`describe.skip` perf convention found), so this is written as a normal test,
  per the task's own fallback instruction.

## SPEC-AMBIGUITY findings requiring human ruling

**Status: ALL FIVE RULED — human ruling (2026-07-12).** Each item below is annotated
**RULING → &lt;outcome&gt;** with what changed (or didn't) as a result. Four assumptions were
CONFIRMED unchanged; one (confirm-dialog composition) was OVERRULED and the affected tests were
updated accordingly (see "Post-ruling test update" below).

1. **Manifest env var name and JSON shape (REQ-F005-044/053).** The spec pins the manifest's
   *behavior* precisely (REQ-F005-053) but not (a) the BFF config env var name it reads for the
   manifest path, or (b) the exact JSON shape of the manifest file (only that entries are
   `FeatureCatalogEntry`-shaped, REQ-F005-016). This suite assumed `FEATURE_CATALOG_MANIFEST_PATH`
   (matching the project's existing `DB_PATH`/`EVENT_BUS_URL` naming convention) and
   `{ "features": FeatureCatalogEntry[] }`. Documented in `bff/test/routes/feature-toggles.helpers.ts`'s
   header.
   **RULING → CONFIRMED, now spec-pinned.** The assumed env var name and JSON shape are adopted as
   the normative contract. No test change required.
2. **Web API client function names / component path / confirmation-dialog composition
   (REQ-F005-031..036/047/055).** Neither the client function names (`listFeatureToggles`,
   `setFeatureToggle`, `clearFeatureToggleOverride`) nor the component path
   (`web/src/features/featureToggles/FeatureTogglesPage.tsx`) are pinned by the spec — those remain
   assumptions. The confirmation-dialog COMPOSITION choice, however, was submitted for ruling:
   ~~this suite's original reading composed the existing `DangerConfirm` component in its
   ALREADY-IMPLEMENTED checkbox/"I understand and want to proceed" acknowledgement mode~~.
   **RULING → OVERRULED.** The ratified UX design doc (`docs/design/ux/F-005-feature-toggle-console.md`
   rev 2, §4.1/§4.2/§8) is authoritative and wins: F-005 introduces a **new, dedicated `ToggleConfirm`
   component** wrapping the design-system `Modal` — `DangerConfirm` is explicitly "deliberately not
   reused" per that doc, because its typed-token/checkbox gate is reserved for irreversible ops, not a
   highly-reversible toggle. `ToggleConfirm`'s footer is "ghost Cancel + PRIMARY (not danger) Confirm"
   with **no arming mechanism** (no checkbox, no typed token) — Confirm is actionable as soon as the
   dialog opens.
   **Directory naming (`web/src/features/featureToggles/` vs. the UX doc's `feature-toggles/`
   spelling) → CONFIRMED as this suite already had it**; the design doc is being corrected to match,
   not the other way round. No file move needed.
3. **Audit action-name strings (`feature_toggle.set` / `feature_toggle.clear`).** REQ-F005-038 only
   specifies the audit entry's *content* (actor, action=route, target, new state, `hasOverride`,
   `verified`, timestamp, outcome), not the literal `action` string. This suite assumed
   `feature_toggle.set`/`feature_toggle.clear` (matching the existing `baseline_prompt.update`,
   `settings.update`, `raw_env.write` dot-separated `resource.verb` convention).
   **RULING → CONFIRMED, now spec-pinned.** No test change required.
4. **REQ-F005-053's exact startup-failure mechanism (process exit vs. a rejected `buildApp()`
   promise)** is not pinned beyond "refuses to start... fails startup/readiness." Mirroring
   `bff/test/config.test.ts`'s own precedent for a load-time failure
   (`await expect(loadConfig()).rejects.toThrow(...)`), `feature-toggles.catalog.test.ts` tolerates
   either surfacing point (import-time throw or `buildApp()`-call-time throw) via a manual try/catch
   around both, rather than asserting a specific throw site.
   **RULING → the tolerant try/catch approach STANDS.** No test change required.
5. **"Not a routing error" vs. exact status for a raw (unencoded) `/` inside a `:featureKey` path
   segment (REQ-F005-028).** The spec pins the two REACHABLE-input outcomes precisely (malformed
   percent-encoding → 400; well-formed encoding of an undeclared key → 404) but the THIRD case in its
   own *Test* clause — "the same key sent raw (unencoded `/`) does not silently match a different
   feature" — only pins the negative (must not silently succeed as if correctly encoded), not which
   exact status code Fastify's own router produces for the resulting extra path segment. `feature-
   toggles.routes.test.ts` asserts the loose, defensible bound (`statusCode !== 200`) rather than
   guessing a specific code Fastify's routing layer (not F-005 code) would produce.
   **RULING → the `statusCode !== 200` assertion STANDS.** No test change required.

### Post-ruling test update (ambiguity #2, confirm-dialog composition)

`web/src/features/featureToggles/FeatureTogglesPage.test.tsx` was updated to match the ratified
`ToggleConfirm` design rather than `DangerConfirm`'s checkbox mode:
- Removed every `within(dialog).getByRole('checkbox', { name: 'I understand and want to proceed' })`
  click step — `ToggleConfirm` has no arming control at all.
- Added a new test (REQ-F005-034/047) asserting the confirm dialog renders NO checkbox and NO
  textbox, and that the non-Cancel Confirm button is enabled immediately on open — the "lightweight,
  non-typed" gate is now asserted behaviorally rather than assumed via a specific `DangerConfirm` mode.
- Broadened the REQ-F005-056 "state will not change" copy assertion to
  `/will not change|no change/i` so it matches BOTH the spec's own *Test*-clause paraphrase and the
  UX doc's suggested literal copy ("there is NO CHANGE to customer-visible state") without pinning one
  exact string over the other.
- Added an explicit "dialog stays open on failure" assertion to the REQ-F005-035 failure test, per the
  UX doc §5 `ToggleConfirm` error-state description.
- The header comment now cites the UX doc as authoritative for this choice and explicitly notes the
  tests do NOT import `ToggleConfirm`'s module directly and do NOT assert its internal
  structure/props — only the `role`/accessible-name/text contract the page renders, so they remain
  valid regardless of `ToggleConfirm`'s internal composition.
- Nothing else in the file changed: the `role="dialog"` query, the `findConfirmButton()` helper (picks
  the non-Cancel button generically), the feature/customer-naming assertions, the immediate-effect
  copy assertion (REQ-F005-057), and the focus-management assertions (REQ-F005-042) were already
  composition-agnostic and needed no edits.
- Re-run confirmed the file still fails for exactly one reason — "Failed to resolve import
  './FeatureTogglesPage'. Does the file exist?" (component module not found, the same sanctioned RED
  signal as before) — and the full web suite remains `2 failed | 48 passed` (files) /
  `3 failed | 525 passed` (tests), identical to the pre-update baseline: no pre-existing test
  regressed and no new compile/syntax error was introduced by the edit.

---

# TEST_PLAN — F-004 Production-Ready Event Bus (Outbox Relay)

Spec: `specs/F-004-production-event-bus.md` (Draft rev 10 — final, review-gated; every
`REQ-F004-###` is binding). Design: `docs/design/09-F004-production-event-bus.md`. Parent spec:
`specs/admin-console.md` (v1, rev 7). Migration runbook (already implemented by a prior agent):
`docs/runbooks/F-004-migration-runbook.md`; migration test (PRE-EXISTING, not touched by this task):
`bff/test/store/f004-outbox-migration.test.ts`.

## Framework & harness choice

Same established BFF suite as F-002/F-005: `vitest` (node env), real (tmp-file) SQLite via
`bff/src/store/db.ts`, module-boundary `vi.mock` where isolation is wanted (mirrors
`bff/test/events/bus.test.ts`), and the `vi.resetModules() + dynamic import()` pattern for
load-time-throwing config modules (mirrors `bff/test/config.test.ts`). No new framework
introduced. Run with `npm test` (= `vitest run`) from `bff/`.

## What exists vs. what does not, as of this task

**Already implemented** (a prior "migration" agent's work, grounded/read, not modified here):
the `event_outbox` schema delta (`ordering_key`, `attempt_count`, `next_attempt_at`,
`last_error`, `parked_at`, `acked_at`), the `outbox_meta` epoch singleton, the partial index, and
the migration's own inline `deriveOrderingKeyForBackfill` — all in `bff/src/store/db.ts`, covered
by `bff/test/store/f004-outbox-migration.test.ts`.

**Does NOT exist yet** (this task's entire target surface, per `docs/design/09-F004-production-
event-bus.md` §1.1's file table): `bff/src/relay/*` (the whole relay package — `index.ts`,
`drainer.ts`, `transport.ts`, `http-peer-transport.ts`, `delivery-id.ts`, `backoff.ts`,
`metrics.ts`, `ready.ts`, `config.ts`), `bff/src/events/ordering-key.ts`, the F-004 additions to
`bff/src/store/repositories/outbox.repo.ts` (`selectEligible`/`markAcked`/`recordFailure`/`park`/
`forcePublish`/`pruneShipped`/`getEpoch`), the F-004 edit to `bff/src/events/bus.ts`
(`OutboxRelayBus.publish` computing `ordering_key`), and the F-004 edit to `bff/src/config.ts`
(the `EVENT_BUS_MODE` production hard-refuse). Every test below targeting these is written
strictly from the spec + design doc, BEFORE reading any relay implementation (none exists), and
is **expected to fail now** (module-not-found / missing-method / wrong-throw-message) — not on a
syntax/import error in the TEST files themselves. Confirmed by running the full suite (see
"Suite status" below).

## Interface-shape assumptions (NOT pinned verbatim by the spec — documented per file)

The spec pins every requirement's **observable behavior** precisely; several internal module
**call signatures** are left to the implementer (design doc names each file's *responsibility*,
not always its literal exported API). Each test file's header comment states its own assumption
inline; summarized here for a single reference point:

| Module (does not exist yet) | Assumed export(s) | Rationale |
|---|---|---|
| `bff/src/events/ordering-key.ts` | `deriveOrderingKey(envelope): string` | design §1.1: "shared by the enqueue path" (`OutboxRelayBus.publish`), which holds the parsed envelope object |
| `bff/src/relay/delivery-id.ts` | `composeDeliveryId(epoch, rowId): string` | design §2.3 pins the composed shape only |
| `bff/src/relay/backoff.ts` | `backoffMs(attempt): number`, `MAX_ATTEMPTS: number` | design §1.1/§5: "capped-exponential backoff schedule + MAX_ATTEMPTS constant of record" |
| `bff/src/relay/transport.ts` | `TransportError` (design §2.1, pinned shape), `createTransport({kind, peerUrls})` | design §1.1: "the EVENT_BUS_TRANSPORT factory" |
| `bff/src/relay/http-peer-transport.ts` | `new HttpPeerTransport(peerUrls: string[])`, `.deliver()`, `.release()` | design §2.2 pins behavior, not the constructor literal |
| `bff/src/relay/drainer.ts` | `createDrainer({transport}) -> { runOnce(), shutdown(timeoutMs) }` | the highest-risk assumption — design leaves poll cadence implementation-defined (REQ-F004-010/M8); `runOnce()`/`shutdown()` is the minimal seam that makes the spec's real-time-independent behavior deterministically testable without depending on a live poll loop. **If the real module exposes a different shape** (e.g. `start()`/`stop()`), the OBSERVABLE assertions in `drainer.test.ts` (DB row state transitions) are what is spec-load-bearing — only the call sites would need adjusting, not the assertions |
| `bff/src/relay/metrics.ts` | `getRelayLagMs()`, `getBacklogCount()`, `recordDelivered/recordAttemptFailure/recordNeverDeliveredPark/recordPartiallyDeliveredPark/recordPostAckCap()`, `getCounters()` | design §1.1/§6 name the counters; recorder-function shape assumed since the drainer is the only place an outcome is known |
| `bff/src/relay/ready.ts` | `buildReadyApp(deps) -> { inject() }` | mirrors this repo's own established Fastify `buildApp()`/`.inject()` convention |
| `bff/src/relay/config.ts` (or an equivalent relay-scoped module) | `config` (a load-time const/throw, mirroring `bff/src/config.ts`'s own pattern) | design §5/§11 explicitly flags this split as an **open question**, not resolved by the spec — the module PATH itself is an assumption, not just its shape |
| `bff/src/store/repositories/outbox.repo.ts` (edit) | `selectEligible(now, limit)`, `markAcked(id, iso)`, `recordFailure(id, next, err)`, `park(id, iso)`, `forcePublish(id, iso)`, `pruneShipped(before)`, `getEpoch()` | design §1.1's file table names these literally |
| `bff/src/events/bus.ts` (edit) | `outboxRepo.insert(ts, envelope, orderingKey)` — third positional arg | design §1.1: "computes ordering_key ... and passes it to insert" |

None of these are `SPEC-AMBIGUITY` in the blocking sense (hard rule 4) — the spec's *behavior* is
unambiguous in every case above; only the internal call-shape needed inventing, exactly the same
situation F-002/F-005's own `TEST_PLAN.md` sections documented for unpinned web API client
function names / component paths (see those sections' "Design notes / how ambiguity was handled").

## Test files created

- `bff/test/relay/helpers.ts` — shared test-only support (NOT a test file itself): `makeEnvelope`/
  `envJson`, the 21-event-name/8-family `CATALOG_FAMILY_CASES` fixture (grounded from
  `bff/src/events/catalog.ts`), the scriptable `FakeTransport` double (REQ-F004-049's
  transport-agnostic-swap proof), and raw `event_outbox` row seeding. Zero dependency on any
  not-yet-built `bff/src/relay/*` module, so it never itself causes a cascading import failure.
- `bff/test/events/ordering-key.test.ts` — 35 tests (`it.each` over the 21-case catalog fixture
  expands most of this). §3 total derivation over all 8 families, trailing-dot prefix match (N6),
  totality edge cases (N5), `__unkeyed__` independence.
- `bff/test/events/bus.f004.test.ts` — 3 tests. `OutboxRelayBus.publish` byte-for-byte envelope +
  computing/passing `ordering_key` to `insert()`.
- `bff/test/store/repositories/outbox.repo.f004.test.ts` — 23 tests. `selectEligible` (the spec's
  own two seeded eligibility scenarios verbatim, §3.4/REQ-F004-041), `markAcked`/`forcePublish`,
  `recordFailure`, `park`, `pruneShipped`, `getEpoch`, `busy_timeout` proxy check.
- `bff/test/relay/delivery-id.test.ts` — 5 tests. Epoch-qualified delivery id composition/
  stability/uniqueness-across-reset.
- `bff/test/relay/backoff.test.ts` — 5 tests. Capped-exponential shape, `MAX_ATTEMPTS` constant.
- `bff/test/relay/transport.test.ts` — 7 tests. `TransportError` shape, `EVENT_BUS_TRANSPORT`
  factory (`http` default; `broker`/out-of-set hard-refuse in ALL environments).
- `bff/test/relay/http-peer-transport.test.ts` — 29 tests. Fan-out ack (resolve-only-on-full-2xx),
  byte-for-byte envelope, delivery-id header carriage, stateful per-`deliveryId` re-drive
  (re-POST only un-acked peers), eviction via `release()`. **Phase-2 addendum (REQ-F004-055, rev
  11, §4.4 — RULED):** the full single-peer HTTP-status/network-failure -> permanent/transient
  classification table (ack 2xx incl. 200/204; transient 500/502/503/408/429 + connection-refused
  + DNS failure + socket reset; permanent 400/401/403/404/422 + 301/302) and the REQ-F004-051
  fan-out composition rule (a permanent response from any not-yet-acked peer makes the WHOLE
  `deliver()` reject permanent even against an already-acked or transient-failing peer; with no
  permanent peer, a transient peer makes `deliver()` reject transient and re-drive re-POSTs only
  the still-un-acked peer).
- `bff/test/relay/drainer.test.ts` — 20 tests. THE priority file: basic delivery, crash/restart
  backfill (never-zero, same-delivery-id redelivery), first-connection backfill (all rows, no
  horizon), per-key ordering (skip-across / block-within), poison isolation (never-acked park vs
  ever-acked force-publish vs immediate permanent-park), single-drainer/no-double-delivery,
  graceful shutdown draining the SET of in-flight deliveries with abandon-preserves-
  `attempt_count`. Built entirely against the `FakeTransport` double — the REQ-F004-049
  swap-ability proof in practice.
- `bff/test/relay/metrics.test.ts` — 10 tests. Live lag/backlog gauges (seeded-DB-driven,
  deterministic), event counters incl. the never-vs-partially-delivered park split.
- `bff/test/relay/ready.test.ts` — 10 tests. `/ready` 200/503 + reasons, the at-or-over threshold
  boundary (rev-10) at both the backlog and lag edges.
- `bff/test/relay/relay-config.test.ts` — 14 tests. Relay-scoped config requiring ONLY
  `DB_PATH`+`EVENT_BUS_*` (not the BFF's secrets, REQ-F004-033), peer-list parsing, transport
  selector, threshold defaults, the `EVENT_BUS_URL`-missing / `EVENT_BUS_TRANSPORT=broker`
  hard-refuse postures.
- `bff/test/config.f004.test.ts` — 6 tests. BFF-side `EVENT_BUS_MODE` production hard-refuse
  (REQ-F004-021/039/046), isolated from the pre-existing `config.test.ts` (not edited).
- `bff/test/relay/static-scans.test.ts` — 12 tests. No `web/` change, `listUnpublished` has no
  non-repo caller, no transport-specific logic leaks into the orchestration layer, mutating
  routes/services untouched, `EVENT_BUS_URL` never reaches a route response, relay never
  references a second application's database. **Phase-2 addendum (REQ-F004-055/049):** neither
  `drainer.ts` nor `transport.ts` (the seam/factory) contains any of the REQ-F004-055 HTTP-status
  classification tokens (408/429/403/404/422, `>= 500`/`>= 400` range-check idioms, a
  `status/100`-bucketing idiom) — that table is HttpPeerTransport-internal only.
- `bff/test/relay/consumer-contract.test.ts` — 4 tests. Self-contained reference `Consumer` +
  two transport doubles proving dedupe + cross-key-reorder-tolerance is broker-swap-invariant —
  runs GREEN today (validates the contract itself, independent of the not-yet-built relay).
- `bff/test/relay/perf.test.ts` — 2 tests. Smoke-level backlog-drain-to-zero + cross-key
  parallel-dispatch-in-one-tick, explicitly NOT a rigorous load test (same convention as
  `bff/test/routes/{baseline-prompt,feature-toggles}.performance.test.ts`).

**Total: 16 files (1 shared helper + 15 test files), 185 test cases** as actually collected by
`vitest run` (163 from the original pass + 22 from the REQ-F004-055 Phase-2 addendum below; see
"Suite status" for the exact pass/fail/skip breakdown).

## Phase-2 addendum (REQ-F004-055, rev 11 — HTTP status -> permanent/transient classification, RULED)

The spec's rev 11 (`specs/F-004-production-event-bus.md` §4.4) resolved the one genuine
`SPEC-AMBIGUITY` this suite originally flagged (HttpPeerTransport's concrete HTTP-status ->
classification mapping) as a new binding requirement, **REQ-F004-055**:

- **Ack:** 2xx.
- **Transient** (retry w/ backoff to the max-attempt bound, then park — REQ-F004-013/014):
  connection-refused / timeout / DNS failure / socket reset (network-level); ALL 5xx; 408; 429.
- **Permanent** (immediate park, no backoff — REQ-F004-047/051(d)): all other 4xx; any 3xx; any
  other unexpected non-2xx.
- **Fan-out composition** (REQ-F004-051): a permanent response from any not-yet-acked peer ->
  the whole `deliver()` rejects permanent (immediate park), even against an already-acked or
  transient-failing peer; with no permanent peer, a not-yet-acked transient peer -> `deliver()`
  rejects transient (re-drive re-POSTs only the still-un-acked peers).

**Tests added** (both to already-existing files, matching the established structure — no new
files needed):

- `bff/test/relay/http-peer-transport.test.ts` — **+19 test cases**: a single-peer classification
  table (`it.each` over 200/204 ack; 500/502/503/408/429 transient + connection-refused + DNS
  failure + a fast, deterministic socket-reset double (`startResetPeer()`, destroys the TCP
  socket on connect rather than waiting out a real response timeout) + 400/401/403/404/422/301/302
  permanent) and 4 fan-out composition tests (permanent-wins regardless of peer order, permanent
  wins even over an already-acked peer, transient-only re-drives only the un-acked peer).
- `bff/test/relay/static-scans.test.ts` — **+3 test cases**: a new `describe` block asserting
  neither `drainer.ts` nor `transport.ts` contains any REQ-F004-055 HTTP-status classification
  token (the table is HttpPeerTransport-internal, kept out of the seam per REQ-F004-049), plus the
  explicit pre-implementation RED-signal test.

**Testing-practicality note (not a spec gap):** an actual network-level *timeout* (as opposed to
connection-refused/DNS-failure/socket-reset, all three of which fail fast and deterministically)
is not independently exercised with a real elapsed-timeout wait, because HttpPeerTransport's
concrete per-request timeout value is not spec-pinned and waiting out an unknown real timeout
would make the suite slow/flaky. The other three network-level transient cases the REQ-F004-055
table names are each covered by a fast, deterministic double instead — the same testing-practicality
tradeoff already documented for REQ-F004-020's `busy_timeout`/`SQLITE_BUSY` scenario above.

Suite re-run after this addendum: `Test Files 13 failed | 46 passed | 1 skipped (60)` — identical
file-level counts to before (no regression, no new failing file — both touched files were already
counted as "failed" for their pre-existing module-resolution RED signal). `Tests 36 failed | 953
passed | 134 skipped (1123)` (was `35 failed | 953 passed | 113 skipped (1101)`): +22 new test
cases total, of which +1 is a new genuine failing assertion (the new explicit
pre-implementation-state flag added to `static-scans.test.ts`) and +21 cleanly self-skip via
`describe.skipIf`/`it.skipIf` until `HttpPeerTransport`/`drainer.ts`/`transport.ts` exist. `tsc
--noEmit -p bff` still exits 0.

## Suite status as of this run

Run from `bff/`: `npm test` (= `vitest run`).

```
Test Files  13 failed | 46 passed | 1 skipped (60)
     Tests  35 failed | 953 passed | 113 skipped (1101)
```

- All **47 pre-existing BFF test files** (~938 pre-existing test cases: 1101 total minus this
  task's 163 new) **pass/skip exactly as before** — this task added 15 new test files and did not
  edit any pre-existing test file, so there is zero regression risk to the existing green baseline.
  `bff/test/store/f004-outbox-migration.test.ts` (the migration agent's pre-existing file) also
  still passes unchanged.
- The **13 new files that touch not-yet-built `bff/src/relay/*` (or not-yet-added methods on
  existing modules)** are the ones showing as "failed" — every failure is a clean, informative
  assertion mismatch (missing method / module-not-found / wrong-throw-message), confirmed by
  manual inspection of the full run: **zero** failures are a `SyntaxError`, a
  `ReferenceError` in the TEST file's own code, or an uncaught exception that crashed test
  collection — every file was fully collected and every one of its `it()`/`it.each` cases ran
  (verified via `--reporter=verbose`; each failing file also enumerates its skipped-via-
  `describe.skipIf`/`it.skipIf` cases, e.g. `drainer.test.ts` shows 1 failure + 19 skips —
  module-resolution fails clean, then everything downstream gracefully self-skips instead of
  cascading into 20 separate "Cannot find module" errors).
- **2 files run entirely GREEN today**, by design: `consumer-contract.test.ts` (self-contained —
  validates the REQ-F004-053 contract itself against two local test doubles, no dependency on
  `bff/src/relay/*`) and the non-relay-dependent portions of `static-scans.test.ts` (the `web/`
  leakage check, the `listUnpublished`-caller audit, the route/service-untouched checks, and the
  `EVENT_BUS_URL`-in-routes check all pass vacuously now and will keep doing real work as
  F-004 implementation code lands — mirrors the F-001 `TEST_PLAN.md`'s own "PASSES NOW" pattern).
- `tsc --noEmit -p bff` exits 0 (test files are outside `bff/tsconfig.json`'s `include: ["src"]`,
  matching this repo's existing convention of not type-checking `test/**` — vitest's own esbuild
  transform is what "compiles" the test files, and it succeeded for all 60 files with zero
  transform errors).

**Status update (post-implementation):** F-004 has since been implemented (`bff/src/relay/**`,
`bff/src/events/ordering-key.ts`, the `outbox.repo.ts`/`bus.ts`/`config.ts` edits all now exist).
Two follow-up QA passes were made against the built implementation, kept as separate dated
addenda below rather than silently rewritten into this pre-implementation snapshot: (1) the
REQ-F004-055 addendum (rev-11 ruling), and (2) the Phase-3 addendum immediately below (a
Phase-8-perf-incident regression guard). As of the Phase-3 addendum the full `bff/` suite is
`Test Files 70 passed (70)` / `Tests 1229 passed (1229)`, `tsc --noEmit -p bff` exits 0 — the
70-vs-60 file-count growth includes both this task's additions and a separate `*.unit.test.ts`
batch owned by the unit-test-writer agent (outside this document's scope, not touched here).

## Phase-3 addendum (Phase-8 perf incident — REQ-F004-027/034 query-PLAN regression guard)

**Incident:** Phase-8 perf testing found `selectEligible` was `O(total-table-size)`, not
`O(backlog)` — the 7-day retention window keeps published rows around, and the outer scan (plus
the correlated per-key head-of-line subquery) fell back to a full-table/rowid-range scan once
enough published rows accumulated: median 4.5ms @5k rows -> **4851ms @205k rows**, blowing the
REQ-F004-027 p95 SLO. This was invisible to `bff/test/relay/perf.test.ts`, which only seeds ~500
rows — too small for SQLite's query planner to ever consider, let alone need, a full scan. The fix
(implementation, not touched by this task) added two partial indexes in `bff/src/store/db.ts`
(`idx_outbox_live_id`, `idx_outbox_unpublished_key`); `outbox.repo.ts`'s `selectEligibleStmt` SQL
text is byte-for-byte unchanged.

**Test added:** a new `describe` block appended to
`bff/test/store/repositories/outbox.repo.f004.test.ts` — **2 test cases**:

1. **Query-PLAN assertion (the actual regression guard).** Seeds 4,000 retained-published rows +
   400 unpublished rows across 40 ordering keys (large enough for SQLite's planner to genuinely
   prefer an index — verified manually: dropping the two indexes against an equivalent seed
   reproduces `"SCAN o"` (bare) + `"SEARCH e USING INTEGER PRIMARY KEY (rowid<?)"`, i.e. this test
   would correctly FAIL against the pre-fix schema). The exact SQL under test is **extracted
   directly from `outbox.repo.ts`'s own `selectEligibleStmt` source text** (via
   `extractSelectEligibleSql()`, a small text-marker extraction, not a re-typed copy) so the guard
   can never silently drift from the real query. Runs `EXPLAIN QUERY PLAN` against that exact SQL
   and asserts: the outer scan's plan step mentions `idx_outbox_live_id`; the correlated subquery's
   plan step mentions `idx_outbox_unpublished_key`; and **no** plan step is a bare `SCAN` (matches
   `/\bSCAN\b/` without `USING INDEX`) — i.e. no full-table scan survived. This guards the query
   **plan shape**, not wall-clock timing, so it is deterministic and non-flaky in CI.
2. **Correctness-on-the-same-large-dataset assertion.** Layers five precise marker rows on top of
   the 4,400-row noise set (an older-parked-row-blocks-its-key pair, a clean single-row key, and an
   older-parked/newer-eligible `__unkeyed__` pair) and asserts `selectEligible` still returns
   exactly the spec-correct set — guarding against exactly the trap the implementer avoided: an
   "index-friendly" rewrite that becomes fast by silently breaking per-key head-of-line or
   `__unkeyed__` independence (e.g. adding `parked_at IS NULL` to `idx_outbox_unpublished_key`'s
   partial predicate would make the subquery index-driven too, but would drop parked rows from the
   blocker set and un-stall a key that must stay stalled — this test would catch that).

Both cases run in ~11ms each (real SQLite, no mocking), confirmed by re-running with the two new
indexes manually dropped (see above) that they fail for the right reason before the fix, and pass
after it.

## REQ-F004-### -> test coverage map (every MUST mapped)

Legend: **NEW** = a test in the files above. **EXISTING** = the pre-existing, untouched
`f004-outbox-migration.test.ts`. **traced** = a §9 ruling/OQ-record REQ realized entirely through
the operative REQ(s) it decided, per the same convention F-002/F-005's own plans use for their
open-questions sections (no independent test, would just re-test the REQ it resolved).

| REQ | Requirement (short) | Test(s) |
|---|---|---|
| REQ-F004-001 | Core guarantee; seam unchanged; static scan | `static-scans.test.ts` (emitAdminEvent/services scan); `drainer.test.ts` basic-delivery + crash/restart blocks |
| REQ-F004-002 | Envelope delivered byte-for-byte | `drainer.test.ts`, `http-peer-transport.test.ts`, `bus.f004.test.ts` |
| REQ-F004-003 | Independent out-of-process subscriber receives the event | `drainer.test.ts` crash/restart-backfill block (FakeTransport models the subscriber); `static-scans.test.ts` (no browser path) |
| REQ-F004-004 | Event contract itself unchanged | traced — `ordering-key.test.ts`'s `CATALOG_FAMILY_CASES` is grounded verbatim from `catalog.ts`; no F-004 test asserts a changed envelope shape |
| REQ-F004-005 | Transactional outbox WRITE unchanged | traced via `bus.f004.test.ts` (insert() still takes ts/envelope; only ordering_key appended) |
| REQ-F004-006 | Zero web/ changes | `static-scans.test.ts` |
| REQ-F004-007 | No production consumer beyond test doubles | traced — the whole suite's only "consumers" are `FakeTransport`/the `consumer-contract.test.ts` reference `Consumer`, never a production module |
| REQ-F004-008 | Demonstrable against a transport stub, no broker product needed | traced via `drainer.test.ts` (entirely against `FakeTransport`) |
| REQ-F004-009 | `listUnpublished` has no non-test caller (grounding) | `static-scans.test.ts` |
| REQ-F004-010 | Relay drains ELIGIBLE rows only | `outbox.repo.f004.test.ts` `selectEligible`; `drainer.test.ts` basic-delivery block |
| REQ-F004-011 | Core durability guarantee; `acked_at`-routed post-ack cap | `drainer.test.ts` crash/restart-backfill + poison-isolation blocks; `outbox.repo.f004.test.ts` markAcked/forcePublish |
| REQ-F004-012 | Mark-published only on ack | `drainer.test.ts` basic-delivery block |
| REQ-F004-013 | Retry with bounded backoff; inclusive-at-N cap | `backoff.test.ts`; `outbox.repo.f004.test.ts` recordFailure; `drainer.test.ts` transient-failure test |
| REQ-F004-014 | Poison isolation, per-key scoped | `drainer.test.ts` poison-isolation block; `outbox.repo.f004.test.ts` park |
| REQ-F004-015 | Backfill after outage | `drainer.test.ts` first-connection-backfill test |
| REQ-F004-016 | In-order within key, skip-ahead across keys | `drainer.test.ts` per-key-ordering block; `outbox.repo.f004.test.ts` selectEligible ordering tests |
| REQ-F004-017 | Single-drainer / no double-processing | `drainer.test.ts` single-drainer block |
| REQ-F004-018 | Consumer dedupe id | `delivery-id.test.ts`; `drainer.test.ts` crash-in-window test; `consumer-contract.test.ts` |
| REQ-F004-019 | Retention & pruning | `outbox.repo.f004.test.ts` pruneShipped |
| REQ-F004-020 | Lifecycle, supervision, graceful shutdown of the SET | `drainer.test.ts` graceful-shutdown block (3 tests); `outbox.repo.f004.test.ts` busy_timeout proxy check (see limitation note) |
| REQ-F004-021 | `bus` is prod; BFF hard-refuse on non-bus mode | `config.f004.test.ts` |
| REQ-F004-022 | Transport adapter behind the seam; no route/service change | `static-scans.test.ts` |
| REQ-F004-023 | Relay lag metric | `metrics.test.ts` getRelayLagMs |
| REQ-F004-024 | Backlog metric | `metrics.test.ts` getBacklogCount |
| REQ-F004-025 | Failure/attempt/park-split/post-ack-cap counters | `metrics.test.ts` event-counters block |
| REQ-F004-026 | `/ready` threshold-driven readiness, named config keys | `ready.test.ts`; `relay-config.test.ts` thresholds |
| REQ-F004-027 | Latency/throughput SLO | `perf.test.ts`; `outbox.repo.f004.test.ts` REQ-F004-027/034 query-PLAN regression guard (Phase-8 addendum — see below) |
| REQ-F004-028 | Security & log hygiene | `static-scans.test.ts` |
| REQ-F004-029 | Delivery-bookkeeping schema + total derivation | EXISTING `f004-outbox-migration.test.ts`; NEW `ordering-key.test.ts`, `outbox.repo.f004.test.ts`, `bus.f004.test.ts` |
| REQ-F004-030 | Transport/broker deferred to ops (ruling) | traced via REQ-F004-049/050 tests |
| REQ-F004-031 | Per-key ordering + effectively-once (ruling) | traced via REQ-F004-001/011/016/018/042 tests |
| REQ-F004-032 | Park + capped backoff (ruling) | traced via REQ-F004-013/014 tests |
| REQ-F004-033 | Separate supervised relay service (ruling) | `relay-config.test.ts` REQ-F004-033 block (relay-scoped config independent of BFF secrets); `static-scans.test.ts` REQ-F004-054 block |
| REQ-F004-034 | Observability/SLO constants (ruling) | traced via REQ-F004-026/027 tests |
| REQ-F004-035 | Retention (ruling) | traced via REQ-F004-019 test |
| REQ-F004-036 | Dedupe id transport-level (ruling) | traced via REQ-F004-018/048 tests |
| REQ-F004-037 | First-connection backfill horizon (ruling) | traced via REQ-F004-015 test |
| REQ-F004-038 | Bookkeeping columns shape (ruling) | traced via REQ-F004-029 tests |
| REQ-F004-039 | Hard-refuse prod posture; separate `/ready` (ruling) | traced via REQ-F004-021/044/045 tests |
| REQ-F004-040 | Production-readiness gate framing (informational ruling) | not independently tested — informational, no code behavior hinges on it |
| REQ-F004-041 | Eligibility query (drain-selection contract) | `outbox.repo.f004.test.ts` selectEligible (the spec's own two seeded scenarios verbatim) |
| REQ-F004-042 | Head-of-line: skip across / block within | `outbox.repo.f004.test.ts` head-of-line tests; `drainer.test.ts` per-key-ordering block |
| REQ-F004-043 | Conforming-transport contract (ack/id-carriage/perm-transient) | `transport.test.ts`; `http-peer-transport.test.ts` (id-carriage + full REQ-F004-055 classification table) |
| REQ-F004-044 | Separate `/ready` on the relay | `ready.test.ts` |
| REQ-F004-045 | `bus`+no-URL relay hard-refuse | `relay-config.test.ts` bus-mode-without-URL block |
| REQ-F004-046 | `EVENT_BUS_MODE` closed-set validation | `config.f004.test.ts` |
| REQ-F004-047 | Transient-vs-permanent classification | `drainer.test.ts` (permanent-immediate-park + transient-retry tests); `http-peer-transport.test.ts` transient cases |
| REQ-F004-048 | Delivery-id epoch | `delivery-id.test.ts`; `outbox.repo.f004.test.ts` getEpoch |
| REQ-F004-049 | Two-layer transport seam; fake-transport swap proof; no-leak | `drainer.test.ts` (built entirely against `FakeTransport`); `static-scans.test.ts` no-leak block; `transport.test.ts` |
| REQ-F004-050 | HTTP-to-known-peer for GTM; broker future drop-in | `transport.test.ts`; `http-peer-transport.test.ts` |
| REQ-F004-051 | Multi-peer fan-out ack, stateful re-drive, eviction, permanent-immediate-park, partial-park distinct signal | `http-peer-transport.test.ts` fan-out block (a-c) + REQ-F004-055 fan-out-composition block (d, concrete HTTP-status-driven); `drainer.test.ts` permanent-immediate-park test (d, transport-agnostic); `metrics.test.ts` park-split counters (e, SPEC-AMBIGUITY on the transport->drainer signal shape remains open, see below) |
| REQ-F004-052 | `EVENT_BUS_URL` comma-list + `EVENT_BUS_TRANSPORT` selector, broker all-env refuse | `relay-config.test.ts`; `transport.test.ts` broker-refuse block |
| REQ-F004-053 | Broker-swap-invariant consumer contract (dedupe + reorder tolerance) | `consumer-contract.test.ts` |
| REQ-F004-054 | Per-app relay pattern | `static-scans.test.ts` REQ-F004-054 block |
| REQ-F004-055 | HTTP status/network-failure -> permanent/transient classification (RULED, rev 11, §4.4); fan-out composition | `http-peer-transport.test.ts` REQ-F004-055 single-peer classification-table block (`it.each` over ack/transient/permanent) + fan-out-composition block; `static-scans.test.ts` REQ-F004-055/049 seam-isolation block (classification tokens live only in HttpPeerTransport) |

**Coverage: 55/55 REQ-F004-### ids mapped** (rev 11 appended REQ-F004-055; 14 "traced"/
informational — REQ-F004-004/005/007/008 plus the ten §9 ruling-record items REQ-F004-030..040
whose behavior is realized entirely by the operative REQ(s) they decided or, for REQ-F004-040, is
purely informational — matching the F-002/F-005 `TEST_PLAN.md` precedent for open-questions
sections; the remaining 41 REQ ids, including the new REQ-F004-055, each have at least one
independent, executable test). No REQ id was left unmapped.

## Design notes / how ambiguity was handled

- **Internal module call-shapes** for every not-yet-built `bff/src/relay/*` file are documented
  assumptions (see table above), not spec ambiguities — the spec's *behavior* is unambiguous in
  every case; only the literal function/class signature was invented, exactly as F-002/F-005 did
  for their own unpinned web API client names.
- **`drainer.test.ts` decouples from `transport.ts`/`http-peer-transport.ts` entirely** — it uses
  only the structurally-duck-typed `FakeTransport` from `helpers.ts`, which imports nothing from
  `bff/src/relay/*`. This means the drainer suite can go green the moment `drainer.ts` alone
  exists, independent of whether `HttpPeerTransport` is finished yet — mirroring the real
  REQ-F004-049 swap-ability guarantee in the test suite's own dependency graph, not just its
  assertions.
- **The `MAX_ATTEMPTS` cap-boundary tests** (`drainer.test.ts` poison-isolation block) seed
  `attempt_count = MAX_ATTEMPTS - 1` directly rather than driving a row through N real
  backoff-delayed ticks, so the test is deterministic and fast regardless of the (spec-undefined)
  concrete backoff constant values — it still exercises the real cap-decision code path (one more
  failure trips the cap), just without waiting out real backoff wall-clock delays.
- **Graceful-shutdown tests** use `FakeTransport.hang()`/`.settleHang()` plus short REAL timeouts
  (tens of ms, not fake timers) — this repo's own test-authoring notes (`TEST_PLAN.md`'s F-002
  session-reuse note) record that faking timers previously hung Fastify's/better-sqlite3's own
  real-timer internals in this codebase, so real (short) timeouts are the established, safer
  convention here.
- **Perf tests are smoke-level**, not a rigorous load test, per this repo's own established
  `*.performance.test.ts` convention (documented inline in `perf.test.ts`'s header).

## SPEC-AMBIGUITY findings requiring human ruling

**Status update (Phase-2 addendum): item 1 below (the HTTP-status -> permanent/transient mapping)
was the one genuine ambiguity this suite originally flagged. It has since been RULED and pinned as
REQ-F004-055 (spec rev 11, §4.4) and is now fully tested** — see "Phase-2 addendum" above and the
`http-peer-transport.test.ts`/`static-scans.test.ts` blocks it added. Retained here, struck
through, for the historical record rather than silently deleted (the QA workflow instruction is to
list ambiguities found, not to erase the record once a human rules on one).

~~1. HttpPeerTransport's concrete HTTP-status-code -> permanent/transient classification mapping
   was genuinely unpinned.~~ **RESOLVED by REQ-F004-055 (rev 11) — see the Phase-2 addendum
   above.** (Original finding: the spec precisely defined the conforming-transport CONTRACT,
   REQ-F004-043(c), and the ORCHESTRATION-level consequence, REQ-F004-047/014/051(d), but never
   stated which concrete HTTP status codes `HttpPeerTransport` itself must treat as "permanent."
   REQ-F004-055 now pins the exact table; `http-peer-transport.test.ts` exercises it in full.)

2. **How the drain/orchestration layer learns "this park was partial" vs. "this park was
   never-delivered" from `HttpPeerTransport`, for the REQ-F004-025/051(e) split park counters, is
   not pinned.** REQ-F004-051(e) itself states a partially-delivered park STILL has row-level
   `acked_at IS NULL` (full ack requires every peer), so the distinction cannot be read back from
   the `event_outbox` row/DB state alone — the signal must originate inside the transport's
   rejection (e.g. `TransportError` carrying a `partial: boolean` flag alongside its
   `classification`), which the design doc's pinned `TransportError` shape (§2.1: `classification:
   'transient' | 'permanent'`) does not currently include. `metrics.test.ts` tests each recorder
   function directly (the defensible, interface-level slice: the two counters ARE independently
   incrementable and distinct) rather than assuming a specific transport-to-drainer signal shape
   for the distinction end-to-end. **Needs a human/architect ruling** on the exact carrier for this
   signal (most likely: add an optional field to `TransportError`).
3. **`bff/src/relay/drainer.ts`'s exact exported API shape** (assumed `createDrainer({transport})
   -> {runOnce(), shutdown(timeoutMs)}`) is the single highest-leverage assumption in this suite —
   see the "Interface-shape assumptions" table above. This is flagged for awareness (not a spec
   ambiguity — the design doc correctly leaves internal APIs to the implementer) so the
   implementer either matches this minimal shape or the test call sites get a thin adjustment;
   either way the OBSERVABLE assertions (DB row state transitions) are what encode the spec.
4. **The relay-scoped config's module path and BFF/relay config split** (design §5/§11 "open
   question #1") is explicitly UNRESOLVED by the spec/design itself, not just by this suite —
   `relay-config.test.ts` assumes `bff/src/relay/config.ts`. This is the design doc's own flagged
   open question, carried forward here rather than resolved by this QA task.
5. **REQ-F004-020's SQLITE_BUSY-retry-without-incrementing-attempt_count scenario is not
   independently exercised** — documented as a coverage limitation (not a fabricated/fake test) in
   `outbox.repo.f004.test.ts`'s `busy_timeout` block: reliably forcing a genuine SQLITE_BUSY from
   two truly concurrent writers is not feasible deterministically within one Node process given
   better-sqlite3's synchronous, single-threaded-per-connection nature, without either flaky
   timing or spawning a second OS process/worker thread. A positive-`busy_timeout`-configured
   proxy check is included instead; the full concurrent-contention scenario is recommended for an
   integration/e2e-level check outside this unit suite (two real relay/BFF processes against one
   file), not fabricated here with a fake that wouldn't exercise SQLite's real retry path.

None of the above blocks writing a concrete, spec-derived test — each is either (a) tested at the
most defensible, uncontroversial layer while flagging the genuinely-open narrower question, or
(b) an interface-shape assumption already reasoned through and documented, per hard rule 4's
"write the test for the most defensible reading, mark it, list it" instruction.

---

# TEST_PLAN — F-010 Deliver admin.* Events to customer-web-app (Register cwa as a Relay Peer + Shared-Secret Credential)

Spec: `specs/F-010-deliver-admin-events-to-customer-web-app.md` (Draft rev 3 — human ruling gate
complete 2026-07-22; Q1/Q2/Q4/Q5/Q6/Q8/Q9 resolved, Q3/Q7 explicitly deferred). Parent/composed
specs: `specs/F-004-production-event-bus.md` (REQ-F004-049/051/052/055), cwa's
`~/git/customer-web-app/specs/F-005-cross-app-identity-sync.md` §3.6 (REQ-F005-060..063, the
contract of record this feature satisfies — not owned here).

## Framework & harness choice

Same established BFF suite as F-002/F-004/F-005: `vitest` (node env), real (tmp-file) SQLite via
`bff/src/store/db.ts`, real local `node:http` servers standing in for peers (the F-004 convention
in `bff/test/relay/http-peer-transport.test.ts` — no mocking of the transport's own networking),
and the `vi.resetModules() + dynamic import()` pattern for load-time-throwing config modules
(`bff/test/relay/relay-config.test.ts`). No new framework introduced. Run with `npm test` (=
`vitest run`) from `bff/`.

**Directory-ownership boundary honored:** every file below lives under `bff/test/relay/` or
`bff/test/store/` — the existing relay/event unit+integration home. Nothing was written to
`tests/e2e/` (owned by the e2e-tester, Phase-6) or `tests/unit/` (owned by the unit-test-writer).
Every new file is a **dedicated, separate file** for F-010's additions to an already-existing
F-004 module (mirrors this repo's own `bff/test/config.f004.test.ts` precedent of isolating one
feature's additions rather than editing a pre-existing, other-feature-owned spec-level test file)
— **zero pre-existing test file was edited**, so there is zero regression risk to the established
green F-004 baseline.

## What exists vs. what does not, as of this task

F-004 is fully implemented (`bff/src/relay/**` — `config.ts`, `transport.ts`,
`http-peer-transport.ts`, `drainer.ts`, `metrics.ts`, `ready.ts`, `backoff.ts`, `delivery-id.ts` —
all exist and their F-004 suites are green). **F-010's credential path does not exist yet**: no
`X-Event-Ingest-Secret` header is ever attached, no `EVENT_BUS_PEER_AUTH_TOKEN` config key exists, no
boot-posture validation for it exists, and `bff/.env.example` does not document the key. Every new
test below is written strictly from the spec (this task did not read `bff/src/**` before writing
it), and is **expected to fail now** on a clean assertion mismatch — not a syntax/import error in
the test files themselves. Confirmed by running the full suite (see "Suite status" below).

## Interface-shape assumptions (NOT pinned verbatim by the spec — flagged, not silently guessed)

The spec pins every requirement's **observable wire/config behavior** exactly (REQ-F010-004/005/
007/017 in particular are pinned to a concrete header name, env-var name, "verbatim value", and a
three-application-level-header set, per the spec's own §7 self-check). It does **not** pin the
internal **call signatures** F-010 must extend. Each assumption below is documented inline in the
relevant file's header comment; summarized here for a single reference point:

| Module | Assumed extension | Rationale |
|---|---|---|
| `bff/src/relay/http-peer-transport.ts` | `new HttpPeerTransport(peerUrls, peerTimeoutMs?, peerAuthToken?)` — a 3rd optional positional constructor param | Mirrors the EXACT precedent this repo already used to add `peerTimeoutMs` as a 2nd optional positional param (`bff/test/relay/http-peer-transport.unit.test.ts`, Phase-7 remediation) — the next wire-adjacent concern extends the same way. A credential is attached iff the param is a non-empty string, which maps directly onto REQ-F010-017's "absent/empty is empty, whitespace-only is not" definition via ordinary JS truthiness — no extra plumbing assumption needed. |
| `bff/src/relay/transport.ts` | `createTransport({ kind, peerUrls, peerTimeoutMs?, peerAuthToken? })` | Mirrors the same `peerTimeoutMs`-threading precedent one level up the factory, needed to test REQ-F010-008's threading claim (config → createTransport → HttpPeerTransport) rather than only the transport constructor in isolation. |
| `bff/src/relay/config.ts` | Exposes the credential as `config.peerAuthToken: string \| undefined` | Mirrors the camelCase convention of every other peer-scoped config key (`peerUrls`, `peerTimeoutMs`). |

**Confirmed, not guessed:** running the suite incidentally showed (via vitest's own failure-diff
output, not a deliberate read of `bff/src/**`) that `http-peer-transport.ts` does call `fetch()` —
this validated, rather than invented, the assumption behind the REQ-F010-005
"whitespace-verification-point" test's fetch-spy technique (see Ambiguities below for the residual
risk this was written against **before** that incidental confirmation).

None of these are `SPEC-AMBIGUITY` in the blocking sense (hard rule 4) — the spec's *behavior* is
unambiguous in every case above; only the internal call-shape needed inventing, exactly the same
situation F-004's own `TEST_PLAN.md` section documented for its unpinned `HttpPeerTransport`/
`createDrainer` signatures.

## Test files created

- `bff/test/relay/http-peer-transport.f010.test.ts` — 17 tests (see Phase-4 addendum below —
  net +1 vs. the original 16: one mis-targeted assertion was replaced by two correctly-targeted
  ones). REQ-F010-004/005/006/009/013/022.
  Three-application-level-header presence when a credential is configured; the "exactly one NEW
  header vs. the no-credential baseline" diff assertion; the REQ-F010-005 whitespace-verification-
  point test (asserted at the `fetch()` call boundary, not the peer-observed wire value, per the
  spec's own explicit instruction that some HTTP clients strip OWS in transit); absent/empty-string
  credential → no header; whitespace-only credential → header sent verbatim; two-peer shared-secret
  fan-out; single-POST-per-delivery (no added round-trip); the REQ-F004-055 classification table
  re-affirmed unchanged with a credential configured (REQ-F010-013/028).
- `bff/test/relay/transport.f010.test.ts` — 5 tests. REQ-F010-008 (credential threaded through
  `createTransport`, not just the transport constructor in isolation) and REQ-F010-029 (broker
  still hard-refuses even with a credential supplied).
- `bff/test/relay/relay-config.f010.test.ts` — 20 tests (see Phase-4 addendum below — net -1 vs.
  the original 21: two platform-impossible assertions were replaced by one). REQ-F010-003 (peer registration reuses the
  unchanged `EVENT_BUS_URL` wire shape, demonstrated with a representative cwa-shaped URL, not a
  literal spec constant), REQ-F010-007 (new config key, raw single string — NOT comma-split, NOT
  trimmed, no hard-coded literal), REQ-F010-017 (the full boot-posture matrix: production
  absent/empty → refuse naming the var; production whitespace-only → boots verbatim; production/
  development present → boots; development absent/empty → boots soft; CR/LF/NUL/other-illegal-byte
  → refuse in ANY environment, distinct from the empty-value check).
- `bff/test/relay/drainer.f010.test.ts` — 4 tests. Integration: the REAL `HttpPeerTransport` (not
  the F-004 `FakeTransport` double) driven by the REAL `createDrainer` against a REAL local stub
  peer that authenticates the credential header. REQ-F010-014 (401 → permanent → immediate park,
  no backoff, never-delivered-park counter fires), REQ-F010-018 (wrong-credential park is
  RECOVERABLE: re-provisioning the correct credential + replaying the parked row delivers it, event
  never lost), REQ-F010-019 (misconfiguration never silently drops an event, never corrupts
  bookkeeping, does not wedge an unrelated ordering key).
- `bff/test/relay/confidentiality.f010.test.ts` — 8 tests. REQ-F010-010 (credential never in the
  envelope; `admin.user.created` keeps `changes={username,role}` exactly), REQ-F010-011 (credential
  never in a thrown/serialized `TransportError`, never in `console.log/warn/error/info` output
  during a real credentialed delivery, static proxy checks that `ready.ts`/`metrics.ts` reference no
  credential token), REQ-F010-020 (`.env.example` documents the key with an empty value; no
  hard-coded literal in `config.ts`).
- `bff/test/relay/static-scans.f010.test.ts` — 8 tests. REQ-F010-001 (a genuine credential-carrying
  code path exists in the transport, not config alone — plus the explicit pre-implementation
  RED-flag test, mirroring the F-004 `static-scans.test.ts` dual-test convention), REQ-F010-002/012/
  027 (the 21-name/5-`admin.user.*` catalog is unchanged; catalog.ts carries no credential-related
  field), REQ-F010-008/023 (the drainer/orchestration layer references no credential value/header
  constant/env-var — transport-swap boundary preserved), REQ-F010-025 (no HMAC/mTLS signing, no
  https-only peer-URL scheme enforcement introduced — stays with D-006).
- `bff/test/store/f010-no-new-outbox-state.test.ts` — 2 tests. REQ-F010-022's DB-state half: no new
  `event_outbox` column, no plausible credential-storing table.

**Total: 7 new files, 64 test cases** (16 + 5 + 21 + 4 + 8 + 8 + 2), matching `vitest run`'s own
collected count exactly.

## Suite status as of this run

Run from `bff/`: `npm test` (= `vitest run`).

```
Test Files  6 failed | 71 passed (77)
     Tests  26 failed | 1267 passed (1293)
```

- All **70 pre-existing test files / 1229 pre-existing tests** (F-001..F-005, F-004's relay suite
  included) **pass unchanged** — this task added 7 new files and edited zero pre-existing files, so
  there is zero regression risk to the existing green baseline. `bff/test/store/
  f010-no-new-outbox-state.test.ts` (new) also passes fully, cleanly.
- The **26 new failing assertions**, all within the 6 files that assert genuinely-new F-010
  behavior, are every one a clean, informative assertion mismatch (`expected 'X' to be undefined` /
  `rejects.toThrow()` not throwing / a missing `.env.example` line) — confirmed via
  `--reporter=verbose`: **zero** are a `SyntaxError`, a `ReferenceError` in the test file's own
  code, or an uncaught exception that crashed test collection. This is the correct, expected
  pre-implementation RED signal.
- `npx tsc --noEmit -p bff` exits 0 (test files are outside `bff/tsconfig.json`'s `include: ["src"]`,
  matching this repo's existing convention).
- **Note on which failures are "genuinely F-010 RED" vs. "passes now by legitimately reusing
  F-004 machinery":** a few assertions in `drainer.f010.test.ts` (REQ-F010-014/019) **pass today**
  even though no credential code path exists, because a stub peer that requires a matching
  `X-Event-Ingest-Secret` header already sees "no header at all" as a mismatch regardless of F-010's
  status — this legitimately proves F-004's classify/park/metrics machinery already composes
  correctly with a credential-authenticating peer, which F-010 must not regress. The genuinely-new
  RED signal for the credential mechanism itself is `REQ-F010-018`'s replay test (requires the
  CORRECT credential to actually reach the peer after re-provisioning) and every
  `http-peer-transport.f010.test.ts` / `transport.f010.test.ts` / `relay-config.f010.test.ts`
  failure (all directly assert the credential's presence/value, which is impossible before F-010
  ships). This is called out explicitly rather than silently claimed as uniform RED, per the same
  transparency standard the F-004 `TEST_PLAN.md` section applied to its own vacuously-passing
  `consumer-contract.test.ts`.

## Phase-4 addendum (2026-07-23) — post-implementation verification, two disputed test vectors corrected

F-010 has since been implemented (`bff/src/relay/**`, `bff/.env.example`, and the runbook now
exist). Re-ran the full suite (`npm test` from `bff/`, plus `npx tsc --noEmit -p bff`). The
implementer self-reported 1290 pass / 3 fail, disputing all 3 as platform/spec impossibilities in
the TEST vectors, not implementation bugs. Per instruction, neither claim was taken on the
implementer's word — both were independently reproduced with standalone scripts before any test
file was touched.

**Initial post-implementation run (before this addendum's fixes):**

```
Test Files  2 failed | 75 passed (77)
     Tests  3 failed | 1290 passed (1293)
```

All 70 pre-existing files and 5 of this task's 7 F-010 files were already fully green against the
real implementation — confirming REQ-F010-021 (no F-004 regression) and the bulk of F-010's own
coverage passed on the FIRST post-implementation run with no test changes needed.

### Dispute 1 — `relay-config.f010.test.ts`, NUL-byte-in-credential boot-refusal (REQ-F010-017)

**Implementer's claim:** `process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\x00more'` truncates to
`'tok'` at assignment (Node/libuv `setenv` uses NUL-terminated C strings), so config reads a valid,
non-illegal value and correctly boots — the NUL never reaches the process, in tests or reality.

**Independently verified, not assumed:** ran a standalone script (`node`, this exact runtime,
v24.18.0/linux) that set `process.env['TEST_NUL_VAR'] = 'tok\x00more'` and read it back BOTH
in-process and via a freshly spawned child process inheriting the same env — both observed `'tok'`
(3 chars), confirming truncation happens at the OS/environment-variable layer, before any
JavaScript (including config.ts) ever runs. This is not Node-specific: POSIX `setenv`/`putenv` and
the Windows environment block are both fundamentally NUL-terminated C-string storage — no real OS
can carry a NUL byte inside an environment variable's value, for any process, ever.

**Classification: TEST-VECTOR DEFECT, CORRECTED (not an implementation bug).** The two failing
assertions (`production`/`development` × "NUL byte refuses to boot") asserted behavior that is
architecturally unreachable via `process.env` on any real OS — the implementation cannot be faulted
for not rejecting a byte it can never receive. **What changed, in `bff/test/relay/
relay-config.f010.test.ts`:** removed the two `it.each` assertions asserting `rejects.toThrow()`
for the NUL-byte vector; replaced them with a single new test that (a) asserts the truncation
itself in-process (`expect(process.env['EVENT_BUS_PEER_AUTH_TOKEN']).toBe('tok')`) as a pinned,
executable regression guard rather than a comment-only claim, and (b) asserts the truncated value
boots normally and is exposed verbatim (`config.peerAuthToken === 'tok'`) — turning an
unreachable-vector failure into a documented, passing fact. **REQ-F010-017 coverage is NOT
reduced:** the pre-existing CR-byte and LF-byte `it.each` tests (both environments) and the VT
(0x0B) "non-exhaustive illustration" test are untouched, still pass against the real
implementation, and independently exercise the SAME header-legality-refusal code path on bytes that
ARE reachable via `process.env` — which is REQ-F010-017's actual testable intent ("CR, LF, and NUL
are non-exhaustive illustrations... of any byte illegal in an HTTP header field value").

### Dispute 2 — `http-peer-transport.f010.test.ts`, whitespace-only `' '` credential observed at the peer (REQ-F010-005/017)

**Implementer's claim:** WHATWG `fetch`/undici strips leading/trailing HTTP whitespace from header
values before the request is sent, so a peer stub observes `''`, not `' '`; REQ-F010-005's own text
says the whitespace-verbatim check must be done at the TRANSPORT boundary (the `fetch()` call), not
at the peer, for exactly this reason; the sibling fetch-spy test (value `' abc '`) already passes,
proving the transport itself sets the value verbatim.

**Independently verified, not assumed:** wrote a standalone script driving a real local
`node:http` server with real `fetch()` calls. Confirmed: (a) a whitespace-only header value `' '`
arrives at the server as `''`; (b) `new Headers({'x': ' '}).get('x')` is ALREADY `''` immediately
after construction, with zero network I/O — i.e., the stripping happens inside the WHATWG `Headers`
class itself, not "in transit" on the wire, so it is unconditional for any code using `fetch`/
`Headers`, not implementation-specific; (c) the padded case `' abc '` likewise normalizes to
`'abc'` at the peer, corroborating the effect is general, not a one-off.

**Classification: TEST-VECTOR DEFECT, CORRECTED (not an implementation bug).** The failing
assertion checked the whitespace-only value at the peer-observed wire boundary — precisely the
verification point REQ-F010-005's own text says is insufficient ("a peer stub that observes trimmed
surrounding whitespace does not by itself prove a spec violation, whereas the transport setting a
trimmed value does"). **What changed, in `bff/test/relay/http-peer-transport.f010.test.ts`:**
1. Extracted the existing fetch-spy plumbing (previously inlined only in the `' abc '` test) into
   a shared `captureTransportHeaderValue(peerAuthToken)` helper, so the correct verification
   technique is reusable rather than re-duplicated per value.
2. Replaced the single peer-observed `' '` assertion with **two** tests: (a) a corrected test using
   `captureTransportHeaderValue(' ')` that asserts the TRANSPORT sets the header to `' '` verbatim
   at the `fetch()` call boundary — this is the test that actually proves/disproves REQ-F010-017's
   "whitespace-only is non-empty, sent verbatim" claim, and it now passes; (b) a new,
   explicitly-labeled DOCUMENTATION test at the peer boundary that asserts the header KEY is
   present (proving the transport did not treat `' '` as absent, contrasting with the `''`→omitted
   case) while its VALUE is normalized to `''` by the client — asserting the real, verified outcome
   rather than a false expectation, with an inline comment citing REQ-F010-005's own text for why
   this is not itself a spec violation.

REQ-F010-005/017 coverage is NOT reduced — if anything it is more precise: the mechanism the spec
actually requires (transport sets the value verbatim) is now the one asserted, and the previously
over-claiming peer-level assertion is retained as accurate documentation instead of a false claim.

### Final suite status (after both corrections)

```
Test Files  77 passed (77)
     Tests  1293 passed (1293)
```

`npx tsc --noEmit -p bff` exits 0. Zero regressions: all 70 pre-existing files remain green: all 7
F-010 files (now 64 tests total, unchanged count — the two corrections were 2-for-1 and 1-for-2
swaps that net to zero) pass against the real implementation. Every REQ-F010-### id in the
coverage map below remains covered at the same or a strictly more precise verification point;
none was weakened, skipped, or deleted to make the suite pass, per this role's hard rule 4.

## REQ-F010-### → test coverage map (every REQ mapped)

Legend: **unit/integration (bff/test/)** = covered by a file in this task. **Phase-6 e2e
(tests/e2e/relay)** = explicitly deferred to the e2e-tester per this task's directory-ownership
instruction — NOT written here. **doc/process-only** = deliberately NOT an in-repo automated test,
per this task's own explicit framing; reasoning given inline. **F-004-owned (reused)** = already
covered by the pre-existing F-004 suite, unchanged and re-affirmed rather than duplicated.

| REQ | Requirement (short) | Coverage |
|---|---|---|
| REQ-F010-001 | Core work is a transport code-path change, not config alone | `static-scans.f010.test.ts` (credential-header literal scan + explicit RED-flag) + `http-peer-transport.f010.test.ts` (behavioral header-set proof) |
| REQ-F010-002 | Delivery wire metadata/config only, NOT the event contract | `static-scans.f010.test.ts` (catalog 21-name/5-family scan) + F-004-owned `drainer.test.ts` byte-for-byte envelope (reused) |
| REQ-F010-003 | cwa registered via the EXISTING `EVENT_BUS_URL` peer-list shape | `relay-config.f010.test.ts` |
| REQ-F010-004 | Credential is the 3rd wire element, same single POST | `http-peer-transport.f010.test.ts` |
| REQ-F010-005 | Credential header name + byte-for-byte verbatim value + 3-app-header set | `http-peer-transport.f010.test.ts` (incl. the whitespace-verification-point fetch-spy test) |
| REQ-F010-006 | The two existing wire elements are unchanged | `http-peer-transport.f010.test.ts` |
| REQ-F010-007 | New config key, raw single string, not split/trimmed, not hard-coded | `relay-config.f010.test.ts` |
| REQ-F010-008 | Threaded config → createTransport → HttpPeerTransport; drainer never sees it | `transport.f010.test.ts` (threading) + `static-scans.f010.test.ts` (drainer no-leak) |
| REQ-F010-009 | Single shared secret applied to every configured peer | `http-peer-transport.f010.test.ts` |
| REQ-F010-010 | Credential never in the envelope | `confidentiality.f010.test.ts` |
| REQ-F010-011 | Credential never in logs/errors/metrics/`/ready`/outbox | `confidentiality.f010.test.ts` (TransportError + console spy, strong; `ready.ts`/`metrics.ts` static proxy, weaker — see Ambiguities) |
| REQ-F010-012 | Envelope delivered byte-for-byte; catalog unchanged | `static-scans.f010.test.ts` + F-004-owned `drainer.test.ts`/`bus.f004.test.ts` (reused) |
| REQ-F010-013 | REQ-F004-055 classifier semantics unchanged | `http-peer-transport.f010.test.ts` (regression re-run with credential configured) + F-004-owned classification suite (reused) |
| REQ-F010-014 | 401 from cwa → permanent → immediate park (documented outcome) | `drainer.f010.test.ts` (real transport + real drainer + real metrics) |
| REQ-F010-015 | Row published only after ALL peers ack; one peer's permanent park parks the whole key | **Phase-6 e2e (tests/e2e/relay)** — explicitly named in this task's instructions as e2e-tester territory (the two-peer partially-delivered park journey) |
| REQ-F010-016 | Runbook: peer reg, credential provisioning, rotation, park-response, real-cwa deployment-validation | **doc/process-only** — this task's own instructions name REQ-F010-016 as a doc check, not an in-repo automated test; see rationale below |
| REQ-F010-017 | Boot posture: prod fail-fast naming the var / whitespace-only boots / dev boot-soft / CR-LF-NUL refuse in any env | `relay-config.f010.test.ts` |
| REQ-F010-018 | Wrong/stale credential → permanent park, recoverable via re-provision + replay | `drainer.f010.test.ts` |
| REQ-F010-019 | Misconfiguration never silently drops an event/corrupts bookkeeping | `drainer.f010.test.ts` (delivery-outcome half) + `relay-config.f010.test.ts` (boot-refusal half — nothing runs, so nothing is dropped, vacuously true since outbox writes happen in the BFF process, not the relay process) |
| REQ-F010-020 | Secret handling posture: env-sourced, `.env.example` empty value, no committed literal | `confidentiality.f010.test.ts` |
| REQ-F010-021 | No regression to F-004 | **doc/process-only** — the full pre-existing 70-file/1229-test F-004+ suite passing UNCHANGED (confirmed this run) IS the regression evidence; the "F-010 touches only transport/config/.env.example/tests/runbook" claim is a `git diff --stat` scope check at implementation-review time (mirrors the F-001 `TEST_PLAN.md`'s own precedent for this exact kind of claim), not a pre-implementation unit test (there is no diff yet) |
| REQ-F010-022 | No added round-trip; no new persisted DB state | `http-peer-transport.f010.test.ts` (single-POST) + `bff/test/store/f010-no-new-outbox-state.test.ts` (schema) |
| REQ-F010-023 | Transport-swap boundary preserved | `static-scans.f010.test.ts` (drainer no-leak, shared block with REQ-F010-008) + F-004-owned `drainer.test.ts`'s `FakeTransport` swap-ability proof (reused, unaffected by the credential) |
| REQ-F010-024(a) | e2e stub-peer: correct credential → 2xx → published | **Phase-6 e2e (tests/e2e/relay)** — explicitly named e2e-tester territory |
| REQ-F010-024(b-wrong) | e2e stub-peer: wrong credential (env-independent) → 401 → permanent park | **Phase-6 e2e (tests/e2e/relay)** |
| REQ-F010-024(b-missing) | e2e stub-peer: missing credential, DEV-ONLY → 401 → permanent park; PRODUCTION → boot refusal, not a 401 | **Phase-6 e2e (tests/e2e/relay)** — the production boot-refusal HALF of this arm is unit-covered by `relay-config.f010.test.ts`'s REQ-F010-017 tests, reused |
| REQ-F010-024(b) real-cwa integration | Live delivery accepted by the real cwa deployment | **doc/process-only** — explicitly named in this task's instructions as a runbook deployment-validation step, NOT an in-repo automated test (cwa is a separate deployment) |
| REQ-F010-025 | No HMAC/mTLS peer auth, no https-only scheme enforcement (stays with D-006) | `static-scans.f010.test.ts` |
| REQ-F010-026 | No cwa/`customer-web-app` repo file changed | **doc/process-only** — a cross-repo negative claim outside this repo's test harness; verified by PR-diff scope review (mirrors the F-001 `TEST_PLAN.md` precedent for REQ-F001-004/007's identical "negative claim about a separate deployment/repo" shape) |
| REQ-F010-027 | Envelope/`changes` shape/catalog unchanged | `static-scans.f010.test.ts` + `confidentiality.f010.test.ts` (same tests as REQ-F010-002/010/012) |
| REQ-F010-028 | Classifier semantics unchanged (non-goal restated) | `http-peer-transport.f010.test.ts` REQ-F010-013 regression block + F-004-owned classification-token static scan (reused, unchanged) |
| REQ-F010-029 | No broker/non-HTTP transport added | `transport.f010.test.ts` + F-004-owned `transport.test.ts`/`transport.unit.test.ts` (reused) |
| REQ-F010-030 | No deployment-topology artifacts (docker-compose/k8s/Dockerfile) | **doc/process-only** — this task's own instructions name REQ-F010-030 explicitly as a non-goal NOT covered by an in-repo test; see rationale below |

**30/30 REQ ids traced.** Of these: **25** have a concrete executable test in this task's 7 new
files (several also cross-reference pre-existing F-004-owned tests that already prove the
"unchanged" half of a requirement); **3** (`REQ-F010-015`, `REQ-F010-024(a)`, `REQ-F010-024(b-wrong)`,
`REQ-F010-024(b-missing)`'s delivering half) are explicitly deferred to the Phase-6 e2e-tester per
this task's own directory-ownership instruction; **5** (`REQ-F010-016`, `REQ-F010-024(b)` real-cwa
integration, `REQ-F010-021`, `REQ-F010-026`, `REQ-F010-030`) are deliberately **doc/process-only**,
per this task's own explicit framing, with rationale given per-row above and expanded just below.

### Why REQ-F010-016 / REQ-F010-024(b) / REQ-F010-030 have NO in-repo automated test (by design)

This task's own brief explicitly names these three as requirements to **deliberately not** cover
with an in-repo automated test, and this plan follows that framing rather than inventing a
mechanical proxy that would either be vacuous or overreach:

- **REQ-F010-016 (runbook)** — a content-completeness check ("does the runbook's prose cover
  registration/provisioning/rotation/park-response/deployment-validation") is a documentation-review
  concern, not a spec *behavior* a test can independently verify without re-grading prose quality.
  Writing a keyword-grep test would only prove the right WORDS appear, not that the runbook is
  operationally correct — a false-confidence proxy this task's brief explicitly asked to avoid by
  naming this item as doc-only up front.
- **REQ-F010-024(b) real-cwa integration** — by the spec's own text (§4/§8 Q2), this is "captured as
  a deployment-validation step in the F-010 runbook... NOT an in-repo automated test (cwa is a
  separate deployment)". A real `customer-web-app` deployment is not reachable from this test
  harness; simulating it with yet another local stub would just re-test REQ-F010-024(a), which is
  already the e2e-tester's Phase-6 stub-peer journey.
- **REQ-F010-030 (topology artifacts)** — the *Test* clause ("F-010 introduces no such artifact") is
  an absence-of-a-FUTURE-change claim. A glob-based existence check for `docker-compose*.yml`/
  `Dockerfile`/k8s manifests would pass **vacuously today** (none exist, unrelated to F-010) and
  would only ever catch a violation if some LATER, unrelated PR added one — at which point it is a
  PR-scope/review-time concern (does this PR's diff introduce a topology artifact), not a
  spec-behavior regression this feature's own test suite is positioned to guard. This task's brief
  names this item as its own example of a non-goal better handled as a review-time check than a
  standing unit test.

REQ-F010-021's "no regression to F-004" is handled the same way for the same reason (a diff-scope
claim, not a behavior a fresh unit test can assert pre-diff) — its BEHAVIORAL half ("the F-004
suites keep passing") is, however, concretely demonstrated by this run's own green 1229-test
baseline, so it is listed as doc/process-only for the diff-scope half only, not left completely
untested.

## Ambiguities / risks needing human ruling or acknowledgement

1. **HttpPeerTransport's assumed constructor extension (3rd positional `peerAuthToken` param) is
   not spec-pinned.** The spec pins the WIRE behavior exactly but leaves the internal call shape to
   the implementer, exactly as it already left `peerTimeoutMs`'s call shape open. This task's choice
   mirrors the established precedent (see the assumptions table above). **Not blocking** — if the
   implementer instead threads the credential via an options object, only the CALL SITES in the new
   test files need adjusting; every assertion is behavioral (headers observed by a real peer, or the
   value passed to `fetch()`), not shape-derived.
2. **REQ-F010-005's whitespace-verification-point test assumes `HttpPeerTransport` calls the global
   `fetch()`.** This was written BEFORE reading any implementation source, based on `bff/package.json`
   shipping no alternate HTTP client dependency and Node's `>=20` engine requirement. Running the
   suite incidentally confirmed this (via vitest's own failure-diff output, not a deliberate read of
   `bff/src/**`) — the fetch-spy technique correctly intercepted a real call. Flagged here because the
   test was DESIGNED to fail gracefully with an explicit diagnostic (`expect.fail(...)` naming the
   assumption) rather than a false pass/fail if the client had turned out to be `node:http` directly;
   that fallback branch did not trigger in this run, and is retained in the test as a safety net
   against a future refactor changing the client.
3. **REQ-F010-011's `/ready`/metrics-surface redaction checks are a static-text PROXY, not a live
   `/ready` HTTP call carrying a real credential through the whole boot path.** `ready.ts`'s own
   established test convention (`bff/test/relay/ready.test.ts`) constructs its deps object by hand
   (not by loading real `config`), so there is no existing seam to drive a genuinely end-to-end
   "`/ready` served while a credential is configured" check without inventing wiring the spec does
   not pin. The TransportError/console-log checks in the same file ARE strong, live, behavioral
   checks (a real 401 delivery with a real credential, real console spies) — only the `/ready`/
   metrics half is the weaker static proxy. Recommend a human ruling on whether this proxy is
   sufficient or whether `ready.ts`'s deps shape should be extended (by the implementer) with an
   explicit seam this suite could then drive live.
4. **REQ-F010-019's "boot refusal never drops an event" half is asserted as vacuously true by
   construction, not independently re-verified against a live outbox.** Since the relay process
   refusing to boot means the drain loop never runs at all, and outbox writes happen entirely in the
   separate BFF process (unaffected by the relay's own boot), there is no code path by which a boot
   refusal could ever touch `event_outbox` — this is a structural argument, not a live behavioral
   test, and is presented as such rather than manufacturing an artificial test that would just
   re-confirm the relay process didn't start.
5. **The camelCase config field name `peerAuthToken`** (vs., say, `credential` or `authToken`) is an
   assumption, not a spec pin — flagged in the assumptions table; low-risk since it only affects the
   TEST's own property-access call sites if the implementer picks a different name.

None of the above blocks a concrete, spec-derived test from having been written — each is either
(a) tested at the most defensible, uncontroversial layer while flagging the genuinely-open narrower
question, or (b) an interface-shape assumption already reasoned through and documented, per hard
rule 4's "write the test for the most defensible reading, mark it, list it" instruction.
