// SPEC REQ-097a — the console renders the BFF-provided { message } VERBATIM: no rewording, no
// trimming, no truncation, no re-casing.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner (REQ-097a)', () => {
  it('renders nothing for a null/undefined message', () => {
    const { container: c1 } = render(<ErrorBanner message={null} />);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<ErrorBanner message={undefined} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('renders an arbitrary BFF message string unchanged, including punctuation and casing', () => {
    const message = 'Engine returned HTTP 503: Service Temporarily Unavailable.';
    render(<ErrorBanner message={message} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert.textContent).toBe(message);
  });

  it('does not reword or truncate an unusual message shape', () => {
    const message = '  weird   spacing AND ALL-CAPS words 123!!!';
    render(<ErrorBanner message={message} />);
    expect(screen.getByRole('alert').textContent).toBe(message);
  });
});
