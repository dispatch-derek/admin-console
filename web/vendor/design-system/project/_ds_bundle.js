/* @ds-bundle: {"format":4,"namespace":"AnythingLLMAdminDesignSystem_4c97b8","components":[{"name":"Badge","sourcePath":"components/data-display/Badge.jsx"},{"name":"PageHeader","sourcePath":"components/data-display/PageHeader.jsx"},{"name":"Table","sourcePath":"components/data-display/Table.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Toggle","sourcePath":"components/forms/Toggle.jsx"},{"name":"SidebarItem","sourcePath":"components/navigation/SidebarItem.jsx"},{"name":"Modal","sourcePath":"components/overlays/Modal.jsx"}],"sourceHashes":{"components/data-display/Badge.jsx":"7f59e4b87fb7","components/data-display/PageHeader.jsx":"d06df94454cd","components/data-display/Table.jsx":"69ab7fc7316b","components/forms/Button.jsx":"78f6f5c6d7f4","components/forms/IconButton.jsx":"ab1568b4bcc9","components/forms/Input.jsx":"b15fe12395dc","components/forms/Select.jsx":"958c620115e1","components/forms/Textarea.jsx":"4a8c47006166","components/forms/Toggle.jsx":"37c454609b0d","components/navigation/SidebarItem.jsx":"42b2bcc92a41","components/overlays/Modal.jsx":"ca3ea92dadca","ui_kits/admin-console/AdminSidebar.jsx":"890421b9460f","ui_kits/admin-console/EventLogScreen.jsx":"48b691410dbc","ui_kits/admin-console/LoginScreen.jsx":"6d188cc86a83","ui_kits/admin-console/UsersScreen.jsx":"dafa7287916c","ui_kits/admin-console/WorkspacesScreen.jsx":"0c4bd2629b12"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AnythingLLMAdminDesignSystem_4c97b8 = window.AnythingLLMAdminDesignSystem_4c97b8 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/data-display/Badge.jsx
try { (() => {
/**
 * Status pill used in event logs and metadata. Fully rounded, translucent
 * fill with a matching bright text color. Tones map to the product's
 * event-badge color logic (info / success / warn / danger).
 */
function Badge({
  children,
  tone = "info",
  className = "",
  style = {}
}) {
  const tones = {
    info: {
      bg: "var(--theme-badge-info-bg)",
      color: "var(--theme-badge-info-text)"
    },
    success: {
      bg: "var(--theme-badge-success-bg)",
      color: "var(--theme-badge-success-text)"
    },
    warn: {
      bg: "var(--theme-badge-warn-bg)",
      color: "var(--theme-badge-warn-text)"
    },
    danger: {
      bg: "var(--theme-badge-danger-bg)",
      color: "var(--theme-badge-danger-text)"
    },
    neutral: {
      bg: "rgba(255,255,255,0.08)",
      color: "var(--theme-text-secondary)"
    }
  }[tone] || {};
  return /*#__PURE__*/React.createElement("span", {
    className: className,
    style: {
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
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/data-display/PageHeader.jsx
try { (() => {
/**
 * Section header for admin console pages. Bold title (18px) with a small
 * secondary description below and a 2px bottom border — the standard header
 * that opens Users / Workspaces / Event Log screens. Optional right-aligned
 * action slot.
 */
function PageHeader({
  title,
  description,
  action,
  className = "",
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: "16px",
      paddingBottom: "24px",
      borderBottom: "2px solid var(--theme-sidebar-border)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "4px"
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: "var(--font-sans)",
      fontSize: "18px",
      lineHeight: "24px",
      fontWeight: 700,
      color: "var(--theme-text-primary)"
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      maxWidth: "760px",
      fontFamily: "var(--font-sans)",
      fontSize: "12px",
      lineHeight: "18px",
      color: "var(--theme-text-secondary)"
    }
  }, description)), action && /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0
    }
  }, action));
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Table.jsx
try { (() => {
/**
 * Admin data table. Uppercase, bold, secondary-colored headers over
 * hairline-separated rows (h-40, text-xs). Pass `columns` (array of header
 * labels) and `children` <Table.Row>/<tr> rows, or compose manually.
 */
function Table({
  columns = [],
  children,
  minWidth = 640,
  className = "",
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: "auto",
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: className,
    style: {
      width: "100%",
      minWidth,
      textAlign: "left",
      borderCollapse: "collapse",
      fontFamily: "var(--font-sans)",
      fontSize: "12px",
      ...style
    }
  }, columns.length > 0 && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: "1px solid var(--theme-sidebar-border)"
    }
  }, columns.map((c, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    scope: "col",
    style: {
      padding: "12px 24px",
      fontSize: "12px",
      fontWeight: 700,
      lineHeight: "18px",
      textTransform: "uppercase",
      letterSpacing: "0.02em",
      color: "var(--theme-text-secondary)",
      whiteSpace: "nowrap"
    }
  }, c)))), /*#__PURE__*/React.createElement("tbody", null, children)));
}

/** A body row. Cells are <Table.Cell> or plain <td>. */
Table.Row = function Row({
  children,
  className = "",
  style = {}
}) {
  return /*#__PURE__*/React.createElement("tr", {
    className: className,
    style: {
      height: 40,
      color: "rgba(255,255,255,0.8)",
      fontWeight: 500,
      borderBottom: "1px solid var(--theme-sidebar-border)",
      ...style
    }
  }, children);
};
Table.Cell = function Cell({
  children,
  header = false,
  style = {}
}) {
  const Tag = header ? "th" : "td";
  return /*#__PURE__*/React.createElement(Tag, {
    scope: header ? "row" : undefined,
    style: {
      padding: "0 24px",
      whiteSpace: header ? "nowrap" : "normal",
      fontWeight: header ? 500 : "inherit",
      ...style
    }
  }, children);
};
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Table.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
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
function Button({
  children,
  variant = "cta",
  size = "md",
  disabled = false,
  full = false,
  icon = null,
  onClick,
  type = "button",
  className = "",
  style = {}
}) {
  const heights = {
    sm: 28,
    md: 34,
    lg: 40
  };
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
    transition: "background-color .2s ease, color .2s ease, opacity .2s ease"
  };
  const variants = {
    cta: {
      background: "var(--theme-button-primary)",
      color: "#0e0f0f"
    },
    solid: {
      background: "#ffffff",
      color: "#000000"
    },
    ghost: {
      background: "transparent",
      color: "var(--theme-text-primary)"
    },
    danger: {
      background: "transparent",
      color: "#f87171"
    },
    login: {
      background: "#ffffff",
      color: "#09090b",
      fontWeight: 600,
      fontSize: "14px"
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    disabled: disabled,
    onClick: onClick,
    className: `alm-btn alm-btn--${variant} ${className}`,
    style: {
      ...base,
      ...variants[variant],
      ...style
    }
  }, icon, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
/**
 * Icon-only button used across the admin console — modal close (X),
 * header shortcuts (house), row actions. Circular or rounded-square,
 * transparent by default with a faint fill on hover.
 */
function IconButton({
  children,
  onClick,
  size = 34,
  shape = "square",
  // "square" | "circle"
  variant = "default",
  // "default" | "menu"
  title,
  className = "",
  style = {}
}) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    padding: 0,
    color: "var(--theme-text-primary)",
    background: variant === "menu" ? "var(--theme-action-menu-bg)" : "transparent",
    border: "1px solid transparent",
    borderRadius: shape === "circle" ? "9999px" : "var(--radius-sm)",
    cursor: "pointer",
    transition: "background-color .2s ease, border-color .2s ease"
  };
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    title: title,
    onClick: onClick,
    className: `alm-iconbtn ${className}`,
    style: {
      ...base,
      ...style
    }
  }, children);
}
if (typeof document !== "undefined" && !document.getElementById("alm-iconbtn-styles")) {
  const s = document.createElement("style");
  s.id = "alm-iconbtn-styles";
  s.textContent = `.alm-iconbtn:hover { background: var(--theme-modal-border) !important; }`;
  document.head.appendChild(s);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
/**
 * Settings/form text input. Borderless, dark fill, rounded-lg, 10px padding.
 * Focus ring uses the primary cyan (outline). Supports an optional label + hint.
 */
function Input({
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
  style = {}
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
    outline: "none"
  };
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "14px",
      fontWeight: 500,
      color: "var(--theme-text-primary)"
    }
  }, label), /*#__PURE__*/React.createElement("input", {
    id: id,
    name: name,
    type: type,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    required: required,
    className: "alm-input",
    style: field
  }), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: "12px",
      color: "var(--theme-text-secondary)"
    }
  }, hint));
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
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
/**
 * Settings/form select. Matches Input styling — borderless dark fill,
 * rounded-lg, with a custom caret.
 */
function Select({
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
  style = {}
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
    backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='4 6 8 10 12 6'/></svg>\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center"
  };
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "14px",
      fontWeight: 500,
      color: "var(--theme-text-primary)"
    }
  }, label), /*#__PURE__*/React.createElement("select", {
    id: id,
    name: name,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    className: "alm-input",
    style: field
  }, options ? options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value ?? o,
    value: o.value ?? o
  }, o.label ?? o)) : children), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: "12px",
      color: "var(--theme-text-secondary)"
    }
  }, hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
/**
 * Multi-line settings input. Same visual language as Input.
 */
function Textarea({
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
  style = {}
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
    resize: "vertical"
  };
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "14px",
      fontWeight: 500,
      color: "var(--theme-text-primary)"
    }
  }, label), /*#__PURE__*/React.createElement("textarea", {
    id: id,
    name: name,
    rows: rows,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    className: "alm-input",
    style: field
  }), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: "12px",
      color: "var(--theme-text-secondary)"
    }
  }, hint));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/forms/Toggle.jsx
try { (() => {
/**
 * Toggle switch. Green when on, zinc when off — matches the product Toggle.
 * Optional label + description, "default" (switch first) or "horizontal"
 * (label left, switch right) layout.
 */
function Toggle({
  enabled = false,
  onChange,
  disabled = false,
  size = "md",
  label,
  description,
  variant = "default",
  name,
  className = "",
  style = {}
}) {
  const dims = {
    sm: {
      w: 20,
      h: 12,
      knob: 8
    },
    md: {
      w: 28,
      h: 16,
      knob: 12
    },
    lg: {
      w: 36,
      h: 19,
      knob: 15
    }
  }[size];
  const track = {
    position: "relative",
    flexShrink: 0,
    width: dims.w,
    height: dims.h,
    borderRadius: "9999px",
    background: enabled ? "var(--theme-toggle-on)" : "var(--theme-toggle-off)",
    transition: "background-color .2s ease",
    cursor: disabled ? "not-allowed" : "pointer"
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
    transition: "transform .2s ease"
  };
  const Switch = /*#__PURE__*/React.createElement("div", {
    role: "switch",
    "aria-checked": enabled,
    onClick: () => !disabled && onChange?.(!enabled),
    style: {
      ...track,
      opacity: disabled ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: knob
  }));
  const Text = (label || description) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "2px"
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: size === "lg" ? "16px" : "14px",
      fontWeight: 500,
      color: "var(--theme-text-primary)"
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "12px",
      color: "var(--theme-text-secondary)",
      maxWidth: "520px"
    }
  }, description));
  if (variant === "horizontal") {
    return /*#__PURE__*/React.createElement("div", {
      className: className,
      style: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "16px",
        maxWidth: "700px",
        ...style
      }
    }, Text, Switch);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "flex-start",
      gap: "12px",
      ...style
    }
  }, Switch, Text);
}
Object.assign(__ds_scope, { Toggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Toggle.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarItem.jsx
try { (() => {
/**
 * Settings-sidebar navigation item. 32px tall, 6px radius, icon + label.
 * Selected state gets a faint fill + semibold label; hover gets a subtle fill.
 * `caret` shows an expand chevron for parent items.
 */
function SidebarItem({
  label,
  icon = null,
  active = false,
  caret = false,
  expanded = false,
  isChild = false,
  onClick,
  className = "",
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `alm-navitem ${active ? "is-active" : ""} ${className}`,
    onClick: onClick,
    style: {
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
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      minWidth: 0
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      color: "var(--theme-text-primary)"
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: isChild ? "12px" : "14px",
      fontWeight: active ? 600 : 500,
      color: "var(--theme-text-primary)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, label)), caret && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      color: "var(--theme-text-primary)",
      transform: expanded ? "rotate(90deg)" : "none",
      transition: "transform .2s ease"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "6 4 10 8 6 12"
  }))));
}
if (typeof document !== "undefined" && !document.getElementById("alm-navitem-styles")) {
  const s = document.createElement("style");
  s.id = "alm-navitem-styles";
  s.textContent = `.alm-navitem:not(.is-active):hover { background: var(--theme-sidebar-item-hover) !important; }`;
  document.head.appendChild(s);
}
Object.assign(__ds_scope, { SidebarItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarItem.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Modal.jsx
try { (() => {
/**
 * Modal dialog shell matching the admin console. Dark backdrop (50% black),
 * centered card with bg-secondary, 2px border, rounded-lg. Header (title + X),
 * scrollable body, and an optional footer (border-top) for Cancel/confirm.
 */
function Modal({
  open = true,
  title,
  onClose,
  children,
  footer,
  width = 672,
  // max-w-2xl
  className = ""
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 50,
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    className: className,
    style: {
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
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "24px",
      borderBottom: "1px solid var(--theme-modal-border)"
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: "20px",
      fontWeight: 600,
      color: "var(--theme-text-primary)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, title), onClose && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    className: "alm-modal-x",
    style: {
      display: "inline-flex",
      padding: "4px",
      background: "transparent",
      border: "1px solid transparent",
      borderRadius: "var(--radius-sm)",
      cursor: "pointer",
      color: "var(--theme-text-primary)"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "22",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("line", {
    x1: "18",
    y1: "6",
    x2: "6",
    y2: "18"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "6",
    x2: "18",
    y2: "18"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "24px",
      overflowY: "auto"
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "24px",
      borderTop: "1px solid var(--theme-modal-border)"
    }
  }, footer)));
}
if (typeof document !== "undefined" && !document.getElementById("alm-modal-styles")) {
  const s = document.createElement("style");
  s.id = "alm-modal-styles";
  s.textContent = `.alm-modal-x:hover { background: var(--theme-modal-border) !important; }`;
  document.head.appendChild(s);
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Modal.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/AdminSidebar.jsx
try { (() => {
// Admin console sidebar — brand mark, nav sections, footer. Cosmetic recreation.
function AdminSidebar({
  active,
  onNavigate
}) {
  const {
    SidebarItem
  } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const items = [{
    key: "users",
    label: "Users",
    icon: "ph ph-users-three"
  }, {
    key: "workspaces",
    label: "Workspaces",
    icon: "ph ph-squares-four"
  }, {
    key: "invites",
    label: "Invitations",
    icon: "ph ph-envelope-simple"
  }, {
    key: "log",
    label: "Event Log",
    icon: "ph ph-list-magnifying-glass"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 252,
      flexShrink: 0,
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: 18,
      boxSizing: "border-box",
      background: "var(--theme-bg-sidebar)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      letterSpacing: "-0.01em",
      color: "#fff"
    }
  }, "Admin Console"), /*#__PURE__*/React.createElement("a", {
    title: "Home",
    style: {
      display: "inline-flex",
      padding: 8,
      borderRadius: 9999,
      color: "#fff",
      background: "var(--theme-action-menu-bg)",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ph ph-house",
    style: {
      fontSize: 16
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--theme-sidebar-border)",
      margin: "10px 0 14px"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: ".05em",
      textTransform: "uppercase",
      color: "var(--theme-text-secondary)",
      padding: "0 12px 8px"
    }
  }, "Admin"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, items.map(it => /*#__PURE__*/React.createElement(SidebarItem, {
    key: it.key,
    icon: /*#__PURE__*/React.createElement("i", {
      className: it.icon,
      style: {
        fontSize: 18
      }
    }),
    label: it.label,
    active: active === it.key,
    onClick: () => onNavigate(it.key)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--theme-sidebar-border)",
      margin: "14px 0"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: ".05em",
      textTransform: "uppercase",
      color: "var(--theme-text-secondary)",
      padding: "0 12px 8px"
    }
  }, "Instance"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(SidebarItem, {
    icon: /*#__PURE__*/React.createElement("i", {
      className: "ph ph-flask",
      style: {
        fontSize: 18
      }
    }),
    label: "Agent Skills",
    caret: true
  }), /*#__PURE__*/React.createElement(SidebarItem, {
    icon: /*#__PURE__*/React.createElement("i", {
      className: "ph ph-sliders-horizontal",
      style: {
        fontSize: 18
      }
    }),
    label: "System Prompt"
  }), /*#__PURE__*/React.createElement(SidebarItem, {
    icon: /*#__PURE__*/React.createElement("i", {
      className: "ph ph-paint-brush",
      style: {
        fontSize: 18
      }
    }),
    label: "Appearance"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 9999,
      background: "var(--gradient-selected)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontSize: 12,
      fontWeight: 700
    }
  }, "A"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: "#fff"
    }
  }, "admin"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "var(--theme-text-secondary)"
    }
  }, "Administrator"))));
}
window.AdminSidebar = AdminSidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/AdminSidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/EventLogScreen.jsx
try { (() => {
// Event Log admin screen — table with status badges + expandable metadata.
function EventLogScreen() {
  const {
    PageHeader,
    Table,
    Badge,
    Button
  } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const rows = [{
    event: "login_event",
    tone: "success",
    user: "admin",
    at: "Jul 5, 2026 09:14",
    meta: {
      ip: "10.0.0.2",
      ua: "Chrome/126"
    }
  }, {
    event: "workspace_created",
    tone: "info",
    user: "sarah.chen",
    at: "Jul 5, 2026 08:52",
    meta: {
      workspace: "Engineering"
    }
  }, {
    event: "system_settings_updated",
    tone: "warn",
    user: "admin",
    at: "Jul 4, 2026 17:03",
    meta: {
      field: "llm_provider",
      to: "openai"
    }
  }, {
    event: "user_deleted",
    tone: "danger",
    user: "system",
    at: "Jul 4, 2026 16:40",
    meta: {
      target: "old.account"
    }
  }, {
    event: "api_key_generated",
    tone: "info",
    user: "devon.k",
    at: "Jul 4, 2026 11:20",
    meta: null
  }];
  const [expanded, setExpanded] = React.useState(1);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Event Log",
    description: "View all actions and events happening on this instance for monitoring.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "cta",
      icon: /*#__PURE__*/React.createElement("i", {
        className: "ph-bold ph-broom"
      })
    }, "Clear Event Log")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(Table, {
    columns: ["Event", "User", "Occurred At", ""]
  }, rows.map((r, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement(Table.Row, {
    style: {
      cursor: r.meta ? "pointer" : "default"
    }
  }, /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement(Badge, {
    tone: r.tone
  }, r.event)), /*#__PURE__*/React.createElement(Table.Cell, null, r.user), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--theme-text-secondary)"
    }
  }, r.at)), /*#__PURE__*/React.createElement(Table.Cell, null, r.meta && /*#__PURE__*/React.createElement("button", {
    onClick: () => setExpanded(expanded === i ? -1 : i),
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: "rgba(255,255,255,.5)",
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: `ph-bold ${expanded === i ? "ph-caret-up" : "ph-caret-down"}`,
    style: {
      fontSize: 16
    }
  }), expanded === i ? "hide" : "show"))), r.meta && expanded === i && /*#__PURE__*/React.createElement("tr", {
    style: {
      background: "var(--theme-bg-primary)"
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "16px 24px",
      fontWeight: 500,
      color: "#fff",
      borderTopLeftRadius: 12,
      borderBottomLeftRadius: 12
    }
  }, "Event Metadata"), /*#__PURE__*/React.createElement("td", {
    colSpan: 3,
    style: {
      padding: "16px 24px",
      borderTopRightRadius: 12,
      borderBottomRightRadius: 12
    }
  }, /*#__PURE__*/React.createElement("pre", {
    style: {
      margin: 0,
      padding: 10,
      borderRadius: 8,
      background: "rgba(255,255,255,.05)",
      border: "1px solid var(--theme-sidebar-border)",
      color: "#fff",
      fontSize: 12,
      fontFamily: "var(--font-mono)"
    }
  }, JSON.stringify(r.meta, null, 2)))))))));
}
window.EventLogScreen = EventLogScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/EventLogScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/LoginScreen.jsx
try { (() => {
// Multi-user login screen — recreation of the Admin Console auth modal.
function LoginScreen({
  onLogin
}) {
  const {
    Button
  } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const field = {
    boxSizing: "border-box",
    width: 300,
    height: 34,
    padding: "0 10px",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    color: "#e4e4e7",
    background: "#27272a",
    border: "none",
    borderRadius: 8,
    outline: "none"
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "#09090b",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 28,
      fontWeight: 700,
      letterSpacing: "-0.01em",
      color: "#fff",
      marginBottom: 8
    }
  }, "Admin Console"), /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onLogin();
    },
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px 0 36px",
      textAlign: "center",
      maxWidth: 300
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 38,
      lineHeight: "28px",
      fontWeight: 500,
      color: "#fff"
    }
  }, "Welcome Back"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "18px 0 0",
      fontSize: 14,
      color: "#a1a1aa"
    }
  }, "Sign in to your Admin Console instance.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12,
      padding: "0 48px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 14,
      color: "#d4d4d8"
    }
  }, "Username"), /*#__PURE__*/React.createElement("input", {
    style: field,
    defaultValue: "admin"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 14,
      color: "#d4d4d8"
    }
  }, "Password"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    style: field,
    defaultValue: "password"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 24,
      padding: "36px 48px 0",
      width: 300,
      boxSizing: "content-box"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "login",
    full: true,
    type: "submit"
  }, "Login"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      fontSize: 14,
      color: "#e4e4e7"
    }
  }, "Forgot password? ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "#7dd3fc"
    }
  }, "Reset")))));
}
window.LoginScreen = LoginScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/UsersScreen.jsx
try { (() => {
// Users admin screen — table of accounts with row actions + Add User modal.
function UsersScreen() {
  const NS = window.AnythingLLMAdminDesignSystem_4c97b8;
  const {
    PageHeader,
    Table,
    Button,
    Badge,
    Modal,
    Input,
    Textarea,
    Select
  } = NS;
  const [users, setUsers] = React.useState([{
    name: "admin",
    role: "Admin",
    date: "Jan 2, 2025"
  }, {
    name: "sarah.chen",
    role: "Manager",
    date: "Feb 14, 2025"
  }, {
    name: "devon.k",
    role: "Default",
    date: "Mar 3, 2025"
  }, {
    name: "priya.n",
    role: "Default",
    date: "Apr 21, 2025"
  }, {
    name: "marcus.lee",
    role: "Manager",
    date: "Jun 8, 2025"
  }]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    role: "Default"
  });
  const roleTone = {
    Admin: "info",
    Manager: "success",
    Default: "neutral"
  };
  function addUser() {
    if (form.name.trim()) setUsers(u => [...u, {
      name: form.name.trim(),
      role: form.role,
      date: "Jul 5, 2026"
    }]);
    setForm({
      name: "",
      role: "Default"
    });
    setOpen(false);
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Users",
    description: "These are all the accounts which have an account on this instance. Removing an account will instantly remove their access to this instance.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "cta",
      icon: /*#__PURE__*/React.createElement("i", {
        className: "ph-bold ph-user-plus"
      }),
      onClick: () => setOpen(true)
    }, "Add user")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(Table, {
    columns: ["Username", "Role", "Date Added", ""]
  }, users.map((u, i) => /*#__PURE__*/React.createElement(Table.Row, {
    key: i
  }, /*#__PURE__*/React.createElement(Table.Cell, {
    header: true
  }, u.name), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement(Badge, {
    tone: roleTone[u.role]
  }, u.role)), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--theme-text-secondary)"
    }
  }, u.date)), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "Edit"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "Suspend"), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm"
  }, "Delete"))))))), open && /*#__PURE__*/React.createElement(Modal, {
    title: "Add user to instance",
    onClose: () => setOpen(false),
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => setOpen(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "solid",
      onClick: addUser
    }, "Add user"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Username",
    placeholder: "User's username",
    value: form.name,
    hint: "Username must be only contain lowercase letters, numbers, underscores, and hyphens with no spaces",
    onChange: e => setForm({
      ...form,
      name: e.target.value
    })
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Password",
    type: "password",
    placeholder: "User's initial password",
    hint: "Password must be at least 8 characters long"
  }), /*#__PURE__*/React.createElement(Textarea, {
    label: "Bio",
    rows: 2,
    placeholder: "User's bio"
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Role",
    value: form.role,
    onChange: e => setForm({
      ...form,
      role: e.target.value
    }),
    options: ["Default", "Manager", "Admin"]
  }))));
}
window.UsersScreen = UsersScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/UsersScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin-console/WorkspacesScreen.jsx
try { (() => {
// Workspaces admin screen — table of workspaces.
function WorkspacesScreen() {
  const {
    PageHeader,
    Table,
    Button
  } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const rows = [{
    name: "Product Docs",
    slug: "product-docs",
    users: 8,
    date: "Jan 12, 2025"
  }, {
    name: "Support KB",
    slug: "support-kb",
    users: 5,
    date: "Feb 2, 2025"
  }, {
    name: "Engineering",
    slug: "engineering",
    users: 12,
    date: "Mar 19, 2025"
  }, {
    name: "Sales Enablement",
    slug: "sales-enablement",
    users: 4,
    date: "May 6, 2025"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Instance Workspaces",
    description: "These are all the workspaces that exist in this instance. Removing a workspace will delete all of its associated chats and settings.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "cta",
      icon: /*#__PURE__*/React.createElement("i", {
        className: "ph-bold ph-plus"
      })
    }, "New Workspace")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(Table, {
    columns: ["Name", "Link", "Users", "Created On", ""]
  }, rows.map((r, i) => /*#__PURE__*/React.createElement(Table.Row, {
    key: i
  }, /*#__PURE__*/React.createElement(Table.Cell, {
    header: true
  }, r.name), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement("a", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      color: "#fff",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ph ph-link-simple",
    style: {
      fontSize: 15
    }
  }), " ", r.slug)), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement("a", {
    style: {
      color: "#fff",
      textDecoration: "underline",
      cursor: "pointer"
    }
  }, r.users)), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--theme-text-secondary)"
    }
  }, r.date)), /*#__PURE__*/React.createElement(Table.Cell, null, /*#__PURE__*/React.createElement("button", {
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      color: "rgba(255,255,255,.8)",
      display: "inline-flex",
      padding: 4
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ph ph-trash",
    style: {
      fontSize: 18
    }
  }))))))));
}
window.WorkspacesScreen = WorkspacesScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin-console/WorkspacesScreen.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Toggle = __ds_scope.Toggle;

__ds_ns.SidebarItem = __ds_scope.SidebarItem;

__ds_ns.Modal = __ds_scope.Modal;

})();
