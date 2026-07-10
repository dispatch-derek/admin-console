// Recreated DS component (REQ-F001-045). Contract: vendored forms/Input.d.ts.
// A generated fallback id (useId) associates the label with the control even when no `id` prop is
// supplied, so the label/control pairing (and getByLabelText) works for label-only usages.
import type { ChangeEvent, FocusEvent, CSSProperties } from 'react';
import styles from './Field.module.css';
import { useFieldIds } from './useFieldIds';
import { FieldFrame } from './FieldFrame';

export interface InputProps {
  label?: string;
  hint?: string;
  type?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  // --- RISK-4 adopted-contract extensions (see web/src/bridge/README.md §3) ---
  // read-only env fields / SecretField parity (parent REQ-060/078a); numeric-bounds validation
  // (parent REQ-035); and validation/a11y hooks (.field-error, aria-*). These props are declared on
  // the ADOPTED contract (the source of truth tsc enforces) and wired straight to the <input>; the
  // vendored reference is unchanged.
  readOnly?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  autoComplete?: string;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  error?: string | null;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function Input({
  label,
  hint,
  type = 'text',
  value,
  defaultValue,
  onChange,
  placeholder,
  name,
  disabled = false,
  required = false,
  id,
  className = '',
  style,
  readOnly = false,
  min,
  max,
  step,
  inputMode,
  autoComplete,
  onBlur,
  error,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: InputProps) {
  // Associate the hint/error text with the control via aria-describedby, and expose the error state
  // via aria-invalid (WCAG 3.3.1). An explicitly-passed aria-describedby is preserved and merged.
  const { fieldId: inputId, hintId, errorId } = useFieldIds(id, hint, error);
  const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldFrame
      fieldId={inputId}
      label={label}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
      className={className}
      style={style}
    >
      <input
        id={inputId}
        name={name}
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        readOnly={readOnly}
        min={min}
        max={max}
        step={step}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        aria-invalid={ariaInvalid ?? (error ? true : undefined)}
        className={styles.control}
      />
    </FieldFrame>
  );
}
