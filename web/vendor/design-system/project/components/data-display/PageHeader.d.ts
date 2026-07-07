import * as React from "react";

/**
 * Admin page section header.
 */
export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function PageHeader(props: PageHeaderProps): JSX.Element;
