# F-007: Multi-language and number format internationalization support in the user interface

## Problem

The Admin Console user interface presents its text and its numeric values in English and in the default runtime locale only. Interface text is authored as hardcoded English inline in the components: a lower-bound heuristic scan found at least 48 capitalized inline JSX text nodes across 50 non-test component files, and this count excludes attribute-borne strings (placeholders, titles, aria labels) and lowercase strings, so the true volume of English-only text is larger. Numeric values are rendered without an explicit locale: the two formatting call sites in the app both call `.toLocaleString()` with no locale argument, so numbers (vector counts, and values in the baseline prompt editor) follow whatever default the runtime resolves rather than a locale a user or operator can choose. There is no mechanism in the codebase to detect a user's preferred language (no `navigator.language` / `Accept-Language` handling anywhere across 111 TS/TSX files), no message catalog or locale resource files, and no way to present the interface in any language other than English. An operator whose working language is not English reads, and enters against, an English-only console with default-locale number and date formatting they cannot influence.

This section describes the current state and the pain of it, not the remedy. No operator has reported this as a problem: the console has no ticketing/request channel, so there is no observed inbound complaint — the pain described here is inferred from the code state and the product-owner ruling below, not from a logged user report.

## Affected Users

The Admin Console is a single-tenant operator tool — a downstream fork of AnythingLLM — so the direct users are the operators/administrators running a given deployment. Today every one of them experiences the interface in English with default-locale number formatting regardless of their own language.

The population the product-owner ruling points at is **prospective**: operators and customers in non-English-speaking markets into which the product is not yet sold. There is no current operator on record requesting localization, and no ticket system exists to have captured such a request, so the size of the affected population is a forward-looking market estimate rather than a count of observed affected users. The brief encodes this honestly: the demand is prospective-market, not observed. The customer-facing web app is in the same English-only state, but per the product-owner ruling of 2026-07-19 its localization is a separate feature row in its own pipeline — this row's affected surface is the operator console only.

## Business Rationale

Per the product-owner ruling of 2026-07-19, the driver for F-007 is **market expansion**: the ability to sell and deploy the product into non-English-speaking customer and operator markets. The falsifiable claim is that the current English-only, default-locale-only interface is a barrier to entering those markets — i.e., that prospective deployments in those markets require the console to present in the local language and local number/date formats. This claim is testable against go-to-market evidence (target-market deals, RFP language requirements, partner/reseller requirements in target regions) that the research role can seek out; it is not established by any inbound customer demand today, because none has been observed. Upstream (the parent product, not this fork) shows repeated non-English UI demand in its issue tracker, which is a lead for whether comparable demand exists in this product's target markets.

## Timing

The product owner has explicitly **tied F-007 to go-to-market**: its timing is governed by the schedule for selling into the non-English-speaking markets it is meant to unlock. There is no fixed calendar deadline supplied with this brief. The time pressure, to the extent it exists, is the market-entry timeline rather than a regulatory or contractual date. The research role should seek the actual go-to-market dates for the target markets to size this dimension; this brief does not assert a window it was not given.

## Existing Evidence

All entries below are leads to be re-verified by the research role, not established fact. Entries from the 2026-07-19 discovery pass are tagged accordingly; they are that agent's own prior output and must be re-checked, not inherited.

- `[agent-discovery 2026-07-19]` No i18n libraries present in this repo: `web/package.json` and lockfile carry zero i18n dependencies (no i18next, react-intl, formatjs, or lingui); runtime deps are only react, react-dom, and @phosphor-icons/react.
- `[agent-discovery 2026-07-19]` Two default-locale numeric formatting call sites, both with no explicit locale argument: `vectorCount.toLocaleString()` at `web/src/features/diagnostics/DiagnosticsPage.tsx:49` and `d.toLocaleString()` at `web/src/features/baseline-prompt/BaselineEditor.tsx:110`. Zero explicit-locale `Intl` usage and zero `navigator.language` / `Accept-Language` handling across 111 TS/TSX files.
- `[agent-discovery 2026-07-19]` Hardcoded English UI text: at least 48 capitalized inline JSX text nodes across 50 non-test `.tsx` files (lower bound; grep heuristic `>[A-Z][A-Za-z][^<>{}]{2,}<`, which does not count attribute-borne or lowercase strings). No locale / i18n / `.po` files anywhere in the tree.
- `[agent-discovery 2026-07-19]` Sibling repo `/home/derek/git/customer-web-app` is in the same state: 0 i18n deps, 1 default-locale call site, at least 139 inline JSX strings, 0 locale files. (Relevant to the scope open question below.)
- `[agent-discovery 2026-07-19]` Upstream `Mintplex-Labs/anything-llm` frontend ships `frontend/src/locales` with 26 language folders (ar … zh_TW), 3 translation-management scripts, and a `resources.js`; this fork carries none of them. https://github.com/Mintplex-Labs/anything-llm/tree/master/frontend/src/locales
- `[agent-discovery 2026-07-19]` Upstream demand signals (upstream product, not this fork): issue #1371 (non-English UI request, ~2024-05), #3108 (Turkish translation contribution offer, ~2025-02), #4340 (embed "de" locale handling bug). These are upstream-project signals; their applicability to this fork's target markets is unverified.
- `[agent-discovery 2026-07-19]` Repo backlog: no existing F-007 brief or spec; zero i18n mentions in docs, README, or CHANGELOG.

No inbound operator/customer request for localization exists to cite — the console has no ticketing channel that could have captured one.

## Proposed Direction

This paragraph is non-binding and exists only to orient later work; it must not shape the Problem or Affected Users framing above. One plausible direction is to introduce a standard React i18n layer (message catalogs plus locale-aware number/date formatting via explicit `Intl` locale arguments), externalize the hardcoded English strings into a default-locale catalog, and add locale detection/selection. The upstream `frontend/src/locales` infrastructure (26-locale catalog, translation-management scripts, `resources.js`) is a possible pattern to borrow for structure — though its catalog covers the engine frontend's strings, not this console's, so it would be a pattern reference rather than a drop-in translation source. Target languages, RTL handling, and translation sourcing are deliberately left open below rather than fixed here.

## Design Considerations

Reads from the ux-designer agent (2026-07-19); informs the human's later Effort and
Risk scores, does not set them.

- **complexity_read:** Net-new *visible* surface is small: essentially one control — a
  locale picker — plus an invisible detection step. No new screen or journey. The app
  shell is a hardcoded in-app view switch (`App.tsx`, no router), and this direction
  doesn't add a view; the picker most naturally composes the existing DS `Select` and
  drops into an existing region (sidebar footer near "Sign out", or the
  Security/Settings surface). The dominant effort is *mechanical externalization*, not
  interaction design: strings live inline across the shell and features (`App.tsx` NAV
  labels + `PAGE_META` titles/descriptions; per-feature headings, buttons,
  placeholders) — closer to fill-in-the-blanks string extraction than design-on-the-fly:
  low novelty, high count/breadth. Design-system fit is clean for the visible part (DS
  is a barrel-only, CSS-module, token-driven set of 11 components; `Select` already
  gives labeled, accessible picker behavior); the i18n provider/context and catalog
  format are architectural plumbing, not a DS extension. Two wrinkles enlarge the
  design surface beyond "swap strings": (1) interpolation/pluralization for strings
  that embed data (e.g. `DangerConfirm` consequence text naming a target;
  diagnostics/baseline strings carrying counts/dates) need a message-with-placeholders
  convention, not flat constants; (2) a real boundary exists between client-owned
  chrome (translatable) and server-owned text — `ErrorBanner` renders the BFF
  `{ message }` verbatim by contract (REQ-097a), so server error strings are
  pass-through and out of the catalog; where that boundary sits is a genuine design
  decision. Number/date formatting is a tiny footprint (exactly two `toLocaleString()`
  sites). As scoped (default-locale catalog + selection scaffolding) there is no RTL
  layout work; if RTL ever enters scope it becomes a genuinely novel layout concern
  (directional CSS, mirrored sidebar) rather than more of the same.
- **ux_risk_read:** Accessibility exposure as scoped is modest but non-zero: the
  selected locale should drive the `<html lang>` attribute (screen-reader
  pronunciation) — worth stating as a design requirement so it isn't missed; the picker
  itself inherits DS `Select`'s labeled-control a11y. The larger a11y/layout exposure
  (bidi, focus order in mirrored layouts) only materializes if RTL later enters
  scope — deferred, not present. Reversibility of the user-facing interaction is high
  (a locale picker with a persisted preference is non-destructive and instantly
  switchable); the sticky, hard-to-reverse decision is the *architectural* one (i18n
  library, catalog format, key conventions), which sits with the architect read, not
  the interaction. Usability-testing needs are limited while demand is prospective and
  only default-locale English ships: the pragmatic pre-checks are pseudo-localization
  (string expansion / layout overflow) rather than user studies, plus a lightweight
  check on picker placement/discoverability. A coherence risk to watch: translated
  client chrome wrapped around untranslated verbatim server error text (REQ-097a) can
  read as a mixed-language UI once a non-English locale is active — a usability seam
  worth naming even though the spec constraint is fixed.

## Out of Scope

- Localization of engine-side / user-generated content — LLM outputs, workspace names, and other runtime content — is presumed out of scope for F-007; this feature concerns the console's own UI chrome, not content flowing through the product.
- Reusing upstream's translation *content* as an authoritative source is not assumed in scope: upstream's catalog targets the engine frontend's strings, not this console's, so it is at most a structural pattern (see Proposed Direction).
- customer-web-app localization — **resolved by product-owner ruling 2026-07-19**: the customer app gets its own feature row (tracked in its own pipeline). F-007 is scoped to the admin-console UI only. The sibling-repo evidence above remains as context, not scope.

## Open Questions

- **Target languages/locales first.** Which languages and locales should the initial delivery cover, driven by which target markets?
- **Translation sourcing and ongoing maintenance.** Where do translations come from (professional, community, upstream-derived), and who owns keeping them current after launch?
- **RTL support.** Is right-to-left layout (upstream ships ar/he) in scope, given the target markets chosen?
- **Number/date formatting vs. full translation scope.** Does F-007 cover locale-aware number/date formatting only, full UI-string translation, or both — and is there a phased boundary between them?
- **Engine-side content.** Confirm that localizing engine-side / user-generated content (LLM outputs, workspace names) is out of scope, as presumed above.
