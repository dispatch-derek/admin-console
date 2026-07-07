import React from "react";

/**
 * Icon-only button used across the admin console — modal close (X),
 * header shortcuts (house), row actions. Circular or rounded-square,
 * transparent by default with a faint fill on hover.
 */
export function IconButton({
  children,
  onClick,
  size = 34,
  shape = "square", // "square" | "circle"
  variant = "default", // "default" | "menu"
  title,
  className = "",
  style = {},
}) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    padding: 0,
    color: "var(--theme-text-primary)",
    background:
      variant === "menu" ? "var(--theme-action-menu-bg)" : "transparent",
    border: "1px solid transparent",
    borderRadius: shape === "circle" ? "9999px" : "var(--radius-sm)",
    cursor: "pointer",
    transition: "background-color .2s ease, border-color .2s ease",
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`alm-iconbtn ${className}`}
      style={{ ...base, ...style }}
    >
      {children}
    </button>
  );
}

if (typeof document !== "undefined" && !document.getElementById("alm-iconbtn-styles")) {
  const s = document.createElement("style");
  s.id = "alm-iconbtn-styles";
  s.textContent = `.alm-iconbtn:hover { background: var(--theme-modal-border) !important; }`;
  document.head.appendChild(s);
}
