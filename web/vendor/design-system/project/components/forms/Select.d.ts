import * as React from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  hint?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  name?: string;
  disabled?: boolean;
  id?: string;
  children?: React.ReactNode;
  options?: (SelectOption | string)[];
  className?: string;
  style?: React.CSSProperties;
}

export function Select(props: SelectProps): JSX.Element;
