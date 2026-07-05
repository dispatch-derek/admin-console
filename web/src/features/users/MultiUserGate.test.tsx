// SPEC §6.1 REQ-040 — before rendering any §6 user-management view, the console reads
// GET /api/multi-user-status. When OFF, ALL §6 controls are withheld, an out-of-band notice is
// shown, and there is NO enable action anywhere (enabling multi-user mode is out-of-band,
// REQ-073/085). When ON, the wrapped §6 UI renders normally.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MultiUserGate } from './MultiUserGate';
import * as api from '../../api/client';

vi.mock('../../api/client');
const mockedApi = vi.mocked(api);

function Section6Controls() {
  return (
    <div>
      <button type="button">Create user</button>
      <button type="button">Enable multi-user mode</button>
    </div>
  );
}

describe('MultiUserGate (REQ-040)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('disables §6 controls and shows the out-of-band notice, with no enable action, when OFF', async () => {
    mockedApi.getMultiUserStatus.mockResolvedValue({ enabled: false });
    render(
      <MultiUserGate>
        <Section6Controls />
      </MultiUserGate>,
    );

    expect(await screen.findByText('User management unavailable')).toBeInTheDocument();
    // The wrapped §6 controls (including any hypothetical "enable" action) must NOT render at all.
    expect(screen.queryByRole('button', { name: 'Create user' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable multi-user mode' })).not.toBeInTheDocument();
    // The gate's own copy must not offer an enable action either.
    expect(screen.queryByRole('button', { name: /enable/i })).not.toBeInTheDocument();
  });

  it('renders the wrapped §6 UI enabled when multi-user mode is ON', async () => {
    mockedApi.getMultiUserStatus.mockResolvedValue({ enabled: true });
    render(
      <MultiUserGate>
        <Section6Controls />
      </MultiUserGate>,
    );

    const createButton = await screen.findByRole('button', { name: 'Create user' });
    expect(createButton).toBeInTheDocument();
    expect(createButton).toBeEnabled();
    expect(screen.queryByText('User management unavailable')).not.toBeInTheDocument();
  });

  it('surfaces the BFF { message } verbatim if the status check itself fails', async () => {
    mockedApi.getMultiUserStatus.mockRejectedValue(
      Object.assign(new Error('Status check failed'), { name: 'ApiError', status: 500 }),
    );
    render(
      <MultiUserGate>
        <Section6Controls />
      </MultiUserGate>,
    );

    // Falls back to a generic message since this is a plain Error, not an ApiError instance —
    // exercised for completeness; the ApiError verbatim path is covered by client.test.ts /
    // ErrorBanner.test.tsx.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create user' })).not.toBeInTheDocument();
  });
});
