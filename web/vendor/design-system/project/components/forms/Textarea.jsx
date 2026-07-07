import React from "react";

/**
 * Multi-line settings input. Same visual language as Input.
 */
export function Textarea({
  label,
  hint,
  value,
  defaultValue,
  onChange,
  placeholder,
  name,
  rows = 3,
  disabled = false,
  id,
  className = "",
  style = {},
}) {
  const field = {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "10px",
    fontFamily: "var(--font-sans)",
    fontSize: "14px",
    lineHeight: 1.5,
    color: "var(--theme-settings-input-text)",
    background: "var(--theme-settings-input-bg)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    outline: "none",
    resize: "vertical",
  };
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "8px", ...style }}>
      {label && (
        <label htmlFor={id} style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--theme-text-primary)" }}>
          {label}
        </label>
      )}
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className="alm-input"
        style={field}
      />
      {hint && <p style={{ margin: 0, fontSize: "12px", color: "var(--theme-text-secondary)" }}>{hint}</p>}
    </div>
  );
}
