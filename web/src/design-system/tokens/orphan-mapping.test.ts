// SPEC F-001 REQ-F001-048 (orphaned --success*/--danger* -> DS token mapping, ruling OQ-10) and
// REQ-F001-053 (seven additional orphaned --theme-* -> DS token mapping, ruling OQ-12, RISK-2).
// Also exercises REQ-F001-053's "reproducible audit method" (exhaustiveness: the union of the two
// mappings is the complete set of consumed-but-undefined custom properties; no third orphan class).
//
// Current-state baseline (inspected 2026-07-07/09, `web/src/index.css`): ALL twelve orphaned custom
// properties are still defined/consumed there today, so every "must not survive" assertion below is
// EXPECTED TO FAIL until the migration re-points these references. That failure is the correct,
// spec-derived signal that the migration has not happened yet — not a broken test.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname, join } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
import { collectFiles, readText, findVarReferences } from '../../test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..', '..');
const SRC_DIR = join(WEB_ROOT, 'src');

// REQ-F001-048 — the five retired `--success*`/`--danger*` names.
const RETIRED_SUCCESS_DANGER = ['--success', '--success-bg', '--danger', '--danger-bg', '--danger-strong'];

// REQ-F001-053 — the seven retired non-DS `--theme-*` names (RISK-2).
const RETIRED_THEME_ORPHANS = [
  '--theme-home-bg-card',
  '--theme-button-text',
  '--theme-button-code-hover-text',
  '--theme-button-disable-hover-text',
  '--theme-button-disable-hover-bg',
  '--theme-button-delete-hover-text',
  '--theme-button-delete-hover-bg',
];

const ALL_RETIRED = [...RETIRED_SUCCESS_DANGER, ...RETIRED_THEME_ORPHANS];

function allSourceText(): { path: string; text: string }[] {
  const files = collectFiles(SRC_DIR, { extensions: ['.ts', '.tsx', '.css'] });
  return files.map((path) => ({ path, text: readText(path) }));
}

describe('Orphaned --success*/--danger* custom properties (REQ-F001-048, ruling OQ-10)', () => {
  it.each(RETIRED_SUCCESS_DANGER)('%s is neither defined nor referenced anywhere in web/src', (name) => {
    const offenders = allSourceText().filter(({ text }) => text.includes(name));
    expect(
      offenders.map((o) => o.path),
      `${name} must be fully retired (REQ-F001-048); found in`,
    ).toEqual([]);
  });

  it('the mapped DS tokens (--theme-badge-success-text/-bg, --theme-badge-danger-text/-bg) are the ones actually consumed', () => {
    const consumed = new Set<string>();
    for (const { text } of allSourceText()) for (const v of findVarReferences(text)) consumed.add(v);
    for (const target of [
      '--theme-badge-success-text',
      '--theme-badge-success-bg',
      '--theme-badge-danger-text',
      '--theme-badge-danger-bg',
    ]) {
      expect(consumed.has(target), `expected ${target} to be consumed post-migration`).toBe(true);
    }
  });
});

describe('Seven additional non-DS --theme-* orphans (REQ-F001-053, ruling OQ-12, RISK-2)', () => {
  it.each(RETIRED_THEME_ORPHANS)('%s is neither defined nor referenced anywhere in web/src', (name) => {
    const offenders = allSourceText().filter(({ text }) => text.includes(name));
    expect(
      offenders.map((o) => o.path),
      `${name} must be fully retired (REQ-F001-053); found in`,
    ).toEqual([]);
  });

  it('the two actually-consumed orphans re-point to --theme-bg-secondary / --theme-badge-warn-text', () => {
    const consumed = new Set<string>();
    for (const { text } of allSourceText()) for (const v of findVarReferences(text)) consumed.add(v);
    expect(consumed.has('--theme-bg-secondary'), 'expected --theme-home-bg-card sites to re-point to --theme-bg-secondary').toBe(true);
    expect(consumed.has('--theme-badge-warn-text'), 'expected --theme-button-disable-hover-text sites to re-point to --theme-badge-warn-text').toBe(true);
  });
});

describe('Exhaustiveness — no third orphan class (REQ-F001-053 audit method)', () => {
  it('every `var()` reference under web/src resolves to a name defined somewhere under web/src (no unresolved custom property)', () => {
    const consumed = new Set<string>();
    const defined = new Set<string>();
    for (const { text } of allSourceText()) {
      for (const v of findVarReferences(text)) consumed.add(v);
      const defRe = /(--[A-Za-z0-9-]+)\s*:/g;
      let m: RegExpExecArray | null;
      while ((m = defRe.exec(text))) defined.add(m[1]);
    }
    const unresolved = [...consumed].filter((name) => !defined.has(name));
    expect(
      unresolved,
      'every consumed custom property must be defined somewhere under web/src (adopted token files or the documented bridge light-source file)',
    ).toEqual([]);
  });

  it('none of the 12 retired orphan names (5 + 7) appear anywhere in the consumed-or-defined set post-migration', () => {
    const allNames = new Set<string>();
    for (const { text } of allSourceText()) {
      for (const v of findVarReferences(text)) allNames.add(v);
      const defRe = /(--[A-Za-z0-9-]+)\s*:/g;
      let m: RegExpExecArray | null;
      while ((m = defRe.exec(text))) allNames.add(m[1]);
    }
    const survivors = ALL_RETIRED.filter((name) => allNames.has(name));
    expect(survivors, 'no retired orphan name may survive the migration').toEqual([]);
  });
});
