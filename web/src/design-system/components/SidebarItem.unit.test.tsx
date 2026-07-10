// White-box unit tests for SidebarItem (REQ-F001-045). Complements SidebarItem.test.tsx (spec-level)
// by exercising: the caret-absent branch (no caret svg rendered by default), the expanded/collapsed
// caret modifier class, the active-state classes on both the item and label, and the isChild label
// modifier class. Also locks in the REQ-F001-021/-030 keyboard-operability fix: SidebarItem is a
// native `<button type="button">` (not a bare `<div>` with an onClick), so it is reachable by Tab
// and activates via Enter/Space, not just pointer clicks.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarItem } from '../index';

describe('SidebarItem (white-box)', () => {
  it('renders no caret element when `caret` is omitted (default false)', () => {
    const { container } = render(<SidebarItem label="Users" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders a caret element when `caret` is true', () => {
    const { container } = render(<SidebarItem label="Users" caret />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies the expanded caret modifier class only when caret && expanded', () => {
    const { container: collapsed } = render(<SidebarItem label="Users" caret expanded={false} />);
    const { container: expanded } = render(<SidebarItem label="Users2" caret expanded />);
    const collapsedCaretWrapper = collapsed.querySelectorAll('span')[1];
    const expandedCaretWrapper = expanded.querySelectorAll('span')[1];
    expect(collapsedCaretWrapper.className).not.toEqual(expect.stringContaining('caretExpanded'));
    expect(expandedCaretWrapper.className).toEqual(expect.stringContaining('caretExpanded'));
  });

  it('applies the active class to the outer item and the labelActive class to the label when `active`', () => {
    render(<SidebarItem label="Users" active />);
    const label = screen.getByText('Users');
    expect(label.className).toEqual(expect.stringContaining('labelActive'));
    expect(label.parentElement!.parentElement!.className).toEqual(expect.stringContaining('active'));
  });

  it('does not apply the active classes when `active` is omitted', () => {
    render(<SidebarItem label="Users" />);
    const label = screen.getByText('Users');
    expect(label.className).not.toEqual(expect.stringContaining('labelActive'));
  });

  it('applies the child label modifier class when `isChild`', () => {
    render(<SidebarItem label="Sub item" isChild />);
    expect(screen.getByText('Sub item').className).toEqual(expect.stringContaining('child'));
  });

  it('renders no icon wrapper when `icon` is omitted', () => {
    const { container } = render(<SidebarItem label="Users" />);
    expect(container.querySelectorAll('span').length).toBe(1); // just the label span
  });

  it('is a native, keyboard-focusable <button> (not a bare <div>), reachable by role', () => {
    render(<SidebarItem label="Users" />);
    const button = screen.getByRole('button', { name: 'Users' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button.tabIndex).toBe(0);
  });

  it('activates onClick via the keyboard (Enter and Space), not just a pointer click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<SidebarItem label="Workspaces" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Workspaces' });
    button.focus();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);

    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('reflects `active` in the button element itself (selected-state mapping)', () => {
    render(<SidebarItem label="Users" active />);
    const button = screen.getByRole('button', { name: 'Users' });
    expect(button.className).toEqual(expect.stringContaining('active'));
  });
});
