// White-box unit tests for Badge (REQ-F001-045). Complements Badge.test.tsx (spec-level) by
// exercising the TONE_CLASS lookup branches directly: default tone ('info') when omitted, and each
// declared tone resolves to its OWN distinct class (guarding against a copy/paste mapping bug where
// every tone accidentally resolves to the same class).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../index';

const TONES = ['info', 'success', 'warn', 'danger', 'neutral'] as const;

describe('Badge (white-box)', () => {
  it('defaults to the "info" tone class when `tone` is omitted', () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText('x').className).toEqual(expect.stringContaining('info'));
  });

  it.each(TONES)('tone=%s resolves to its own class and no other tone class', (tone) => {
    render(<Badge tone={tone}>{tone}-label</Badge>);
    const classList = Array.from(screen.getByText(`${tone}-label`).classList);
    expect(classList.some((c) => c.includes(tone))).toBe(true);
    for (const other of TONES) {
      if (other !== tone) expect(classList.some((c) => c.includes(other))).toBe(false);
    }
  });
});
