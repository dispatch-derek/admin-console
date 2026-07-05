// SPEC REQ-039 (slice-3 follow-up c) — the knowledge panel shows the workspace's CURRENTLY-attached
// documents with their pin state, and an "available to attach" picker of not-yet-attached docs.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgePanel } from './KnowledgePanel';
import * as api from '../../api/client';
import type { WorkspaceDocument } from '../../api/types';

vi.mock('../../api/client');
const mockedApi = vi.mocked(api);

const ATTACHED: WorkspaceDocument[] = [
  { id: 'custom-documents/a.txt', title: 'Doc A', pinned: true },
  { id: 'custom-documents/b.txt', title: 'Doc B', pinned: false },
];

describe('KnowledgePanel (REQ-039 attach/pin state)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Global doc set: one already attached (a.txt), one attachable (c.txt).
    mockedApi.listDocuments.mockResolvedValue([
      { id: 'custom-documents/a.txt', title: 'Doc A' },
      { id: 'custom-documents/c.txt', title: 'Doc C' },
    ]);
  });

  it('lists attached documents with their pin state and only the not-yet-attached in the picker', async () => {
    render(<KnowledgePanel workspaceId="ws-1" attached={ATTACHED} />);

    // Wait for the async global-doc load so the "available" picker has rendered.
    expect(await screen.findByText('Doc C')).toBeInTheDocument();

    // Attached list (rendered from props): Doc A pinned, Doc B not pinned.
    const attachedList = screen.getAllByRole('list')[0]!;
    expect(within(attachedList).getByText('Doc A')).toBeInTheDocument();
    expect(within(attachedList).getByText('Doc B')).toBeInTheDocument();
    expect(within(attachedList).getByText('Pinned')).toBeInTheDocument();
    expect(within(attachedList).getByText('Not pinned')).toBeInTheDocument();

    // The picker offers Doc C (attachable) but NOT Doc A (already attached) → one Attach button.
    expect(screen.getAllByRole('button', { name: 'Attach' })).toHaveLength(1);
  });

  it('attaching a document calls changeKnowledge with the doc id and reflects the returned state', async () => {
    const onChanged = vi.fn();
    mockedApi.changeKnowledge.mockResolvedValue({
      documents: [...ATTACHED, { id: 'custom-documents/c.txt', title: 'Doc C', pinned: false }],
    } as never);
    render(<KnowledgePanel workspaceId="ws-1" attached={ATTACHED} onChanged={onChanged} />);

    await screen.findByText('Doc C');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));

    expect(mockedApi.changeKnowledge).toHaveBeenCalledWith('ws-1', { adds: ['custom-documents/c.txt'] });
    expect(onChanged).toHaveBeenCalled();
  });
});
