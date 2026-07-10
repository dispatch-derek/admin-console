// Recreated DS component (REQ-F001-045). Contract: vendored forms/IconButton.d.ts.
// shape ∈ {square,circle}, variant ∈ {default,menu} (REQ-F001-044 iv).
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps {
  children?: ReactNode;
  onClick?: (e: MouseEvent) => void;
  size?: number;
  shape?: 'square' | 'circle';
  variant?: 'default' | 'menu';
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function IconButton({
  children,
  onClick,
  size = 34,
  shape = 'square',
  variant = 'default',
  title,
  className = '',
  style,
}: IconButtonProps) {
  const classes = [styles.btn, shape === 'circle' ? styles.circle : styles.square, variant === 'menu' ? styles.menu : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={classes}
      style={{ width: size, height: size, ...style }}
    >
      {children}
    </button>
  );
}
