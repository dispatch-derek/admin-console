// SPEC §3.2 — the login FSM: factor-1 (username+password) yields a stage; the UI branches on
// `stage` to 'mfa' (code entry), 'enroll' (QR/secret + code confirm + recovery-code reveal), or
// 'setPassword' (new-password step). A failed login renders the BFF { message } verbatim via
// ErrorBanner, unchanged (REQ-097a).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
import { ApiError } from '../api/errors';
import * as api from '../api/client';

vi.mock('../api/client');

const mockedApi = vi.mocked(api);

async function fillCredentials(username = 'alice', password = 'hunter2') {
  await userEvent.type(screen.getByLabelText('Username'), username);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage (SPEC §3.2)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the MFA code entry when login yields stage:"mfa"', async () => {
    mockedApi.login.mockResolvedValue({ stage: 'mfa', challengeId: 'chal-1' });
    render(<LoginPage onAuthenticated={vi.fn()} />);

    await fillCredentials();

    expect(await screen.findByText('Enter your authenticator code')).toBeInTheDocument();
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
  });

  it('renders EnrollMfa (QR image + secret + code-confirm form) when stage:"enroll"', async () => {
    mockedApi.login.mockResolvedValue({
      stage: 'enroll',
      challengeId: 'chal-2',
      secret: 'JBSWY3DPEHPK3PXP',
      qr: 'data:image/png;base64,abc123',
      otpauthUri: 'otpauth://totp/AdminConsole:alice?secret=JBSWY3DPEHPK3PXP',
    });
    render(<LoginPage onAuthenticated={vi.fn()} />);

    await fillCredentials();

    expect(await screen.findByText('Set up two-factor authentication')).toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'TOTP enrollment QR code' });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
  });

  it('renders the new-password step when stage:"setPassword"', async () => {
    mockedApi.login.mockResolvedValue({ stage: 'setPassword', challengeId: 'chal-3' });
    render(<LoginPage onAuthenticated={vi.fn()} />);

    await fillCredentials();

    expect(await screen.findByText('Set a new password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('renders the BFF { message } verbatim via ErrorBanner on a failed login (REQ-097a)', async () => {
    mockedApi.login.mockRejectedValue(new ApiError('Invalid username or password', 401));
    render(<LoginPage onAuthenticated={vi.fn()} />);

    await fillCredentials();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid username or password');
  });

  it('completes the enroll → recovery-code-reveal → onAuthenticated flow end to end', async () => {
    mockedApi.login.mockResolvedValue({
      stage: 'enroll',
      challengeId: 'chal-4',
      secret: 'SECRET',
      qr: 'data:image/png;base64,xyz',
    });
    mockedApi.enroll.mockResolvedValue({
      recoveryCodes: ['aaa-111', 'bbb-222'],
      staff: {
        id: 's1',
        username: 'alice',
        mfaEnrolled: true,
        disabled: false,
        mustSetPassword: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
    });
    const onAuthenticated = vi.fn();
    render(<LoginPage onAuthenticated={onAuthenticated} />);

    await fillCredentials();
    await userEvent.type(await screen.findByLabelText('Authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm code' }));

    expect(await screen.findByText('Save your recovery codes')).toBeInTheDocument();
    expect(screen.getByText('aaa-111')).toBeInTheDocument();
    expect(screen.getByText('bbb-222')).toBeInTheDocument();

    const continueButton = screen.getByRole('button', { name: 'Continue to console' });
    expect(continueButton).toBeDisabled();
    expect(onAuthenticated).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'I have saved these recovery codes' }));
    expect(continueButton).toBeEnabled();

    await userEvent.click(continueButton);
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', username: 'alice' }),
    );
  });
});
