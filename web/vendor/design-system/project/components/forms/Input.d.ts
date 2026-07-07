import * as React from "react";

export interface InputProps {
  label?: string;
  hint?: string;
  type?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Input(props: InputProps): JSX.Element;
