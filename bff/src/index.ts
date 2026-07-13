// App bootstrap (REQ-020). buildApp() wires plugins, migrations, and routes so tests can
// import the app without opening a socket; we only listen() when run as the main module.

import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { migrate } from './store/db.js';
import { registerPlugins } from './server/plugins.js';
import { frameworkErrorHandler } from './server/errors.js';
import { registerSessionGuard } from './server/session-guard.js';
import { seedFirstAccount } from './auth/bootstrap.js';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { workspacesRoutes } from './routes/workspaces.routes.js';
import { usersRoutes } from './routes/users.routes.js';
import { oversightRoutes } from './routes/oversight.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { baselineRoutes } from './routes/baseline.routes.js';
import { featureToggleRoutes } from './routes/feature-toggle.routes.js';
import { loadCatalog } from './feature-catalog/catalog.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    // Own router-level failures (e.g. FST_ERR_BAD_URL on a malformed percent-sequence) so they get
    // the product {message} envelope instead of Fastify's raw error body (REQ-097a, REQ-F005-028).
    frameworkErrors: frameworkErrorHandler,
  });

  await registerPlugins(app);
  migrate(); // idempotent; ensures the BFF-owned schema exists (03-data-models.md)
  loadCatalog(); // F-005: load the feature-catalog manifest; throws (refuse-to-start) if broken (REQ-F005-053)
  await seedFirstAccount(); // REQ-019a: seed one account only when the staff store is empty
  registerSessionGuard(app); // REQ-012: session required on /api/* except login-flow steps
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(workspacesRoutes);
  await app.register(usersRoutes);
  await app.register(oversightRoutes);
  await app.register(settingsRoutes);
  await app.register(baselineRoutes);
  await app.register(featureToggleRoutes);

  return app;
}

// Only start listening when executed directly (not when imported by tests).
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
