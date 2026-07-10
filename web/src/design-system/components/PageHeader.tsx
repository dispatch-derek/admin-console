// Recreated DS component (REQ-F001-045). Contract: vendored data-display/PageHeader.d.ts.
import type { CSSProperties, ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function PageHeader({ title, description, action, className = '', style }: PageHeaderProps) {
  return (
    <div className={`${styles.header} ${className}`.trim()} style={style}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
