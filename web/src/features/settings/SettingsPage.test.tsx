// SPEC §7 / §8 / §10 — the instance settings screen (data-driven off GET /api/settings):
//   - REQ-083/084/086/092: changing a `type:'select'` provider control or a `security` secret is a
//     §8 dangerous op. Opening its confirmation triggers a FRESH GET /api/settings before applying,
//     and the write is not issued until the operator confirms.
//   - A plain (non-dangerous) change saves directly on Save, with no confirmation dialog.
//   - REQ-098a/098b: after a 2xx PATCH /api/settings returning a per-control `verified` map with a
//     mix of true/false, each control renders its own status and the page does NOT show a single
//     "all saved" banner when any entry is false; when all true, it shows the success banner.
//   - REQ-098: on a failed (throwing) patchSettings, fields keep their prior values and a
//     not-saved message is shown (no partial success).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import { ApiError } from '../../api/errors';
import * as api from '../../api/client';
import type { SettingsView } from '../../api/types';

vi.mock('../../api/client');
const mockedApi = vi.mocked(api);

const BASE_VIEW: SettingsView = {
  categories: [
    {
      id: 'llm',
      label: 'LLM',
      controls: [
        { id: 'llmProvider', label: 'LLM Provider', type: 'select', secret: false, value: 'openai' },
        { id: 'llmTimeout', label: 'Request timeout (s)', type: 'number', secret: false, value: 30 },
      ],
    },
    {
      id: 'security',
      label: 'Security',
      controls: [
        { id: 'authToken', label: 'Auth token', type: 'secret', secret: true, set: true },
      ],
    },
  ],
};

function freshView(): SettingsView {
  // A structurally-equal but distinct object so we can tell a fresh GET apart from a stale one.
  return JSON.parse(JSON.stringify(BASE_VIEW)) as SettingsView;
}

describe('SettingsPage — dangerous vs. plain changes (REQ-083/084/086/092)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getSettings.mockImplementation(() => Promise.resolve(freshView()));
  });

  it('saves a plain (non-dangerous) numeric change directly, with no confirmation dialog', async () => {
    mockedApi.patchSettings.mockResolvedValue({
      ...freshView(),
      verified: { llmTimeout: true },
      changedCategories: ['llm'],
    });
    render(<SettingsPage />);

    const timeoutInput = await screen.findByLabelText('Request timeout (s)');
    await userEvent.clear(timeoutInput);
    await userEvent.type(timeoutInput, '60');

    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    // No dangerous-op confirmation dialog for a plain control.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockedApi.patchSettings).toHaveBeenCalledWith({ llmTimeout: 60 });
  });

  it('gates a select-control (provider) change behind confirmation + a fresh getSettings() read (REQ-092)', async () => {
    mockedApi.patchSettings.mockResolvedValue({
      ...freshView(),
      verified: { llmProvider: true },
      changedCategories: ['llm'],
    });
    render(<SettingsPage />);

    const providerInput = await screen.findByLabelText(/LLM Provider/);
    // getSettings has been called once on mount.
    expect(mockedApi.getSettings).toHaveBeenCalledTimes(1);

    await userEvent.clear(providerInput);
    await userEvent.type(providerInput, 'anthropic');

    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    // Opening the confirmation must trigger a fresh read BEFORE the write is issued.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockedApi.getSettings).toHaveBeenCalledTimes(2);
    expect(mockedApi.patchSettings).not.toHaveBeenCalled();
  });

  it('gates a security-secret change behind confirmation (REQ-086) and only writes on explicit confirm', async () => {
    mockedApi.patchSettings.mockResolvedValue({
      ...freshView(),
      verified: { authToken: false },
      changedCategories: ['security'],
    });
    render(<SettingsPage />);

    const secretInput = await screen.findByLabelText(/Auth token/);
    await userEvent.type(secretInput, 'new-secret-value');

    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    const dialog = await screen.findByRole('dialog');
    expect(mockedApi.patchSettings).not.toHaveBeenCalled();
    const applyButton = within(dialog).getByRole('button', { name: 'Apply changes' });
    expect(applyButton).toBeDisabled();

    // Toggle-mode confirmation (§8): the operator must explicitly acknowledge before it arms.
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(applyButton).toBeEnabled();

    await userEvent.click(applyButton);
    expect(mockedApi.patchSettings).toHaveBeenCalledWith({ authToken: 'new-secret-value' });
  });
});

describe('SettingsPage — per-field verify state (REQ-098a/098b)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getSettings.mockImplementation(() => Promise.resolve(freshView()));
  });

  it('renders per-control status for a mixed verified map and shows NO single "all saved" banner', async () => {
    mockedApi.patchSettings.mockResolvedValue({
      ...freshView(),
      verified: { llmTimeout: true, authToken: false },
      changedCategories: ['llm', 'security'],
    });
    render(<SettingsPage />);

    const timeoutInput = await screen.findByLabelText('Request timeout (s)');
    await userEvent.clear(timeoutInput);
    await userEvent.type(timeoutInput, '99');
    const secretInput = screen.getByLabelText(/Auth token/);
    await userEvent.type(secretInput, 'rotated');

    // authToken is a dangerous secret change -> confirmation path (toggle-mode acknowledgement).
    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply changes' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(
      screen.getByText('Submitted — not verified (re-check via the provider or re-enter)'),
    ).toBeInTheDocument();

    // No blanket success banner when any entry is false.
    expect(screen.queryByText('All changes saved.')).not.toBeInTheDocument();
    expect(screen.getByText(/Some changes could not be confirmed/)).toBeInTheDocument();
  });

  it('shows the success banner only when every verified entry is true', async () => {
    mockedApi.patchSettings.mockResolvedValue({
      ...freshView(),
      verified: { llmTimeout: true },
      changedCategories: ['llm'],
    });
    render(<SettingsPage />);

    const timeoutInput = await screen.findByLabelText('Request timeout (s)');
    await userEvent.clear(timeoutInput);
    await userEvent.type(timeoutInput, '45');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    expect(await screen.findByText('All changes saved.')).toBeInTheDocument();
  });
});

describe('SettingsPage — no partial success on a failed write (REQ-098)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getSettings.mockImplementation(() => Promise.resolve(freshView()));
  });

  it('keeps the prior value and shows a not-saved message when patchSettings throws', async () => {
    mockedApi.patchSettings.mockRejectedValue(new ApiError('Upstream write failed', 502));
    render(<SettingsPage />);

    const timeoutInput = await screen.findByLabelText('Request timeout (s)');
    await userEvent.clear(timeoutInput);
    await userEvent.type(timeoutInput, '999');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Upstream write failed');

    // No success banner of any kind, and no per-field "Saved" status was fabricated.
    expect(screen.queryByText('All changes saved.')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();

    // SPEC REQ-098 ("forced upstream failure leaves the field showing its prior state"): the
    // control must NOT display the failed, never-persisted "999" as the current value once the
    // write has been rejected — the pre-edit value (30) must be what's shown.
    expect(screen.getByLabelText('Request timeout (s)')).toHaveValue(30);
  });
});
