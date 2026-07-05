// SPEC §8 REQ-082 — user delete is a dangerous operation: the confirmation names the exact user and
// requires the operator to type the username before `deleteUser` fires.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserList } from './UserList';
import * as api from '../../api/client';
import type { User } from '../../api/types';

vi.mock('../../api/client');
const mockedApi = vi.mocked(api);

const USERS: User[] = [
  { id: 'u1', username: 'bob', role: 'default', suspended: false, dailyMessageLimit: null },
];

describe('UserList delete flow (REQ-082)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.listUsers.mockResolvedValue(USERS);
  });

  it('does not call deleteUser until the exact username is typed', async () => {
    render(<UserList />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete user' });
    expect(dialog).toHaveTextContent('bob');

    const confirmButton = within(dialog).getByRole('button', { name: 'Delete user' });
    expect(confirmButton).toBeDisabled();

    const input = within(dialog).getByRole('textbox');
    await userEvent.type(input, 'wrong-name');
    expect(confirmButton).toBeDisabled();
    expect(mockedApi.deleteUser).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, 'bob');
    expect(confirmButton).toBeEnabled();

    await userEvent.click(confirmButton);
    expect(mockedApi.deleteUser).toHaveBeenCalledWith('u1');
  });
});
