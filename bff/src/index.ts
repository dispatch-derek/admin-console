// App bootstrap (REQ-020). buildApp() wires plugins, migrations, and routes so tests can
// import the app without opening a socket; we only listen() when run as the main module.

import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { migrate } from './store/db.js';
import { registerPlugins } from './server/plugins.js';
import { healthRoutes } from './routes/health.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env['LOG_LEVEL'] ?? 'info' } });

  await registerPlugins(app);
  migrate(); // idempotent; ensures the BFF-owned schema exists (03-data-models.md)
  await app.register(healthRoutes);

  return app;
}

// Only start listening when executed directly (not when imported by tests).
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
