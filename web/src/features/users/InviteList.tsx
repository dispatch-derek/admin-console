// Invite management (§6.3, REQ-045–047). List invites, create an invite scoped to selected
// workspaces, and revoke an invite.

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import type { Invite, Workspace } from '../../api/types';

export function InviteList() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [inv, ws] = await Promise.all([api.listInvites(), api.listWorkspaces()]);
      setInvites(inv);
      setWorkspaces(ws);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load invites');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function create() {
    setError(null);
    setBusy(true);
    try {
      await api.createInvite(selected);
      setSelected([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.deleteInvite(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="invite-list">
      <ErrorBanner message={error} />

      <div className="create-invite">
        <h3>Create invite (scoped to workspaces)</h3>
        <ul className="checkbox-list">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(ws.id)}
                  onChange={() => toggle(ws.id)}
                />
                {ws.displayName}
              </label>
            </li>
          ))}
        </ul>
        <button type="button" disabled={busy} onClick={create}>
          Create invite
        </button>
      </div>

      <table className="entity-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Status</th>
            <th>Workspaces</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {invites.map((inv) => (
            <tr key={inv.id}>
              <td>
                <code>{inv.code}</code>
              </td>
              <td>{inv.status}</td>
              <td>{inv.workspaceIds.length}</td>
              <td>
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  onClick={() => revoke(inv.id)}
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
