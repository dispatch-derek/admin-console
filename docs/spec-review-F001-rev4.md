# Adversarial Spec Re-Review — F-001 "Adhere to a Design System" (rev 4)

- **Spec under review:** `specs/F-001-adhere-to-design-system.md` (Draft rev 4)
- **Prior review resolved:** `docs/spec-review-F001-rev3.md` (BLOCK; F-1, F-2 blocking; F-3, F-4, F-5 major; N-1..N-5 notes)
- **Review mode:** round-1 re-review (delta focus). Verifies (a) each rev-3 finding is genuinely
  resolved on disk, (b) the changed requirements survive a fresh adversarial pass, (c) no
  previously-clean requirement regressed and the rev-3 §9 rulings (OQ-3..OQ-8) survive intact.
- **Ground truth consulted (not under review):** `web/vendor/design-system/project/tokens/colors.css`,
  `tokens/fonts.css`, `assets/fonts/`, `_adherence.oxlintrc.json`, `_ds_manifest.json`,
  `web/src/index.css`.
- **Checks executed:** 8/8.

---

## Baseline factual verification (rev-4 remedy claims vs. disk)

Every remedy the author claimed was checked against the working tree. Results:

| Claim (rev 4) | Disk reality | Verdict |
|---|---|---|
| F-2 target `--theme-badge-success-text` = `#4ade80` (dark) / `#047857` (light) | `colors.css` L74 `#4ade80`, L113 `#047857` | ACCURATE (exact) |
| F-2 target `--theme-badge-success-bg` = `rgba(22,163,74,.2)` / `rgba(5,150,105,.12)` | `colors.css` L73, L112 | ACCURATE (exact) |
| F-2 target `--theme-badge-danger-text` = `#f87171` / `#b91c1c` | `colors.css` L78, L117 | ACCURATE (exact) |
| F-2 target `--theme-badge-danger-bg` = `rgba(220,38,38,.2)` / `rgba(220,38,38,.12)` | `colors.css` L77, L116 | ACCURATE (exact) |
| F-2 fallback `--alm-error` = `#b42318` | `colors.css` L30 (`:root` only; not re-declared in light) | EXISTS (dark-scoped; cascades to light) |
| F-2 source values `--success/-bg`, `--danger/-bg`, `--danger-strong` (dark/light) | `index.css` L31-35 / L70-74 / L100-104 all match cited hex/rgba | ACCURATE (exact) |
| F-2 usage sites: `--danger` @334,342-343,424-425; `--danger-bg` @341,429; `--success` @351,596; `--success-bg` @376 | `rg` over `index.css` confirms each line | ACCURATE (exact) |
| F-2 `--danger-strong` "defined but unused" | no `var(--danger-strong)` anywhere in `index.css` | ACCURATE |
| F-3 font asset present for co-vendoring | `web/vendor/design-system/project/assets/fonts/PlusJakartaSans.ttf` exists | ACCURATE |
| F-3 `fonts.css` L6 relative `url("../assets/fonts/PlusJakartaSans.ttf")` | `fonts.css` L6 confirmed verbatim | ACCURATE |
| F-4 all vendored oxlint rules severity `warn` | `_adherence.oxlintrc.json` — every rule `"warn"` | ACCURATE (the fix's premise holds) |
| F-5 vendored `no-restricted-imports` keys `components/{data-display,forms,navigation,overlays}/**`, `ui_kits/admin-console/**`, exempts `**/index.js` | `_adherence.oxlintrc.json` L13-29,122-131 confirmed | ACCURATE |
| DS manifest lists `--theme-badge-*` + `--alm-error` as real tokens; `[data-theme="light"]` scope; `viewport:"1280x720"` | `_ds_manifest.json` confirms all three | ACCURATE |

**Every quantitative remedy claim is accurate — several exact.** The F-2 mapping in particular maps
each orphaned property onto a DS token that genuinely exists with the cited dark/light values; a
mapping onto a non-existent token (the specific new-defect risk called out for this re-review) is
**not** present.

---

## Resolution of rev-3 findings

### F-1 [was CONTRADICTION→UNTESTABLE] — CSS-completeness gate — **RESOLVED**
Rev 4 introduces a genuine two-gate model. `REQ-F001-047` adds a CSS-aware gate over
`web/src/**/*.css` with concrete, testable content: it scans `web/src/**/*.css`; forbids (i) raw hex
in property values, (ii) raw `px` in property values, (iii) non-`Plus Jakarta Sans` `font-family`;
exempts the adopted token-definition CSS; and **MUST fail CI (non-zero exit) on any violation**.
`REQ-F001-044` now explicitly states oxlint "parses JS/TS/JSX/TSX only and does not scan `.css`" and
delegates CSS residue to `REQ-F001-047`. `REQ-F001-018/026/027` are rewritten to rest the CSS
guarantee on the gate that actually scans CSS. **No requirement still relies on the JS-only oxlint
config to bound CSS.** The headline anti-loophole example (`bridge.css` dense with hex/`px` fails the
CSS gate) now holds against a tool that actually reads the file. *Residual precision issue in the
exemption scope is raised as NEW-1 below — non-blocking.*

### F-2 [was CONTRADICTION+GAP] — orphaned `--success*`/`--danger*` mapping — **RESOLVED**
`REQ-F001-048` supplies a concrete mapping table, every target verified to exist on disk with exact
dark/light values (table above). `REQ-F001-017` carve-out B scopes the "verbatim / same names /
resolves through DS tokens" claim to the `--theme-*` family only and explicitly excludes
`--success*`/`--danger*`, re-pointing every consumer per `REQ-F001-048`. `REQ-F001-020`
(DangerConfirm/ErrorBanner) cites the mapping. `REQ-F001-023`'s unresolved-var harness is extended to
assert the mapped tokens resolve **and** that zero `var(--success…)`/`var(--danger…)` survive. The
former unsatisfiable test is now satisfiable and testable.

### F-3 [was GAP] — `@font-face` asset path on verbatim copy — **RESOLVED**
`REQ-F001-017` carve-out A requires the `.ttf` be co-vendored so the relative `url()` resolves,
permits at most one `url()`-string edit if the build layout can't honor the relative path, and gives
a concrete test (adopted `fonts.css` differs in at most that one string; face loads at runtime). The
asset exists in the bundle for co-vendoring.

### F-4 [was GAP] — linter severity `warn` → non-gating — **RESOLVED**
`REQ-F001-044` mandates a `--deny-warnings` run mode (or an error-severity adopted-config copy),
without hand-editing the vendored file (preserving consume-don't-fork), with the concrete requirement
"a single lint violation yields a non-zero CI exit." The fix's premise (all vendored rules are
`warn`) is confirmed on disk.

### F-5 [was GAP] — import-restriction patterns keyed to bundle layout — **RESOLVED**
`REQ-F001-044(v)` remaps `no-restricted-imports` to forbid deep imports into the recreated internals
(`web/src/design-system/components/**`) while exempting the TS barrel
(`web/src/design-system/index.ts`/`index.tsx`), and scopes this as the one rule whose patterns must
be adjusted. Testable ("a deep import of a recreated DS internal fails the gate").

### N-1 (modest ≠ budget) / N-2 (pre-migration baseline) — **ADDRESSED**
`REQ-F001-026/027` now state explicitly that "modest/small" is a descriptive expectation and the
gates (not a line count) are the bound. `REQ-F001-049` requires a dated pre-migration baseline
(gzipped bundle + a11y/contrast snapshot) captured and committed **before the first migration
commit**, cited by `REQ-F001-030/033`.

### rev-3 §9 rulings (OQ-3..OQ-8) — **SURVIVE INTACT**
`REQ-F001-038` (OQ-3 on-demand re-sync), `-039` (OQ-6 WCAG 2.1 AA non-gating), `-040` (OQ-7 hard GTM
gate), `-041` (OQ-8 phased acceptable), `-042` (OQ-4 internal-only), `-043` (OQ-5 <25) are all present
verbatim with their 2026-07-07 rulings. Rev 4 adds OQ-9 (`REQ-F001-050`) and OQ-10 (`REQ-F001-051`)
as OPEN with recommended defaults; no id is renumbered or reused.

---

## BLOCKING FINDINGS

**None.** All five rev-3 blocking/major findings are resolved on disk; no new blocking-class defect
was introduced by the changes.

---

## NEW MAJOR / NON-BLOCKING FINDINGS (introduced by the rev-4 changes)

### NEW-1 [AMBIGUOUS/GAP, non-blocking] — REQ-F001-047's exemption is under-specified in two ways that a stylelint implementer could resolve divergently
`REQ-F001-047` says the CSS gate "**exempts exactly one file scope: the single adopted DS
token-definition CSS** (the `:root`/`[data-theme]` custom-property blocks and the adopted
`@font-face`)." Two independent under-specifications:

1. **File count vs. `REQ-F001-017`.** `REQ-F001-017` adopts **four** token files verbatim —
   `tokens/{fonts,colors,typography,spacing}.css`. On disk `colors.css` is entirely raw-hex custom
   properties, `spacing.css`/`typography.css` are raw-`px` custom properties. If the implementer keeps
   the four files (the literal reading of "adopt verbatim"), the phrase "exactly one file scope /
   **the single** … CSS" exempts only one of them and the other three would trip the gate on their
   own legitimate token definitions. *Reading A:* "one file scope" = one glob covering all four
   adopted token files → gate green. *Reading B:* one physical file exempt → three token files fail,
   or the implementer must merge the four into one file (an unstated step). Both readings are
   defensible from the text.
2. **Path-scoped vs. declaration-scoped exemption.** A natural stylelint config expresses the
   exemption as "ignore hex/`px` inside custom-property (`--*`) declarations," which is
   *content-scoped* and would exempt custom-property definitions **in any file** — reopening a
   laundering path (`:root{--x:#fff} .foo{color:var(--x)}` in `bridge.css` passes). A *path-scoped*
   config (`ignoreFiles` = the adopted token CSS) closes it. The spec's "exactly one file scope"
   favors path-scoping, but the parenthetical describes the exemption by content ("the `:root` /
   `[data-theme]` custom-property blocks"), so both configs can claim compliance.

Non-blocking because: intent is recoverable; the headline anti-loophole guarantee
(`REQ-F001-026`'s "dense with hex/`px` regular-property rules fails") holds under **both** readings;
`REQ-F001-014`'s independent static-review test ("no per-screen redefinition of a token") bites the
laundering path; and **OQ-9 (`REQ-F001-050`) is already flagged OPEN for a human ruling that freezes
the gate**. *Recommendation:* fold into the OQ-9 ruling — state the exemption as a **file/path glob
covering all adopted token CSS files** (not a declaration-type exemption), and reconcile "one file
scope" with the four-file adoption of `REQ-F001-017` (e.g., name the exempt glob).

### NEW-2 [AMBIGUOUS/stale-cross-ref, non-blocking] — the F-1 two-gate rewrite did not reach REQ-F001-014/016/019, whose completeness/coverage tests still cite only the JS/TS gate
Rev 4 updated `REQ-F001-018/026/027/044` to cite **both** gates and added `REQ-F001-047`, but three
sibling completeness/coverage tests still read "**the adherence linter (REQ-F001-044) passes**"
(JS/TS-only) with no companion citation of the CSS gate:
- `REQ-F001-014` (single source of truth) — "…and the adherence linter (REQ-F001-044) passes."
- `REQ-F001-016` (coverage-scoped adoption) — "the adherence linter (REQ-F001-044) passes over the
  migrated scope."
- `REQ-F001-019` (component migration) — "the adherence linter (REQ-F001-044) passes…"

This collides with §3's blanket instruction ("where this spec previously said 'the adherence linter,'
read 'the adherence gates' (both)"): the §3 rule says *both*, the inline `(REQ-F001-044)` pins *JS/TS
only*. A reader can reasonably take either, so for a CSS-side violation (e.g. a raw-hex token
redefinition in a screen's `.css`, which is exactly what `REQ-F001-014` forbids) the cited gate would
not catch it while `REQ-F001-047` would. Non-blocking because each of these three requirements carries
an **independent primary test** that still bites (014: "a static review finds no per-screen
redefinition"; 016: "the migration record cites the DS component that serves it"; 019: "count of
unaccounted-for ad-hoc classes is zero"), and `REQ-F001-045`'s `(REQ-F001-044)` citation is in fact
*correct* (prop/variant rules are genuinely JS/TS-only). *Recommendation:* update the inline citations
in `REQ-F001-014/016/019` to "REQ-F001-044 and REQ-F001-047."

---

## NOTES (non-blocking; for human awareness)

- **N-A** — `--alm-error` (the `--danger-strong` fallback in `REQ-F001-048`) is declared only in
  `:root` (dark) and is not re-declared under `[data-theme="light"]`; it therefore resolves to
  `#b42318` in **both** themes (cascade). This is harmless (it resolves to a defined value, satisfying
  the `REQ-F001-023` harness) and `--danger-strong` is dead anyway, but note the fallback is a single
  un-themed value rather than a dark/light pair — consistent with how the mapping table presents it.
- **N-B** — `--danger` currently serves as both a foreground color and a 1px border color
  (`index.css` L343, L425); `REQ-F001-048` maps it to `--theme-badge-danger-text` (a text tone). This
  is a disclosed, correctness-bearing color shift (the spec flags it under OQ-10, and OQ-10 even
  offers the stronger `--alm-danger` `#f04438` as a designer alternative). No defect — surfaced for the
  human ruling.
- **N-C** — `REQ-F001-011`/`-020` cite parent `REQ-078c` for `DangerConfirm`; this is unchanged from
  prior revisions and outside the rev-4 delta scope, so it was not re-verified against
  `specs/admin-console.md` in this pass (rev-3 blessed the parent cross-refs).

---

## Check-by-check summary (delta focus)

1. **Misinterpretation attack** — Divergent-implementation pairs found only in the new/adjacent
   material: the CSS-gate exemption (file-count and path-vs-content) → **NEW-1**; the §3-vs-inline
   citation for completeness tests → **NEW-2**. The rev-3 pair (inline-tokenize vs. untouched
   `bridge.css`) is now closed — both branches fail a gate (JS/TS via 044, CSS via 047).
2. **One-line-test check** — Every changed MUST yields a one-line test. New gates: "given a raw hex in
   a non-token `web/src/*.css`, assert the CSS gate exits non-zero" (047); "given a lint violation,
   assert oxlint exits non-zero under `--deny-warnings`" (044/F-4); "given a `var(--danger)` surviving
   in `web/src/`, assert the static scan fails" (048/023). No new untestable guarantee introduced.
3. **Error-coverage sweep** — Orphaned tokens (F-2) now covered by 048 + the extended 023 harness;
   CSS residue (F-1) now covered by 047; broken font URL (F-3) covered by carve-out A; gate exit mode
   (F-4) and import layout (F-5) covered. Residual: exemption-scope precision (NEW-1).
4. **Example-vs-prose reconciliation** — `REQ-F001-026`'s `bridge.css`-fails-lint example now traces
   to a tool (stylelint/047) that actually scans `.css` — the rev-3 contradiction is gone. The F-2
   mapping-table values trace exactly to `colors.css` (verified line-by-line). No divergence.
5. **Definition audit** — "Adherence gates (two-gate adoption floor)" is defined in §3 and used
   consistently in the rewritten reqs; the stale singular "the adherence linter (REQ-F001-044)" in
   014/016/019 is the one inconsistency (**NEW-2**).
6. **Boundary audit** — Clean. New numeric edges (bundle "≤ baseline + 10%", viewport "down to 1024px
   … up to at least 1920px") unchanged and inclusive as before.
7. **Non-goal probe** — Clean; no new scope-drift surface introduced by the fixes.
8. **Cross-reference check** — New ids `REQ-F001-047/048/049/050/051` are unique, non-colliding, and
   their internal references (017/009/023/026/030/033/044/051/020) all resolve. §9 header correctly
   reads "OQ-1…OQ-8 RESOLVED; OQ-9, OQ-10 OPEN." Stale-content (not broken-target) citation flagged as
   NEW-2.

---

## VERDICT: **ACCEPT (PASS WITH NOTES)**

- rev-3 blocking findings **F-1, F-2 — CONFIRMED RESOLVED** (verified on disk; no mapping onto a
  non-existent token; no requirement still relies on oxlint to scan CSS).
- rev-3 major findings **F-3, F-4, F-5 — CONFIRMED RESOLVED**.
- rev-3 notes **N-1, N-2 — ADDRESSED**; **OQ-3..OQ-8 rulings survive intact**; no previously-clean
  requirement regressed.
- **New findings:** 2, both **non-blocking** — NEW-1 (CSS-gate exemption scope under-specified; fold
  into OQ-9) and NEW-2 (three completeness/coverage tests still cite only the JS/TS gate; update to
  cite both). 3 notes (N-A, N-B, N-C).

**Blocking findings: 0.  Major/non-blocking: 2.  Notes: 3.**

The two blocking defects that made the load-bearing "done" definition (CSS-migration completeness) and
the token-migration test unsatisfiable are genuinely fixed against the artifacts on disk. The two new
findings are precision gaps in the *new* gate wiring, not correctness holes: intent is recoverable,
each affected requirement retains an independent test that still bites, and the CSS-gate design is
already parked as OPEN question OQ-9 for the human ruling — which is the right place to pin NEW-1. This
does not warrant a second BLOCK/revise cycle; recommend the spec-writer fold NEW-1 into the OQ-9
ruling and apply the NEW-2 one-line citation fix, then proceed.
