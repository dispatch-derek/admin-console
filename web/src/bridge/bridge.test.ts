// SPEC F-001 §6.5 — REQ-F001-026 (the bridge layer isolates and audits residual gaps; exactly two
// pre-authorized entries) and REQ-F001-046 (the raw/code-editor surface is the one named legitimate
// bridge candidate). Per `docs/design/F-001/00-design.md` §2.2, the bridge layer is a single
// identifiable directory at `web/src/bridge/` holding a `README.md` (documenting every entry + its
// named DS gap) and `RawEditorSurface.tsx` (composing DS `Textarea` + tokens). This location is the
// architect's placement choice, not spec-fixed verbatim, but the SPEC's own requirement — "all
// bridge entries live in a SINGLE, explicitly isolated, documented bridge layer under `web/src/`" —
// is what this file actually asserts; only the exact path is taken from the design doc.
//
// SPEC-DEFERRED: fails until `web/src/bridge/` exists (Phase 1, REQ-F001-026/046).

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname, join } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
import { collectFiles, fileExists, readText } from '../test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..');
const BRIDGE_DIR = join(WEB_ROOT, 'src', 'bridge');
const README = join(BRIDGE_DIR, 'README.md');

describe('Bridge layer isolation & documentation (REQ-F001-026)', () => {
  it('a single identifiable bridge directory exists under web/src/', () => {
    expect(fileExists(BRIDGE_DIR), 'expected web/src/bridge/ to exist').toBe(true);
  });

  it('the bridge README documents every entry with a named DS-coverage-gap reason', () => {
    expect(fileExists(README), 'expected web/src/bridge/README.md (REQ-F001-026)').toBe(true);
    const readme = readText(README);
    // The two pre-authorized entries named by the spec.
    expect(readme, 'README must document the raw/code-editor bridge (REQ-F001-046)').toMatch(/raw|code.editor/i);
    expect(
      readme,
      "README must document the prefers-color-scheme bridge (REQ-F001-052, carve-out C)",
    ).toMatch(/prefers-color-scheme|light.theme|carve-out C/i);
  });

  it('no bridge entry other than the raw editor and the prefers-color-scheme block exists without a named justification', () => {
    const files = collectFiles(BRIDGE_DIR, { extensions: ['.ts', '.tsx', '.css'] });
    const named = files.filter((f) => !/README/i.test(f));
    // Every non-README file under bridge/ must be one of the two pre-authorized entries, OR (if a
    // third entry is ever added) the README must name its specific DS gap. We check the weaker,
    // permissive form the spec actually requires: any file present must be referenced BY NAME in
    // the README, so an auditor can trace it to a documented reason (REQ-F001-026/046).
    const readme = fileExists(README) ? readText(README) : '';
    for (const f of named) {
      const base = f.split('/').pop()!;
      expect(readme.includes(base), `bridge file ${base} must be named in bridge/README.md with its DS-gap justification`).toBe(true);
    }
  });
});

describe('Raw/code-editor bridge composes DS Textarea + tokens, not raw literals (REQ-F001-046)', () => {
  const SURFACE = join(BRIDGE_DIR, 'RawEditorSurface.tsx');

  it('a raw-editor bridge module exists', () => {
    expect(fileExists(SURFACE), 'expected web/src/bridge/RawEditorSurface.tsx (or equivalent, REQ-F001-046)').toBe(true);
  });

  it('the raw-editor bridge imports Textarea from the design-system barrel, not a deep/internal path', () => {
    expect(fileExists(SURFACE)).toBe(true);
    const src = readText(SURFACE);
    expect(src, 'must import Textarea').toMatch(/Textarea/);
    // Barrel-only import discipline (REQ-F001-044 v): never `design-system/components/Textarea`.
    expect(src).not.toMatch(/design-system\/components\//);
  });

  it('the raw-editor bridge contains no raw hex color or raw px literal (gate-clean, REQ-F001-044/046)', () => {
    expect(fileExists(SURFACE)).toBe(true);
    const src = readText(SURFACE);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b\d+px\b/);
  });
});
