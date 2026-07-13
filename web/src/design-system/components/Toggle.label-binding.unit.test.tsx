// White-box unit tests for the DS `Toggle` label-binding extension (REQ-F005-054). Complements
// Toggle.a11y-label.test.tsx (which pins the WITH-label accessible-name contract) by covering two
// branches that file does not: the label-ABSENT render path (aria-labelledby must not be emitted
// pointing at nothing), and that the generated label id is STABLE across re-renders of the same
// mounted instance (a regression here — e.g. swapping useId() for something re-derived per render —
// would silently break the aria-labelledby reference on every subsequent render).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toggle } from '../index';

describe('Toggle — label-absent render path (REQ-F005-054 boundary)', () => {
  it('omits aria-labelledby entirely when no label prop is given', () => {
    render(<Toggle enabled />);
    const el = screen.getByRole('switch');
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('a description with no label still omits aria-labelledby (only `label` binds the accessible name)', () => {
    render(<Toggle enabled description="Some description text" />);
    const el = screen.getByRole('switch');
    expect(el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('a switch with no label has no accessible name derivable from a labelledby id', () => {
    render(<Toggle enabled />);
    // getByRole with a `name` filter should fail to find it under any non-empty name.
    expect(screen.queryByRole('switch', { name: /.+/ })).toBeNull();
  });
});

describe('Toggle — aria-labelledby id stability across re-renders (REQ-F005-054)', () => {
  it('the labelledby id (and the referenced element it resolves to) is UNCHANGED across a re-render with new props', () => {
    const { rerender } = render(<Toggle enabled={false} label="Invoice viewer" />);
    const el = screen.getByRole('switch');
    const firstId = el.getAttribute('aria-labelledby');
    expect(firstId).toBeTruthy();

    rerender(<Toggle enabled={true} label="Invoice viewer" />);
    const secondId = screen.getByRole('switch').getAttribute('aria-labelledby');
    expect(secondId).toBe(firstId);
    // The accessible name keeps resolving correctly after the re-render (not just the same id string
    // by coincidence — the id must still reference a live label element).
    expect(screen.getByRole('switch', { name: 'Invoice viewer' })).toBeInTheDocument();
  });

  it('changing the label TEXT (same instance) keeps the same id but updates the resolved accessible name', () => {
    const { rerender } = render(<Toggle enabled={false} label="Old name" />);
    const firstId = screen.getByRole('switch').getAttribute('aria-labelledby');

    rerender(<Toggle enabled={false} label="New name" />);
    const el = screen.getByRole('switch');
    expect(el.getAttribute('aria-labelledby')).toBe(firstId);
    expect(screen.getByRole('switch', { name: 'New name' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Old name' })).toBeNull();
  });
});
