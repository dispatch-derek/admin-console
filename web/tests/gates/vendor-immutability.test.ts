// SPEC F-001 REQ-F001-015 ("consume, don't fork" — the vendored handoff bundle is an immutable
// reference; no F-001 commit hand-edits any file under web/vendor/design-system/) and REQ-F001-025
// (re-sync stays a diff-and-reapply because the vendored reference is kept un-forked).
//
// This test pins a content hash of the five vendored files F-001 depends on (the four token CSS
// files + the adherence oxlint config) captured at spec-authoring time (rev 6, 2026-07-09). It is
// intentionally NOT deferred: it passes TODAY and must keep passing through and after the migration
// — a failure here means something hand-edited the immutable reference, which is a regression
// regardless of migration progress.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname, join } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { createHash } from 'node:crypto';
import { readText } from '../../src/test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..');
const VENDOR_DIR = join(WEB_ROOT, 'vendor', 'design-system', 'project');

// SHA-256 of the pristine vendored files, captured 2026-07-09 against the checked-in bundle.
const PINNED_HASHES: Record<string, string> = {
  'tokens/colors.css': '0aadcca827422b991b00a7502a58f866a24eaf74a6154a549d38b911286ad2e0',
  'tokens/spacing.css': '74920c9b317e0b36804419dbb50634e971c91890cbb36ca5917e46e3d8026471',
  'tokens/typography.css': 'c3c5fdc257894e19fe96cf7126641d89d4a503c357c7bab7c01e128f798c15f2',
  'tokens/fonts.css': '638c498ee9ed8b887b2df84216fe3ea3ad5ea556d2bcc1adff5ace7d7aa8608b',
  '_adherence.oxlintrc.json': '30e745a8fcde2ea17855fb238254040485a9d30ba36f9a2972aef0fc7873417d',
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

describe('Vendored DS bundle is immutable (REQ-F001-015)', () => {
  it.each(Object.entries(PINNED_HASHES))('%s is byte-identical to the pinned rev-6 reference hash', (relPath, expectedHash) => {
    const text = readText(join(VENDOR_DIR, relPath));
    expect(sha256(text), `${relPath} must never be hand-edited (REQ-F001-015)`).toBe(expectedHash);
  });
});
