// SPEC F-001 REQ-F001-045 (§5) — recreate PageHeader matching
// web/vendor/design-system/project/components/data-display/PageHeader.d.ts: `title` is the only
// REQUIRED prop; `description`/`action`/`className`/`style` are optional.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// PageHeader.tsx` exist (REQ-F001-045/015).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../index';

describe('PageHeader (REQ-F001-045, contract: data-display/PageHeader.d.ts)', () => {
  it('renders the required title', () => {
    render(<PageHeader title="Workspaces" />);
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
  });

  it('renders an optional description', () => {
    render(<PageHeader title="Users" description="Manage user accounts, roles, and access." />);
    expect(screen.getByText('Manage user accounts, roles, and access.')).toBeInTheDocument();
  });

  it('renders an optional action slot', () => {
    render(<PageHeader title="Diagnostics" action={<button type="button">Refresh</button>} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('renders with only the required title (description/action are optional)', () => {
    expect(() => render(<PageHeader title="Security" />)).not.toThrow();
  });
});
