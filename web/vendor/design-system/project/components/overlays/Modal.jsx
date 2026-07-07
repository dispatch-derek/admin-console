import React from "react";

/**
 * Modal dialog shell matching the admin console. Dark backdrop (50% black),
 * centered card with bg-secondary, 2px border, rounded-lg. Header (title + X),
 * scrollable body, and an optional footer (border-top) for Cancel/confirm.
 */
export function Modal({
  open = true,
  title,
  onClose,
  children,
  footer,
  width = 672, // max-w-2xl
  className = "",
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={className}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: width,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--theme-bg-secondary)",
          border: "2px solid var(--theme-modal-border)",
          borderRadius: "var(--radius-sm)",
          boxShadow: "var(--shadow-modal)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px", borderBottom: "1px solid var(--theme-modal-border)" }}>
          <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 600, color: "var(--theme-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="alm-modal-x"
              style={{ display: "inline-flex", padding: "4px", background: "transparent", border: "1px solid transparent", borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--theme-text-primary)" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div style={{ padding: "24px", overflowY: "auto" }}>{children}</div>
        {footer && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "24px", borderTop: "1px solid var(--theme-modal-border)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

if (typeof document !== "undefined" && !document.getElementById("alm-modal-styles")) {
  const s = document.createElement("style");
  s.id = "alm-modal-styles";
  s.textContent = `.alm-modal-x:hover { background: var(--theme-modal-border) !important; }`;
  document.head.appendChild(s);
}
