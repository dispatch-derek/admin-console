// Recreated DS component (REQ-F001-045). Contract: vendored data-display/Badge.d.ts.
// tone ∈ {info,success,warn,danger,neutral} (REQ-F001-044 iv). Styling references DS tokens via
// var() only — no raw hex/px in JS/TS (REQ-F001-018/044).
import type { CSSProperties, ReactNode } from 'react';
import styles from './Badge.module.css';

export interface BadgeProps {
  children?: ReactNode;
  tone?: 'info' | 'success' | 'warn' | 'danger' | 'neutral';
  className?: string;
  style?: CSSProperties;
}

const TONE_CLASS: Record<NonNullable<BadgeProps['tone']>, string> = {
  info: styles.info,
  success: styles.success,
  warn: styles.warn,
  danger: styles.danger,
  neutral: styles.neutral,
};

export function Badge({ children, tone = 'info', className = '', style }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[tone]} ${className}`.trim()} style={style}>
      {children}
    </span>
  );
}
