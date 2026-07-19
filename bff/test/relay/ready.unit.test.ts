// White-box unit tests for bff/src/relay/ready.ts — supplements bff/test/relay/ready.test.ts
// (qa-engineer's spec-level suite, NOT modified here). Targets the OPTIONAL `isStoreWritable`
// dependency branch (`if (deps.isStoreWritable && !(await deps.isStoreWritable()))`) — every
// spec-suite case supplies `isStoreWritable`, so the "not provided at all" short-circuit
// (the `deps.isStoreWritable &&` guard evaluating falsy) is never exercised there.

import { describe, it, expect } from 'vitest';

const { buildReadyApp } = await import('../../src/relay/ready.js');

interface ReadyDeps {
  isTransportReachable: () => boolean | Promise<boolean>;
  eventBusUrlConfigured: boolean;
  getBacklogCount: () => number;
  getRelayLagMs: () => number;
  backlogThreshold: number;
  lagThresholdMs: number;
  isStoreWritable?: () => boolean | Promise<boolean>;
}

const BASE_NO_STORE_CHECK: ReadyDeps = {
  isTransportReachable: () => true,
  eventBusUrlConfigured: true,
  getBacklogCount: () => 0,
  getRelayLagMs: () => 0,
  backlogThreshold: 1000,
  lagThresholdMs: 30_000,
  // isStoreWritable deliberately omitted
};

describe('GET /ready — isStoreWritable is OPTIONAL (ready.ts branch: `deps.isStoreWritable &&`)', () => {
  it('when isStoreWritable is not provided at all, the store-unwritable check is skipped entirely and a healthy backlog/lag still yields 200', async () => {
    const app = buildReadyApp(BASE_NO_STORE_CHECK);
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('with isStoreWritable omitted, an over-threshold backlog still correctly falls through to backlog-over-threshold (proves the omitted check does not short-circuit the whole handler)', async () => {
    const app = buildReadyApp({ ...BASE_NO_STORE_CHECK, getBacklogCount: () => 1000 });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ reason: 'backlog-over-threshold' });
  });
});
