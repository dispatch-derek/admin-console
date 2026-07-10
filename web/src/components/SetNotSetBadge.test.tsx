// SPEC parent REQ-060 (secret set/not-set indicator) + F-001 REQ-F001-011/020 — SetNotSetBadge is
// one of the three shared components F-001 migrates onto the recreated DS `Badge` primitive
// WITHOUT changing its contract or behavior: it must keep showing set/not-set semantics and must
// NEVER reveal a secret value, before or after migration.
//
// Unlike the design-system component tests (which target the not-yet-created `web/src/design-system`
// barrel), this file targets the EXISTING, already-implemented `./SetNotSetBadge` module. It fills a
// baseline-coverage gap (this component had no dedicated test file) and is expected to PASS today
// against the current implementation, and to keep passing unchanged after the DS migration
// re-expresses it on `<Badge tone="success"|"neutral">` (REQ-F001-020) — this is the concrete
// behavior-preservation regression guard REQ-F001-021 relies on for this component.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetNotSetBadge } from './SetNotSetBadge';

describe('SetNotSetBadge (parent REQ-060; F-001 REQ-F001-011/020)', () => {
  it('renders "set" when set=true', () => {
    render(<SetNotSetBadge set={true} />);
    expect(screen.getByText('set')).toBeInTheDocument();
  });

  it('renders "not set" when set=false', () => {
    render(<SetNotSetBadge set={false} />);
    expect(screen.getByText('not set')).toBeInTheDocument();
  });

  it('the component contract has no prop through which a secret value could be passed (never reveals a secret)', () => {
    // The declared props are exactly `{ set: boolean }` — there is no `value`/`secret`/`revealed`
    // prop, so structurally no caller can hand this component a secret to render. This is the
    // regression guard for REQ-F001-011/020's "SetNotSetBadge never reveals a secret value": any
    // future migration that adds such a prop, or otherwise renders arbitrary child content, would
    // need to change this test.
    // @ts-expect-error -- intentionally probing an undeclared prop to confirm it has no effect.
    render(<SetNotSetBadge set={true} value="super-secret-api-key" />);
    expect(screen.queryByText(/super-secret-api-key/)).not.toBeInTheDocument();
  });

  it('renders exactly one of the two known states, never both, never empty', () => {
    const { rerender } = render(<SetNotSetBadge set={true} />);
    expect(screen.queryByText('not set')).not.toBeInTheDocument();
    rerender(<SetNotSetBadge set={false} />);
    expect(screen.queryByText(/^set$/)).not.toBeInTheDocument();
  });
});
