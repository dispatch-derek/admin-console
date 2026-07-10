// Per-workspace membership management (§6.4, REQ-048/049). Pick a workspace, view its members, and
// add/remove users. Adds use a non-reset write (userIds appended); removes send the full remaining
// desired set with reset=true so the removed user is dropped.

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Select, Button } from '../../design-system';
import type { User, Workspace } from '../../api/types';

export function MembershipPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [members, setMembers] = useState<User[]>([]);
  const [addUserId, setAddUserId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.listWorkspaces(), api.listUsers()])
      .then(([ws, users]) => {
        if (!active) return;
        setWorkspaces(ws);
        setAllUsers(users);
      })
      .catch(
        (err) => active && setError(err instanceof ApiError ? err.message : 'Failed to load'),
      );
    return () => {
      active = false;
    };
  }, []);

  const loadMembers = useCallback(async (id: string) => {
    setError(null);
    try {
      setMembers(await api.listMembers(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load members');
    }
  }, []);

  function selectWorkspace(id: string) {
    setWorkspaceId(id);
    setMembers([]);
    if (id) void loadMembers(id);
  }

  async function add() {
    if (!workspaceId || !addUserId) return;
    setError(null);
    setBusy(true);
    try {
      await api.updateMembers(workspaceId, { userIds: [addUserId], reset: false });
      setAddUserId('');
      await loadMembers(workspaceId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    if (!workspaceId) return;
    setError(null);
    setBusy(true);
    try {
      const remaining = members.filter((m) => m.id !== userId).map((m) => m.id);
      await api.updateMembers(workspaceId, { userIds: remaining, reset: true });
      await loadMembers(workspaceId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set(members.map((m) => m.id));
  const addable = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <section className="ac-membership-panel">
      <ErrorBanner message={error} />

      <Select
        label="Workspace"
        value={workspaceId}
        onChange={(e) => selectWorkspace(e.target.value)}
      >
        <option value="">— select —</option>
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.displayName}
          </option>
        ))}
      </Select>

      {workspaceId && (
        <>
          <div className="ac-add-member">
            <Select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
              <option value="">— select user —</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </Select>
            <Button variant="solid" disabled={busy || !addUserId} onClick={add}>
              Add member
            </Button>
          </div>

          <ul className="ac-member-list">
            {members.map((m) => (
              <li key={m.id}>
                <span className="ac-doc-title">{m.username}</span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(m.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
