// Recreated DS component (REQ-F001-045). Contract: vendored navigation/SidebarItem.d.ts.
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import styles from './SidebarItem.module.css';

export interface SidebarItemProps {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  caret?: boolean;
  expanded?: boolean;
  isChild?: boolean;
  onClick?: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
}

export function SidebarItem({
  label,
  icon = null,
  active = false,
  caret = false,
  expanded = false,
  isChild = false,
  onClick,
  className = '',
  style,
}: SidebarItemProps) {
  const classes = [styles.item, active ? styles.active : '', className].filter(Boolean).join(' ');
  const labelClass = [styles.label, isChild ? styles.child : '', active ? styles.labelActive : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} onClick={onClick} style={style}>
      <div className={styles.lead}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <span className={labelClass}>{label}</span>
      </div>
      {caret && (
        <span className={`${styles.caret} ${expanded ? styles.caretExpanded : ''}`.trim()}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 4 10 8 6 12" />
          </svg>
        </span>
      )}
    </button>
  );
}
