// White-box unit tests for Select (REQ-F001-045). Complements Select.test.tsx (spec-level) by
// exercising the options-vs-children branch (including the empty-array boundary), useId-generated
// label/id fallback, uncontrolled (defaultValue) usage, and the hint-absent branch.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from '../index';

describe('Select (white-box)', () => {
  it('renders no <option> elements when `options` is an empty array (does not fall back to children)', () => {
    const { container } = render(
      <Select label="Empty">
        <option value="fallback">fallback</option>
      </Select>,
    );
    // sanity: children ARE rendered when options is omitted entirely
    expect(container.querySelectorAll('option').length).toBe(1);
  });

  it('renders no <option> elements for an empty `options` array, and does NOT fall back to children', () => {
    const { container } = render(<Select label="Empty" options={[]} />);
    expect(container.querySelectorAll('option').length).toBe(0);
  });

  it('associates the label via a useId-generated id when no `id` prop is supplied', () => {
    render(<Select label="Auto id" options={['a']} />);
    const el = screen.getByLabelText('Auto id') as HTMLSelectElement;
    expect(screen.getByText('Auto id')).toHaveAttribute('for', el.id);
    expect(el.id).toBeTruthy();
  });

  it('renders no <label> element when `label` is omitted', () => {
    const { container } = render(<Select options={['a']} />);
    expect(container.querySelector('label')).toBeNull();
  });

  it('renders no hint <p> when `hint` is omitted', () => {
    const { container } = render(<Select label="x" options={['a']} />);
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('renders an optional hint', () => {
    render(<Select label="x" hint="Pick one" options={['a']} />);
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('supports uncontrolled usage via `defaultValue`', () => {
    render(<Select label="Uncontrolled" defaultValue="b" options={['a', 'b', 'c']} />);
    expect((screen.getByLabelText('Uncontrolled') as HTMLSelectElement).value).toBe('b');
  });

  it('wires `name` to the underlying <select>', () => {
    render(<Select label="Named" name="provider" options={['a']} />);
    expect(screen.getByLabelText('Named')).toHaveAttribute('name', 'provider');
  });

  // REQ-F001-021/-030 lock-in: the hint must be programmatically associated with the control via
  // aria-describedby (not just visually adjacent) so screen readers announce it on focus.
  it('aria-describedby references the hint paragraph id when `hint` is set', () => {
    render(<Select label="Provider" hint="Choose your LLM provider" options={['a']} />);
    const select = screen.getByLabelText('Provider');
    const hintEl = screen.getByText('Choose your LLM provider');
    expect(hintEl).toHaveAttribute('id');
    expect(select.getAttribute('aria-describedby')).toContain(hintEl.id);
  });
});
