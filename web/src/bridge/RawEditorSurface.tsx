// F-001 bridge entry (REQ-F001-046): the raw/code-editor surface. The DS ships no dedicated
// code-editor component, so this composes the DS `Textarea` (its closest primitive) plus DS tokens
// via a monospace class — the single named legitimate DS coverage gap (REQ-F001-016/046). It adds
// only code-editor affordances (monospace font, spellCheck off, no wrap) around the DS Textarea; it
// contains no raw hex/px literal, so it passes both adherence gates (REQ-F001-044/047).
import type { ChangeEvent } from 'react';
import { Textarea } from '../design-system';
import styles from './RawEditorSurface.module.css';

export interface RawEditorSurfaceProps {
  value: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
  name?: string;
  id?: string;
}

export function RawEditorSurface({ value, onChange, rows = 16, disabled, label, hint, name, id }: RawEditorSurfaceProps) {
  return (
    <Textarea
      className={styles.code}
      value={value}
      onChange={onChange}
      rows={rows}
      disabled={disabled}
      label={label}
      hint={hint}
      name={name}
      id={id}
      // Code-editor affordance (see header comment + bridge/README §1): never spell-check code.
      spellCheck={false}
    />
  );
}
