import * as React from "react";

export interface SidebarItemProps {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  caret?: boolean;
  expanded?: boolean;
  isChild?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function SidebarItem(props: SidebarItemProps): JSX.Element;
