// Workspace knowledge management (§5.4). Shows the workspace's CURRENTLY-attached documents with
// their pin state (from the workspace's `documents`, REQ-039) and a picker of not-yet-attached
// documents sourced from GET /api/documents. Attach/detach (PUT .../knowledge) and pin/unpin
// (POST .../knowledge/pin) mutate the workspace; changeKnowledge returns the updated workspace so
// the panel reflects the new state. Detaching deletes the document's vector data for the workspace,
// so it is a §8 dangerous operation gated behind an explicit confirmation naming the document (REQ-087).

import { useCallback, useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DangerConfirm } from '../../components/DangerConfirm';
import type { DocumentRef, WorkspaceDocument } from '../../api/types';

interface KnowledgePanelProps {
  workspaceId: string;
  attached: WorkspaceDocument[];
  onChanged?: (documents: WorkspaceDocument[]) => void;
}

export function KnowledgePanel({ workspaceId, attached, onChanged }: KnowledgePanelProps) {
  const [current, setCurrent] = useState<WorkspaceDocument[]>(attached);
  const [available, setAvailable] = useState<DocumentRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detachTarget, setDetachTarget] = useState<WorkspaceDocument | null>(null);
  const [detachError, setDetachError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep local state in sync if the parent reloads the workspace.
  useEffect(() => setCurrent(attached), [attached]);

  // The global document set feeds the "available to attach" picker (REQ-039 MI-5).
  useEffect(() => {
    let active = true;
    api
      .listDocuments()
      .then((docs) => active && setAvailable(docs))
      .catch(
        (err) => active && setError(err instanceof ApiError ? err.message : 'Failed to load documents'),
      );
    return () => {
      active = false;
    };
  }, []);

  const applyUpdated = useCallback(
    (documents: WorkspaceDocument[]) => {
      setCurrent(documents);
      onChanged?.(documents);
    },
    [onChanged],
  );

  const attachedIds = new Set(current.map((d) => d.id));
  const attachable = available.filter((d) => !attachedIds.has(d.id));

  async function attach(doc: DocumentRef) {
    setError(null);
    try {
      const updated = await api.changeKnowledge(workspaceId, { adds: [doc.id] });
      applyUpdated(updated.documents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Attach failed');
    }
  }

  async function togglePin(doc: WorkspaceDocument) {
    setError(null);
    try {
      await api.pinKnowledge(workspaceId, { docPath: doc.id, pinned: !doc.pinned });
      // pin/unpin returns 204; re-read the workspace to reflect the new pin state.
      const updated = await api.getWorkspace(workspaceId);
      applyUpdated(updated.documents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pin failed');
    }
  }

  async function confirmDetach() {
    if (!detachTarget) return;
    setDetachError(null);
    setBusy(true);
    try {
      const updated = await api.changeKnowledge(workspaceId, { deletes: [detachTarget.id] });
      applyUpdated(updated.documents);
      setDetachTarget(null);
    } catch (err) {
      setDetachError(err instanceof ApiError ? err.message : 'Detach failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="knowledge-panel">
      <h3>Knowledge &amp; documents</h3>
      <ErrorBanner message={error} />

      <h4>Attached documents</h4>
      {current.length === 0 ? (
        <p>No documents attached to this workspace.</p>
      ) : (
        <ul className="document-list attached">
          {current.map((doc) => (
            <li key={doc.id}>
              <span className="doc-title">{doc.title}</span>
              <span className={doc.pinned ? 'pin-on' : 'pin-off'}>
                {doc.pinned ? 'Pinned' : 'Not pinned'}
              </span>
              <button type="button" onClick={() => togglePin(doc)}>
                {doc.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => setDetachTarget(doc)}
              >
                Detach
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4>Available to attach</h4>
      {attachable.length === 0 ? (
        <p>No further documents available.</p>
      ) : (
        <ul className="document-list available">
          {attachable.map((doc) => (
            <li key={doc.id}>
              <span className="doc-title">{doc.title}</span>
              <button type="button" onClick={() => attach(doc)}>
                Attach
              </button>
            </li>
          ))}
        </ul>
      )}

      {detachTarget && (
        <DangerConfirm
          title="Detach document"
          target={detachTarget.title}
          consequence="Detaching removes this document from the workspace and deletes its vector data. This cannot be undone."
          error={detachError}
          busy={busy}
          confirmLabel="Detach document"
          onConfirm={confirmDetach}
          onCancel={() => {
            setDetachTarget(null);
            setDetachError(null);
          }}
        />
      )}
    </section>
  );
}
