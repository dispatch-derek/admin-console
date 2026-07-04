// Shared Fastify plugins: CORS (REQ-095), signed cookies, correlation-id + structured
// logging (REQ-099), and the engine→product error handler (errors.ts).

import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { errorHandler } from './errors.js';

// A correlation id we attach per request (REQ-099) and echo back in the response header.
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  // CORS: strict origin allowlist in production, permissive in dev (REQ-095). Credentials
  // are enabled so the httpOnly session cookie flows on cross-origin dev requests.
  await app.register(cors, {
    origin: config.corsMode === 'strict' ? config.webOrigins : true,
    credentials: true,
  });

  // Signed cookies — the session cookie is signed with SESSION_SECRET (REQ-011).
  await app.register(cookie, { secret: config.sessionSecret });

  // Correlation id: honor an inbound X-Correlation-Id or mint one; bind it to the request
  // logger so every line for this request is correlatable, and echo it to the client.
  app.decorateRequest('correlationId', '');
  app.addHook('onRequest', async (req, reply) => {
    const inbound = req.headers['x-correlation-id'];
    const cid = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
    req.correlationId = cid;
    reply.header('x-correlation-id', cid);
    req.log.info({ correlationId: cid, method: req.method, url: req.url }, 'request');
  });

  // Engine→product error mapping (REQ-023, REQ-097): renders {message} the web app shows.
  app.setErrorHandler(errorHandler);
}
