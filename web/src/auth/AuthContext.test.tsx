// SPEC §3.2 / REQ-012/014 — AuthContext calls GET /api/auth/me on mount to establish who the
// current staff is, and registers the global 401 handler so ANY unauthorized response anywhere
// clears session state and drops the user back to the login screen.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { ApiError } from '../api/errors';
import * as api from '../api/client';

vi.mock('../api/client');
const mockedApi = vi.mocked(api);

const STAFF = {
  id: 's1',
  username: 'alice',
  mfaEnrolled: true,
  disabled: false,
  mustSetPassword: false,
  createdAt: '2026-01-01T00:00:00Z',
};

function Probe() {
  const { staff, loading } = useAuth();
  if (loading) return <p>loading</p>;
  return <p>{staff ? `signed-in:${staff.username}` : 'signed-out'}</p>;
}

describe('AuthContext (REQ-012/014)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // setUnauthorizedHandler is the real (non-mocked-behavior) function under test's wiring;
    // vi.mock() auto-mocks it too, so give it a no-op implementation by default.
    mockedApi.setUnauthorizedHandler.mockImplementation(() => {});
  });

  it('calls me() on mount and establishes the session on success', async () => {
    mockedApi.me.mockResolvedValue({ staff: STAFF });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('signed-in:alice')).toBeInTheDocument();
    expect(mockedApi.me).toHaveBeenCalledOnce();
  });

  it('treats a failed me() (e.g. 401 before any session) as signed-out', async () => {
    mockedApi.me.mockRejectedValue(new ApiError('Unauthorized', 401));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('signed-out')).toBeInTheDocument();
  });

  it('registers a 401 handler that clears the session', async () => {
    mockedApi.me.mockResolvedValue({ staff: STAFF });
    let capturedHandler: (() => void) | null = null;
    mockedApi.setUnauthorizedHandler.mockImplementation((handler) => {
      capturedHandler = handler;
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('signed-in:alice');

    expect(capturedHandler).not.toBeNull();
    // Simulate a 401 firing anywhere in the app.
    act(() => {
      capturedHandler!();
    });

    expect(await screen.findByText('signed-out')).toBeInTheDocument();
  });
});
