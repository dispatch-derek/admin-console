// Workspace service (§5, REQ-032–REQ-039). Owns the per-call responsibility chain for
// workspaces (01-bff §chain): resolve id→slug → translate product→engine → adapter call →
// re-shape → verify-after-write → emit event + audit. Reads do steps 1–5 only. Mutations
// run through verifiedWrite (REQ-028): on success exactly one event + one success audit row;
// on an unconfirmed change verifiedWrite throws 409 and we write a failure audit + rethrow.

import { engineAdapter as adapter } from '../engine/adapter.js';
import {
  documentPaths,
  toDocumentRef,
  toWorkspace,
  toWorkspaceSettings,
  toWorkspaceUpdate,
  validateWorkspacePatch,
} from '../engine/mappers.js';
import {
  ensureNumericId,
  forget,
  recordNew,
  reconcile,
  resolveSlug,
} from '../identity/workspace-map.js';
import { verifiedWrite } from './verify.js';
import { emitAdminEvent } from '../events/emitter.js';
import { recordAudit } from '../audit/audit.js';
import { AppError } from '../server/errors.js';
import type { DocumentRef, Workspace, WorkspaceSettings } from '../types/product-types.js';

// Run a mutation through verifiedWrite, writing a failure audit row on the unconfirmed 409
// (or any thrown error) before rethrowing, so audit stays entirely in the service layer.
async function runVerified<T>(
  action: string,
  actorId: string,
  target: Record<string, unknown>,
  opts: {
    write: () => Promise<void>;
    reread: () => Promise<T>;
    confirm: (state: T) => boolean;
    onUnconfirmed: string;
  },
): Promise<T> {
  try {
    return await verifiedWrite(opts);
  } catch (err) {
    recordAudit({
      actor: actorId,
      action,
      outcome: 'failure',
      target,
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

// GET /api/workspaces — list, reconciling any engine workspace not yet mapped (REQ-021b).
export async function listWorkspaces(): Promise<Workspace[]> {
  const engineWorkspaces = await adapter.listWorkspaces();
  const bySlug = reconcile(engineWorkspaces);
  const out: Workspace[] = [];
  for (const engine of engineWorkspaces) {
    const productId = bySlug.get(engine.slug);
    if (!productId) continue; // unreachable: reconcile maps every slug
    out.push(toWorkspace(engine, productId));
  }
  return out;
}

// GET /api/workspaces/:id — full settings detail.
export async function getWorkspaceSettings(productId: string): Promise<WorkspaceSettings> {
  const slug = resolveSlug(productId);
  const engine = await adapter.getWorkspace(slug);
  if (!engine) throw new AppError(404, 'Workspace not found');
  return toWorkspaceSettings(engine, productId);
}

// POST /api/workspaces — create + mint a handle, then verify the workspace exists with the
// intended name (REQ-037). If the create response omitted the numeric id, do a follow-up
// list lookup to backfill it (REQ-037 MIN-4).
export async function createWorkspace(
  actorId: string,
  displayName: string,
): Promise<Workspace> {
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new AppError(400, 'displayName is required');
  }
  const created = await adapter.createWorkspace({ name: displayName });
  const row = recordNew(created);
  const productId = row.product_id;

  if (created.id === undefined || created.id === null) {
    const all = await adapter.listWorkspaces();
    ensureNumericId(productId, all);
  }

  const target = { id: productId };
  let reread: Awaited<ReturnType<typeof adapter.getWorkspace>>;
  try {
    reread = await runVerified<Awaited<ReturnType<typeof adapter.getWorkspace>>>(
      'workspace.create',
      actorId,
      target,
      {
        write: async () => {}, // the create above IS the write; verify by re-reading
        reread: () => adapter.getWorkspace(created.slug),
        confirm: (ws) => ws !== null && ws.name === displayName,
        onUnconfirmed: 'Workspace creation could not be confirmed',
      },
    );
  } catch (err) {
    // Roll back the just-minted handle so an unconfirmed create leaves no orphan mapping row.
    forget(productId);
    throw err;
  }

  await emitAdminEvent('admin.workspace.created', actorId, target, true, { displayName });
  recordAudit({
    actor: actorId,
    action: 'workspace.create',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
  return toWorkspace(reread!, productId);
}

// PATCH /api/workspaces/:id/settings — partial settings write (REQ-033/036).
export async function updateWorkspaceSettings(
  actorId: string,
  productId: string,
  patch: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  validateWorkspacePatch(patch);
  const slug = resolveSlug(productId);
  const engineBody = toWorkspaceUpdate(patch);
  const engineKeys = Object.keys(engineBody) as Array<keyof typeof engineBody>;
  if (engineKeys.length === 0) throw new AppError(400, 'No changes provided');

  const target = { id: productId };
  const reread = await runVerified<Awaited<ReturnType<typeof adapter.getWorkspace>>>(
    'workspace.update',
    actorId,
    target,
    {
      write: () => adapter.updateWorkspace(slug, engineBody),
      reread: () => adapter.getWorkspace(slug),
      confirm: (ws) =>
        ws !== null &&
        engineKeys.every(
          (k) =>
            (ws as unknown as Record<string, unknown>)[k] ===
            (engineBody as Record<string, unknown>)[k],
        ),
      onUnconfirmed: 'Workspace settings change could not be confirmed',
    },
  );

  await emitAdminEvent('admin.workspace.updated', actorId, target, true, engineBody);
  recordAudit({
    actor: actorId,
    action: 'workspace.update',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
  return toWorkspaceSettings(reread!, productId);
}

// DELETE /api/workspaces/:id — delete + verify the workspace is gone (REQ-038). A 404
// re-read is success (adapter.getWorkspace returns null on 404).
export async function deleteWorkspace(actorId: string, productId: string): Promise<void> {
  const slug = resolveSlug(productId);
  const target = { id: productId };
  await runVerified<Awaited<ReturnType<typeof adapter.getWorkspace>>>(
    'workspace.delete',
    actorId,
    target,
    {
      write: () => adapter.deleteWorkspace(slug),
      reread: () => adapter.getWorkspace(slug),
      confirm: (ws) => ws === null,
      onUnconfirmed: 'Workspace deletion could not be confirmed',
    },
  );

  forget(productId);
  await emitAdminEvent('admin.workspace.deleted', actorId, target, true);
  recordAudit({
    actor: actorId,
    action: 'workspace.delete',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
}

// PUT /api/workspaces/:id/knowledge — attach/detach documents + verify the deltas landed.
export async function changeDocuments(
  actorId: string,
  productId: string,
  adds: string[],
  deletes: string[],
): Promise<WorkspaceSettings> {
  const slug = resolveSlug(productId);
  const target = { id: productId };
  const reread = await runVerified<Awaited<ReturnType<typeof adapter.getWorkspace>>>(
    'workspace.documents_change',
    actorId,
    target,
    {
      write: () => adapter.updateEmbeddings(slug, adds, deletes),
      reread: () => adapter.getWorkspace(slug),
      confirm: (ws) => {
        if (ws === null) return false;
        const paths = documentPaths(ws);
        return (
          adds.every((a) => paths.includes(a)) && deletes.every((d) => !paths.includes(d))
        );
      },
      onUnconfirmed: 'Document change could not be confirmed',
    },
  );

  await emitAdminEvent('admin.workspace.documents_changed', actorId, target, true, {
    adds,
    deletes,
  });
  recordAudit({
    actor: actorId,
    action: 'workspace.documents_change',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
  return toWorkspaceSettings(reread!, productId);
}

// POST /api/workspaces/:id/knowledge/pin — pin/unpin a document + verify the pin state.
export async function pinDocument(
  actorId: string,
  productId: string,
  docPath: string,
  pinned: boolean,
): Promise<void> {
  const slug = resolveSlug(productId);
  const target = { id: productId };
  const action = 'workspace.pin';
  await runVerified<Awaited<ReturnType<typeof adapter.getWorkspace>>>(
    action,
    actorId,
    target,
    {
      write: () => adapter.updatePin(slug, docPath, pinned),
      reread: () => adapter.getWorkspace(slug),
      confirm: (ws) => {
        if (ws === null) return false;
        const doc = (ws.documents ?? []).find((d) => (d.docpath ?? d.name) === docPath);
        return doc !== undefined && doc.pinned === pinned;
      },
      onUnconfirmed: 'Pin change could not be confirmed',
    },
  );

  await emitAdminEvent(
    pinned ? 'admin.workspace.knowledge_pinned' : 'admin.workspace.knowledge_unpinned',
    actorId,
    target,
    true,
    { docPath, pinned },
  );
  recordAudit({
    actor: actorId,
    action,
    outcome: 'success',
    target,
    detail: { verified: true },
  });
}

// GET /api/documents — the document source list (REQ-039 MI-5).
export async function listDocuments(): Promise<DocumentRef[]> {
  const docs = await adapter.listDocuments();
  return docs.map(toDocumentRef);
}
