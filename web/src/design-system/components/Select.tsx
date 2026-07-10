// Recreated DS component (REQ-F001-045). Contract: vendored forms/Select.d.ts.
// `options` accepts either a plain string or a { value, label } SelectOption.
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import styles from './Field.module.css';
import { useFieldIds } from './useFieldIds';
import { FieldFrame } from './FieldFrame';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  hint?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  name?: string;
  disabled?: boolean;
  id?: string;
  children?: ReactNode;
  options?: (SelectOption | string)[];
  className?: string;
  style?: CSSProperties;
}

export function Select({
  label,
  hint,
  value,
  defaultValue,
  onChange,
  name,
  disabled = false,
  id,
  children,
  options,
  className = '',
  style,
}: SelectProps) {
  const { fieldId: selectId, hintId } = useFieldIds(id, hint);
  return (
    <FieldFrame fieldId={selectId} label={label} hint={hint} hintId={hintId} className={className} style={style}>
      <select
        id={selectId}
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={hintId}
        className={`${styles.control} ${styles.select}`}
      >
        {options
          ? options.map((o) => {
              const opt = typeof o === 'string' ? { value: o, label: o } : o;
              return (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              );
            })
          : children}
      </select>
    </FieldFrame>
  );
}
