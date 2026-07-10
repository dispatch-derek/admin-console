// SPEC F-001 REQ-F001-045 (§5) — recreate Input matching
// web/vendor/design-system/project/components/forms/Input.d.ts. Note (RISK-4,
// docs/design/F-001/01-component-contracts.md §3): the vendored contract does NOT declare
// `readOnly`/`min`/`max`/`onBlur`/`error`/`aria-*`, which current usages (SecretField, numeric-bounds
// validation REQ-035, `.field-error`) need. This test asserts only the DECLARED contract (label, hint,
// type, value/defaultValue, onChange, placeholder, name, disabled, required, id, className, style) —
// it deliberately does NOT assert on undeclared props, since REQ-F001-045 only requires each
// component to match its `.d.ts`. See TEST_PLAN.md ambiguity note on RISK-4.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// Input.tsx` exist (REQ-F001-045/015).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../index';

describe('Input (REQ-F001-045, contract: forms/Input.d.ts)', () => {
  it('renders an associated label', () => {
    render(<Input label="Username" id="username" />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('renders an optional hint', () => {
    render(<Input label="API key" hint="Never displayed after saving" />);
    expect(screen.getByText('Never displayed after saving')).toBeInTheDocument();
  });

  it('reflects a controlled `value` and fires onChange', async () => {
    const onChange = vi.fn();
    render(<Input label="Slug" value="my-workspace" onChange={onChange} />);
    const input = screen.getByLabelText('Slug') as HTMLInputElement;
    expect(input.value).toBe('my-workspace');
    await userEvent.type(input, 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('supports `type` (e.g. password for secret fields)', () => {
    render(<Input label="Secret" type="password" />);
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'password');
  });

  it('supports `disabled` and `required`', () => {
    render(<Input label="Locked" disabled required />);
    const input = screen.getByLabelText('Locked');
    expect(input).toBeDisabled();
    expect(input).toBeRequired();
  });

  it('supports `placeholder`, `name`, `className`', () => {
    render(<Input label="Env key" placeholder="KEY=value" name="envKey" className="extra" />);
    const input = screen.getByLabelText('Env key');
    expect(input).toHaveAttribute('placeholder', 'KEY=value');
    expect(input).toHaveAttribute('name', 'envKey');
  });
});
