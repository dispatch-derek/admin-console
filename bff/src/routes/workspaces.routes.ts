// Workspace product routes (§5, 02-product-api.md). All require a session — the global
// guard enforces it; requireStaff resolves the actor id for audit/events. Routes are thin:
// they parse the product body and delegate to workspace.service, which owns the chain.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../server/errors.js';
import type { WorkspaceSettings } from '../types/product-types.js';
import {
  changeDocuments,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceSettings,
  listDocuments,
  listWorkspaces,
  pinDocument,
  updateWorkspaceSettings,
} from '../services/workspace.service.js';

function body<T>(req: FastifyRequest): T {
  return (req.body ?? {}) as T;
}

function requireStaff(req: FastifyRequest): { id: string; username: string } {
  if (!req.staff) throw new AppError(401, 'Not authenticated');
  return req.staff;
}

export async function workspacesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/workspaces', async (req, reply) => {
    requireStaff(req);
    return reply.send(await listWorkspaces());
  });

  app.get('/api/documents', async (req, reply) => {
    requireStaff(req);
    return reply.send(await listDocuments());
  });

  app.get('/api/workspaces/:id', async (req, reply) => {
    requireStaff(req);
    const { id } = req.params as { id: string };
    return reply.send(await getWorkspaceSettings(id));
  });

  app.post('/api/workspaces', async (req, reply) => {
    const actor = requireStaff(req);
    const { displayName } = body<{ displayName?: string }>(req);
    if (!displayName) throw new AppError(400, 'displayName is required');
    const workspace = await createWorkspace(actor.id, displayName);
    return reply.code(201).send(workspace);
  });

  app.patch('/api/workspaces/:id/settings', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    const patch = body<Partial<WorkspaceSettings>>(req);
    return reply.send(await updateWorkspaceSettings(actor.id, id, patch));
  });

  app.delete('/api/workspaces/:id', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    await deleteWorkspace(actor.id, id);
    return reply.code(204).send();
  });

  app.put('/api/workspaces/:id/knowledge', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    const { adds, deletes } = body<{ adds?: string[]; deletes?: string[] }>(req);
    const addList = adds ?? [];
    const deleteList = deletes ?? [];
    if (addList.length === 0 && deleteList.length === 0) {
      throw new AppError(400, 'adds or deletes must be provided');
    }
    return reply.send(await changeDocuments(actor.id, id, addList, deleteList));
  });

  app.post('/api/workspaces/:id/knowledge/pin', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    const { docPath, pinned } = body<{ docPath?: string; pinned?: boolean }>(req);
    if (!docPath || typeof pinned !== 'boolean') {
      throw new AppError(400, 'docPath and pinned (boolean) are required');
    }
    await pinDocument(actor.id, id, docPath, pinned);
    return reply.code(204).send();
  });
}
