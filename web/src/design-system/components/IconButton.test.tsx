// SPEC F-001 REQ-F001-045 (§5) — recreate IconButton matching
// web/vendor/design-system/project/components/forms/IconButton.d.ts and the oxlint allow-list
// (REQ-F001-044 iv): `shape ∈ {square,circle}`, `variant ∈ {default,menu}`.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// IconButton.tsx` exist (REQ-F001-045/015).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from '../index';

const SHAPES = ['square', 'circle'] as const;
const VARIANTS = ['default', 'menu'] as const;

describe('IconButton (REQ-F001-045, contract: forms/IconButton.d.ts)', () => {
  it('renders its children (icon content)', () => {
    render(
      <IconButton title="Close">
        <svg data-testid="x-icon" />
      </IconButton>,
    );
    expect(screen.getByTestId('x-icon')).toBeInTheDocument();
  });

  it.each(SHAPES)('accepts the declared shape %s without throwing', (shape) => {
    expect(() => render(<IconButton shape={shape} />)).not.toThrow();
  });

  it.each(VARIANTS)('accepts the declared variant %s without throwing', (variant) => {
    expect(() => render(<IconButton variant={variant} />)).not.toThrow();
  });

  it('exposes an accessible name via `title` for icon-only affordance (REQ-F001-030 non-regression)', () => {
    render(<IconButton title="Expand section" />);
    expect(screen.getByTitle('Expand section')).toBeInTheDocument();
  });

  it('fires onClick', async () => {
    const onClick = vi.fn();
    render(<IconButton title="Menu" onClick={onClick} />);
    await userEvent.click(screen.getByTitle('Menu'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
