import * as React from "react";

export interface ToggleProps {
  enabled?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  description?: string;
  variant?: "default" | "horizontal";
  name?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Toggle(props: ToggleProps): JSX.Element;
