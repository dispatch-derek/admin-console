// White-box unit tests for the raw/code-editor bridge (REQ-F001-046). Complements bridge.test.ts
// (which asserts static file/import structure) by exercising the RENDERED composition: the DS
// Textarea props actually wired through (value/onChange/rows/disabled/label/hint/name/id), the
// default `rows`, and the monospace/code-editor className.
//
// NOTE: RawEditorSurface.tsx's own header comment and web/src/bridge/README.md §1 both describe this
// bridge as adding "spellCheck off" as one of its code-editor affordances. The component's declared
// `RawEditorSurfaceProps`, however, has no `spellCheck` field, and it never passes `spellCheck` to the
// underlying DS `Textarea`, so the rendered <textarea> gets the browser/DS default rather than being
// forced off. The test below documents the INTENDED behavior (per the file's own doc comment) and is
// expected to fail against the current implementation — see suspected-bug report.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RawEditorSurface } from './RawEditorSurface';

describe('RawEditorSurface (white-box)', () => {
  it('renders a controlled value and fires onChange', async () => {
    const onChange = vi.fn();
    render(<RawEditorSurface label="Raw env" value="KEY=1" onChange={onChange} />);
    const el = screen.getByLabelText('Raw env') as HTMLTextAreaElement;
    expect(el.value).toBe('KEY=1');
    await userEvent.type(el, '!');
    expect(onChange).toHaveBeenCalled();
  });

  it('defaults `rows` to 16', () => {
    render(<RawEditorSurface label="Raw env" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Raw env')).toHaveAttribute('rows', '16');
  });

  it('wires a custom `rows`', () => {
    render(<RawEditorSurface label="Raw env" value="" onChange={() => {}} rows={30} />);
    expect(screen.getByLabelText('Raw env')).toHaveAttribute('rows', '30');
  });

  it('wires `disabled`', () => {
    render(<RawEditorSurface label="Raw env" value="" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Raw env')).toBeDisabled();
  });

  it('wires `hint`, `name`, and `id`', () => {
    render(
      <RawEditorSurface
        label="Raw env"
        value=""
        onChange={() => {}}
        hint="one KEY=value per line"
        name="rawEnv"
        id="raw-env-id"
      />,
    );
    expect(screen.getByText('one KEY=value per line')).toBeInTheDocument();
    const el = screen.getByLabelText('Raw env');
    expect(el).toHaveAttribute('name', 'rawEnv');
    expect(el).toHaveAttribute('id', 'raw-env-id');
  });

  it('applies the code-editor monospace wrapper class to the composed Textarea', () => {
    const { container } = render(<RawEditorSurface label="Raw env" value="" onChange={() => {}} />);
    // RawEditorSurface passes className={styles.code} through to Textarea, which merges it onto
    // the field wrapper div.
    expect(container.firstElementChild!.className).toEqual(expect.stringContaining('code'));
  });

  it('SUSPECTED BUG: documented "spellCheck off" affordance is not wired to the underlying <textarea>', () => {
    render(<RawEditorSurface label="Raw env" value="" onChange={() => {}} />);
    // RawEditorSurface.tsx's own comment + bridge/README.md §1 claim spellCheck is off for the
    // code-editor surface, but `spellCheck` is not part of RawEditorSurfaceProps and is never passed
    // to the composed Textarea.
    expect(screen.getByLabelText('Raw env')).toHaveAttribute('spellcheck', 'false');
  });
});
