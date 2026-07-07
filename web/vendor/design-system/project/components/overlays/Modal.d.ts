import * as React from "react";

/**
 * Admin console modal dialog.
 */
export interface ModalProps {
  open?: boolean;
  title?: string;
  onClose?: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  className?: string;
}

export function Modal(props: ModalProps): JSX.Element | null;
