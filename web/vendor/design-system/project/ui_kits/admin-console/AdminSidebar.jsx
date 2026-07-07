// Admin console sidebar — brand mark, nav sections, footer. Cosmetic recreation.
function AdminSidebar({ active, onNavigate }) {
  const { SidebarItem } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const items = [
    { key: "users", label: "Users", icon: "ph ph-users-three" },
    { key: "workspaces", label: "Workspaces", icon: "ph ph-squares-four" },
    { key: "invites", label: "Invitations", icon: "ph ph-envelope-simple" },
    { key: "log", label: "Event Log", icon: "ph ph-list-magnifying-glass" },
  ];
  return (
    <div style={{ width: 252, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column", padding: 18, boxSizing: "border-box", background: "var(--theme-bg-sidebar)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: "#fff" }}>Admin Console</span>
        <a title="Home" style={{ display: "inline-flex", padding: 8, borderRadius: 9999, color: "#fff", background: "var(--theme-action-menu-bg)", cursor: "pointer" }}>
          <i className="ph ph-house" style={{ fontSize: 16 }} />
        </a>
      </div>
      <div style={{ height: 1, background: "var(--theme-sidebar-border)", margin: "10px 0 14px" }} />
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--theme-text-secondary)", padding: "0 12px 8px" }}>Admin</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it) => (
          <SidebarItem key={it.key} icon={<i className={it.icon} style={{ fontSize: 18 }} />} label={it.label} active={active === it.key} onClick={() => onNavigate(it.key)} />
        ))}
      </div>
      <div style={{ height: 1, background: "var(--theme-sidebar-border)", margin: "14px 0" }} />
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--theme-text-secondary)", padding: "0 12px 8px" }}>Instance</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SidebarItem icon={<i className="ph ph-flask" style={{ fontSize: 18 }} />} label="Agent Skills" caret />
        <SidebarItem icon={<i className="ph ph-sliders-horizontal" style={{ fontSize: 18 }} />} label="System Prompt" />
        <SidebarItem icon={<i className="ph ph-paint-brush" style={{ fontSize: 18 }} />} label="Appearance" />
      </div>
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <div style={{ width: 30, height: 30, borderRadius: 9999, background: "var(--gradient-selected)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>A</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>admin</span>
          <span style={{ fontSize: 10, color: "var(--theme-text-secondary)" }}>Administrator</span>
        </div>
      </div>
    </div>
  );
}
window.AdminSidebar = AdminSidebar;
