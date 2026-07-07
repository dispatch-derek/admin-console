import React from "react";

/* Inject hover styles once (React-only, no external deps). */
if (typeof document !== "undefined" && !document.getElementById("alm-btn-styles")) {
  const s = document.createElement("style");
  s.id = "alm-btn-styles";
  s.textContent = `
    .alm-btn--cta:not(:disabled):hover   { background: var(--alm-secondary, #2c2f36) !important; color: #fff !important; }
    .alm-btn--solid:not(:disabled):hover { opacity: .6; }
    .alm-btn--login:not(:disabled):hover { background: #d4d4d8 !important; }
    .alm-btn--ghost:not(:disabled):hover { background: rgba(255,255,255,.08) !important; }
    .alm-btn--danger:not(:disabled):hover{ background: rgba(248,113,113,.12) !important; color:#fca5a5 !important; }
  `;
  document.head.appendChild(s);
}

/**
 * Admin Console button. Consolidates the product's action buttons:
 *   - cta     : cyan pill used for "Add user", "New workspace" (bg #46c8ff)
 *   - solid   : white fill / black text — the primary modal confirm
 *   - ghost   : transparent, used for "Cancel"
 *   - danger  : destructive text/hover
 *   - login   : full-width white button used on the auth screen
 */
export function Button({
  children,
  variant = "cta",
  size = "md",
  disabled = false,
  full = false,
  icon = null,
  onClick,
  type = "button",
  className = "",
  style = {},
}) {
  const heights = { sm: 28, md: 34, lg: 40 };
  const h = heights[size] || 34;

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    height: h,
    padding: size === "sm" ? "0 12px" : "0 16px",
    fontFamily: "var(--font-sans)",
    fontSize: size === "lg" ? "14px" : "12px",
    fontWeight: 600,
    lineHeight: 1,
    borderRadius: "var(--radius-sm)",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    width: full ? "100%" : "fit-content",
    whiteSpace: "nowrap",
    transition: "background-color .2s ease, color .2s ease, opacity .2s ease",
  };

  const variants = {
    cta: { background: "var(--theme-button-primary)", color: "#0e0f0f" },
    solid: { background: "#ffffff", color: "#000000" },
    ghost: { background: "transparent", color: "var(--theme-text-primary)" },
    danger: { background: "transparent", color: "#f87171" },
    login: {
      background: "#ffffff",
      color: "#09090b",
      fontWeight: 600,
      fontSize: "14px",
    },
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`alm-btn alm-btn--${variant} ${className}`}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {icon}
      {children}
    </button>
  );
}
