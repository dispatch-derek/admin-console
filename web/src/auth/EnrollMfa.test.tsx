// SPEC §3.2 / REQ-017 — MFA enrollment: QR (data-URI <img>) + secret display, code confirm against
// the pending secret, then a one-time recovery-code reveal gated behind an explicit
// acknowledgement before the session proceeds.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnrollMfa } from './EnrollMfa';
import { ApiError } from '../api/errors';
import * as api from '../api/client';

vi.mock('../api/client');
const mockedApi = vi.mocked(api);

describe('EnrollMfa (REQ-017)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('falls back to manual-entry guidance when no QR is provided', () => {
    render(
      <EnrollMfa challengeId="c1" secret="ABCDEF" qr={undefined} onComplete={vi.fn()} />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('QR code unavailable — use the secret below for manual entry.')).toBeInTheDocument();
    expect(screen.getByText('ABCDEF')).toBeInTheDocument();
  });

  it('renders the BFF { message } verbatim on a failed code confirm (REQ-097a)', async () => {
    mockedApi.enroll.mockRejectedValue(new ApiError('Invalid authenticator code', 400));
    render(<EnrollMfa challengeId="c1" secret="ABCDEF" onComplete={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Authenticator code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm code' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid authenticator code');
    // Recovery codes must NOT be shown on a failed confirm.
    expect(screen.queryByText('Save your recovery codes')).not.toBeInTheDocument();
  });

  it('does not call onComplete before the recovery codes are acknowledged', async () => {
    mockedApi.enroll.mockResolvedValue({
      recoveryCodes: ['code-1'],
      staff: {
        id: 's1',
        username: 'bob',
        mfaEnrolled: true,
        disabled: false,
        mustSetPassword: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
    });
    const onComplete = vi.fn();
    render(<EnrollMfa challengeId="c1" secret="ABCDEF" onComplete={onComplete} />);

    await userEvent.type(screen.getByLabelText('Authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm code' }));

    await screen.findByText('Save your recovery codes');
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue to console' })).toBeDisabled();
  });
});
