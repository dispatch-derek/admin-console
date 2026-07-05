// Workspace knowledge management (§5.4). Attach/detach documents (PUT .../knowledge) and pin/unpin
// (POST .../knowledge/pin). Detaching a document deletes its vector data for the workspace, so it
// is a §8 dangerous operation gated behind an explicit confirmation naming the affected document
// and warning of the deletion (REQ-087).

import { useEffect, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DangerConfirm } from '../../components/DangerConfirm';
import type { DocumentRef } from '../../api/types';

interface KnowledgePanelProps {
  workspaceId: string;
}

export function KnowledgePanel({ workspaceId }: KnowledgePanelProps) {
  const [documents, setDocuments] = useState<DocumentRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detachTarget, setDetachTarget] = useState<DocumentRef | null>(null);
  const [detachError, setDetachError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .listDocuments()
      .then((docs) => active && setDocuments(docs))
      .catch((err) =>
        active && setError(err instanceof ApiError ? err.message : 'Failed to load documents'),
      );
    return () => {
      active = false;
    };
  }, []);

  async function attach(doc: DocumentRef) {
    setError(null);
    try {
      await api.changeKnowledge(workspaceId, { adds: [doc.id] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Attach failed');
    }
  }

  async function pin(doc: DocumentRef, pinned: boolean) {
    setError(null);
    try {
      await api.pinKnowledge(workspaceId, { docPath: doc.id, pinned });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pin failed');
    }
  }

  async function confirmDetach() {
    if (!detachTarget) return;
    setDetachError(null);
    setBusy(true);
    try {
      await api.changeKnowledge(workspaceId, { deletes: [detachTarget.id] });
      setDetachTarget(null);
    } catch (err) {
      setDetachError(err instanceof ApiError ? err.message : 'Detach failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="knowledge-panel">
      <h3>Knowledge & documents</h3>
      <ErrorBanner message={error} />
      {documents.length === 0 ? (
        <p>No documents available.</p>
      ) : (
        <ul className="document-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <span className="doc-title">{doc.title}</span>
              <button type="button" onClick={() => attach(doc)}>
                Attach
              </button>
              <button type="button" onClick={() => pin(doc, true)}>
                Pin
              </button>
              <button type="button" onClick={() => pin(doc, false)}>
                Unpin
              </button>
              <button type="button" className="danger-button" onClick={() => setDetachTarget(doc)}>
                Detach
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
