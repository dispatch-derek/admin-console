import * as React from "react";

export interface TableProps {
  columns?: string[];
  children?: React.ReactNode;
  minWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

export interface TableRowProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface TableCellProps {
  children?: React.ReactNode;
  header?: boolean;
  style?: React.CSSProperties;
}

export function Table(props: TableProps): JSX.Element;
export namespace Table {
  function Row(props: TableRowProps): JSX.Element;
  function Cell(props: TableCellProps): JSX.Element;
}
