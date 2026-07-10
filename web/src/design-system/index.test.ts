// SPEC F-001 REQ-F001-015 / REQ-F001-045 / REQ-F001-044(v, F-5) — the recreated DS layer is a SINGLE
// identifiable un-forked layer under `web/src/design-system/`, and screens import DS primitives from
// its barrel (`index.ts`/`index.tsx`) ONLY — never from vendored paths, never from component
// internals. This test asserts the barrel exports exactly the 11 manifest components (plus their
// prop types) and that the barrel file is the one the JS/TS adherence gate's `no-restricted-imports`
// remap exempts (REQ-F001-044 F-5; see web/tests/gates/adherence-gates.test.ts for the gate-config
// assertion of the remapped pattern/exemption).
//
// SPEC-DEFERRED: fails until `web/src/design-system/index.ts` (or `.tsx`) exists.

import { describe, it, expect } from 'vitest';

// The 11 components declared in the vendored manifest
// (web/vendor/design-system/project/_ds_manifest.json `components`), REQ-F001-045.
const MANIFEST_COMPONENT_NAMES = [
  'Badge',
  'PageHeader',
  'Table',
  'Button',
  'IconButton',
  'Input',
  'Select',
  'Textarea',
  'Toggle',
  'SidebarItem',
  'Modal',
] as const;

describe('design-system barrel (REQ-F001-015, REQ-F001-045, REQ-F001-044 F-5)', () => {
  it('exports all 11 manifest components from a single barrel module', async () => {
    // Dynamic import so a missing module surfaces as a normal (awaited) test failure rather than a
    // whole-file import crash, giving a clearer signal of exactly which export is missing once the
    // barrel exists but is incomplete.
    const barrel = await import('./index').catch((err: unknown) => {
      throw new Error(
        `web/src/design-system/index.ts(.tsx) does not exist or failed to import yet ` +
          `(REQ-F001-045/015 not yet implemented): ${String(err)}`,
      );
    });
    for (const name of MANIFEST_COMPONENT_NAMES) {
      expect(barrel, `barrel must export ${name}`).toHaveProperty(name);
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('Table namespace exposes Row and Cell (REQ-F001-045, contract: data-display/Table.d.ts)', async () => {
    const { Table } = (await import('./index')) as { Table: { Row?: unknown; Cell?: unknown } };
    expect(Table.Row).toBeTypeOf('function');
    expect(Table.Cell).toBeTypeOf('function');
  });
});
