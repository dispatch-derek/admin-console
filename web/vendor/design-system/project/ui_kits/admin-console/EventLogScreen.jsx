// Event Log admin screen — table with status badges + expandable metadata.
function EventLogScreen() {
  const { PageHeader, Table, Badge, Button } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const rows = [
    { event: "login_event", tone: "success", user: "admin", at: "Jul 5, 2026 09:14", meta: { ip: "10.0.0.2", ua: "Chrome/126" } },
    { event: "workspace_created", tone: "info", user: "sarah.chen", at: "Jul 5, 2026 08:52", meta: { workspace: "Engineering" } },
    { event: "system_settings_updated", tone: "warn", user: "admin", at: "Jul 4, 2026 17:03", meta: { field: "llm_provider", to: "openai" } },
    { event: "user_deleted", tone: "danger", user: "system", at: "Jul 4, 2026 16:40", meta: { target: "old.account" } },
    { event: "api_key_generated", tone: "info", user: "devon.k", at: "Jul 4, 2026 11:20", meta: null },
  ];
  const [expanded, setExpanded] = React.useState(1);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <PageHeader title="Event Log" description="View all actions and events happening on this instance for monitoring."
        action={<Button variant="cta" icon={<i className="ph-bold ph-broom" />}>Clear Event Log</Button>} />
      <div style={{ marginTop: 24 }}>
        <Table columns={["Event", "User", "Occurred At", ""]}>
          {rows.map((r, i) => (
            <React.Fragment key={i}>
              <Table.Row style={{ cursor: r.meta ? "pointer" : "default" }}>
                <Table.Cell><Badge tone={r.tone}>{r.event}</Badge></Table.Cell>
                <Table.Cell>{r.user}</Table.Cell>
                <Table.Cell><span style={{ color: "var(--theme-text-secondary)" }}>{r.at}</span></Table.Cell>
                <Table.Cell>
                  {r.meta && (
                    <button onClick={() => setExpanded(expanded === i ? -1 : i)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.5)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <i className={`ph-bold ${expanded === i ? "ph-caret-up" : "ph-caret-down"}`} style={{ fontSize: 16 }} />
                      {expanded === i ? "hide" : "show"}
                    </button>
                  )}
                </Table.Cell>
              </Table.Row>
              {r.meta && expanded === i && (
                <tr style={{ background: "var(--theme-bg-primary)" }}>
                  <td style={{ padding: "16px 24px", fontWeight: 500, color: "#fff", borderTopLeftRadius: 12, borderBottomLeftRadius: 12 }}>Event Metadata</td>
                  <td colSpan={3} style={{ padding: "16px 24px", borderTopRightRadius: 12, borderBottomRightRadius: 12 }}>
                    <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: "rgba(255,255,255,.05)", border: "1px solid var(--theme-sidebar-border)", color: "#fff", fontSize: 12, fontFamily: "var(--font-mono)" }}>
{JSON.stringify(r.meta, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </Table>
      </div>
    </div>
  );
}
window.EventLogScreen = EventLogScreen;
