// User / invite / membership product routes (§6.1–§6.4, 02-product-api.md). All require a
// session — the global guard enforces it; requireStaff resolves the actor id for
// audit/events. Routes are thin: they parse the product body and delegate to
// user.service, which owns the chain.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../server/errors.js';
import {
  createInvite,
  createUser,
  deleteInvite,
  deleteUser,
  getMultiUserStatus,
  listInvites,
  listMembers,
  listUsers,
  updateMembers,
  updateUser,
} from '../services/user.service.js';

function body<T>(req: FastifyRequest): T {
  return (req.body ?? {}) as T;
}

function requireStaff(req: FastifyRequest): { id: string; username: string } {
  if (!req.staff) throw new AppError(401, 'Not authenticated');
  return req.staff;
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/multi-user-status', async (req, reply) => {
    requireStaff(req);
    return reply.send(await getMultiUserStatus());
  });

  app.get('/api/users', async (req, reply) => {
    requireStaff(req);
    return reply.send(await listUsers());
  });

  app.post('/api/users', async (req, reply) => {
    const actor = requireStaff(req);
    const { username, password, role } = body<{
      username?: string;
      password?: string;
      role?: string;
    }>(req);
    if (!username || !password || !role) {
      throw new AppError(400, 'username, password, and role are required');
    }
    const user = await createUser(actor.id, { username, password, role });
    return reply.code(201).send(user);
  });

  app.patch('/api/users/:id', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    const patch = body<{
      role?: string;
      suspended?: boolean;
      dailyMessageLimit?: number | null;
    }>(req);
    return reply.send(await updateUser(actor.id, id, patch));
  });

  app.delete('/api/users/:id', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    await deleteUser(actor.id, id);
    return reply.code(204).send();
  });

  app.get('/api/invites', async (req, reply) => {
    requireStaff(req);
    return reply.send(await listInvites());
  });

  app.post('/api/invites', async (req, reply) => {
    const actor = requireStaff(req);
    const { workspaceIds } = body<{ workspaceIds?: string[] }>(req);
    const invite = await createInvite(actor.id, workspaceIds ?? []);
    return reply.code(201).send(invite);
  });

  app.delete('/api/invites/:id', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    await deleteInvite(actor.id, id);
    return reply.code(204).send();
  });

  app.get('/api/workspaces/:id/members', async (req, reply) => {
    requireStaff(req);
    const { id } = req.params as { id: string };
    return reply.send(await listMembers(id));
  });

  app.post('/api/workspaces/:id/members', async (req, reply) => {
    const actor = requireStaff(req);
    const { id } = req.params as { id: string };
    const { userIds, reset } = body<{ userIds?: unknown; reset?: unknown }>(req);
    if (!Array.isArray(userIds) || typeof reset !== 'boolean') {
      throw new AppError(400, 'userIds (array) and reset (boolean) are required');
    }
    return reply.send(await updateMembers(actor.id, id, userIds as string[], reset));
  });
}
