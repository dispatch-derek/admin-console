import React from "react";

/**
 * Toggle switch. Green when on, zinc when off — matches the product Toggle.
 * Optional label + description, "default" (switch first) or "horizontal"
 * (label left, switch right) layout.
 */
export function Toggle({
  enabled = false,
  onChange,
  disabled = false,
  size = "md",
  label,
  description,
  variant = "default",
  name,
  className = "",
  style = {},
}) {
  const dims = {
    sm: { w: 20, h: 12, knob: 8 },
    md: { w: 28, h: 16, knob: 12 },
    lg: { w: 36, h: 19, knob: 15 },
  }[size];

  const track = {
    position: "relative",
    flexShrink: 0,
    width: dims.w,
    height: dims.h,
    borderRadius: "9999px",
    background: enabled ? "var(--theme-toggle-on)" : "var(--theme-toggle-off)",
    transition: "background-color .2s ease",
    cursor: disabled ? "not-allowed" : "pointer",
  };
  const knob = {
    position: "absolute",
    top: 2,
    left: 2,
    width: dims.knob,
    height: dims.knob,
    borderRadius: "9999px",
    background: "#fff",
    transform: enabled ? `translateX(${dims.w - dims.knob - 4}px)` : "translateX(0)",
    transition: "transform .2s ease",
  };

  const Switch = (
    <div
      role="switch"
      aria-checked={enabled}
      onClick={() => !disabled && onChange?.(!enabled)}
      style={{ ...track, opacity: disabled ? 0.5 : 1 }}
    >
      <span style={knob} />
    </div>
  );

  const Text = (label || description) && (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {label && (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: size === "lg" ? "16px" : "14px", fontWeight: 500, color: "var(--theme-text-primary)" }}>
          {label}
        </span>
      )}
      {description && (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--theme-text-secondary)", maxWidth: "520px" }}>
          {description}
        </span>
      )}
    </div>
  );

  if (variant === "horizontal") {
    return (
      <div className={className} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", maxWidth: "700px", ...style }}>
        {Text}
        {Switch}
      </div>
    );
  }
  return (
    <div className={className} style={{ display: "inline-flex", alignItems: "flex-start", gap: "12px", ...style }}>
      {Switch}
      {Text}
    </div>
  );
}
