// bff/src/relay/ready.ts — the relay-only GET /ready readiness probe (spec REQ-F004-026/044;
// design §6). 200 ready iff transport reachable AND backlog < threshold AND lag < threshold
// (both strictly below); 503 not-ready/degraded with a machine-readable `reason` otherwise.
// Boundary is AT-OR-OVER -> not-ready (rev-10 clarification, deterministic comparison).
//
// ASSUMED EXPORT (mirrors this repo's established buildApp()/`.inject()` Fastify convention,
// e.g. bff/test/routes/workspaces.routes.test.ts; not literally pinned by the spec, which only
// requires "a separate GET /ready probe served by the relay"):
//   buildReadyApp(deps: {
//     isTransportReachable: () => boolean | Promise<boolean>;
//     eventBusUrlConfigured: boolean;
//     getBacklogCount: () => number;
//     getRelayLagMs: () => number;
//     backlogThreshold: number;
//     lagThresholdMs: number;
//     isStoreWritable?: () => boolean | Promise<boolean>;
//   }): FastifyLikeApp   // exposes .inject({ method, url })

import { describe, it, expect } from 'vitest';

const mod = await import('../../src/relay/ready.js').catch((e: unknown) => ({ __importError: e as Error }));
interface ReadyDeps {
  isTransportReachable: () => boolean | Promise<boolean>;
  eventBusUrlConfigured: boolean;
  getBacklogCount: () => number;
  getRelayLagMs: () => number;
  backlogThreshold: number;
  lagThresholdMs: number;
  isStoreWritable?: () => boolean | Promise<boolean>;
}
interface InjectResult {
  statusCode: number;
  json: () => unknown;
}
interface ReadyApp {
  inject: (opts: { method: string; url: string }) => Promise<InjectResult>;
}
const buildReadyApp = (mod as { buildReadyApp?: (deps: ReadyDeps) => ReadyApp }).buildReadyApp;

const BASE: ReadyDeps = {
  isTransportReachable: () => true,
  eventBusUrlConfigured: true,
  getBacklogCount: () => 0,
  getRelayLagMs: () => 0,
  backlogThreshold: 1000,
  lagThresholdMs: 30_000,
  isStoreWritable: () => true,
};

describe('ready.ts — module resolution', () => {
  it('exists and exports buildReadyApp', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail(`bff/src/relay/ready.ts does not exist yet — expected pre-implementation RED signal.`);
    }
    expect(typeof buildReadyApp).toBe('function');
  });
});

describe.skipIf(!buildReadyApp)('GET /ready — REQ-F004-026/044', () => {
  it('200 ready when transport reachable AND backlog AND lag are both strictly below threshold', async () => {
    const app = buildReadyApp!({ ...BASE, getBacklogCount: () => 999, getRelayLagMs: () => 29_999 });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('503 transport-unreachable when the transport is not reachable', async () => {
    const app = buildReadyApp!({ ...BASE, isTransportReachable: () => false });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ reason: 'transport-unreachable' });
  });

  it('503 "bus mode without EVENT_BUS_URL" when the URL is not configured', async () => {
    const app = buildReadyApp!({ ...BASE, eventBusUrlConfigured: false });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { reason: string }).reason).toMatch(/EVENT_BUS_URL/);
  });

  it('backlog EXACTLY EQUAL to the threshold is already not-ready (at-or-over, rev-10 boundary)', async () => {
    const app = buildReadyApp!({ ...BASE, getBacklogCount: () => 1000, backlogThreshold: 1000 });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ reason: 'backlog-over-threshold' });
  });

  it('backlog one below the threshold is still ready', async () => {
    const app = buildReadyApp!({ ...BASE, getBacklogCount: () => 999, backlogThreshold: 1000 });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('lag EXACTLY EQUAL to the threshold is already not-ready (at-or-over, rev-10 boundary)', async () => {
    const app = buildReadyApp!({ ...BASE, getRelayLagMs: () => 30_000, lagThresholdMs: 30_000 });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ reason: 'lag-over-threshold' });
  });

  it('lag one ms below the threshold is still ready', async () => {
    const app = buildReadyApp!({ ...BASE, getRelayLagMs: () => 29_999, lagThresholdMs: 30_000 });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('a lower configured threshold flips /ready to not-ready at that lower bound', async () => {
    const app = buildReadyApp!({ ...BASE, getBacklogCount: () => 5, backlogThreshold: 5 });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
  });

  it('503 store-unwritable when the relay cannot land its bookkeeping writes', async () => {
    const app = buildReadyApp!({ ...BASE, isStoreWritable: () => false });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ reason: 'store-unwritable' });
  });
});
