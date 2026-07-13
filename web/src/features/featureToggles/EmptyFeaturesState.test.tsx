// White-box unit test for EmptyFeaturesState (src/features/featureToggles/EmptyFeaturesState.tsx,
// REQ-F005-024/036). This is a static, prop-less component only ever exercised indirectly through
// FeatureTogglesPage.test.tsx (the qa-engineer's page-level suite) when its zero-features branch is
// hit; this file pins the component's own contract directly: it renders as role="status" (never an
// error/alert) with the exact first-class empty-state copy, so a future refactor of the page-level
// branch condition can't silently swap in an ErrorBanner or drop the "no features" messaging.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyFeaturesState } from './EmptyFeaturesState';

describe('EmptyFeaturesState (REQ-F005-024/036)', () => {
  it('renders as a role="status" panel, not an alert/error', () => {
    render(<EmptyFeaturesState />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the exact first-class empty-state title copy', () => {
    render(<EmptyFeaturesState />);
    expect(screen.getByText('No features are defined for this install yet.')).toBeInTheDocument();
  });

  it('shows explanatory help copy alongside the title', () => {
    render(<EmptyFeaturesState />);
    expect(
      screen.getByText(/Features declared by the customer-facing codebase will appear here/),
    ).toBeInTheDocument();
  });
});
