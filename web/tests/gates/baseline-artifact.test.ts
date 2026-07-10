// SPEC F-001 REQ-F001-049 (N-2) — the pre-migration baseline (gzipped bundle size + a11y/contrast
// snapshot) MUST be captured and committed as a dated artifact under `docs/` (or a comparable
// tracked location) BEFORE the first migration change lands, because it stops being reconstructable
// once migration starts. REQ-F001-030 (a11y no-regression) and REQ-F001-033 (bundle budget ≤
// baseline + 10%) both cite this artifact rather than a re-measured value.
//
// This is a blocking PREREQUISITE check, not a post-hoc one: as of this run, migration has not
// started (no `web/src/design-system/**` components exist, no lint gates are wired — see the other
// F-001 gate/token suites), so this test is expected to FAIL until the baseline artifact is captured
// — which per REQ-F001-049 must happen BEFORE any migration commit, i.e. before those other suites
// are made to pass.
//
// REQ-F001-030/033's actual numeric comparisons (contrast ratios, p95 render time, gzip size math)
// require a real browser + production build pipeline outside vitest's jsdom environment; see
// TEST_PLAN.md for the exact out-of-band commands. This file verifies the ARTIFACT'S EXISTENCE AND
// SHAPE, which is the part that is unit-testable.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname, join } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { readdirSync, existsSync } from 'node:fs';
import { readText } from '../../src/test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..'); // web/tests/gates -> repo root
const DOCS_F001_DIR = join(REPO_ROOT, 'docs', 'design', 'F-001');

function findBaselineArtifact(): string | null {
  if (!existsSync(DOCS_F001_DIR)) return null;
  const match = readdirSync(DOCS_F001_DIR).find((f) => /^baseline-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  return match ? join(DOCS_F001_DIR, match) : null;
}

describe('REQ-F001-049 — pre-migration baseline artifact captured before migration begins', () => {
  it('a dated baseline-<YYYY-MM-DD>.md artifact exists under docs/design/F-001/', () => {
    const artifact = findBaselineArtifact();
    expect(
      artifact,
      'expected docs/design/F-001/baseline-<YYYY-MM-DD>.md (REQ-F001-049) to exist BEFORE the first migration commit',
    ).not.toBeNull();
  });

  it('the artifact records both required measurements: gzipped bundle size and an a11y/contrast snapshot', () => {
    const artifact = findBaselineArtifact();
    expect(artifact).not.toBeNull();
    const text = readText(artifact!);
    expect(text, 'must record the gzipped production JS+CSS bundle size (REQ-F001-033 basis)').toMatch(
      /gzip/i,
    );
    expect(text, 'must record an accessibility/contrast snapshot (REQ-F001-030 basis)').toMatch(
      /a11y|accessib|contrast/i,
    );
    expect(
      text,
      'must cover the parent REQ-100 read views plus DangerConfirm/ErrorBanner/SetNotSetBadge',
    ).toMatch(/DangerConfirm/);
  });
});
