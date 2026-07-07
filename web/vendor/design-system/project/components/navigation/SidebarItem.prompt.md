Settings-sidebar nav item — 32px, icon + label, faint selected fill and hover. Use `caret` for expandable parents, `isChild` for nested rows.

```jsx
<SidebarItem icon={<i className="ph ph-users-three" />} label="Users" active />
<SidebarItem icon={<i className="ph ph-flask" />} label="Agent Skills" caret expanded />
```
