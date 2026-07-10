// Shared test-only filesystem-scan helpers for F-001 spec tests (specs/F-001-adhere-to-design-
// system.md). NOT production code: it exists solely so multiple *.test.ts(x) files can do static
// source-tree scans (className inventory, orphan-token audit, vendor-immutability hashing, etc.)
// without duplicating the same fs-walk in every file. Mirrors the pattern already used in
// `web/src/leakage.test.ts`.
//
// This file is intentionally NOT itself a `*.test.*` file, so vitest does not try to run it as a
// suite; it is imported by the F-001 test files that need it.

// This project's tsconfig targets the browser (lib: DOM, no @types/node), so the Node built-in
// module specifiers below have no type declarations here even though they resolve fine at test
// runtime under Vitest's Node process. Suppressed narrowly, only in this test-infra file.
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { join, extname } from 'node:path';

export interface ScanOptions {
  /** File extensions to include, e.g. ['.ts', '.tsx']. */
  extensions: string[];
  /** Directory names (basename) to skip entirely, e.g. ['node_modules']. */
  skipDirs?: string[];
  /** If true, exclude `*.test.ts`/`*.test.tsx` files. Default true. */
  excludeTests?: boolean;
}

/** Recursively collect absolute file paths under `dir` matching `options`. */
export function collectFiles(dir: string, options: ScanOptions): string[] {
  const { extensions, skipDirs = [], excludeTests = true } = options;
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (skipDirs.includes(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full, options));
      continue;
    }
    if (!extensions.includes(extname(entry))) continue;
    if (excludeTests && /\.test\.(ts|tsx|js|jsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

export function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Strip `/* ... *\/` block comments from CSS text, replacing each with spaces of the same length
 * (newlines preserved) so downstream indices/line numbers still line up 1:1 with the original
 * text. Selector-matching regexes must never match text that only appears inside a CSS comment
 * (e.g. a file-header comment that mentions `[data-theme="light"]` in prose) — see REQ-F001-023
 * path (iii) / dual-theme-harness.test.ts regression this guards against.
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Extract the declaration body of the first top-level rule whose selector text matches
 * `selectorPattern`, handling one level of brace nesting (enough for `:root { ... }`,
 * `[data-theme="light"] { ... }`, and `@media (...) { :root:not(...) { ... } }` shapes). Returns
 * `null` if no match is found.
 *
 * This is a deliberately minimal CSS-block extractor (not a full parser) — sufficient for
 * asserting on the flat custom-property blocks the DS token files and the F-001 bridge use.
 * CSS comments are stripped before selector matching so prose inside a comment (e.g. a file-header
 * comment mentioning `[data-theme="light"]`) can never be mistaken for the real selector.
 */
export function extractRuleBody(css: string, selectorPattern: RegExp): string | null {
  const searchable = stripCssComments(css);
  const match = selectorPattern.exec(searchable);
  if (!match) return null;
  const braceStart = searchable.indexOf('{', match.index + match[0].length - 1);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < searchable.length; i++) {
    if (searchable[i] === '{') depth++;
    else if (searchable[i] === '}') {
      depth--;
      if (depth === 0) return searchable.slice(braceStart + 1, i);
    }
  }
  return null;
}

/** Parse `--name: value;` custom-property declarations out of a CSS block body. */
export function parseCustomProps(blockBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockBody))) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** Every distinct `var(--name` reference in a source string. */
export function findVarReferences(source: string): Set<string> {
  const out = new Set<string>();
  const re = /var\(\s*(--[A-Za-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.add(m[1]);
  return out;
}
