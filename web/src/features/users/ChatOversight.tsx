// Read-only chat oversight (§6.6, REQ-051). Fetches chat history via GET /api/oversight/chats with
// an optional workspace filter and limit/offset paging. Chats are opaque history records rendered
// as-is; the view performs no mutation.

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Select, Button } from '../../design-system';
import type { Workspace } from '../../api/types';

const PAGE_SIZE = 20;

export function ChatOversight() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<string>('');
  const [chats, setChats] = useState<unknown[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listWorkspaces()
      .then((ws) => active && setWorkspaces(ws))
      .catch(() => {
        /* workspace filter is optional; ignore load failure */
      });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(
    async (nextOffset: number, ws: string) => {
      setError(null);
      try {
        const page = await api.getOversightChats({
          workspace: ws || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setChats(page.chats);
        setHasMore(page.hasMore);
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load chats');
      }
    },
    [],
  );

  useEffect(() => {
    void load(0, workspace);
  }, [load, workspace]);

  return (
    <section className="ac-chat-oversight">
      <ErrorBanner message={error} />

      <Select
        label="Workspace filter"
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value)}
      >
        <option value="">All workspaces</option>
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.displayName}
          </option>
        ))}
      </Select>

      <ol className="ac-chat-list">
        {chats.map((chat, i) => (
          <li key={offset + i}>
            <pre>{JSON.stringify(chat, null, 2)}</pre>
          </li>
        ))}
      </ol>

      <div className="ac-pager">
        <Button
          variant="ghost"
          disabled={offset === 0}
          onClick={() => load(Math.max(0, offset - PAGE_SIZE), workspace)}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          disabled={!hasMore}
          onClick={() => load(offset + PAGE_SIZE, workspace)}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
