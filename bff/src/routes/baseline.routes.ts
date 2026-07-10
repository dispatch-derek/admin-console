// F-002 baseline product routes (§7.2). Thin Fastify handlers under /api, all staff-session
// guarded by the global guard (parent REQ-012); error bodies are { message } (parent REQ-097a).
// The route table names six method+path handlers across five distinct path patterns
// (/api/baseline-prompt, .../status, .../preview, .../apply). Handlers parse the product body,
// resolve the actor, and delegate to baseline.service. Per REQ-F002-021/047/048/055 the apply body
// carries a required, validated `mode` (prose governs over the abbreviated §7.2 table example).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../server/errors.js';
import {
  apply,
  clearBaseline,
  getBaseline,
  getStatus,
  runPreview,
  setBaseline,
} from '../services/baseline.service.js';

function requireStaff(req: FastifyRequest): { id: string; username: string } {
  if (!req.staff) throw new AppError(401, 'Not authenticated');
  return req.staff;
}

export async function baselineRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/baseline-prompt', async (req, reply) => {
    requireStaff(req);
    return reply.send(getBaseline());
  });

  app.put('/api/baseline-prompt', async (req, reply) => {
    const actor = requireStaff(req);
    const { text } = (req.body ?? {}) as { text?: unknown };
    return reply.send(await setBaseline(actor.id, text));
  });

  app.delete('/api/baseline-prompt', async (req, reply) => {
    const actor = requireStaff(req);
    return reply.send(await clearBaseline(actor.id));
  });

  app.get('/api/baseline-prompt/status', async (req, reply) => {
    requireStaff(req);
    return reply.send(await getStatus());
  });

  app.get('/api/baseline-prompt/preview', async (req, reply) => {
    requireStaff(req);
    const { mode } = (req.query ?? {}) as { mode?: string };
    return reply.send(await runPreview(mode));
  });

  app.post('/api/baseline-prompt/apply', async (req, reply) => {
    const actor = requireStaff(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    return reply.send(await apply(actor.id, body));
  });
}
