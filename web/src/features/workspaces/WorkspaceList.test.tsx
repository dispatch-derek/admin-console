// SPEC §8 REQ-081 — workspace delete is a dangerous operation: the confirmation names the exact
// workspace and requires the operator to type the workspace id before `deleteWorkspace` fires.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceList } from './WorkspaceList';
import * as api from '../../api/client';
import type { Workspace } from '../../api/types';

vi.mock('../../api/client');
const mockedApi = vi.mocked(api);

const WORKSPACES: Workspace[] = [
  { id: 'support-kb', displayName: 'Support KB', llmProvider: null, llmModel: null },
];

describe('WorkspaceList delete flow (REQ-081)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.listWorkspaces.mockResolvedValue(WORKSPACES);
  });

  it('does not call deleteWorkspace until the exact workspace id is typed', async () => {
    render(<WorkspaceList />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete workspace' });
    expect(dialog).toHaveTextContent('Support KB');

    const confirmButton = screen.getByRole('button', { name: 'Delete workspace' });
    expect(confirmButton).toBeDisabled();

    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'wrong-id');
    expect(confirmButton).toBeDisabled();
    expect(mockedApi.deleteWorkspace).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, 'support-kb');
    expect(confirmButton).toBeEnabled();

    await userEvent.click(confirmButton);
    expect(mockedApi.deleteWorkspace).toHaveBeenCalledWith('support-kb');
  });
});
