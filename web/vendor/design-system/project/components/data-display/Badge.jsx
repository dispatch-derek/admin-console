import React from "react";

/**
 * Status pill used in event logs and metadata. Fully rounded, translucent
 * fill with a matching bright text color. Tones map to the product's
 * event-badge color logic (info / success / warn / danger).
 */
export function Badge({ children, tone = "info", className = "", style = {} }) {
  const tones = {
    info: { bg: "var(--theme-badge-info-bg)", color: "var(--theme-badge-info-text)" },
    success: { bg: "var(--theme-badge-success-bg)", color: "var(--theme-badge-success-text)" },
    warn: { bg: "var(--theme-badge-warn-bg)", color: "var(--theme-badge-warn-text)" },
    danger: { bg: "var(--theme-badge-danger-bg)", color: "var(--theme-badge-danger-text)" },
    neutral: { bg: "rgba(255,255,255,0.08)", color: "var(--theme-text-secondary)" },
  }[tone] || {};

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: "9999px",
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
        fontWeight: 500,
        lineHeight: 1.4,
        background: tones.bg,
        color: tones.color,
        boxShadow: "var(--shadow-sm)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
