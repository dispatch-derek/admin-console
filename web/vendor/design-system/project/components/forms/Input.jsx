import React from "react";

/**
 * Settings/form text input. Borderless, dark fill, rounded-lg, 10px padding.
 * Focus ring uses the primary cyan (outline). Supports an optional label + hint.
 */
export function Input({
  label,
  hint,
  type = "text",
  value,
  defaultValue,
  onChange,
  placeholder,
  name,
  disabled = false,
  required = false,
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
    color: "var(--theme-settings-input-text)",
    background: "var(--theme-settings-input-bg)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    outline: "none",
  };
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "8px", ...style }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            fontWeight: 500,
            color: "var(--theme-text-primary)",
          }}
        >
          {label}
        </label>
      )}
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className="alm-input"
        style={field}
      />
      {hint && (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--theme-text-secondary)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

if (typeof document !== "undefined" && !document.getElementById("alm-input-styles")) {
  const s = document.createElement("style");
  s.id = "alm-input-styles";
  s.textContent = `
    .alm-input:focus { outline: 2px solid var(--theme-button-primary); outline-offset: 0; }
    .alm-input::placeholder { color: var(--theme-settings-input-placeholder); }
    .alm-input:disabled { opacity: .5; cursor: not-allowed; }
  `;
  document.head.appendChild(s);
}
