// White-box unit tests for Textarea (REQ-F001-045). Complements Textarea.test.tsx (spec-level) by
// exercising the RISK-4 adopted-contract extensions (web/src/bridge/README.md §3) needed by the
// raw/code-editor bridge (REQ-F001-046): `readOnly`, `spellCheck` — plus useId-generated label/id
// fallback, uncontrolled (defaultValue) usage, and the hint-absent branch.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '../index';

describe('Textarea (white-box, RISK-4 extensions)', () => {
  it('associates the label via a useId-generated id when no `id` prop is supplied', () => {
    render(<Textarea label="Auto id" />);
    const el = screen.getByLabelText('Auto id') as HTMLTextAreaElement;
    expect(screen.getByText('Auto id')).toHaveAttribute('for', el.id);
    expect(el.id).toBeTruthy();
  });

  it('renders no <label> element when `label` is omitted', () => {
    const { container } = render(<Textarea placeholder="no label" />);
    expect(container.querySelector('label')).toBeNull();
  });

  it('renders no hint <p> when `hint` is omitted', () => {
    const { container } = render(<Textarea label="x" />);
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('supports uncontrolled usage via `defaultValue`', () => {
    render(<Textarea label="Uncontrolled" defaultValue="initial text" />);
    expect((screen.getByLabelText('Uncontrolled') as HTMLTextAreaElement).value).toBe('initial text');
  });

  it('defaults `rows` to 3 when omitted', () => {
    render(<Textarea label="Defaults" />);
    expect(screen.getByLabelText('Defaults')).toHaveAttribute('rows', '3');
  });

  it('wires `readOnly` to the underlying <textarea> and blocks edits', async () => {
    const onChange = vi.fn();
    render(<Textarea label="RO" value="fixed" readOnly onChange={onChange} />);
    const el = screen.getByLabelText('RO') as HTMLTextAreaElement;
    expect(el).toHaveAttribute('readonly');
    await userEvent.type(el, 'x');
    expect(onChange).not.toHaveBeenCalled();
    expect(el.value).toBe('fixed');
  });

  it('wires `spellCheck={false}` to the underlying <textarea>', () => {
    render(<Textarea label="Code" spellCheck={false} />);
    expect(screen.getByLabelText('Code')).toHaveAttribute('spellcheck', 'false');
  });

  it('wires `spellCheck={true}` to the underlying <textarea>', () => {
    render(<Textarea label="Prose" spellCheck={true} />);
    expect(screen.getByLabelText('Prose')).toHaveAttribute('spellcheck', 'true');
  });

  // REQ-F001-021/-030 lock-in: the hint must be programmatically associated with the control via
  // aria-describedby (not just visually adjacent) so screen readers announce it on focus.
  it('aria-describedby references the hint paragraph id when `hint` is set', () => {
    render(<Textarea label="Raw env" hint="One KEY=value pair per line" />);
    const textarea = screen.getByLabelText('Raw env');
    const hintEl = screen.getByText('One KEY=value pair per line');
    expect(hintEl).toHaveAttribute('id');
    expect(textarea.getAttribute('aria-describedby')).toContain(hintEl.id);
  });
});
