import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DangerConfirm } from './DangerConfirm';

// Smoke coverage for REQ-080/081: the destructive action stays disabled until the exact target
// token is typed.
describe('DangerConfirm (typed-token mode)', () => {
  it('arms the confirm button only on an exact token match', async () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirm
        title="Delete workspace"
        target="Support KB"
        consequence="This cannot be undone."
        expectedToken="support-kb"
        tokenLabel="workspace id"
        confirmLabel="Delete workspace"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: 'Delete workspace' });
    expect(button).toBeDisabled();

    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'wrong');
    expect(button).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'support-kb');
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  // SPEC §8 REQ-080: a mismatched typed value must keep the destructive action disabled, no matter
  // how close it is to the expected token.
  it('keeps the confirm action disabled for a near-miss (case/whitespace) mismatch', async () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirm
        title="Delete workspace"
        target="Support KB"
        consequence="This cannot be undone."
        expectedToken="support-kb"
        tokenLabel="workspace id"
        confirmLabel="Delete workspace"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: 'Delete workspace' });
    const input = screen.getByRole('textbox');

    await userEvent.type(input, 'Support-KB'); // wrong case
    expect(button).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'support-kb '); // trailing whitespace
    expect(button).toBeDisabled();

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// SPEC §8 REQ-080 (toggle mode): when no `expectedToken` is supplied, the dialog uses an explicit
// "I understand" checkbox instead of a typed token; the action stays disabled until it is checked.
describe('DangerConfirm (checkbox acknowledgement mode)', () => {
  it('arms the confirm button only once the acknowledgement checkbox is ticked', async () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirm
        title="Change LLM provider"
        target="LLM provider"
        consequence="Chat behavior may change for all users."
        confirmLabel="Apply change"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: 'Apply change' });
    expect(button).toBeDisabled();
    // Toggle mode renders no typed-token textbox.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', { name: 'I understand and want to proceed' });
    await userEvent.click(checkbox);
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
