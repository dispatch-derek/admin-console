// D-008 regression test (GH #40) — bff/src/relay/metrics.ts + bff/src/relay/ready.ts.
//
// Root cause (debugger's report): metrics.ts:66 `getCounters()` (delivered, attemptFailures,
// neverDeliveredPark, partiallyDeliveredPark, postAckCap) has NO CALLER anywhere in bff/src — the
// relay's only HTTP surface, GET /ready (ready.ts:21-39), never reads it. An operator therefore
// cannot observe a partially-delivered park vs a never-delivered park (or any other counter),
// even though the internal increment path (drainer.ts:70-72) is correct.
//
// Expected-fixed behavior this test locks in: a new relay `GET /metrics` endpoint, served by the
// same Fastify app family as `/ready` (i.e. registered inside `buildReadyApp`, per the debugger's
// report), returns 200 JSON exposing the event counters from `getCounters()` — with
// `partiallyDeliveredPark` and `neverDeliveredPark` as DISTINCT numeric fields — plus the
// `getBacklogCount` / `getRelayLagMs` gauge values.
//
// DEP-SHAPE ASSUMPTION (mirrors existing precedent, not literally spec-pinned): `ReadyDeps`
// already injects the two gauges as bare no-arg functions — `getBacklogCount: () => number` and
// `getRelayLagMs: () => number` (ready.ts:11-12, matched 1:1 by BASE in ready.test.ts). This test
// assumes the fix adds a THIRD dep of the same shape, `getCounters: () => Counters`, to that same
// `ReadyDeps` interface (per the debugger's note: "inject getCounters through ReadyDeps") — NOT a
// separately-built app, NOT a default import of the real metrics.ts singleton. If the real fix
// wires a different shape (e.g. a separate `buildMetricsApp`), that is a legitimate implementation
// choice the implementer can make, but this test's dep-injection surface is the most defensible
// reading of the debugger's report and mirrors this file family's own established convention
// (see ready.test.ts's `BASE` object).
//
// Spec: REQ-F004-025 (event counters, park-split); design §6 (relay observability).

import { describe, it, expect } from 'vitest';

const mod = await import('../../src/relay/ready.js').catch((e: unknown) => ({ __importError: e as Error }));

interface Counters {
  delivered: number;
  attemptFailures: number;
  neverDeliveredPark: number;
  partiallyDeliveredPark: number;
  postAckCap: number;
}

// ReadyDeps as it exists TODAY, plus the ASSUMED new `getCounters` dep the fix must add.
interface ReadyDepsWithCounters {
  isTransportReachable: () => boolean | Promise<boolean>;
  eventBusUrlConfigured: boolean;
  getBacklogCount: () => number;
  getRelayLagMs: () => number;
  backlogThreshold: number;
  lagThresholdMs: number;
  isStoreWritable?: () => boolean | Promise<boolean>;
  getCounters: () => Counters;
}

interface InjectResult {
  statusCode: number;
  json: () => unknown;
}
interface ReadyApp {
  inject: (opts: { method: string; url: string }) => Promise<InjectResult>;
}

const buildReadyApp = (mod as { buildReadyApp?: (deps: ReadyDepsWithCounters) => ReadyApp }).buildReadyApp;

// Known, DISTINCT counter values — the crux of the defect: partiallyDeliveredPark (2) must be
// observably different from neverDeliveredPark (0), and both from the other three counters.
const KNOWN_COUNTERS: Counters = {
  delivered: 41,
  attemptFailures: 7,
  neverDeliveredPark: 0,
  partiallyDeliveredPark: 2,
  postAckCap: 3,
};

const BASE: ReadyDepsWithCounters = {
  isTransportReachable: () => true,
  eventBusUrlConfigured: true,
  getBacklogCount: () => 12,
  getRelayLagMs: () => 5_000,
  backlogThreshold: 1000,
  lagThresholdMs: 30_000,
  isStoreWritable: () => true,
  getCounters: () => KNOWN_COUNTERS,
};

describe.skipIf(!buildReadyApp)('GET /metrics — D-008 (GH #40): counters must be observable via HTTP', () => {
  it('PRIMARY: returns 200 JSON with partiallyDeliveredPark and neverDeliveredPark as DISTINCT numeric fields (REQ-F004-025)', async () => {
    const app = buildReadyApp!(BASE);
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    // Today: no /metrics route is registered at all, so this 404s — that IS the defect
    // (getCounters() is dead code; there is no HTTP surface reading it).
    expect(res.statusCode).toBe(200);

    const body = res.json() as Record<string, unknown>;
    expect(typeof body['partiallyDeliveredPark']).toBe('number');
    expect(typeof body['neverDeliveredPark']).toBe('number');
    // The distinguishing assertion: a partially-delivered park is NOT the same signal as a
    // never-delivered park, and must not collapse to the same value/field.
    expect(body['partiallyDeliveredPark']).toBe(2);
    expect(body['neverDeliveredPark']).toBe(0);
    expect(body['partiallyDeliveredPark']).not.toBe(body['neverDeliveredPark']);
  });

  it('boundary: also exposes the other three event counters verbatim', async () => {
    const app = buildReadyApp!(BASE);
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['delivered']).toBe(41);
    expect(body['attemptFailures']).toBe(7);
    expect(body['postAckCap']).toBe(3);
  });

  // SPEC-AMBIGUITY: the exact JSON field names for the two gauges are not pinned anywhere (design
  // §6 only names the getter functions). This test assumes `backlogCount` / `relayLagMs` — the
  // getter names with the `get` prefix stripped, camelCase-consistent with the counter field
  // names above (`delivered`, `attemptFailures`, ...). This is the most defensible reading, not a
  // literal spec requirement; flagged for human ruling if the implementer picks different keys.
  it('boundary: also exposes the getBacklogCount/getRelayLagMs gauge values (design §6)', async () => {
    const app = buildReadyApp!(BASE);
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['backlogCount']).toBe(12);
    expect(body['relayLagMs']).toBe(5_000);
  });
});
