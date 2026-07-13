// Recreated DS component (REQ-F001-045). Contract: vendored forms/Toggle.d.ts.
// size ∈ {sm,md,lg}, variant ∈ {default,horizontal} (REQ-F001-044 iv). Renders role="switch" +
// aria-checked; onChange receives the NEXT boolean state. RISK-3 note: the DS ships --theme-toggle-*
// only under :root (dark), not under [data-theme="light"]; to keep every consumed --theme-* dual-theme
// resolvable (REQ-F001-023), the on/off track colors use the nearest DS tokens defined in BOTH themes
// (--theme-badge-success-text for on, --theme-placeholder for off).
import { useId, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import styles from './Toggle.module.css';

/**
 * Props for the `Toggle` switch control. The `label` (when provided) is bound programmatically
 * to the switch via `aria-labelledby` (REQ-F005-054, additive F-001 extension), so the switch
 * announces the label as its accessible name. The optional `description` is similarly bound
 * via `aria-describedby` for semantic clarity.
 */
export interface ToggleProps {
  enabled?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /**
   * The primary label text for the switch. When provided, it is rendered in the text area
   * and bound to the switch via `aria-labelledby` for accessibility (REQ-F005-054).
   */
  label?: string;
  /**
   * Optional descriptive text shown below the label. When provided, it is bound to the
   * switch via `aria-describedby` for semantic clarity.
   */
  description?: string;
  variant?: 'default' | 'horizontal';
  // Contract-fidelity prop (vendored forms/Toggle.d.ts): accepted-but-unused. The vendored
  // prototype (forms/Toggle.jsx) also destructures `name` without wiring it — this element is a
  // `role="switch"` div, not a native form control, so there is no hidden input to bind it to.
  // See bridge/README §3. Do not invent form-submission behavior beyond the prototype.
  name?: string;
  className?: string;
  style?: CSSProperties;
}

const TRACK_SIZE: Record<NonNullable<ToggleProps['size']>, string> = {
  sm: styles.trackSm,
  md: styles.trackMd,
  lg: styles.trackLg,
};

const KNOB_SIZE: Record<NonNullable<ToggleProps['size']>, string> = {
  sm: styles.knobSm,
  md: styles.knobMd,
  lg: styles.knobLg,
};

const KNOB_TRAVEL: Record<NonNullable<ToggleProps['size']>, string> = {
  sm: 'translateX(0.5rem)',
  md: 'translateX(0.75rem)',
  lg: 'translateX(1.0625rem)',
};

export function Toggle({
  enabled = false,
  onChange,
  disabled = false,
  size = 'md',
  label,
  description,
  variant = 'default',
  className = '',
  style,
}: ToggleProps) {
  const trackStyle: CSSProperties = {
    background: enabled ? 'var(--theme-badge-success-text)' : 'var(--theme-placeholder)',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
  const knobStyle: CSSProperties = {
    transform: enabled ? KNOB_TRAVEL[size] : 'translateX(0)',
  };

  const toggle = () => {
    if (!disabled) onChange?.(!enabled);
  };
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Native checkboxes toggle on Space; also honor Enter for parity with the pre-migration control
    // so the switch is keyboard-operable (REQ-F001-021/-030). preventDefault stops Space scrolling.
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  };

  // Programmatic accessible name (REQ-F005-054, additive F-001 contract extension, human ruling
  // RATIFIED 2026-07-12): bind the rendered `label` element to the switch via aria-labelledby so the
  // control announces its label as its accessible name — benefiting every Toggle consumer, not just
  // F-005. useId keeps the label id unique so multiple Toggles on one page never collide.
  const reactId = useId();
  const labelId = `${reactId}-label`;
  // Programmatic description (WCAG 1.3.1): when a `description` is rendered, associate it with the
  // switch via aria-describedby so assistive tech announces it too, not just the visible label
  // (REQ-F005-032 "labeled with the feature displayName and, where present, its description").
  const descId = `${reactId}-desc`;

  // Rendered as a <button type="button"> (not a bare <div>): a native, keyboard-operable control with
  // an appearance reset in Toggle.module.css so it looks identical to the prior div-track. Being a
  // non-<div> lets consumers reliably reach the switch's surrounding row/label container via closest()
  // without the switch element itself matching a generic `div` selector.
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-disabled={disabled || undefined}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descId : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      className={`${styles.track} ${TRACK_SIZE[size]}`}
      style={trackStyle}
    >
      <span className={`${styles.knob} ${KNOB_SIZE[size]}`} style={knobStyle} />
    </button>
  );

  const textEl: ReactNode = (label || description) && (
    <div className={styles.text}>
      {label && (
        <span id={labelId} className={`${styles.label} ${size === 'lg' ? styles.labelLg : ''}`.trim()}>
          {label}
        </span>
      )}
      {description && (
        <span id={descId} className={styles.description}>
          {description}
        </span>
      )}
    </div>
  );

  if (variant === 'horizontal') {
    return (
      <div className={`${styles.horizontal} ${className}`.trim()} style={style}>
        {textEl}
        {switchEl}
      </div>
    );
  }
  return (
    <div className={`${styles.default} ${className}`.trim()} style={style}>
      {switchEl}
      {textEl}
    </div>
  );
}
