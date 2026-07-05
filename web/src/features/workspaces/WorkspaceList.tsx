// Workspaces area (§5): list + view/edit + create + delete. A single fetch renders the list
// (REQ-100). Selecting a workspace opens its settings editor. Deletion is a §8 dangerous operation
// requiring the operator to type the workspace id/slug to confirm (REQ-081).

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DangerConfirm } from '../../components/DangerConfirm';
import { CreateWorkspace } from './CreateWorkspace';
import { WorkspaceSettings } from './WorkspaceSettings';
import type { Workspace } from '../../api/types';

export function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setWorkspaces(await api.listWorkspaces());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load workspaces');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setBusy(true);
    try {
      await api.deleteWorkspace(deleteTarget.id);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspaces-view">
      <div className="list-column">
        <div className="list-header">
          <h2>Workspaces</h2>
          <button type="button" onClick={() => setCreating(true)}>
            New
          </button>
        </div>
        <ErrorBanner message={error} />
        <ul className="entity-list">
          {workspaces.map((ws) => (
            <li key={ws.id} className={ws.id === selectedId ? 'selected' : undefined}>
              <button type="button" className="link-button" onClick={() => setSelectedId(ws.id)}>
                {ws.displayName}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => setDeleteTarget(ws)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="detail-column">
        {creating && (
          <CreateWorkspace
            onCreated={(ws) => {
              setCreating(false);
              setSelectedId(ws.id);
              void load();
            }}
            onCancel={() => setCreating(false)}
          />
        )}
        {!creating && selectedId && (
          <WorkspaceSettings
            key={selectedId}
            workspaceId={selectedId}
            onDeleted={() => {
              setSelectedId(null);
              void load();
            }}
          />
        )}
        {!creating && !selectedId && <p>Select a workspace to view its settings.</p>}
      </div>

      {deleteTarget && (
        <DangerConfirm
          title="Delete workspace"
          target={deleteTarget.displayName}
          consequence="Deleting this workspace permanently removes it and its data. This cannot be undone."
          expectedToken={deleteTarget.id}
          tokenLabel="workspace id"
          confirmLabel="Delete workspace"
          error={deleteError}
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}
