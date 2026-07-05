// SPEC REQ-035/064a — client-side validation blocks submit before send. An invalid numeric field
// must prevent `updateWorkspaceSettings` from ever being called; only operator-changed fields are
// sent on a valid submit (REQ-033/036).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSettings } from './WorkspaceSettings';
import * as api from '../../api/client';
import type { WorkspaceSettings as WS } from '../../api/types';

vi.mock('../../api/client');
const mockedApi = vi.mocked(api);

const BASE_WS: WS = {
  id: 'ws-1',
  displayName: 'Support KB',
  llmProvider: null,
  llmModel: null,
  responseMode: 'chat',
  temperature: 0.7,
  historyWindow: 20,
  systemPrompt: null,
  retrievalThreshold: 0.25,
  retrievalTopN: 4,
  agentLlmProvider: null,
  agentLlmModel: null,
  noResultsMessage: null,
  retrievalMode: 'default',
  avatar: null,
  documents: [],
};

describe('WorkspaceSettings (REQ-035 blocks submit on invalid input)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getWorkspace.mockResolvedValue(BASE_WS);
    mockedApi.listDocuments.mockResolvedValue([]);
  });

  it('blocks submit and never calls updateWorkspaceSettings when temperature is out of bounds', async () => {
    render(<WorkspaceSettings workspaceId="ws-1" onDeleted={vi.fn()} />);

    const temperatureInput = await screen.findByLabelText(/Temperature/);
    await userEvent.clear(temperatureInput);
    await userEvent.type(temperatureInput, '5');

    const saveButton = screen.getByRole('button', { name: 'Save changes' });
    expect(saveButton).toBeDisabled();

    await userEvent.click(saveButton);
    expect(mockedApi.updateWorkspaceSettings).not.toHaveBeenCalled();
    expect(screen.getByText('Must be at most 2')).toBeInTheDocument();
  });

  it('blocks submit when retrievalTopN is below the minimum of 1', async () => {
    render(<WorkspaceSettings workspaceId="ws-1" onDeleted={vi.fn()} />);

    const topNInput = await screen.findByLabelText(/Retrieval top N/);
    await userEvent.clear(topNInput);
    await userEvent.type(topNInput, '0');

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(mockedApi.updateWorkspaceSettings).not.toHaveBeenCalled();
  });

  it('sends only the changed field(s) on a valid submit (partial-write semantics)', async () => {
    mockedApi.updateWorkspaceSettings.mockResolvedValue({ ...BASE_WS, displayName: 'New Name' });
    render(<WorkspaceSettings workspaceId="ws-1" onDeleted={vi.fn()} />);

    const nameInput = await screen.findByLabelText('Display name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mockedApi.updateWorkspaceSettings).toHaveBeenCalledWith('ws-1', {
      displayName: 'New Name',
    });
  });

  it('rejects a whitespace-only non-Ollama model tag (REQ-064a) and blocks submit', async () => {
    render(<WorkspaceSettings workspaceId="ws-1" onDeleted={vi.fn()} />);

    const providerInput = await screen.findByLabelText(/^LLM provider/);
    await userEvent.type(providerInput, 'openai');
    const modelInput = screen.getByLabelText(/^LLM model/);
    await userEvent.type(modelInput, 'a b');

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(mockedApi.updateWorkspaceSettings).not.toHaveBeenCalled();
  });
});
