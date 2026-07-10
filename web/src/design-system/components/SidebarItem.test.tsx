// SPEC F-001 REQ-F001-045 (§5) — recreate SidebarItem matching
// web/vendor/design-system/project/components/navigation/SidebarItem.d.ts. `label` is the only
// REQUIRED prop. Serves the app-shell nav migration pattern (`.sidebar-item(.active)`,
// REQ-F001-016/019); App.tsx's `View`/`NAV` structure must be preserved (REQ-F001-002/008).
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// SidebarItem.tsx` exist (REQ-F001-045/015).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarItem } from '../index';

describe('SidebarItem (REQ-F001-045, contract: navigation/SidebarItem.d.ts)', () => {
  it('renders the required label', () => {
    render(<SidebarItem label="Users" />);
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('fires onClick', async () => {
    const onClick = vi.fn();
    render(<SidebarItem label="Workspaces" onClick={onClick} />);
    await userEvent.click(screen.getByText('Workspaces'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an optional icon', () => {
    render(<SidebarItem label="Diagnostics" icon={<svg data-testid="nav-icon" />} />);
    expect(screen.getByTestId('nav-icon')).toBeInTheDocument();
  });

  it('supports `active`, `caret`, `expanded`, `isChild` without throwing', () => {
    expect(() =>
      render(<SidebarItem label="LLM" active caret expanded isChild />),
    ).not.toThrow();
  });
});
