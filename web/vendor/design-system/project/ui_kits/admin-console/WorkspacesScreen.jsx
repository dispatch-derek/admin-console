// Workspaces admin screen — table of workspaces.
function WorkspacesScreen() {
  const { PageHeader, Table, Button } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const rows = [
    { name: "Product Docs", slug: "product-docs", users: 8, date: "Jan 12, 2025" },
    { name: "Support KB", slug: "support-kb", users: 5, date: "Feb 2, 2025" },
    { name: "Engineering", slug: "engineering", users: 12, date: "Mar 19, 2025" },
    { name: "Sales Enablement", slug: "sales-enablement", users: 4, date: "May 6, 2025" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <PageHeader title="Instance Workspaces" description="These are all the workspaces that exist in this instance. Removing a workspace will delete all of its associated chats and settings."
        action={<Button variant="cta" icon={<i className="ph-bold ph-plus" />}>New Workspace</Button>} />
      <div style={{ marginTop: 24 }}>
        <Table columns={["Name", "Link", "Users", "Created On", ""]}>
          {rows.map((r, i) => (
            <Table.Row key={i}>
              <Table.Cell header>{r.name}</Table.Cell>
              <Table.Cell>
                <a style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#fff", cursor: "pointer" }}>
                  <i className="ph ph-link-simple" style={{ fontSize: 15 }} /> {r.slug}
                </a>
              </Table.Cell>
              <Table.Cell><a style={{ color: "#fff", textDecoration: "underline", cursor: "pointer" }}>{r.users}</a></Table.Cell>
              <Table.Cell><span style={{ color: "var(--theme-text-secondary)" }}>{r.date}</span></Table.Cell>
              <Table.Cell>
                <button style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.8)", display: "inline-flex", padding: 4 }}>
                  <i className="ph ph-trash" style={{ fontSize: 18 }} />
                </button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table>
      </div>
    </div>
  );
}
window.WorkspacesScreen = WorkspacesScreen;
