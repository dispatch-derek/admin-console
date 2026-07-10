// SPEC F-001 REQ-F001-045 (§5) — recreate Button matching
// web/vendor/design-system/project/components/forms/Button.d.ts and the oxlint allow-lists
// (REQ-F001-044 iv): `variant ∈ {cta,solid,ghost,danger,login}`, `size ∈ {sm,md,lg}`,
// `type ∈ {button,submit,reset}`.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// Button.tsx` exist (REQ-F001-045/015).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../index';

const VARIANTS = ['cta', 'solid', 'ghost', 'danger', 'login'] as const;
const SIZES = ['sm', 'md', 'lg'] as const;
const TYPES = ['button', 'submit', 'reset'] as const;

describe('Button (REQ-F001-045, contract: forms/Button.d.ts)', () => {
  it('renders children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it.each(VARIANTS)('accepts the declared variant %s without throwing', (variant) => {
    expect(() => render(<Button variant={variant}>x</Button>)).not.toThrow();
  });

  it.each(SIZES)('accepts the declared size %s without throwing', (size) => {
    expect(() => render(<Button size={size}>x</Button>)).not.toThrow();
  });

  it.each(TYPES)('accepts the declared type %s without throwing', (type) => {
    expect(() => render(<Button type={type}>x</Button>)).not.toThrow();
  });

  it('fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled Button does not fire onClick', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the optional icon slot alongside children', () => {
    render(<Button icon={<svg data-testid="icon" />}>Save</Button>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
  });
});
