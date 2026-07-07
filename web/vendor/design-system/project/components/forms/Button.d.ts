import * as React from "react";

/**
 * Admin Console action button.
 */
export interface ButtonProps {
  children?: React.ReactNode;
  /** cta = cyan pill • solid = white/black confirm • ghost = cancel • danger • login = full-width auth */
  variant?: "cta" | "solid" | "ghost" | "danger" | "login";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  full?: boolean;
  icon?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  type?: "button" | "submit" | "reset";
  className?: string;
  style?: React.CSSProperties;
}

export function Button(props: ButtonProps): JSX.Element;
