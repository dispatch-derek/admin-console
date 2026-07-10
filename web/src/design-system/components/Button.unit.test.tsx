// White-box unit tests for Button (REQ-F001-045). Complements Button.test.tsx (spec-level) by
// exercising internal branches: the VARIANT_CLASS/SIZE_CLASS lookup maps, the `full` modifier, the
// default-prop fallbacks (variant='cta', size='md', type='button'), className composition, and the
// RISK-4 `title`/`aria-label` extensions (web/src/bridge/README.md §3).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../index';

describe('Button (white-box)', () => {
  it('applies the default variant/size classes when omitted (cta/md)', () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn.className).toEqual(expect.stringContaining('cta'));
    expect(btn.className).toEqual(expect.stringContaining('md'));
  });

  it('defaults type to "button" when omitted', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button');
  });

  it('applies the full-width modifier class only when `full` is true', () => {
    const { rerender } = render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).not.toEqual(expect.stringContaining('full'));
    rerender(<Button full>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toEqual(expect.stringContaining('full'));
  });

  it('merges a caller-supplied className with the internal classes (does not replace them)', () => {
    render(
      <Button variant="danger" className="my-extra">
        Delete
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.className).toEqual(expect.stringContaining('danger'));
    expect(btn.className).toEqual(expect.stringContaining('my-extra'));
  });

  it('wires `title` through to the underlying <button> (RISK-4 a11y extension)', () => {
    render(<Button title="Save changes">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('title', 'Save changes');
  });

  it('wires `aria-label` through to the underlying <button> (RISK-4 a11y extension)', () => {
    render(
      <Button aria-label="Close panel">
        <svg data-testid="icon" />
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument();
  });

  it('applies the given `style` prop as inline style', () => {
    render(<Button style={{ marginTop: '1rem' }}>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveStyle({ marginTop: '1rem' });
  });

  it('renders with an icon and no children without throwing (icon-only usage)', () => {
    expect(() => render(<Button icon={<svg data-testid="only-icon" />} aria-label="Icon only" />)).not.toThrow();
    expect(screen.getByTestId('only-icon')).toBeInTheDocument();
  });

  it('does not fire onClick when disabled, even on repeated clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
