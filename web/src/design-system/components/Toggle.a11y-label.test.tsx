// SPEC REQ-F005-054 (specs/F-005-per-customer-feature-toggle-console.md §8, human ruling RATIFIED
// 2026-07-12, resolving the ux-designer's OQ-1). The existing web/src/design-system/components/
// Toggle.test.tsx (F-001, REQ-F001-045) pins the component's baseline `.d.ts` contract and is left
// untouched by this agent (owned by the F-001 test surface); this is a NEW, additive file asserting
// the F-005-driven extension: the DS `Toggle` renders `role="switch"` but does NOT currently bind its
// `label` prop to the switch element programmatically (an "unnamed switch" to assistive technology).
// REQ-F005-054 requires the Toggle contract to be extended (e.g. via `aria-labelledby` referencing
// the rendered label) so every switch has a programmatic accessible name equal to its label — NOT
// via a per-usage-site `aria-label` override.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toggle } from '../index';

describe('Toggle — programmatic accessible name (REQ-F005-054)', () => {
  it("the switch's computed accessible name equals the `label` prop", () => {
    render(<Toggle enabled={false} label="Invoice viewer" />);
    // getByRole with an accessible-name filter fails to find the control unless the name is bound
    // programmatically (jsdom/testing-library compute this via the standard accname algorithm,
    // which respects aria-labelledby/aria-label but NOT sibling text with no association).
    expect(screen.getByRole('switch', { name: 'Invoice viewer' })).toBeInTheDocument();
  });

  it('the name is delivered via aria-labelledby referencing the rendered label element, not a bare aria-label', () => {
    render(<Toggle enabled={false} label="Chat export" />);
    const el = screen.getByRole('switch');
    const labelledBy = el.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(el.getAttribute('aria-label')).toBeNull();
    const labelEl = document.getElementById(labelledBy!);
    expect(labelEl).not.toBeNull();
    expect(labelEl!.textContent).toBe('Chat export');
  });

  it('two Toggles on the same page get DISTINCT accessible names matching their own label (no id collision)', () => {
    render(
      <>
        <Toggle enabled={false} label="Feature A" />
        <Toggle enabled={true} label="Feature B" />
      </>,
    );
    expect(screen.getByRole('switch', { name: 'Feature A' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Feature B' })).toHaveAttribute('aria-checked', 'true');
  });
});
