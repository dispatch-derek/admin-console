/**
 * Design System Barrel — The ONLY public import surface for the Admin Console Design System.
 *
 * This module re-exports the 11 recreated DS components and their prop types. Screens MUST import
 * from this barrel exclusively, never from component internals (`design-system/components/*`).
 *
 * **Usage:**
 * ```typescript
 * import { Button, Badge, Table, Input, Modal } from '../../design-system';
 * ```
 *
 * Deep imports (e.g., `import Button from '../../design-system/components/Button'`) will fail the
 * oxlint adherence gate (REQ-F001-044 F-5). This constraint preserves the un-forked adoption layer
 * and enables durable re-syncs (REQ-F001-015, REQ-F001-025).
 *
 * **Token layer:** Imported once in `main.tsx`, the adopted DS token CSS defines all color, spacing,
 * and typography tokens (dark + light themes). Components reference tokens via CSS custom properties,
 * never raw hex/px values (enforced by both adherence gates, REQ-F001-044 and REQ-F001-047).
 *
 * **Reference:** `specs/F-001-adhere-to-design-system.md`, `web/src/design-system/README.md`
 * @category Design System
 */

export { Badge } from './components/Badge';
export type { BadgeProps } from './components/Badge';
export { PageHeader } from './components/PageHeader';
export type { PageHeaderProps } from './components/PageHeader';
export { Table } from './components/Table';
export type { TableProps, TableRowProps, TableCellProps } from './components/Table';
export { Button } from './components/Button';
export type { ButtonProps } from './components/Button';
export { IconButton } from './components/IconButton';
export type { IconButtonProps } from './components/IconButton';
export { Input } from './components/Input';
export type { InputProps } from './components/Input';
export { Select } from './components/Select';
export type { SelectProps, SelectOption } from './components/Select';
export { Textarea } from './components/Textarea';
export type { TextareaProps } from './components/Textarea';
export { Toggle } from './components/Toggle';
export type { ToggleProps } from './components/Toggle';
export { SidebarItem } from './components/SidebarItem';
export type { SidebarItemProps } from './components/SidebarItem';
export { Modal } from './components/Modal';
export type { ModalProps } from './components/Modal';
