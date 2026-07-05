// GET /health → { ok: true } (REQ-024). No session required; not under /api.

import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true }));
}
