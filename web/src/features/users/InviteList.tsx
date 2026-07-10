// Invite management (§6.3, REQ-045–047). List invites, create an invite scoped to selected
// workspaces, and revoke an invite.

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Button, Table } from '../../design-system';
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
    <section className="ac-invite-list">
      <ErrorBanner message={error} />

      <div className="ac-create-invite">
        <h3>Create invite (scoped to workspaces)</h3>
        <ul className="ac-checkbox-list">
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
        <Button variant="cta" disabled={busy} onClick={create}>
          Create invite
        </Button>
      </div>

      <Table columns={['Code', 'Status', 'Workspaces', 'Actions']}>
        {invites.map((inv) => (
          <Table.Row key={inv.id}>
            <Table.Cell>
              <code>{inv.code}</code>
            </Table.Cell>
            <Table.Cell>{inv.status}</Table.Cell>
            <Table.Cell>{inv.workspaceIds.length}</Table.Cell>
            <Table.Cell>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => revoke(inv.id)}>
                Revoke
              </Button>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table>
    </section>
  );
}
