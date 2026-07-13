// F-005 feature-toggle product routes (§7.2). Thin Fastify handlers under /api, all staff-session
// guarded by the global guard (parent REQ-012); error bodies are { message } (parent REQ-097a).
// F-005 makes NO engine call (REQ-F005-003) — handlers touch only the console store via the service.
//
// Opaque featureKey encoding contract (REQ-F005-028): callers percent-encode the single path
// segment. Fastify's router decodes the :featureKey param EXACTLY ONCE and hands the handler the
// already-decoded literal, which it matches byte-for-byte against the catalog (no second decode, no
// normalization, no case folding). A malformed percent-sequence (`%E0%A4%A`) makes the router throw
// FST_ERR_BAD_URL BEFORE dispatch; that failure is owned by `frameworkErrorHandler` (server/
// errors.ts, wired via Fastify's `frameworkErrors` in index.ts), which maps it to 400
// { message: "malformed feature key" } — the same product envelope as every other route, not
// Fastify's raw error body. A raw (unencoded) "/" inside the key splits into extra path segments and
// simply fails to match this route (→ 404), never silently resolving to a different feature.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../server/errors.js';
import {
  clearFeatureToggle,
  listFeatureToggles,
  setFeatureToggle,
} from '../services/feature-toggle.service.js';

function requireStaff(req: FastifyRequest): { id: string; username: string } {
  if (!req.staff) throw new AppError(401, 'Not authenticated');
  return req.staff;
}

export async function featureToggleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/feature-toggles', async (req, reply) => {
    requireStaff(req);
    return reply.send(listFeatureToggles());
  });

  app.put('/api/feature-toggles/:featureKey', async (req, reply) => {
    const actor = requireStaff(req);
    const { featureKey } = req.params as { featureKey: string };
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    return reply.send(await setFeatureToggle(actor.id, featureKey, enabled));
  });

  app.delete('/api/feature-toggles/:featureKey/override', async (req, reply) => {
    const actor = requireStaff(req);
    const { featureKey } = req.params as { featureKey: string };
    return reply.send(await clearFeatureToggle(actor.id, featureKey));
  });
}
