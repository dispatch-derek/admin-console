// SPEC F-001 REQ-F001-045 (§5) — recreate Toggle matching
// web/vendor/design-system/project/components/forms/Toggle.d.ts and the oxlint allow-list
// (REQ-F001-044 iv): `size ∈ {sm,md,lg}`, `variant ∈ {default,horizontal}`. Behavior carried
// faithfully from the vendored prototype (docs/design/F-001/01-component-contracts.md §1): renders
// `role="switch"` + `aria-checked`; `onChange(next: boolean)` receives the NEXT state, not the
// current one.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '../index';

const SIZES = ['sm', 'md', 'lg'] as const;
const VARIANTS = ['default', 'horizontal'] as const;

describe('Toggle (REQ-F001-045, contract: forms/Toggle.d.ts)', () => {
  it('renders role="switch" with aria-checked reflecting `enabled`', () => {
    render(<Toggle enabled={true} label="Telemetry" />);
    const el = screen.getByRole('switch');
    expect(el).toHaveAttribute('aria-checked', 'true');
  });

  it('aria-checked is false when `enabled` is false (or omitted, default false)', () => {
    render(<Toggle label="Telemetry" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('onChange receives the NEXT boolean state, not the current one', async () => {
    const onChange = vi.fn();
    render(<Toggle enabled={false} onChange={onChange} label="Feature" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disabled Toggle does not fire onChange', async () => {
    const onChange = vi.fn();
    render(<Toggle enabled={false} disabled onChange={onChange} label="Feature" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(SIZES)('accepts the declared size %s without throwing', (size) => {
    expect(() => render(<Toggle size={size} label={`size-${size}`} />)).not.toThrow();
  });

  it.each(VARIANTS)('accepts the declared variant %s without throwing', (variant) => {
    expect(() => render(<Toggle variant={variant} label={`variant-${variant}`} />)).not.toThrow();
  });

  it('renders an optional description', () => {
    render(<Toggle label="Advanced mode" description="Enables raw environment editing." />);
    expect(screen.getByText('Enables raw environment editing.')).toBeInTheDocument();
  });
});
