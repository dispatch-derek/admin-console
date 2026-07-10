// SPEC F-001 §6.6 — REQ-F001-044 (JS/TS adherence gate: rules i-iii no raw hex/px/off-system-font,
// rule iv prop/variant restriction, rule v no-restricted-imports barrel discipline; run mode F-4
// `--deny-warnings`, import-pattern remap F-5) and REQ-F001-047 (CSS stylelint gate, ruling OQ-9,
// path-scoped 5-file exemption per NEW-1 + rev-6 REQ-F001-052). Also exercises
// REQ-F001-014/016/019/026/027/028/028a's shared "both gates pass, zero violations, non-zero exit on
// any violation" clause.
//
// This is a repo-root harness (`web/tests/gates/`) because the gate configs live at the `web/`
// package root (`web/.oxlintrc.json`, `web/.stylelintrc.json`), not under `web/src/`.
//
// RULING (2026-07-09, human ruling 1): the JS/TS raw-literal floor (REQ-F001-044 rules i-iii — no raw
// hex, no raw px, no off-system font-family in JS/TS/JSX) moves to ESLint's native
// `no-restricted-syntax` (oxlint 1.73 has no equivalent AST rule). oxlint is retained ONLY for the
// rules it supports: prop/variant restriction (rule iv) and the `no-restricted-imports` barrel
// discipline (rule v) — those checks below still legitimately inspect `.oxlintrc.json` directly,
// since oxlint remains the designated tool for them. The JS/TS gate's COMMAND CONTRACT, regardless of
// which tool(s) it wraps, is `npm run lint:ds` (run from `web/`), which MUST exit non-zero on ANY
// violation. The "Gate execution" block's JS/TS test below is therefore TOOL-AGNOSTIC and
// BEHAVIOR-BASED per the ruling: it seeds a real raw-hex + raw-px + off-system-font-family violation
// into a throwaway `.tsx` fixture under `web/src/`, invokes the actual `npm run lint:ds` command (the
// same command CI/`build` runs), and asserts ONLY on its exit code — never on which tool or rule name
// caught it, and never on `.oxlintrc.json`/`no-restricted-syntax` specifically for this rule set. The
// CSS-gate (stylelint, REQ-F001-047) assertions are UNCHANGED by this ruling.
//
// SPEC-DEFERRED (structural checks): fail until the adopted configs land (Phase 1, REQ-F001-044/047).
// SPEC-DEFERRED (execution checks): additionally require the `oxlint`/`stylelint` devDependencies (or,
// for the JS/TS gate, whatever `npm run lint:ds` wraps) to be installed/wired; until then they fail
// with an explicit, labeled message or a `false`/red assertion rather than crashing, per the QA
// brief's "mark tests that cannot run until implementation exists clearly."

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { dirname, join } from 'node:path';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { execSync } from 'node:child_process';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// @ts-expect-error -- no @types/node in this project's tsconfig; valid Node runtime built-in.
import { tmpdir } from 'node:os';
import { fileExists, readText } from '../../src/test/fsScan';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..');
const SRC_DIR = join(WEB_ROOT, 'src');
const OXLINT_CONFIG = join(WEB_ROOT, '.oxlintrc.json');
const STYLELINT_CONFIG = join(WEB_ROOT, '.stylelintrc.json');
const PACKAGE_JSON = join(WEB_ROOT, 'package.json');

const FIVE_EXEMPT_TOKEN_FILES = ['colors.css', 'spacing.css', 'typography.css', 'fonts.css'];

function readPackageScripts(): Record<string, string> {
  const pkg = JSON.parse(readText(PACKAGE_JSON));
  return pkg.scripts ?? {};
}

describe('Gate config existence & wiring (REQ-F001-044/047)', () => {
  it('the adopted oxlint config exists at web/.oxlintrc.json (REQ-F001-044, consume-dont-fork REQ-F001-015)', () => {
    expect(fileExists(OXLINT_CONFIG), 'expected web/.oxlintrc.json').toBe(true);
  });

  it('the CSS-aware stylelint config exists at web/.stylelintrc.json (REQ-F001-047, ruling OQ-9)', () => {
    expect(fileExists(STYLELINT_CONFIG), 'expected web/.stylelintrc.json').toBe(true);
  });

  it('package.json declares lint:ds and lint:css scripts wired into build (REQ-F001-034)', () => {
    const scripts = readPackageScripts();
    expect(scripts['lint:ds'], 'expected a "lint:ds" script').toBeDefined();
    expect(scripts['lint:css'], 'expected a "lint:css" script').toBeDefined();
    expect(scripts.build, 'the build script should run both gates (REQ-F001-034)').toMatch(/lint:ds/);
    expect(scripts.build).toMatch(/lint:css/);
  });
});

describe('REQ-F001-044 (F-4) — oxlint run mode: warnings must fail CI', () => {
  it('lint:ds is invoked with --deny-warnings, OR the adopted config sets rule severities to "error"', () => {
    const scripts = readPackageScripts();
    const script = scripts['lint:ds'] ?? '';
    const usesDenyWarnings = /--deny-warnings/.test(script);
    let allError = false;
    if (fileExists(OXLINT_CONFIG)) {
      const cfg = JSON.parse(readText(OXLINT_CONFIG));
      const severities = Object.values(cfg.rules ?? {}).map((r) => (Array.isArray(r) ? r[0] : r));
      allError = severities.length > 0 && severities.every((s) => s === 'error' || s === 2);
    }
    expect(
      usesDenyWarnings || allError,
      'F-4: a single violation must yield a non-zero exit — either run with --deny-warnings or set all rule severities to "error"',
    ).toBe(true);
  });
});

describe('REQ-F001-044 (F-5) — import-pattern remap to the recreated web/src/design-system/ layout', () => {
  it('no-restricted-imports targets the recreated internals path, not the vendored bundle JS layout', () => {
    expect(fileExists(OXLINT_CONFIG)).toBe(true);
    const cfg = JSON.parse(readText(OXLINT_CONFIG));
    const noRestricted = cfg.rules?.['no-restricted-imports'];
    expect(noRestricted, 'expected a no-restricted-imports rule').toBeDefined();
    const serialized = JSON.stringify(noRestricted);
    expect(serialized, 'must forbid deep imports into the recreated design-system internals').toMatch(
      /design-system\/components/,
    );
    expect(
      serialized,
      'must NOT still reference the vendored bundle JS category paths (components/data-display/**, etc.) unremapped',
    ).not.toMatch(/components\/data-display\/\*\*/);
  });

  it('the barrel exemption is moved from **/index.js to the TS barrel (design-system/index.ts or .tsx)', () => {
    expect(fileExists(OXLINT_CONFIG)).toBe(true);
    const cfg = JSON.parse(readText(OXLINT_CONFIG));
    const overrides = JSON.stringify(cfg.overrides ?? []);
    expect(overrides, 'expected an override exempting the design-system TS barrel from no-restricted-imports').toMatch(
      /design-system\/index\.(ts|tsx)/,
    );
  });
});

describe('REQ-F001-047 — stylelint CSS gate: path-scoped, NOT content-scoped, exemption', () => {
  it('the exemption names exactly the four adopted DS token files plus the one bridge light-source file (five total), by path', () => {
    expect(fileExists(STYLELINT_CONFIG)).toBe(true);
    const cfg = JSON.parse(readText(STYLELINT_CONFIG));
    const ignoreSources = JSON.stringify([cfg.ignoreFiles ?? [], cfg.overrides ?? []]);
    for (const f of FIVE_EXEMPT_TOKEN_FILES) {
      expect(ignoreSources, `expected the CSS gate to path-exempt ${f}`).toMatch(new RegExp(f.replace('.', '\\.')));
    }
    // Rev 6 fifth file: a bridge light-source token file backing the prefers-color-scheme block
    // (REQ-F001-052). We don't know its exact name, but the exemption list must contain a FIFTH
    // path entry beyond the four named token files (still path-scoped).
    const overridesArr = Array.isArray(cfg.overrides) ? cfg.overrides : [];
    const allFileGlobs: string[] = [];
    for (const o of overridesArr) if (Array.isArray(o.files)) allFileGlobs.push(...o.files);
    if (Array.isArray(cfg.ignoreFiles)) allFileGlobs.push(...cfg.ignoreFiles);
    expect(
      allFileGlobs.length,
      'expected exactly five exempt file globs (four DS token files + one bridge light-source file, REQ-F001-047/052)',
    ).toBeGreaterThanOrEqual(5);
  });

  it('the exemption is expressed as a path/file glob, never a content/--* declaration-type matcher', () => {
    expect(fileExists(STYLELINT_CONFIG)).toBe(true);
    const raw = readText(STYLELINT_CONFIG);
    // Forbid the specific laundering shape NEW-1 calls out: an exemption keyed off custom-property
    // declaration syntax rather than a file path.
    expect(raw, 'the exemption must not be a `--*` declaration-type/content-scoped rule').not.toMatch(
      /"selector"\s*:\s*"\[?--/,
    );
  });
});

// Resolve a devDependency CLI strictly from THIS package's node_modules/.bin — never fall back to
// `npx` (which would attempt a network fetch and could hang/flake in an offline CI/sandbox). If the
// binary isn't installed yet, the gate is simply not wired yet (REQ-F001-044/047 not implemented),
// which is exactly the SPEC-DEFERRED condition we want to surface as a clear, fast test failure.
function localBin(name: string): string | null {
  const path = join(WEB_ROOT, 'node_modules', '.bin', name);
  return fileExists(path) ? path : null;
}

describe('Gate execution — seeded violations fail, clean code passes (REQ-F001-044/047)', () => {
  // REQ-F001-044(i-iii), tool-agnostic per ruling 1 (2026-07-09): the JS/TS raw-literal floor is
  // whatever `npm run lint:ds` invokes (ESLint's `no-restricted-syntax`, per the ruling — but this
  // test does not care which tool it is). It seeds a real fixture INTO `web/src/` (not an OS tmp
  // dir), because the gate command contract lints the `web/src` tree, not an arbitrary path, and runs
  // the actual command CI/`build` runs — never oxlint directly, never inspecting rule names.
  const GATE_FIXTURE = join(SRC_DIR, '__f001_gate_fixture__.tsx');

  function runLintDs(): boolean {
    // Returns true iff `npm run lint:ds` exits zero (i.e. the gate reports no violation).
    try {
      execSync('npm run lint:ds', { cwd: WEB_ROOT, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  it('a seeded raw-hex + raw-px + off-system font-family literal under web/src/ fails `npm run lint:ds`; clean code passes it (REQ-F001-044 i-iii)', () => {
    const scripts = readPackageScripts();
    if (!scripts['lint:ds']) {
      expect.fail(
        'package.json has no "lint:ds" script — the JS/TS gate command contract is not wired ' +
          '(REQ-F001-044 not fully wired, SPEC-DEFERRED)',
      );
      return;
    }
    try {
      // (i) raw hex color, (ii) raw px length, (iii) off-system font-family — all three rules in a
      // single throwaway fixture component, combined so one seeded file exercises the whole floor.
      writeFileSync(
        GATE_FIXTURE,
        [
          "export const GateFixtureBad = () => (",
          "  <div style={{ color: '#ff0000', padding: '12px', fontFamily: 'Comic Sans MS' }}>bad</div>",
          ");",
          '',
        ].join('\n'),
      );
      const violationPasses = runLintDs();
      expect(
        violationPasses,
        'REQ-F001-044(i-iii): a raw hex + raw px + off-system font-family literal in JS/TS must fail ' +
          '`npm run lint:ds` (non-zero exit) — regardless of which tool enforces it',
      ).toBe(false);

      writeFileSync(GATE_FIXTURE, 'export const GateFixtureGood = () => <div>ok</div>;\n');
      const cleanPasses = runLintDs();
      expect(
        cleanPasses,
        'gate-clean JS/TS (no raw hex/px/off-system font anywhere under web/src/) must NOT fail ' +
          '`npm run lint:ds`',
      ).toBe(true);
    } finally {
      rmSync(GATE_FIXTURE, { force: true });
    }
  });

  it('stylelint (adopted config) exits non-zero on a seeded raw-hex/px violation in a non-token .css file, including inside a --* declaration', () => {
    const bin = localBin('stylelint');
    if (!fileExists(STYLELINT_CONFIG) || !bin) {
      expect.fail(
        `stylelint gate not runnable yet (config exists: ${fileExists(STYLELINT_CONFIG)}, ` +
          `stylelint devDependency installed: ${Boolean(bin)}) — REQ-F001-047 not fully wired (SPEC-DEFERRED)`,
      );
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'f001-stylelint-'));
    try {
      // Mirrors the "re-host index.css as bridge.css" loophole (REQ-F001-026/047): a raw hex laundered
      // through a custom-property declaration in a NON-exempt file must still fail.
      const violation = join(dir, 'bridge.css');
      writeFileSync(violation, `:root {\n  --x: #ff0000;\n  padding: 12px;\n}\n`);
      let violationFailed = false;
      try {
        execSync(`"${bin}" --config "${STYLELINT_CONFIG}" "${violation}"`, { cwd: WEB_ROOT, stdio: 'pipe' });
      } catch {
        violationFailed = true;
      }
      expect(
        violationFailed,
        'a raw hex/px value in a non-exempt CSS file must fail the gate, even inside a --* declaration (REQ-F001-047)',
      ).toBe(true);

      const clean = join(dir, 'clean.css');
      writeFileSync(clean, `.foo {\n  color: var(--theme-text-primary);\n  padding: var(--space-2);\n}\n`);
      let cleanFailed = false;
      try {
        execSync(`"${bin}" --config "${STYLELINT_CONFIG}" "${clean}"`, { cwd: WEB_ROOT, stdio: 'pipe' });
      } catch {
        cleanFailed = true;
      }
      expect(cleanFailed, 'gate-clean CSS (var() only) must NOT fail the gate').toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
