// Recreated DS component (REQ-F001-045). Contract: vendored forms/Button.d.ts.
// variant ∈ {cta,solid,ghost,danger,login}, size ∈ {sm,md,lg}, type ∈ {button,submit,reset}
// (REQ-F001-044 iv). Colors resolve through DS tokens via var() only; the destructive variant uses
// the re-pointed DS badge-danger tokens (REQ-F001-048), never a retired ad-hoc status property.
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import styles from './Button.module.css';

export interface ButtonProps {
  children?: ReactNode;
  variant?: 'cta' | 'solid' | 'ghost' | 'danger' | 'login';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  full?: boolean;
  icon?: ReactNode;
  onClick?: (e: MouseEvent) => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  style?: CSSProperties;
  // --- RISK-4 adopted-contract extensions (see web/src/bridge/README.md §3) ---
  // Accessible name / tooltip for icon-bearing buttons (REQ-F001-030); wired straight to the
  // <button>. The vendored reference is unchanged.
  title?: string;
  'aria-label'?: string;
}

const VARIANT_CLASS: Record<NonNullable<ButtonProps['variant']>, string> = {
  cta: styles.cta,
  solid: styles.solid,
  ghost: styles.ghost,
  danger: styles.danger,
  login: styles.login,
};

const SIZE_CLASS: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
};

export function Button({
  children,
  variant = 'cta',
  size = 'md',
  disabled = false,
  full = false,
  icon = null,
  onClick,
  type = 'button',
  className = '',
  style,
  title,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const classes = [styles.btn, VARIANT_CLASS[variant], SIZE_CLASS[size], full ? styles.full : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={classes}
      style={style}
      title={title}
      aria-label={ariaLabel}
    >
      {icon}
      {children}
    </button>
  );
}
