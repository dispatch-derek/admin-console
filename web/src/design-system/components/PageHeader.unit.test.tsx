// White-box unit tests for PageHeader (REQ-F001-045). Complements PageHeader.test.tsx (spec-level)
// by exercising: the action-absent branch (no action wrapper rendered), className/style
// pass-through, and the title/description heading semantics (REQ-F001-021/-030 lock-in): the title
// is an <h1> (the page's top-level heading landmark), NOT a <p> — a regression the a11y/Playwright
// review caught pre-fix — while `description`, when present, remains a <p>.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../index';

describe('PageHeader (white-box)', () => {
  it('renders no action wrapper when `action` is omitted', () => {
    const { container } = render(<PageHeader title="Workspaces" />);
    // only the text wrapper div should be a child of the header
    const header = container.firstElementChild!;
    expect(header.children.length).toBe(1);
  });

  it('renders the title as a level-1 heading, not a <p> (REQ-F001-021/-030)', () => {
    render(<PageHeader title="Workspaces" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Workspaces');
  });

  it('renders zero <p> elements when `description` is omitted', () => {
    const { container } = render(<PageHeader title="Workspaces" />);
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('renders the description as a <p> when provided (title stays an <h1>)', () => {
    const { container } = render(
      <PageHeader title="Workspaces" description="Manage your workspaces." />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]).toHaveTextContent('Manage your workspaces.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workspaces');
  });

  it('merges a caller-supplied className with the internal class', () => {
    const { container } = render(<PageHeader title="Workspaces" className="extra" />);
    expect(container.firstElementChild!.className).toEqual(expect.stringContaining('extra'));
  });

  it('applies a caller-supplied `style`', () => {
    render(<PageHeader title="Workspaces" style={{ marginBottom: '2rem' }} />);
    expect(screen.getByText('Workspaces').parentElement!.parentElement).toHaveStyle({ marginBottom: '2rem' });
  });
});
