// SPEC §7.11 REQ-078 / REQ-078b/e / REQ-078c / REQ-088a — the raw editor:
//   - is gated behind an explicit "advanced mode" acknowledgement: write controls stay inert until
//     enabled (REQ-078).
//   - lists ONLY the keys returned by GET /api/settings/raw — no hardcoded key list (REQ-078b/e).
//   - a write is confirmed via a masked diff (secrets never show their value) and a typed
//     confirmation token; `putRawEnv` fires only on an exact token match (REQ-078c/088a).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RawEnvEditor } from './RawEnvEditor';
import * as api from '../../api/client';
import type { RawEnvEntry } from '../../api/types';

vi.mock('../../api/client');
const mockedApi = vi.mocked(api);

const ENTRIES: RawEnvEntry[] = [
  { key: 'OpenAiKey', state: 'set' },
  { key: 'OllamaLLMBasePath', state: 'value', value: 'http://127.0.0.1:11434' },
];

describe('RawEnvEditor — advanced-mode gate (REQ-078)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getRawEnv.mockResolvedValue(ENTRIES);
  });

  it('renders write inputs disabled until advanced mode is explicitly enabled', async () => {
    render(<RawEnvEditor />);

    const rows = await screen.findAllByRole('textbox');
    // Secret key uses a password input, not textbox; grab all "new value" inputs by test structure.
    const keyCell = await screen.findByText('OllamaLLMBasePath');
    const row = keyCell.closest('tr')!;
    const newValueInput = within(row).getByRole('textbox');
    expect(newValueInput).toBeDisabled();

    const reviewButton = screen.getByRole('button', { name: /Review & write/ });
    expect(reviewButton).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable advanced mode' }));
    expect(newValueInput).toBeEnabled();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('lists only the keys returned by getRawEnv() — no hardcoded key catalog (REQ-078b/e)', async () => {
    render(<RawEnvEditor />);

    expect(await screen.findByText('OpenAiKey')).toBeInTheDocument();
    expect(screen.getByText('OllamaLLMBasePath')).toBeInTheDocument();
    // A well-known accepted engine key NOT returned by this mocked response must not appear —
    // proving the UI has no compiled-in key list of its own.
    expect(screen.queryByText('AnthropicApiKey')).not.toBeInTheDocument();
    expect(mockedApi.getRawEnv).toHaveBeenCalledOnce();
  });

  it('never displays the value of a secret entry, only its set/not-set state', async () => {
    render(<RawEnvEditor />);
    await screen.findByText('OpenAiKey');
    expect(screen.getByText('set')).toBeInTheDocument();
    // The secret entry's "current state" cell shows only the set/not-set badge, never a value.
    const secretRow = screen.getByText('OpenAiKey').closest('tr')!;
    const cells = within(secretRow).getAllByRole('cell');
    const stateCell = cells[1];
    expect(within(stateCell).getByText('set')).toBeInTheDocument();
    expect(stateCell.querySelector('code')).toBeNull();
    // A non-secret entry's actual value IS shown as-is (contrast case).
    expect(screen.getByText('http://127.0.0.1:11434')).toBeInTheDocument();
  });
});

describe('RawEnvEditor — masked-diff + typed-token write confirmation (REQ-078c/088a)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getRawEnv.mockResolvedValue(ENTRIES);
  });

  it('masks secret values in the diff and only calls putRawEnv on an exact token match', async () => {
    mockedApi.putRawEnv.mockResolvedValue({ verified: true, keys: ['OpenAiKey'] });
    render(<RawEnvEditor />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Enable advanced mode' }));

    const secretRow = screen.getByText('OpenAiKey').closest('tr')!;
    const secretInput = within(secretRow).getByPlaceholderText('new value (write-only)');
    await userEvent.type(secretInput, 'sk-super-secret-value');

    await userEvent.click(screen.getByRole('button', { name: /Review & write/ }));

    const dialog = await screen.findByRole('dialog');
    // The masked diff must show "will be set / overwritten" and NEVER the raw secret text.
    expect(dialog).toHaveTextContent('will be set / overwritten');
    expect(dialog).not.toHaveTextContent('sk-super-secret-value');

    const writeButton = within(dialog).getByRole('button', { name: 'Write keys' });
    expect(writeButton).toBeDisabled();

    const tokenInput = within(dialog).getByRole('textbox');
    await userEvent.type(tokenInput, 'wrong-token');
    expect(writeButton).toBeDisabled();
    expect(mockedApi.putRawEnv).not.toHaveBeenCalled();

    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'WRITE');
    expect(writeButton).toBeEnabled();

    await userEvent.click(writeButton);
    expect(mockedApi.putRawEnv).toHaveBeenCalledWith([
      { key: 'OpenAiKey', value: 'sk-super-secret-value' },
    ]);
  });
});
