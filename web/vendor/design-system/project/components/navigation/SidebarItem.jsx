import React from "react";

/**
 * Settings-sidebar navigation item. 32px tall, 6px radius, icon + label.
 * Selected state gets a faint fill + semibold label; hover gets a subtle fill.
 * `caret` shows an expand chevron for parent items.
 */
export function SidebarItem({
  label,
  icon = null,
  active = false,
  caret = false,
  expanded = false,
  isChild = false,
  onClick,
  className = "",
  style = {},
}) {
  return (
    <div
      className={`alm-navitem ${active ? "is-active" : ""} ${className}`}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        height: 32,
        padding: "0 12px",
        borderRadius: "var(--radius-xs)",
        cursor: "pointer",
        background: active ? "var(--theme-sidebar-item-selected)" : "transparent",
        transition: "background-color .2s ease",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        {icon && <span style={{ display: "inline-flex", color: "var(--theme-text-primary)" }}>{icon}</span>}
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: isChild ? "12px" : "14px",
            fontWeight: active ? 600 : 500,
            color: "var(--theme-text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
      </div>
      {caret && (
        <span
          style={{
            display: "inline-flex",
            color: "var(--theme-text-primary)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform .2s ease",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 4 10 8 6 12" />
          </svg>
        </span>
      )}
    </div>
  );
}

if (typeof document !== "undefined" && !document.getElementById("alm-navitem-styles")) {
  const s = document.createElement("style");
  s.id = "alm-navitem-styles";
  s.textContent = `.alm-navitem:not(.is-active):hover { background: var(--theme-sidebar-item-hover) !important; }`;
  document.head.appendChild(s);
}
