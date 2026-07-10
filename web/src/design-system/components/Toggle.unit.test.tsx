// White-box unit tests for Toggle (REQ-F001-045). Complements Toggle.test.tsx (spec-level) by
// exercising: the default 'default' variant layout, the horizontal-variant DOM ORDER (text before
// switch) vs default order (switch before text), the on/off track token used per `enabled` (RISK-3
// note in Toggle.tsx: uses tokens defined in BOTH themes), and the label/description-absent branch.
// Also locks in the REQ-F001-021/-030 keyboard-operability fix: the `role="switch"` div is
// keyboard-focusable (`tabIndex=0`, `-1` when disabled) and toggles on Space/Enter, not just click.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '../index';

describe('Toggle (white-box)', () => {
  it('renders only the switch (no text wrapper) when label and description are both omitted', () => {
    const { container } = render(<Toggle enabled />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
    // no span carrying label/description text should exist
    expect(container.querySelectorAll('span').length).toBe(1); // just the knob span
  });

  it('default variant renders the switch before the label text in DOM order', () => {
    render(<Toggle label="Telemetry" variant="default" />);
    const wrapper = screen.getByRole('switch').parentElement!;
    const children = Array.from(wrapper.children);
    expect(children[0]).toBe(screen.getByRole('switch'));
    expect(children[1].textContent).toContain('Telemetry');
  });

  it('horizontal variant renders the label text before the switch in DOM order', () => {
    render(<Toggle label="Telemetry" variant="horizontal" />);
    const wrapper = screen.getByRole('switch').parentElement!;
    const children = Array.from(wrapper.children);
    expect(children[0].textContent).toContain('Telemetry');
    expect(children[1]).toBe(screen.getByRole('switch'));
  });

  it('uses the "on" track token when enabled', () => {
    render(<Toggle enabled label="x" />);
    expect(screen.getByRole('switch')).toHaveStyle({ background: 'var(--theme-badge-success-text)' });
  });

  it('uses the "off" track token when not enabled', () => {
    render(<Toggle enabled={false} label="x" />);
    expect(screen.getByRole('switch')).toHaveStyle({ background: 'var(--theme-placeholder)' });
  });

  it('reduces opacity and shows not-allowed cursor when disabled', () => {
    render(<Toggle disabled label="x" />);
    const track = screen.getByRole('switch');
    expect(track).toHaveStyle({ opacity: '0.5', cursor: 'not-allowed' });
  });

  it('full opacity and pointer cursor when not disabled', () => {
    render(<Toggle label="x" />);
    const track = screen.getByRole('switch');
    expect(track).toHaveStyle({ opacity: '1', cursor: 'pointer' });
  });

  it('applies a lg-specific label class only at size="lg"', () => {
    const { rerender } = render(<Toggle label="Big" size="lg" />);
    expect(screen.getByText('Big').className).toEqual(expect.stringContaining('labelLg'));
    rerender(<Toggle label="Big" size="md" />);
    expect(screen.getByText('Big').className).not.toEqual(expect.stringContaining('labelLg'));
  });

  it('is keyboard-focusable (tabIndex=0) when enabled for interaction', () => {
    render(<Toggle label="Telemetry" />);
    expect(screen.getByRole('switch')).toHaveAttribute('tabindex', '0');
  });

  it('is removed from the tab order (tabIndex=-1) when disabled', () => {
    render(<Toggle label="Telemetry" disabled />);
    expect(screen.getByRole('switch')).toHaveAttribute('tabindex', '-1');
  });

  it('toggles via keyboard Space, calling onChange with the negated value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle enabled={false} onChange={onChange} label="Feature" />);
    const el = screen.getByRole('switch');
    el.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles via keyboard Enter, calling onChange with the negated value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle enabled={true} onChange={onChange} label="Feature" />);
    const el = screen.getByRole('switch');
    el.focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disabled Toggle does not fire onChange on keyboard activation', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle enabled={false} onChange={onChange} disabled label="Feature" />);
    const el = screen.getByRole('switch');
    el.focus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });
});
