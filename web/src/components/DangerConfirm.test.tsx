import { useRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

// REQ-F002-034: modal-dialog keyboard behavior — initial focus, Escape-to-cancel, focus-return on
// close, and passing the operator's typed value to onConfirm.
describe('DangerConfirm (accessibility / keyboard)', () => {
  it('moves focus to the typed-token input on open', () => {
    render(
      <DangerConfirm
        title="Delete workspace"
        target="Support KB"
        consequence="This cannot be undone."
        expectedToken="support-kb"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('moves focus to the heading in toggle mode (no input)', () => {
    render(
      <DangerConfirm
        title="Change LLM provider"
        target="LLM provider"
        consequence="Chat behavior may change."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Change LLM provider' })).toHaveFocus();
  });

  it('cancels on Escape', async () => {
    const onCancel = vi.fn();
    render(
      <DangerConfirm
        title="Delete workspace"
        target="Support KB"
        consequence="This cannot be undone."
        expectedToken="support-kb"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('passes the exact typed value to onConfirm', async () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirm
        title="Delete workspace"
        target="Support KB"
        consequence="This cannot be undone."
        expectedToken="support-kb"
        confirmLabel="Delete workspace"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), 'support-kb');
    await userEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));
    expect(onConfirm).toHaveBeenCalledWith('support-kb');
  });

  it('returns focus to the opener when the dialog closes', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <DangerConfirm
              title="Change LLM provider"
              target="LLM provider"
              consequence="Chat behavior may change."
              onConfirm={() => {}}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    await userEvent.click(opener);
    // Dialog opened and took focus off the trigger.
    expect(opener).not.toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  // REQ-F002-034 (focus trap): Tab at the LAST focusable element inside the dialog must wrap back to
  // the FIRST rather than escaping to the page behind the modal.
  it('wraps focus from the last focusable element back to the first on Tab', async () => {
    render(
      <DangerConfirm
        title="Delete workspace"
        target="Support KB"
        consequence="This cannot be undone."
        expectedToken="support-kb"
        confirmLabel="Delete workspace"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByRole('textbox');
    // Arm the destructive button so it becomes focusable (last in DOM order); before that only the
    // input and Cancel are tabbable.
    await userEvent.type(input, 'support-kb');
    const confirm = screen.getByRole('button', { name: 'Delete workspace' });
    expect(confirm).toBeEnabled();

    confirm.focus();
    expect(confirm).toHaveFocus();
    // Tab from the last focusable element wraps to the first (the typed-token input).
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(input).toHaveFocus();
  });

  // REQ-F002-034 (focus return on a successful confirm that removes the opener): when the operator's
  // confirm handler disables the opener in the same commit that closes the dialog, the opener can no
  // longer take focus. Focus must land on the caller-supplied fallback landmark, never <body>.
  it('restores focus to the fallback landmark when a successful confirm disables the opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [done, setDone] = useState(false);
      const landmarkRef = useRef<HTMLHeadingElement>(null);
      return (
        <section>
          <h2 ref={landmarkRef} tabIndex={-1}>
            Region
          </h2>
          <button type="button" disabled={done} onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <DangerConfirm
              title="Change LLM provider"
              target="LLM provider"
              consequence="Chat behavior may change."
              confirmLabel="Apply change"
              fallbackFocusRef={landmarkRef}
              onConfirm={() => {
                // Same commit as the close: disable the opener AND unmount the dialog, mirroring the
                // real apply/save/detach handlers whose success disables or removes the trigger.
                setDone(true);
                setOpen(false);
              }}
              onCancel={() => setOpen(false)}
            />
          )}
        </section>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    await userEvent.click(opener);

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'I understand and want to proceed' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply change' }));

    // The opener is now disabled and cannot receive focus; the fallback landmark takes it instead.
    const landmark = screen.getByRole('heading', { name: 'Region' });
    expect(landmark).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});
