# Admin Console — UI Kit

Interactive recreation of the **Admin Console** (the instance-management surface behind Settings → Admin). Cosmetic fidelity, fake data. No brand mark has been determined yet — the sidebar and login screen show "Admin Console" in plain type as a placeholder.

## Flow
1. **Login** — multi-user auth screen (dark, centered, cyan reset link). Any credentials → continue.
2. **Admin shell** — fixed sidebar + rounded secondary panel. Navigate between:
   - **Users** — accounts table with role badges + row actions; "Add user" opens the modal (functional add).
   - **Workspaces** — instance workspaces table with slug links + delete.
   - **Invitations** — empty-state + create-link CTA.
   - **Event Log** — event table with status badges and expandable JSON metadata rows.

## Files
- `index.html` — entry; wires login → shell, loads the DS bundle + Phosphor icon font.
- `AdminSidebar.jsx`, `LoginScreen.jsx`, `UsersScreen.jsx`, `WorkspacesScreen.jsx`, `EventLogScreen.jsx`.

## Composition
Screens compose the DS primitives from the design-system namespace (see `_ds_bundle.js` header): `PageHeader`, `Table`, `Badge`, `Button`, `Modal`, `Input`, `Select`, `Textarea`, `SidebarItem`. Layout constants (252px sidebar, 16px panel margins, rounded-16 shell) match the source `pages/Admin/*`.
