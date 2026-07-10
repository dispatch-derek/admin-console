// SPEC F-001 REQ-F001-045 (§5) — recreate the 11 DS components as production React/TS, matching
// each component's vendored `.d.ts` prop contract (web/vendor/design-system/project/components/
// data-display/Badge.d.ts) and the oxlint prop/variant allow-list (REQ-F001-044 iv:
// `Badge.tone ∈ {info,success,warn,danger,neutral}`).
//
// SPEC-DEFERRED: this file imports from the not-yet-created `web/src/design-system` barrel
// (REQ-F001-045/015) and WILL fail at import time until that barrel + `components/Badge.tsx` exist.
// That is expected per the F-001 QA brief: tests are written to PASS once a correct implementation
// lands, not against a guessed implementation shape.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../index';

const TONES = ['info', 'success', 'warn', 'danger', 'neutral'] as const;

describe('Badge (REQ-F001-045, contract: data-display/Badge.d.ts)', () => {
  it('renders children content', () => {
    render(<Badge>set</Badge>);
    expect(screen.getByText('set')).toBeInTheDocument();
  });

  it.each(TONES)('accepts the declared tone value %s without throwing', (tone) => {
    expect(() => render(<Badge tone={tone}>label</Badge>)).not.toThrow();
  });

  it('accepts className and style per the declared contract', () => {
    render(
      <Badge tone="success" className="extra-class" style={{ opacity: 1 }}>
        ok
      </Badge>,
    );
    const el = screen.getByText('ok');
    expect(el.className).toEqual(expect.stringContaining('extra-class'));
  });

  it('renders with no children (all Badge props are optional per the contract)', () => {
    expect(() => render(<Badge />)).not.toThrow();
  });
});
