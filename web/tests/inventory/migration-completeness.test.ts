// SPEC F-001 §4/§6.2/§6.6 — REQ-F001-009 (ad-hoc index.css baseline; 143/22 baseline is a STATIC,
// DATED historical record — see REDESIGN NOTE below), REQ-F001-010 (className disposition/accounting
// gate: every className site resolves to a DS component/token usage, a documented bridge entry, or a
// removal — none unaccounted), REQ-F001-019 (every className site resolves to a DS component/token
// usage or the raw-editor bridge; both adherence gates pass), REQ-F001-027 (no residual ad-hoc
// styling after migration), and REQ-F001-002/008/012 (View union / NAV / screen inventory preserved).
//
// This is a repo-root test harness (not colocated under web/src) because it audits the WHOLE
// `web/src/` migration surface rather than one module — the QA brief explicitly allows "any
// repo-root harness the gates need." It runs under vitest via the default include glob (no include
// override in vite.config.ts), i.e. `npm test` from `web/` picks it up like any other suite.
//
// REDESIGN NOTE (human ruling 2, 2026-07-09 Phase 4 follow-up): the original version of this file
// asserted `className` count `=== 143` across `=== 22` files against LIVE disk. That over-constrains
// the spec: REQ-F001-019/-016 REQUIRE componentization (one-off `className`s replaced by DS component
// usage), which necessarily SHRINKS the live count — a live count-lock forbids the very migration the
// spec mandates, and froze the pre-migration baseline as if it were a target. Per the ruling:
//   1. The 143/22 figure is preserved as REQ-F001-009's BASELINE OF RECORD in a static, dated doc —
//      `docs/design/F-001/baseline-classname-inventory-2026-07-07.md` — asserted against THAT DOC's
//      own content, never against shrinking live disk state (first describe block below).
//   2. REQ-F001-010's actual *Test* clause — "a static inventory enumerates every className site;
//      each maps to a governing-system component or token usage, an isolated bridge (REQ-F001-026),
//      or a removal — none is left as an unaccounted-for ad-hoc class" — is enforced as a
//      disposition/accounting gate over the CURRENT tree (second describe block below): every literal
//      className token actually used in a screen/shared-component source file must resolve to a CSS
//      class that is (a) DEFINED somewhere in the non-token-exempt `web/src/**/*.css` tree, AND
//      (b) every rule, tree-wide, that defines that class is gate-clean (no raw hex/px in its
//      declaration body) — i.e. genuinely DS-token-referencing composition, not an ad-hoc rule
//      wearing a new class name (which is exactly how the pre-migration `index.css` rules, still
//      raw-hex/px, are correctly rejected today). This is deliberately COUNT-INDEPENDENT: DS-component
//      substitution that removes className sites, or that re-expresses them as token-referencing
//      composition classes, both pass; a brand-new ad-hoc class the original 2026-07-07 inventory
//      never saw still fails, because it is undefined or unclean — not because it matches a fixed
//      blacklist. This must go green precisely when migration is genuinely complete, independent of
//      whether the raw count shrank.
//
// Mechanical-check limitation (documented per QA brief; see also tests/TEST_PLAN.md): the accounting
// gate is a static, textual CSS-rule scan, not a real CSS parser/cascade resolver — it does not
// resolve specificity, `@supports`, preprocessor features, or class-name strings assembled from more
// than one template-literal expression at a usage site. It also does not re-check font-family per
// class (that dimension is covered gate-wide, over ALL non-exempt CSS, by REQ-F001-047's own
// execution test in `web/tests/gates/adherence-gates.test.ts`). These residual gaps remain
// review-artifact territory, flagged in TEST_PLAN.md rather than silently assumed away.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname, join, relative, basename } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
import { collectFiles, readText, fileExists } from '../../src/test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..'); // web/tests/inventory -> web/
const REPO_ROOT = join(WEB_ROOT, '..');
const SRC_DIR = join(WEB_ROOT, 'src');
const INDEX_CSS = join(SRC_DIR, 'index.css');
const MAIN_TSX = join(SRC_DIR, 'main.tsx');
const APP_TSX = join(SRC_DIR, 'App.tsx');
const BASELINE_DOC = join(
  REPO_ROOT,
  'docs',
  'design',
  'F-001',
  'baseline-classname-inventory-2026-07-07.md',
);

// ---------------------------------------------------------------------------------------------
// Historical enumeration (REQ-F001-009), as inspected 2026-07-07: the ~40 bespoke element/utility
// selectors the pre-migration index.css defines. Retained ONLY to (a) document the baseline doc's
// expected content and (b) check, in the "index.css reduced" block further down, that index.css no
// longer DEFINES these selectors post-migration. It is NOT used as a live className-usage blacklist
// — REQ-F001-010/019's live accounting gate (second describe block) supersedes that approach (see
// REDESIGN NOTE above).
// ---------------------------------------------------------------------------------------------
const LEGACY_ADHOC_CLASSES = [
  'app', 'app-loading', 'app-sidebar', 'app-brand', 'app-user', 'app-main',
  'sidebar-nav', 'sidebar-section', 'sidebar-section-label', 'sidebar-item', 'sidebar-footer',
  'page-header', 'page-description', 'page-body', 'page-loading',
  'field', 'field-error',
  'error-banner', 'success', 'warning', 'readonly-note', 'hint',
  'badge', 'badge-set', 'badge-notset', 'badge-active',
  'modal-overlay', 'modal', 'modal-actions', 'danger-target', 'danger-button',
  'entity-table', 'entity-list', 'member-list', 'document-list', 'checkbox-list',
  'recovery-codes', 'masked-diff', 'chat-list', 'link-button',
  'workspaces-view', 'list-column', 'list-header', 'detail-column',
  'create-workspace', 'workspace-settings',
  'settings-category', 'category-title', 'provider-groups', 'provider-group',
  'provider-group-header', 'provider-group-caret', 'provider-group-name', 'provider-group-body',
  'control-row', 'verify-ok', 'verify-pending', 'settings-actions',
  'auth-screen', 'auth-panel', 'mfa-qr', 'mfa-secret', 'mfa-uri',
  'user-list', 'invite-list', 'membership-panel', 'chat-oversight', 'knowledge-panel',
  'diagnostics-page', 'raw-editor', 'multi-user-disabled',
  'create-user', 'create-invite', 'add-member', 'doc-title', 'pin-on', 'pin-off', 'pager',
  'raw-actions', 'ollama-fallback', 'advanced-gate', 'primary-button',
];

// Pinned App shell inventory (REQ-F001-002/008/012): the `View` union ids and NAV item ids as of
// this baseline. Migration MUST NOT remove any of these (cosmetic label/grouping changes only).
const PINNED_VIEW_IDS = [
  'llm', 'vectorDb', 'embedding', 'tts', 'stt',
  'workspaces', 'users', 'invites', 'membership', 'oversight',
  'agentSkills', 'raw', 'diagnostics', 'security',
];

function screenSourceFiles(): string[] {
  // Everything under web/src EXCLUDING the recreated DS layer and the bridge layer (both of which
  // are new production code the migration is ALLOWED to add ad-hoc-looking class tokens inside, as
  // long as they pass the adherence gates — REQ-F001-018/026) and excluding test files.
  return collectFiles(SRC_DIR, { extensions: ['.tsx', '.ts'] }).filter(
    (f) => !f.includes(`${join('src', 'design-system')}`) && !f.includes(`${join('src', 'bridge')}`),
  );
}

/** Extract every literal class-name TOKEN appearing inside a `className=` attribute value. */
function extractClassNameTokens(source: string): string[] {
  const tokens: string[] = [];
  const attrRe = /className=(\{[^]*?\}|"[^"]*"|'[^']*')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(source))) {
    const raw = m[1];
    // Pull every quoted string segment out of the attribute value (handles ternaries, template
    // literals, and plain string literals alike) and split each on whitespace.
    const stringRe = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;
    let sm: RegExpExecArray | null;
    while ((sm = stringRe.exec(raw))) {
      const literal = sm[1] ?? sm[2] ?? sm[3] ?? '';
      for (const part of literal.split(/[\s`$]+/)) {
        const cleaned = part.replace(/[{}]/g, '').trim();
        if (cleaned) tokens.push(cleaned);
      }
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// className disposition/accounting gate machinery (REQ-F001-010/019/027).
// ---------------------------------------------------------------------------------------------

// The five path-scoped DS-token-definition files REQ-F001-047 exempts from the CSS adherence gate
// (four adopted DS token files + the one bridge light-source token file, REQ-F001-052). These files
// legitimately hold raw hex/px as TOKEN DEFINITIONS, not layout classes, so they are excluded from
// the "is this class gate-clean" scan below — mirrored intentionally from
// `web/tests/gates/adherence-gates.test.ts` rather than imported, so the two suites stay independent.
const EXEMPT_TOKEN_CSS_BASENAMES = ['colors.css', 'spacing.css', 'typography.css', 'fonts.css', 'light-source.css'];

const RAW_HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RAW_PX_RE = /(?<![\w-])\d+(?:\.\d+)?px\b/;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Extract every `selector { body }` rule pair in a CSS file, including rules nested inside an
 * at-rule (e.g. `@media (...) { :root { ... } }`), by repeatedly popping innermost brace-pairs. The
 * at-rule's own wrapper "selector" (e.g. `@media (prefers-color-scheme: light)`) is never recorded as
 * a rule itself (selectors starting with `@` are skipped) but its nested content is captured on the
 * pass that finds it as the innermost block. This is a deliberately minimal textual scan, not a real
 * CSS parser (see the mechanical-check limitation note in the file header).
 */
function extractAllRules(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  let working = stripCssComments(css);
  const blockRe = /([^{}]*)\{([^{}]*)\}/g;
  let guard = 0;
  while (/[{}]/.test(working) && guard < 500) {
    guard++;
    let sawMatch = false;
    working = working.replace(blockRe, (_m: string, selector: string, body: string) => {
      sawMatch = true;
      const trimmed = selector.trim();
      if (trimmed && !trimmed.startsWith('@')) {
        rules.push({ selector: trimmed, body });
      }
      return ' ';
    });
    if (!sawMatch) break;
  }
  return rules;
}

/** Every distinct `.class-name` token appearing in a (possibly compound/comma-separated) selector. */
function classTokensInSelector(selector: string): string[] {
  const out: string[] = [];
  const re = /\.([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector))) out.push(m[1]);
  return out;
}

/**
 * Build a registry of every class name DEFINED anywhere in the non-token-exempt `web/src` CSS tree
 * (including the design-system and bridge layers' own CSS/module files — a screen composing a
 * local class alongside a DS/bridge one is legitimate), mapped to whether EVERY rule defining it,
 * tree-wide, is gate-clean (no raw hex / raw px in its declaration body). A class defined only by an
 * ad-hoc rule (e.g. the pre-migration `index.css`, which is NOT exempt and still has raw hex/px today)
 * is correctly registered as `false` (unclean) — this is what makes the gate reject the pre-migration
 * state and is exactly why the gate is expected to go green only once migration genuinely completes.
 */
function buildCssClassRegistry(): Map<string, boolean> {
  const registry = new Map<string, boolean>();
  const cssFiles = collectFiles(SRC_DIR, { extensions: ['.css'] }).filter(
    (f) => !EXEMPT_TOKEN_CSS_BASENAMES.includes(basename(f)),
  );
  for (const file of cssFiles) {
    const rules = extractAllRules(readText(file));
    for (const { selector, body } of rules) {
      const clean = !RAW_HEX_RE.test(body) && !RAW_PX_RE.test(body);
      for (const cls of classTokensInSelector(selector)) {
        const prior = registry.get(cls);
        registry.set(cls, prior === undefined ? clean : prior && clean);
      }
    }
  }
  return registry;
}

describe('REQ-F001-009 — 143/22 baseline of record (static, dated; NOT re-asserted against live disk)', () => {
  it('a dated baseline doc records the pre-migration className/file counts as historical fact', () => {
    expect(
      fileExists(BASELINE_DOC),
      `expected ${relative(REPO_ROOT, BASELINE_DOC)} to exist (REQ-F001-009 baseline of record)`,
    ).toBe(true);
    const text = readText(BASELINE_DOC);
    expect(text, 'must record the pinned pre-migration className count').toMatch(/\b143\b/);
    expect(text, 'must record the pinned pre-migration file count').toMatch(/\b22\b/);
    expect(text, 'must be dated 2026-07-07 (the spec-authoring inspection date)').toMatch(/2026-07-07/);
    expect(text, 'must cite REQ-F001-009').toMatch(/REQ-F001-009/);
    // This is intentionally the ONLY assertion involving the 143/22 figures anywhere in this suite:
    // it checks the STATIC DOC's own content, and never re-derives the count from a live `web/src`
    // scan — a live scan is EXPECTED (and required by REQ-F001-019) to shrink as componentization
    // lands, which is exactly what a live count-lock would have wrongly forbidden.
  });
});

describe('REQ-F001-010/019/027 — className disposition/accounting gate over the CURRENT tree', () => {
  it(
    'every className token used in a screen/shared-component source file resolves to a DEFINED, ' +
      'gate-clean (token-referencing) CSS class — none is left unaccounted-for ad-hoc',
    () => {
      const registry = buildCssClassRegistry();
      const offenders: { file: string; classes: string[] }[] = [];
      for (const f of screenSourceFiles()) {
        const tokens = new Set(extractClassNameTokens(readText(f)));
        const bad: string[] = [];
        for (const token of tokens) {
          const status = registry.get(token);
          // `status !== true` covers BOTH failure modes: the class is undefined anywhere in the CSS
          // tree, OR it is defined only by a rule that still contains raw hex/px (i.e. an ad-hoc rule
          // wearing a class name, not a genuine DS-token composition).
          if (status !== true) bad.push(token);
        }
        if (bad.length > 0) offenders.push({ file: relative(WEB_ROOT, f), classes: bad });
      }
      expect(
        offenders,
        'every className site must resolve to a DS-token-referencing composition class (defined, ' +
          'gate-clean — no raw hex/px — somewhere in the web/src CSS tree) or a documented bridge ' +
          'entry (REQ-F001-010/019/026/027); a class that is undefined anywhere, or defined only by a ' +
          'rule still containing raw hex/px, is an unaccounted-for ad-hoc class',
      ).toEqual([]);
    },
  );
});

describe('REQ-F001-009/027 — index.css reduced to token layer + documented residual only', () => {
  it('index.css no longer defines the ad-hoc hand-authored --theme-*/--success*/--danger* token block', () => {
    expect(fileExists(INDEX_CSS)).toBe(true);
    const css = readText(INDEX_CSS);
    // The hand-authored dark :root token block (REQ-F001-009) must be gone; the token layer now
    // lives in the adopted DS token CSS (REQ-F001-017), imported from main.tsx, not index.css.
    expect(css, 'index.css must not hand-declare --theme-bg-primary with a raw hex value').not.toMatch(
      /--theme-bg-primary\s*:\s*#/,
    );
    expect(css).not.toMatch(/--success\s*:/);
    expect(css).not.toMatch(/--danger\s*:/);
  });

  it('index.css no longer contains the ~40 bespoke element/utility rules (they are migrated to DS components/tokens)', () => {
    const css = readText(INDEX_CSS);
    for (const cls of LEGACY_ADHOC_CLASSES) {
      const selectorRe = new RegExp(`\\.${cls}(?![\\w-])`);
      expect(selectorRe.test(css), `.${cls} selector should no longer be defined in index.css post-migration`).toBe(false);
    }
  });

  it('main.tsx imports the adopted DS token CSS (replacing the ad-hoc index.css token block, REQ-F001-017)', () => {
    expect(fileExists(MAIN_TSX)).toBe(true);
    const main = readText(MAIN_TSX);
    expect(main, "main.tsx must import the adopted token layer under 'design-system/tokens'").toMatch(
      /design-system\/tokens/,
    );
  });
});

describe('REQ-F001-002/008/012 — screen/View inventory preserved (no view removed, no rebuild of navigation)', () => {
  it('every pinned View id still appears in App.tsx (App shell / NAV / View union unchanged)', () => {
    expect(fileExists(APP_TSX)).toBe(true);
    const app = readText(APP_TSX);
    for (const id of PINNED_VIEW_IDS) {
      expect(app.includes(`'${id}'`), `View id '${id}' must still be present in App.tsx (REQ-F001-002/008)`).toBe(true);
    }
  });

  it('all five feature-area directories + auth + the three shared components still exist (REQ-F001-012)', () => {
    for (const dir of ['users', 'workspaces', 'settings', 'raweditor', 'diagnostics']) {
      expect(fileExists(join(SRC_DIR, 'features', dir)), `web/src/features/${dir}/ must exist`).toBe(true);
    }
    expect(fileExists(join(SRC_DIR, 'auth'))).toBe(true);
    for (const comp of ['DangerConfirm.tsx', 'ErrorBanner.tsx', 'SetNotSetBadge.tsx']) {
      expect(fileExists(join(SRC_DIR, 'components', comp)), `web/src/components/${comp} must exist`).toBe(true);
    }
  });
});

describe('REQ-F001-024 — theme mechanism unchanged: no in-app theme switcher / runtime data-theme setter introduced', () => {
  it('no source file under web/src writes the `data-theme` attribute at runtime', () => {
    // Regression guard, not deferred: passes TODAY (no such setter exists) and must keep passing —
    // F-001 introduces no theme switcher unless explicitly ruled in (none is).
    for (const f of screenSourceFiles()) {
      const text = readText(f);
      expect(
        /setAttribute\(\s*['"]data-theme['"]/.test(text) || /\.dataset\.theme\s*=/.test(text),
        `${relative(WEB_ROOT, f)} must not set the data-theme attribute at runtime (REQ-F001-024)`,
      ).toBe(false);
    }
  });
});
