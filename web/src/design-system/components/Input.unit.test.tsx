// White-box unit tests for Input (REQ-F001-045). Complements Input.test.tsx (spec-level, which
// deliberately only asserts the vendored .d.ts contract) by exercising the RISK-4 adopted-contract
// extensions (web/src/bridge/README.md §3): readOnly, min/max/step/inputMode, autoComplete, onBlur,
// error/aria-invalid/aria-describedby — plus the useId-generated label/id fallback and uncontrolled
// (defaultValue) usage.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../index';

describe('Input (white-box, RISK-4 extensions)', () => {
  it('associates the label via a useId-generated id when no `id` prop is supplied', () => {
    render(<Input label="Auto id" />);
    const input = screen.getByLabelText('Auto id') as HTMLInputElement;
    const label = screen.getByText('Auto id');
    expect(label).toHaveAttribute('for', input.id);
    expect(input.id).toBeTruthy();
  });

  it('renders no <label> element when `label` is omitted', () => {
    const { container } = render(<Input placeholder="no label" />);
    expect(container.querySelector('label')).toBeNull();
  });

  it('renders no hint <p> when `hint` is omitted', () => {
    const { container } = render(<Input label="x" />);
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('supports uncontrolled usage via `defaultValue`', () => {
    render(<Input label="Uncontrolled" defaultValue="initial" />);
    expect((screen.getByLabelText('Uncontrolled') as HTMLInputElement).value).toBe('initial');
  });

  it('wires `readOnly` to the underlying <input> and blocks edits', async () => {
    const onChange = vi.fn();
    render(<Input label="RO" value="fixed" readOnly onChange={onChange} />);
    const input = screen.getByLabelText('RO') as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
    await userEvent.type(input, 'x');
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('fixed');
  });

  it('wires `min`/`max`/`step` to the underlying <input>', () => {
    render(<Input label="Bounded" type="number" min={0} max={10} step={2} />);
    const input = screen.getByLabelText('Bounded');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '10');
    expect(input).toHaveAttribute('step', '2');
  });

  it('wires `inputMode` to the underlying <input>', () => {
    render(<Input label="OTP" inputMode="numeric" />);
    expect(screen.getByLabelText('OTP')).toHaveAttribute('inputmode', 'numeric');
  });

  it('wires `autoComplete` to the underlying <input>', () => {
    render(<Input label="Password" type="password" autoComplete="current-password" />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('fires `onBlur` when the field loses focus', async () => {
    const onBlur = vi.fn();
    render(<Input label="Field" onBlur={onBlur} />);
    const input = screen.getByLabelText('Field');
    input.focus();
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('renders the `error` message and defaults aria-invalid to true when unset', () => {
    render(<Input label="Key" error="Key is required" />);
    expect(screen.getByText('Key is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Key')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not render an error paragraph when `error` is unset', () => {
    const { container } = render(<Input label="Key" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('an explicit `aria-invalid` overrides the error-derived default', () => {
    render(<Input label="Key" error="ignored for aria" aria-invalid={false} />);
    expect(screen.getByLabelText('Key')).toHaveAttribute('aria-invalid', 'false');
  });

  it('wires `aria-describedby` to the underlying <input>', () => {
    render(<Input label="Key" aria-describedby="key-hint" />);
    expect(screen.getByLabelText('Key')).toHaveAttribute('aria-describedby', 'key-hint');
  });

  // REQ-F001-021/-030 lock-in: hint/error must be programmatically associated with the control
  // (not just visually adjacent), so screen readers announce them on focus.
  it('aria-describedby references the hint paragraph id when `hint` is set', () => {
    render(<Input label="Key" hint="Must be 32 characters" />);
    const input = screen.getByLabelText('Key');
    const hintEl = screen.getByText('Must be 32 characters');
    expect(hintEl).toHaveAttribute('id');
    expect(input.getAttribute('aria-describedby')).toContain(hintEl.id);
  });

  it('aria-describedby references the error paragraph id when `error` is set', () => {
    render(<Input label="Key" error="Key is required" />);
    const input = screen.getByLabelText('Key');
    const errorEl = screen.getByText('Key is required');
    expect(errorEl).toHaveAttribute('id');
    expect(input.getAttribute('aria-describedby')).toContain(errorEl.id);
  });

  it('aria-describedby references BOTH the hint and error ids when both are set', () => {
    render(<Input label="Key" hint="32 chars" error="Key is required" />);
    const input = screen.getByLabelText('Key');
    const hintEl = screen.getByText('32 chars');
    const errorEl = screen.getByText('Key is required');
    const describedBy = input.getAttribute('aria-describedby')!;
    expect(describedBy).toContain(hintEl.id);
    expect(describedBy).toContain(errorEl.id);
  });

  it('aria-invalid is not set when `error` is absent (and no explicit aria-invalid given)', () => {
    render(<Input label="Key" />);
    expect(screen.getByLabelText('Key')).not.toHaveAttribute('aria-invalid');
  });
});
