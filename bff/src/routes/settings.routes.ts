// Instance-settings, raw-editor, diagnostics, and model-discovery routes (§7,
// 02-product-api.md). All require a session (the global guard enforces it; requireStaff
// resolves the actor id for audit/events). Routes are thin: parse the product body and
// delegate to the settings/discovery services, which own the chain (verify + emit + audit).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../server/errors.js';
import type { SettingsPatch } from '../types/product-types.js';
import {
  getEnvDump,
  getRawEnv,
  getSettings,
  getVectorCount,
  patchSettings,
  putRawEnv,
} from '../services/settings.service.js';
import { getOllamaModels } from '../services/discovery.service.js';

function body<T>(req: FastifyRequest): T {
  return (req.body ?? {}) as T;
}

function requireStaff(req: FastifyRequest): { id: string; username: string } {
  if (!req.staff) throw new AppError(401, 'Not authenticated');
  return req.staff;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (req, reply) => {
    requireStaff(req);
    return reply.send(await getSettings());
  });

  app.patch('/api/settings', async (req, reply) => {
    const actor = requireStaff(req);
    const patch = body<SettingsPatch>(req);
    return reply.send(await patchSettings(actor.id, patch));
  });

  app.get('/api/settings/raw', async (req, reply) => {
    requireStaff(req);
    return reply.send(await getRawEnv());
  });

  app.put('/api/settings/raw', async (req, reply) => {
    const actor = requireStaff(req);
    const { writes } = body<{ writes?: { key: string; value: string }[] }>(req);
    if (!Array.isArray(writes) || writes.length === 0) {
      throw new AppError(400, 'writes must be a non-empty array');
    }
    return reply.send(await putRawEnv(actor.id, writes));
  });

  app.get('/api/diagnostics/vectors', async (req, reply) => {
    requireStaff(req);
    return reply.send(await getVectorCount());
  });

  app.get('/api/diagnostics/env', async (req, reply) => {
    requireStaff(req);
    return reply.send(await getEnvDump());
  });

  app.get('/api/models/ollama', async (req, reply) => {
    requireStaff(req);
    return reply.send(await getOllamaModels());
  });
}
