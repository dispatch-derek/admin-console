# Adversarial Spec Review — F-001 "Adhere to a Design System" (rev 3)

- **Spec under review:** `specs/F-001-adhere-to-design-system.md` (Draft rev 3)
- **Reviewer stance:** adversarial; page stands alone; drafting history and prior reviews NOT consulted.
- **Ground truth consulted (not under review):** `specs/admin-console.md`, `web/vendor/design-system/`, `web/src/`.
- **Checks executed:** 8/8.

---

## Baseline factual verification (§4 and §5 claims vs. disk)

Every quantitative claim the spec pins was checked against the working tree. Results:

| Spec claim | Disk reality | Verdict |
|---|---|---|
| §4 REQ-F001-009: `web/src/index.css` ~723 lines | file ends at line 724 | ACCURATE ("~") |
| §4 REQ-F001-009: `:root` dark block, `[data-theme='light']` block, `@media (prefers-color-scheme: light)` fallback | all three present (lines 4, 43, 79 `:root:not([data-theme='dark'])`) | ACCURATE |
| §4 REQ-F001-010: **143** `className` across **22 files** | `rg` count = 143 occurrences across 22 files, exactly | ACCURATE (exact) |
| §4 REQ-F001-011: three shared components `DangerConfirm`/`ErrorBanner`/`SetNotSetBadge` | `web/src/components/` holds exactly those three `.tsx` (+ tests) | ACCURATE |
| §4 REQ-F001-012: five feature areas users/workspaces/settings/raweditor/diagnostics | all five dirs present under `web/src/features/` | ACCURATE |
| §4 REQ-F001-013: no in-app theme switcher; `main.tsx` only mounts `App` + imports `index.css` | `main.tsx` confirmed; no runtime `data-theme` setter | ACCURATE |
| §5 REQ-F001-045: 11 DS components (`Badge`,`PageHeader`,`Table`,`Button`,`IconButton`,`Input`,`Select`,`Textarea`,`Toggle`,`SidebarItem`,`Modal`) | `_ds_manifest.json` `components[]` lists exactly those 11 | ACCURATE |
| §5/§6.1 token CSS `tokens/{fonts,colors,typography,spacing}.css` | all four files present | ACCURATE |
| §3/§6.6 adherence linter at `project/_adherence.oxlintrc.json` | present | ACCURATE (but see F-1 for what it actually enforces) |
| §6.4 REQ-F001-023: DS defines both `:root` dark and `[data-theme="light"]` using same `--theme-*` names | `tokens/colors.css` confirms both scopes + `--theme-*` names | ACCURATE |

The scalar/inventory claims are sound — several are exact, not approximate. The problems below are not in the
counts; they are in what the spec asserts the **adherence linter** and the **verbatim token CSS** will do, which
does not match the artifacts on disk.

---

## BLOCKING FINDINGS

### F-1 [CONTRADICTION → UNTESTABLE] — The adherence linter cannot enforce the CSS-completeness floor the spec builds on it (§6.6 REQ-F001-044, §6.5 REQ-F001-026, §6.6 REQ-F001-027, §6.1 REQ-F001-018)

The spec makes the adherence linter the load-bearing, testable definition of "migration complete." REQ-F001-026
states the guarantee explicitly:

> "The 'move all 723 lines of `index.css` into a `bridge.css`' loophole therefore **fails the lint** (it is dense
> with hex and `px` literals), which is what makes migration completeness testable."

REQ-F001-027's completeness test likewise leans on "the adherence linter passes over `web/src/` with zero
violations", and REQ-F001-018 says migrated `web/src/` "MUST NOT contain raw color/spacing/type literals … enforced
mechanically by the adherence linter."

The vendored config (`_adherence.oxlintrc.json`) is an **oxlint (JS/TS) config**. `plugins` = `["react","import"]`;
every rule is a JavaScript-AST selector (`Literal[value=/#[0-9a-fA-F]{3,8}\b/]`, `Literal[value=/\b\d+px\b/]`,
`JSXOpeningElement[...]`). oxlint parses JS/TS/JSX/TSX; **it does not parse `.css` files at all** and the config
loads no CSS plugin.

Consequences that directly contradict the spec text:

- A `bridge.css` (or any `.css` file) "dense with hex and `px` literals" is **not scanned** by this linter, so it
  **passes** — the exact opposite of REQ-F001-026's claim that it "fails the lint." The central anti-loophole
  guarantee is false against the adopted tool.
- The hex/`px` rules only catch literals in **JS/TS source** (e.g. inline `style={{color:'#0e0f0f'}}`), not CSS
  rules. The spec never states that residual styling must live in JS/TS (CSS-in-JS / inline) rather than `.css`
  files; if any residual styling stays in `.css`, the "zero violations" gate (REQ-F001-027) enforces nothing about
  it.

Two divergent implementations both "pass" REQ-F001-027: (A) an engineer who moves all ad-hoc styling into inline
JS/TS style objects (caught, must be tokenized) vs. (B) an engineer who moves the same ad-hoc rules into
`web/src/bridge.css` untouched (never scanned, lint green). Both claim compliance; the spec asserts B is impossible.
Because the named testable mechanism does not test the thing it claims to, the CSS-migration-completeness clause of
REQ-F001-027 is **untestable as written**. This is the strongest finding and blocks: it invalidates the spec's own
answer to "what does done mean for the ~723-line `index.css`?"

*Remedy direction (informational):* either add a CSS-aware linter/stylelint gate over `web/src/**/*.css` with the
same hex/`px`/font rules, or require residual styling to be expressed in JS/TS so oxlint's AST rules apply, and
restate REQ-F001-026/027 against whichever gate actually scans CSS.

### F-2 [CONTRADICTION / GAP] — `--success*` / `--danger*` tokens have no DS equivalent, so "adopt verbatim, screens keep the same names, all color resolves through DS tokens" cannot hold (§6.1 REQ-F001-017; interacts with §6.2 REQ-F001-020, §6.4 REQ-F001-023)

REQ-F001-017 requires the DS token CSS be adopted **"verbatim … byte-for-byte matching the vendored reference"**,
asserts "screens keep referencing the same custom-property names; only their definition source changes", and its
test requires "migrated screens resolve color/spacing/typography through the adopted DS tokens."

Disk facts:
- Current `web/src/index.css` defines and uses `--success`, `--success-bg`, `--danger`, `--danger-bg`,
  `--danger-strong` (definitions at lines 31–35 / 70–74 / 100–104; used in ~7 rules incl. lines 334, 341–343,
  351, 376–377, 424–425, 429, 596).
- The DS token CSS (`tokens/colors.css`, per `_ds_manifest.json` token list) defines **no** `--success` / `--danger`
  family. It ships `--alm-success`, `--alm-danger`, `--alm-error`, `--theme-badge-danger-text`,
  `--theme-badge-success-*`, etc. — different names.

So after the ad-hoc `--success*`/`--danger*` block is removed (REQ-F001-009/017) and the DS CSS is adopted verbatim,
every `var(--danger)` / `var(--success)` reference becomes **undefined**. The "same custom-property names" claim is
true only for the `--theme-*` family (the spec even scopes it that way in prose) but false for the `--success*` /
`--danger*` family the same requirement says it is replacing. The spec never specifies which DS token each of
`--success` / `--success-bg` / `--danger` / `--danger-bg` / `--danger-strong` maps to — that mapping is a
correctness-bearing decision left unstated (GAP), and it affects the contract-preserving migration of `DangerConfirm`
and `ErrorBanner` (REQ-F001-020), which are the specific components using those tokens.

Reinforcing the trap: REQ-F001-023's dual-theme harness only asserts that each **`--theme-*`** custom property
resolves in every theme path — it does not cover `--success*`/`--danger*`, so the orphaned tokens would slip past
that check while producing broken danger/success colors. Blocking because REQ-F001-017's own test ("resolve color
… through the adopted DS tokens", "byte-for-byte") is unsatisfiable for these values as the spec is written.

---

## MAJOR / NON-BLOCKING FINDINGS

### F-3 [GAP] — "Byte-for-byte verbatim" token adoption breaks the font asset path (§6.1 REQ-F001-017)

`tokens/fonts.css` line 6: `src: url("../assets/fonts/PlusJakartaSans.ttf") format("truetype")`. Copied
"byte-for-byte" into `web/src/`, that relative URL resolves relative to the new location and will not find the font
unless the `.ttf` is also placed at a matching `../assets/fonts/` path — which the spec does not require and
`web/src/` does not currently contain. "Byte-for-byte verbatim" (an explicit test clause) is therefore either
literally unimplementable for `fonts.css` or requires an unstated URL/asset-relocation adjustment. Specify how the
`@font-face` asset reference is handled on adoption.

### F-4 [GAP] — Linter severity is `warn`; "required gate that fails on violation" needs a run mode the spec omits (§6.6 REQ-F001-044)

Every rule in `_adherence.oxlintrc.json` is severity `"warn"`. REQ-F001-044 requires the config be run as a
"required CI gate" that "reports **zero violations**" and where a deliberately-introduced violation "**fails the
gate**." oxlint exits 0 on warnings unless rules are elevated to `"error"` or it is run with `--deny-warnings`. The
spec neither elevates severities nor specifies a `--deny-warnings` invocation, so as literally "adopted" the gate
passes even with violations. State the elevation or the deny-warnings run mode.

### F-5 [GAP] — Adopted import-restriction rule is keyed to the bundle's JS layout, not the recreated `web/src/design-system/` TS layout (§5 REQ-F001-015/045, §6.6 REQ-F001-044(v))

The `no-restricted-imports` patterns forbid `components/data-display/**`, `components/forms/**`, … and the override
exempts `**/index.js`. REQ-F001-045 recreates the components as **`.tsx` under `web/src/design-system/`** consumed via
a "barrel." A TS barrel is `index.ts`/`index.tsx`, and the recreated internals live under
`web/src/design-system/components/**` (or similar), not the bundle-relative `components/**`. The adopted rule, applied
unmodified, would not reliably match the recreated layout, so REQ-F001-044's "DS-internal import fails the gate" test
is not guaranteed to fire. Specify the import-pattern/barrel-name remapping for the `web/src/` layout.

---

## NOTES (non-blocking; for human awareness)

- **N-1** — REQ-F001-027 describes the residual as "the … token CSS import plus the **small** documented bridge
  layer," while REQ-F001-026 explicitly disclaims a size budget ("not a size budget but the adherence linter").
  "Small" is descriptive, not a gate, so no contradiction — but the adjective invites a size-based reading the spec
  elsewhere rejects.
- **N-2** — REQ-F001-030 ("no accessibility regression") and REQ-F001-033 ("bundle ≤ baseline + 10%") both depend on a
  **captured pre-migration baseline** (a11y/contrast snapshot; gzipped bundle size). Neither requires the baseline to
  be captured as an artifact before migration begins; if the pre-migration tree is gone by measurement time, "no
  regression" and "+10%" are not reconstructable. Consider requiring the baseline be recorded up front.
- **N-3** — Non-goal fencing is good: theme switcher (REQ-F001-024), sub-1024px responsive (REQ-F001-031), logo/
  wordmark (REQ-F001-007), BFF/engine changes (REQ-F001-006/029/032) are all explicitly out. No obvious
  scope-drift gap for a capable engineer to fill uninvited.
- **N-4** — Boundary behavior is clean where stated: bundle budget uses "≤ … + 10%" (inclusive); viewport range is
  "usable down to 1024px" with 1024×720 in the test set (inclusive). No unstated numeric edges found.
- **N-5** — Cross-references check out: internal §/REQ references (REQ-F001-044/046/028a, §6.3/§6.4/§6.6) resolve;
  cited parent REQs (013/021/021a/026/060/078a/097a/098/098a/098b/100) exist in `specs/admin-console.md`.

---

## Check-by-check summary

1. **Misinterpretation attack** — Two compliant-but-divergent implementations found for REQ-F001-027 (inline-style
   tokenization vs. untouched `bridge.css`) → **F-1**.
2. **One-line-test check** — All MUSTs yield a one-line test EXCEPT the CSS-completeness clause of REQ-F001-027,
   whose named mechanism doesn't test CSS → **F-1**; and REQ-F001-017's "resolve through DS tokens" is unsatisfiable
   for `--success*`/`--danger*` → **F-2**.
3. **Error-coverage sweep** — Surfaced: orphaned `--success/--danger` vars (**F-2**), broken font URL (**F-3**),
   CSS not scanned (**F-1**). Theme-path unresolved-var check omits `--success/--danger` (F-2).
4. **Example-vs-prose reconciliation** — REQ-F001-026's `bridge.css`-fails-lint example contradicts the actual
   oxlint capability → **F-1**. Linter variant/prop examples (Button/Badge/Toggle) match the config.
5. **Definition audit** — "Adherence linter" is defined as forbidding raw hex/`px`/fonts/off-contract props; the
   definition is accurate for JS/TS but silently assumes CSS coverage it does not have (**F-1**). Other terms
   (bridge entry/layer, re-sync, consume-don't-fork) are used consistently.
6. **Boundary audit** — Clean (N-4).
7. **Non-goal probe** — Clean (N-3).
8. **Cross-reference check** — Clean (N-5).

---

## VERDICT: **BLOCK (revise)**

Blocking findings: **2** (F-1 CONTRADICTION→UNTESTABLE; F-2 CONTRADICTION+GAP).
Major/non-blocking findings: **3** (F-3, F-4, F-5 GAPs).
Notes: **5**.

The spec's quantitative baseline (§4/§5 counts, component inventory, token/linter file presence, dual-theme
mechanism) is factually accurate — several claims are exact. The block is not about the counts; it is that the spec's
own load-bearing definition of "done" — the adherence linter enforcing no-ad-hoc-CSS, and the verbatim token
adoption preserving all color references — does not hold against the artifacts on disk. Fixing F-1 (make a gate that
actually scans CSS, or require styling in JS/TS) and F-2 (define the `--success/--danger` → DS-token mapping and
correct the "verbatim / same names / resolves through DS tokens" language) is necessary before the completeness and
token-migration requirements are testable.
