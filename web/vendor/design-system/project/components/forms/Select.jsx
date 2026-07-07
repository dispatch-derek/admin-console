import React from "react";

/**
 * Settings/form select. Matches Input styling — borderless dark fill,
 * rounded-lg, with a custom caret.
 */
export function Select({
  label,
  hint,
  value,
  defaultValue,
  onChange,
  name,
  disabled = false,
  id,
  children,
  options,
  className = "",
  style = {},
}) {
  const field = {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 34px 10px 10px",
    fontFamily: "var(--font-sans)",
    fontSize: "14px",
    color: "var(--theme-settings-input-text)",
    background: "var(--theme-settings-input-bg)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    outline: "none",
    appearance: "none",
    WebkitAppearance: "none",
    cursor: "pointer",
    backgroundImage:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='4 6 8 10 12 6'/></svg>\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
  };
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "8px", ...style }}>
      {label && (
        <label htmlFor={id} style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--theme-text-primary)" }}>
          {label}
        </label>
      )}
      <select
        id={id}
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        className="alm-input"
        style={field}
      >
        {options
          ? options.map((o) => (
              <option key={o.value ?? o} value={o.value ?? o}>
                {o.label ?? o}
              </option>
            ))
          : children}
      </select>
      {hint && <p style={{ margin: 0, fontSize: "12px", color: "var(--theme-text-secondary)" }}>{hint}</p>}
    </div>
  );
}
