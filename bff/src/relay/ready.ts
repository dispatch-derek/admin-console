// bff/src/relay/ready.ts — the relay-only GET /ready readiness probe (spec REQ-F004-026/044;
// design §6). Served by the RELAY (the process holding the transport), NOT the BFF — the BFF's
// fixed GET /health (parent REQ-024) is untouched. 200 ready iff transport reachable AND backlog
// AND lag are BOTH STRICTLY below their thresholds; at-or-over is degraded (rev-10 boundary).

import Fastify, { type FastifyInstance } from 'fastify';
import type { Counters } from './metrics.js';

export interface ReadyDeps {
  isTransportReachable: () => boolean | Promise<boolean>;
  eventBusUrlConfigured: boolean;
  getBacklogCount: () => number;
  getRelayLagMs: () => number;
  backlogThreshold: number;
  lagThresholdMs: number;
  isStoreWritable?: () => boolean | Promise<boolean>;
  getCounters: () => Counters;
}

export function buildReadyApp(deps: ReadyDeps): FastifyInstance {
  const app = Fastify();

  app.get('/ready', async (_req, reply) => {
    // Startup-shaped misconfig the relay boots soft on in dev (REQ-F004-045): no peer URL.
    if (!deps.eventBusUrlConfigured) {
      return reply.code(503).send({ reason: 'bus mode without EVENT_BUS_URL' });
    }
    if (!(await deps.isTransportReachable())) {
      return reply.code(503).send({ reason: 'transport-unreachable' });
    }
    if (deps.isStoreWritable && !(await deps.isStoreWritable())) {
      return reply.code(503).send({ reason: 'store-unwritable' }); // REQ-F004-011/044
    }
    if (deps.getBacklogCount() >= deps.backlogThreshold) {
      return reply.code(503).send({ reason: 'backlog-over-threshold' });
    }
    if (deps.getRelayLagMs() >= deps.lagThresholdMs) {
      return reply.code(503).send({ reason: 'lag-over-threshold' });
    }
    return reply.code(200).send({ ready: true });
  });

  // GET /metrics (D-008, GH #40; REQ-F004-025, design §6) — read-only observability surface exposing
  // the event counters (delivered/attemptFailures/never- vs partially-delivered park/postAckCap) that
  // getCounters() tracks but nothing else read, plus the two live gauges. Purely additive to /ready.
  app.get('/metrics', async (_req, reply) => {
    // Explicit allow-list (not a spread): surfacing a newly-added counter must be a deliberate
    // one-line edit here, never an automatic addition to this response contract.
    const { delivered, attemptFailures, neverDeliveredPark, partiallyDeliveredPark, postAckCap } =
      deps.getCounters();
    return reply.code(200).send({
      delivered,
      attemptFailures,
      neverDeliveredPark,
      partiallyDeliveredPark,
      postAckCap,
      backlogCount: deps.getBacklogCount(),
      relayLagMs: deps.getRelayLagMs(),
    });
  });

  return app;
}
