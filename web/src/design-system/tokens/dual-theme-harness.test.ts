// SPEC F-001 REQ-F001-023 (§6.4) — the three-path dual-theme render/contrast harness: (i) dark
// default (no attribute), (ii) `[data-theme='light']`, (iii) simulated
// `prefers-color-scheme: light` with no `data-theme` set. In every path, every custom property a
// migrated screen references must resolve to a defined value; no surviving `var(--success…)` /
// `var(--danger…)` / seven-orphan reference (REQ-F001-048/053); and path (iii) must match path (ii)'s
// value for every `--theme-*` the screens consume (REQ-F001-052, ruling OQ-11, RISK-1 — the bridge
// `@media (prefers-color-scheme: light)` block).
//
// Approach: jsdom does not run a real CSS cascade/layout engine, so this harness resolves theme
// paths STATICALLY from the adopted token CSS text (a defensible reading of "resolves to a defined
// value" that is actually executable in this test stack) rather than rendering in a real browser.
// REQ-F001-030/033's browser-only concerns (contrast ratios, real paint) are out of scope for this
// file and are called out separately in TEST_PLAN.md.
//
// SPEC-DEFERRED: fails until `web/src/design-system/tokens/colors.css` (REQ-F001-017) and the
// REQ-F001-052 bridge `@media (prefers-color-scheme: light)` block exist under web/src.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname, join } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
import {
  collectFiles,
  readText,
  fileExists,
  extractRuleBody,
  parseCustomProps,
  findVarReferences,
} from '../../test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..', '..');
const SRC_DIR = join(WEB_ROOT, 'src');
const ADOPTED_COLORS = join(SRC_DIR, 'design-system', 'tokens', 'colors.css');

// Tokens the REQ-F001-023 test text names explicitly as must-resolve in all three paths.
const NAMED_MUST_RESOLVE = [
  '--theme-badge-success-text',
  '--theme-badge-success-bg',
  '--theme-badge-danger-text',
  '--theme-badge-danger-bg',
  '--theme-bg-secondary',
  '--theme-badge-warn-text',
  '--theme-badge-warn-bg',
  '--theme-text-secondary',
  '--theme-button-cta',
];

function allCssUnderSrc(): { path: string; text: string }[] {
  return collectFiles(SRC_DIR, { extensions: ['.css'] }).map((path) => ({ path, text: readText(path) }));
}

/** Every distinct `--theme-*` custom property referenced anywhere in migrated .ts/.tsx/.css source. */
function consumedThemeVars(): Set<string> {
  const files = collectFiles(SRC_DIR, { extensions: ['.ts', '.tsx', '.css'] });
  const out = new Set<string>();
  for (const f of files) {
    for (const v of findVarReferences(readText(f))) if (v.startsWith('--theme-')) out.add(v);
  }
  return out;
}

/** Resolve a possibly-indirect `var(--x)` value against a flat name->raw-value map (one hop chain). */
function resolve(value: string, flatMap: Map<string, string>, depth = 0): string {
  if (depth > 10) return value;
  const m = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const [, name, fallback] = m;
  if (flatMap.has(name)) return resolve(flatMap.get(name)!, flatMap, depth + 1);
  if (fallback) return resolve(fallback, flatMap, depth + 1);
  return `<UNRESOLVED:${name}>`;
}

function buildFlatDefinitionMap(): Map<string, string> {
  const flat = new Map<string, string>();
  for (const { text } of allCssUnderSrc()) {
    const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) if (!flat.has(m[1])) flat.set(m[1], m[2].trim());
  }
  return flat;
}

function findBridgeMediaBlock(): { file: string; body: string } | null {
  for (const { path, text } of allCssUnderSrc()) {
    if (/@media\s*\(\s*prefers-color-scheme:\s*light\s*\)/.test(text)) {
      const body = extractRuleBody(text, /@media\s*\(\s*prefers-color-scheme:\s*light\s*\)/);
      if (body) return { file: path, body };
    }
  }
  return null;
}

describe('REQ-F001-023 dual-theme harness — path (i) dark default', () => {
  it('the adopted colors.css :root (dark) block defines every consumed --theme-* token', () => {
    expect(fileExists(ADOPTED_COLORS), 'adopted colors.css must exist (REQ-F001-017)').toBe(true);
    const css = readText(ADOPTED_COLORS);
    const darkBody = extractRuleBody(css, /:root\s*(?!\[)/);
    expect(darkBody, ':root (dark) block must exist in colors.css').not.toBeNull();
    const dark = parseCustomProps(darkBody!);
    for (const name of consumedThemeVars()) {
      expect(dark[name], `--theme-* "${name}" consumed by a migrated screen must resolve under dark default`).toBeDefined();
    }
  });
});

describe('REQ-F001-023 dual-theme harness — path (ii) [data-theme="light"]', () => {
  it('the adopted colors.css [data-theme="light"] block defines every consumed --theme-* token', () => {
    expect(fileExists(ADOPTED_COLORS)).toBe(true);
    const css = readText(ADOPTED_COLORS);
    const lightBody = extractRuleBody(css, /\[data-theme=["']light["']\]/);
    expect(lightBody, '[data-theme="light"] block must exist in colors.css').not.toBeNull();
    const light = parseCustomProps(lightBody!);
    for (const name of consumedThemeVars()) {
      expect(light[name], `--theme-* "${name}" consumed by a migrated screen must resolve under [data-theme='light']`).toBeDefined();
    }
  });

  it.each(NAMED_MUST_RESOLVE)('%s resolves under [data-theme="light"]', (name) => {
    const css = readText(ADOPTED_COLORS);
    const lightBody = extractRuleBody(css, /\[data-theme=["']light["']\]/)!;
    const light = parseCustomProps(lightBody);
    expect(light[name]).toBeDefined();
  });
});

describe('REQ-F001-023 path (iii) / REQ-F001-052 — simulated prefers-color-scheme: light, no data-theme', () => {
  it('a bridge @media (prefers-color-scheme: light) block exists outside the verbatim token files (carve-out C)', () => {
    const found = findBridgeMediaBlock();
    expect(found, 'expected a bridge-layer @media (prefers-color-scheme: light) block under web/src (REQ-F001-052)').not.toBeNull();
  });

  it("the bridge block is scoped to :root:not([data-theme='dark']) (mirrors today's selector, REQ-F001-052)", () => {
    const found = findBridgeMediaBlock();
    expect(found).not.toBeNull();
    expect(found!.body).toMatch(/:root:not\(\[data-theme=["']dark["']\]\)/);
  });

  it('the bridge block contains ONLY var() re-points — no raw hex/px (gate-clean, REQ-F001-047/052)', () => {
    const found = findBridgeMediaBlock();
    expect(found).not.toBeNull();
    const innerBody = extractRuleBody(found!.body, /:root:not\(\[data-theme=["']dark["']\]\)/);
    expect(innerBody, 'inner :root:not([data-theme=\'dark\']) rule body must exist').not.toBeNull();
    const props = parseCustomProps(innerBody!);
    expect(Object.keys(props).length, 'the bridge block must re-point at least one --theme-* token').toBeGreaterThan(0);
    for (const [name, value] of Object.entries(props)) {
      expect(value, `${name}: ${value} must be a var() reference, not a raw literal`).toMatch(/^var\(/);
      expect(value, `${name}: ${value} must not contain a raw hex color`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(value, `${name}: ${value} must not contain a raw px length`).not.toMatch(/\b\d+px\b/);
    }
  });

  it('every --theme-* the migrated screens consume resolves, under simulated OS-light, to the SAME value as [data-theme="light"] (REQ-F001-023 path iii / REQ-F001-052 b)', () => {
    const found = findBridgeMediaBlock();
    expect(found).not.toBeNull();
    const innerBody = extractRuleBody(found!.body, /:root:not\(\[data-theme=["']dark["']\]\)/)!;
    const bridgeProps = parseCustomProps(innerBody);
    const flat = buildFlatDefinitionMap();

    const css = readText(ADOPTED_COLORS);
    const lightBody = extractRuleBody(css, /\[data-theme=["']light["']\]/)!;
    const light = parseCustomProps(lightBody);

    for (const name of consumedThemeVars()) {
      expect(bridgeProps[name], `expected the bridge block to re-point ${name} for OS-light (REQ-F001-052)`).toBeDefined();
      const osLightResolved = resolve(bridgeProps[name], flat);
      const expected = light[name];
      expect(expected, `${name} must have a [data-theme="light"] value to compare against`).toBeDefined();
      expect(
        osLightResolved,
        `${name} under simulated prefers-color-scheme:light must resolve to the same value as [data-theme='light'] (${expected}), got ${osLightResolved}`,
      ).toBe(expected);
    }
  });

  it('an explicit [data-theme="dark"] is unaffected by the bridge block (dark wins, REQ-F001-052 c)', () => {
    const found = findBridgeMediaBlock();
    expect(found).not.toBeNull();
    // Structural guarantee: the selector explicitly excludes [data-theme='dark'] via :not(), so a
    // real UA cascade never applies these declarations when that attribute is present.
    expect(found!.body).toMatch(/:not\(\[data-theme=["']dark["']\]\)/);
  });
});

describe('REQ-F001-023 — no surviving retired-orphan var() reference in any theme path', () => {
  it('no --success*/--danger*/seven-orphan reference appears in the adopted token CSS or bridge CSS', () => {
    const retired = [
      '--success',
      '--success-bg',
      '--danger',
      '--danger-bg',
      '--danger-strong',
      '--theme-home-bg-card',
      '--theme-button-text',
      '--theme-button-code-hover-text',
      '--theme-button-disable-hover-text',
      '--theme-button-disable-hover-bg',
      '--theme-button-delete-hover-text',
      '--theme-button-delete-hover-bg',
    ];
    for (const { path, text } of allCssUnderSrc()) {
      for (const name of retired) {
        expect(text.includes(name), `${name} must not appear in ${path} (REQ-F001-048/053)`).toBe(false);
      }
    }
  });
});
