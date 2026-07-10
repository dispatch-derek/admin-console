// Shared label/hint/error scaffolding for Input/Select/Textarea (REQ-F001-045). Factored out
// because all three fields render an identical wrapper/label/hint/error structure
// (REQ-F001-021/-030); this is implementation-internal, not part of any component's public prop
// contract. Id generation lives in the sibling useFieldIds.ts hook.
import type { CSSProperties, ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldFrameProps {
  fieldId: string;
  label?: string;
  hint?: string;
  hintId?: string;
  error?: string | null;
  errorId?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function FieldFrame({
  fieldId,
  label,
  hint,
  hintId,
  error,
  errorId,
  className = '',
  style,
  children,
}: FieldFrameProps) {
  return (
    <div className={`${styles.field} ${className}`.trim()} style={style}>
      {label && (
        <label htmlFor={fieldId} className={styles.label}>
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
