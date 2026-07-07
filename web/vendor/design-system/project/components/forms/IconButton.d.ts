import * as React from "react";

export interface IconButtonProps {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  size?: number;
  shape?: "square" | "circle";
  variant?: "default" | "menu";
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function IconButton(props: IconButtonProps): JSX.Element;
