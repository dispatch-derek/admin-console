// Recreated DS component (REQ-F001-045). Contract: vendored overlays/Modal.d.ts.
// Fixed backdrop (click = onClose), titled card with an X close control, scrollable body, optional
// footer; returns null when !open. a11y (RISK-4 ruling, preserving REQ-F001-020/030 parity): the
// card carries role="dialog" + aria-modal and derives its accessible name from `title` — done
// internally, WITHOUT adding an off-contract prop, so the vendored prop allow-list is unchanged.
import type { ReactNode } from 'react';
import styles from './Modal.module.css';

export interface ModalProps {
  open?: boolean;
  title?: string;
  onClose?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}

export function Modal({ open = true, title, onClose, children, footer, width = 672, className = '' }: ModalProps) {
  if (!open) return null;
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`${styles.card} ${className}`.trim()}
        style={{ maxWidth: width }}
      >
        <div className={styles.header}>
          {/* tabIndex=-1: a stable, safe programmatic-focus target for callers with no other
              in-dialog control to focus initially (e.g. DangerConfirm's checkbox-acknowledgement
              mode, REQ-F002-034) — invisible to normal Tab order, doesn't change the declared
              props contract or any rendered behavior for callers that don't call .focus() on it. */}
          <h3 className={styles.title} tabIndex={-1}>
            {title}
          </h3>
          {onClose && (
            <button type="button" onClick={onClose} className={styles.close} aria-label="Close">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
