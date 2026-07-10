// SPEC F-001 REQ-F001-045 (§5) — recreate Textarea matching
// web/vendor/design-system/project/components/forms/Textarea.d.ts. This is the closest DS primitive
// composed by the raw/code-editor bridge (REQ-F001-046) — see bridge/RawEditorSurface.test.tsx.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// Textarea.tsx` exist (REQ-F001-045/015).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '../index';

describe('Textarea (REQ-F001-045, contract: forms/Textarea.d.ts)', () => {
  it('renders an associated label', () => {
    render(<Textarea label="Raw env" id="raw-env" />);
    expect(screen.getByLabelText('Raw env')).toBeInTheDocument();
  });

  it('reflects a controlled `value` and fires onChange', async () => {
    const onChange = vi.fn();
    render(<Textarea label="Notes" value="hello" onChange={onChange} />);
    const el = screen.getByLabelText('Notes') as HTMLTextAreaElement;
    expect(el.value).toBe('hello');
    await userEvent.type(el, '!');
    expect(onChange).toHaveBeenCalled();
  });

  it('supports `rows`', () => {
    render(<Textarea label="Env dump" rows={20} />);
    expect(screen.getByLabelText('Env dump')).toHaveAttribute('rows', '20');
  });

  it('supports `disabled` and `placeholder`', () => {
    render(<Textarea label="Locked" disabled placeholder="KEY=value" />);
    const el = screen.getByLabelText('Locked');
    expect(el).toBeDisabled();
    expect(el).toHaveAttribute('placeholder', 'KEY=value');
  });
});
