// Recreated DS component (REQ-F001-045). Contract: vendored forms/Textarea.d.ts.
// Closest DS primitive composed by the raw/code-editor bridge (REQ-F001-046).
import type { ChangeEvent, CSSProperties } from 'react';
import styles from './Field.module.css';
import { useFieldIds } from './useFieldIds';
import { FieldFrame } from './FieldFrame';

export interface TextareaProps {
  label?: string;
  hint?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  name?: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  // --- RISK-4 adopted-contract extensions (see web/src/bridge/README.md §3) ---
  // Code-editor affordances the raw-env-editor bridge / masked-diff need (REQ-F001-046); wired
  // straight to the <textarea>. The vendored reference is unchanged.
  readOnly?: boolean;
  spellCheck?: boolean;
}

export function Textarea({
  label,
  hint,
  value,
  defaultValue,
  onChange,
  placeholder,
  name,
  rows = 3,
  disabled = false,
  id,
  className = '',
  style,
  readOnly = false,
  spellCheck,
}: TextareaProps) {
  const { fieldId: textareaId, hintId } = useFieldIds(id, hint);
  return (
    <FieldFrame fieldId={textareaId} label={label} hint={hint} hintId={hintId} className={className} style={style}>
      <textarea
        id={textareaId}
        name={name}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        spellCheck={spellCheck}
        aria-describedby={hintId}
        className={`${styles.control} ${styles.textarea}`}
      />
    </FieldFrame>
  );
}
