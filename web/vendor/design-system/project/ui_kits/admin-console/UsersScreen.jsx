// Users admin screen — table of accounts with row actions + Add User modal.
function UsersScreen() {
  const NS = window.AnythingLLMAdminDesignSystem_4c97b8;
  const { PageHeader, Table, Button, Badge, Modal, Input, Textarea, Select } = NS;
  const [users, setUsers] = React.useState([
    { name: "admin", role: "Admin", date: "Jan 2, 2025" },
    { name: "sarah.chen", role: "Manager", date: "Feb 14, 2025" },
    { name: "devon.k", role: "Default", date: "Mar 3, 2025" },
    { name: "priya.n", role: "Default", date: "Apr 21, 2025" },
    { name: "marcus.lee", role: "Manager", date: "Jun 8, 2025" },
  ]);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", role: "Default" });

  const roleTone = { Admin: "info", Manager: "success", Default: "neutral" };

  function addUser() {
    if (form.name.trim()) setUsers((u) => [...u, { name: form.name.trim(), role: form.role, date: "Jul 5, 2026" }]);
    setForm({ name: "", role: "Default" });
    setOpen(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <PageHeader title="Users" description="These are all the accounts which have an account on this instance. Removing an account will instantly remove their access to this instance."
        action={<Button variant="cta" icon={<i className="ph-bold ph-user-plus" />} onClick={() => setOpen(true)}>Add user</Button>} />
      <div style={{ marginTop: 24 }}>
        <Table columns={["Username", "Role", "Date Added", ""]}>
          {users.map((u, i) => (
            <Table.Row key={i}>
              <Table.Cell header>{u.name}</Table.Cell>
              <Table.Cell><Badge tone={roleTone[u.role]}>{u.role}</Badge></Table.Cell>
              <Table.Cell><span style={{ color: "var(--theme-text-secondary)" }}>{u.date}</span></Table.Cell>
              <Table.Cell>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="ghost" size="sm">Edit</Button>
                  <Button variant="ghost" size="sm">Suspend</Button>
                  <Button variant="danger" size="sm">Delete</Button>
                </div>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table>
      </div>
      {open && (
        <Modal title="Add user to instance" onClose={() => setOpen(false)}
          footer={<>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="solid" onClick={addUser}>Add user</Button>
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="Username" placeholder="User's username" value={form.name}
              hint="Username must be only contain lowercase letters, numbers, underscores, and hyphens with no spaces"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Password" type="password" placeholder="User's initial password" hint="Password must be at least 8 characters long" />
            <Textarea label="Bio" rows={2} placeholder="User's bio" />
            <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              options={["Default", "Manager", "Admin"]} />
          </div>
        </Modal>
      )}
    </div>
  );
}
window.UsersScreen = UsersScreen;
