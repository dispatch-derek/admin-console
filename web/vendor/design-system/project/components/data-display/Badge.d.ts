import * as React from "react";

export interface BadgeProps {
  children?: React.ReactNode;
  tone?: "info" | "success" | "warn" | "danger" | "neutral";
  className?: string;
  style?: React.CSSProperties;
}

export function Badge(props: BadgeProps): JSX.Element;
