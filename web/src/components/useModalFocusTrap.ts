// Shared modal focus management for the app's externally-wrapped DS `Modal` dialogs (DangerConfirm,
// ToggleConfirm). The DS `Modal` ships no focus management and a vendored, closed prop contract (no
// keydown/ref hook), so both dialogs wrap it from the OUTSIDE via a ref'd wrapper div that carries the
// returned `handleKeyDown`. This hook centralizes the behavior both need (REQ-F002-034, REQ-F005-042):
//   1. capture the opener and move focus into the dialog on open,
//   2. trap Tab / Shift+Tab within the dialog,
//   3. Escape cancels, and
//   4. restore focus to the opener on close — or, when the opener is gone/disabled by close time
//      (e.g. a successful confirm unmounted its trigger in the same commit), to a stable fallback,
//      never letting focus drop to <body>.
// Previously DangerConfirm and ToggleConfirm each carried near-verbatim copies of this logic; they now
// share this one implementation (the divergent bits — initial-focus target and fallback derivation —
// are injected via options).

import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Checks if an element is safe to focus: it must be an HTMLElement, still connected to the DOM,
 * and not disabled. A disconnected or disabled element would silently fail to receive focus per
 * the HTML spec (falling through to <body>).
 */
export function isModalFocusable(el: Element | null | undefined): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    document.contains(el) &&
    (el as Partial<HTMLButtonElement>).disabled !== true
  );
}

/**
 * Configuration for the modal focus-trap hook. All focus management is per-caller, allowing
 * different use cases (danger confirm, toggle confirm, etc.) to tailor their focus behavior.
 */
export interface ModalFocusTrapOptions {
  /** Called when Escape is pressed inside the dialog. */
  onCancel: () => void;
  /**
   * Optional: Returns the element to move focus to on dialog open. Default: the dialog's
   * <h3> heading, or the root wrapper if none found. Called after the modal ref is ready
   * and the opener has been captured.
   */
  initialFocus?: (root: HTMLElement) => HTMLElement | null | undefined;
  /**
   * Optional: Resolved at dialog open time and used as a focus target when the opener is no
   * longer focusable at close time (e.g., the trigger button was unmounted in the same React
   * render commit). Receives the opener so callers can derive a sibling element from it.
   */
  resolveFallback?: (opener: HTMLElement | null) => HTMLElement | null | undefined;
}

/**
 * Manages focus behavior for a modal dialog: moves focus in on open, traps Tab/Shift+Tab within
 * the dialog, closes on Escape, and restores focus to the opener on close (or a fallback if the
 * opener is no longer focusable). Used by both DangerConfirm and ToggleConfirm; callers inject
 * their own initialFocus and resolveFallback to tailor focus targets.
 *
 * @param modalRef A ref to the dialog wrapper root element.
 * @param options Configuration: onCancel, and optional initialFocus and resolveFallback callbacks.
 * @returns An object with a `handleKeyDown` function for the dialog's onKeyDown prop.
 */
export function useModalFocusTrap(
  modalRef: RefObject<HTMLElement | null>,
  { onCancel, initialFocus, resolveFallback }: ModalFocusTrapOptions,
): { handleKeyDown: (e: KeyboardEvent<HTMLElement>) => void } {
  // Keep the latest injected callbacks reachable from the mount-only effect without making it re-run
  // (re-running would re-capture the opener AFTER focus already moved into the dialog).
  const initialFocusRef = useRef(initialFocus);
  const resolveFallbackRef = useRef(resolveFallback);
  initialFocusRef.current = initialFocus;
  resolveFallbackRef.current = resolveFallback;

  useEffect(() => {
    const root = modalRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (root) {
      const target = initialFocusRef.current?.(root) ?? root.querySelector<HTMLElement>('h3') ?? root;
      target?.focus();
    }
    // Capture the fallback NOW (at open), while the opener + its surroundings are known-good; by the
    // time cleanup runs the caller may already have unmounted the trigger and its neighbors.
    const fallbackAtOpen = resolveFallbackRef.current?.(opener) ?? null;

    return () => {
      if (isModalFocusable(opener)) {
        opener.focus();
        return;
      }
      if (isModalFocusable(fallbackAtOpen)) fallbackAtOpen.focus();
    };
    // Mount/unmount only: capture the opener before focus moves in, restore it (or the fallback) on
    // close. modalRef is a stable ref; the injected callbacks are read via refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab') return;

    const root = modalRef.current;
    if (!root) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  return { handleKeyDown };
}
