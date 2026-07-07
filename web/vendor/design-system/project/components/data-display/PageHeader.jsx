import React from "react";

/**
 * Section header for admin console pages. Bold title (18px) with a small
 * secondary description below and a 2px bottom border — the standard header
 * that opens Users / Workspaces / Event Log screens. Optional right-aligned
 * action slot.
 */
export function PageHeader({ title, description, action, className = "", style = {} }) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "16px",
        paddingBottom: "24px",
        borderBottom: "2px solid var(--theme-sidebar-border)",
        ...style,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: "18px", lineHeight: "24px", fontWeight: 700, color: "var(--theme-text-primary)" }}>
          {title}
        </p>
        {description && (
          <p style={{ margin: 0, maxWidth: "760px", fontFamily: "var(--font-sans)", fontSize: "12px", lineHeight: "18px", color: "var(--theme-text-secondary)" }}>
            {description}
          </p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
