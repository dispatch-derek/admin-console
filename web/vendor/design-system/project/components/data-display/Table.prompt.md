Admin data table — uppercase bold secondary headers, hairline rows. The Users / Workspaces / Event Log table.

```jsx
<Table columns={["Username", "Role", "Date Added", ""]}>
  <Table.Row>
    <Table.Cell header>alice</Table.Cell>
    <Table.Cell>Admin</Table.Cell>
    <Table.Cell>Jan 2, 2025</Table.Cell>
    <Table.Cell><Button variant="ghost" size="sm">Edit</Button></Table.Cell>
  </Table.Row>
</Table>
```
