import * as React from "react";

export interface TextareaProps {
  label?: string;
  hint?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  name?: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Textarea(props: TextareaProps): JSX.Element;
