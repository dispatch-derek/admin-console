// Oversight product route (§6.6, 02-product-api.md). Session-guarded read-only route: parse
// the query params and delegate to oversight.service. No mutation, no event.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../server/errors.js';
import { getChats } from '../services/oversight.service.js';

function requireStaff(req: FastifyRequest): { id: string; username: string } {
  if (!req.staff) throw new AppError(401, 'Not authenticated');
  return req.staff;
}

export async function oversightRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/oversight/chats', async (req, reply) => {
    requireStaff(req);
    const q = req.query as { workspace?: string; limit?: string; offset?: string };
    const workspace = typeof q.workspace === 'string' ? q.workspace : undefined;
    // Drop non-numeric limit/offset rather than forward NaN to the engine query.
    const toInt = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    return reply.send(await getChats({ workspace, limit: toInt(q.limit), offset: toInt(q.offset) }));
  });
}
