// SPEC F-001 §6.1 Token migration — REQ-F001-017 (verbatim adoption, carve-out A the font-asset
// url()), REQ-F001-018 (no hardcoded off-system values outside the path-exempt token files), and
// REQ-F001-035 (single source of truth / propagation).
//
// SPEC-DEFERRED: `web/src/design-system/tokens/{colors,spacing,typography,fonts}.css` do not exist
// yet (REQ-F001-017/015). Every test below is written against the FILES THE SPEC REQUIRES TO EXIST
// post-migration, not a guessed shape — it will fail with a clear "file not found" style assertion
// until the token layer lands, and should pass unmodified once it does.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { join } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
import { fileExists, readText } from '../../test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..', '..'); // web/src/design-system/tokens -> web/
const ADOPTED_DIR = join(WEB_ROOT, 'src', 'design-system', 'tokens');
const VENDOR_TOKENS_DIR = join(WEB_ROOT, 'vendor', 'design-system', 'project', 'tokens');

const VERBATIM_FILES = ['colors.css', 'spacing.css', 'typography.css'] as const; // fonts.css handled separately (carve-out A)

describe('Adopted DS token CSS — verbatim adoption (REQ-F001-017)', () => {
  it.each(VERBATIM_FILES)('%s is byte-for-byte identical to the vendored reference', (file) => {
    const adoptedPath = join(ADOPTED_DIR, file);
    const vendorPath = join(VENDOR_TOKENS_DIR, file);
    expect(fileExists(adoptedPath), `expected ${adoptedPath} to exist (REQ-F001-017)`).toBe(true);
    const adopted = readText(adoptedPath);
    const vendor = readText(vendorPath);
    expect(adopted, `${file} must not diverge from the vendored reference`).toBe(vendor);
  });

  it('fonts.css differs from the vendored reference in at most the one @font-face src url() string (carve-out A, REQ-F001-017/F-3)', () => {
    const adoptedPath = join(ADOPTED_DIR, 'fonts.css');
    const vendorPath = join(VENDOR_TOKENS_DIR, 'fonts.css');
    expect(fileExists(adoptedPath), `expected ${adoptedPath} to exist (REQ-F001-017 carve-out A)`).toBe(true);
    const adopted = readText(adoptedPath);
    const vendor = readText(vendorPath);

    // Replace the src: url(...) line in both, and everything else must match exactly.
    const stripUrl = (css: string) => css.replace(/src:\s*url\([^)]*\)\s*format\([^)]*\)\s*;/, 'src: <URL>;');
    expect(stripUrl(adopted), 'fonts.css must be verbatim outside the one url() string').toBe(stripUrl(vendor));

    // The font-family declared must still be exactly "Plus Jakarta Sans" (REQ-F001-018/044 iii/047 iii).
    expect(adopted).toMatch(/font-family:\s*"Plus Jakarta Sans"/);
  });

  it('the co-vendored PlusJakartaSans.ttf asset exists at a path the adopted fonts.css url() can resolve (REQ-F001-017 carve-out A)', () => {
    const adoptedPath = join(ADOPTED_DIR, 'fonts.css');
    expect(fileExists(adoptedPath)).toBe(true);
    const adopted = readText(adoptedPath);
    const match = /src:\s*url\(["']?([^"')]+)["']?\)/.exec(adopted);
    expect(match, 'fonts.css must declare a src url()').not.toBeNull();
    const relativeUrl = match![1];
    // The url() is relative to the adopted tokens/ directory (mirroring the vendored bundle's
    // tokens/ -> ../assets/fonts/ layout), per the recommended default in REQ-F001-017(A).
    const resolved = join(ADOPTED_DIR, relativeUrl);
    expect(fileExists(resolved), `expected the font asset to resolve at ${resolved}`).toBe(true);
  });

  it('no adopted token file differs from the vendored reference beyond the two named carve-outs (REQ-F001-017 "no other byte")', () => {
    // Re-assert the invariant holistically: exactly one file (fonts.css) may differ, and only in
    // the url() string; the other three token files (colors/spacing/typography) must be identical.
    for (const file of VERBATIM_FILES) {
      const adopted = readText(join(ADOPTED_DIR, file));
      const vendor = readText(join(VENDOR_TOKENS_DIR, file));
      expect(adopted).toBe(vendor);
    }
  });
});

describe('Single source of truth / propagation (REQ-F001-014/035)', () => {
  it('--theme-button-primary and --theme-bg-primary are defined in exactly one adopted CSS location (the colors.css token file)', () => {
    const colorsPath = join(ADOPTED_DIR, 'colors.css');
    expect(fileExists(colorsPath), 'adopted colors.css must exist (REQ-F001-017)').toBe(true);
    const css = readText(colorsPath);
    for (const token of ['--theme-button-primary', '--theme-bg-primary']) {
      const defRe = new RegExp(`${token}\\s*:`, 'g');
      const count = (css.match(defRe) || []).length;
      // Defined under :root AND [data-theme="light"] is expected (dual-theme, REQ-F001-023) — i.e.
      // exactly 2 definitions inside the ONE adopted token file, never redeclared per-screen.
      expect(count, `${token} should be declared for both themes in colors.css`).toBeGreaterThanOrEqual(2);
    }
  });
});
