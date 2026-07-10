// Create a workspace (§5.3, REQ-037). The engine assigns the opaque slug; the console supplies at
// least a display name.

import { useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Input, Button } from '../../design-system';
import type { Workspace } from '../../api/types';

interface CreateWorkspaceProps {
  onCreated: (workspace: Workspace) => void;
  onCancel: () => void;
}

export function CreateWorkspace({ onCreated, onCancel }: CreateWorkspaceProps) {
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await api.createWorkspace(displayName.trim());
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ac-create-workspace" onSubmit={submit}>
      <h2>New workspace</h2>
      <Input
        label="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <ErrorBanner message={error} />
      <div className="ac-modal-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="cta" type="submit" disabled={busy || displayName.trim() === ''}>
          Create
        </Button>
      </div>
    </form>
  );
}
