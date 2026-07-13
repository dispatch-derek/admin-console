// White-box, ISOLATED unit tests for src/routes/feature-toggle.routes.ts. Unlike
// test/routes/feature-toggles.*.test.ts (the qa-engineer's spec suite, which drives every scenario
// through a full buildApp() — real SQLite, real session cookies, real MFA login), this file registers
// ONLY featureToggleRoutes on a bare Fastify instance, decorates `req.staff` directly (no cookie/
// session machinery), and mocks the service module boundary
// (src/services/feature-toggle.service.ts). This isolates the ROUTE LAYER itself: requireStaff's
// 401 guard, how the body/params are read and handed to the service, and Fastify's own param
// percent-decoding behavior for edge-shaped keys (double-encoded %252F, empty string, overlong,
// malformed percent-sequences) — independent of auth/store/catalog wiring, which the service-level
// and repo-level unit tests already cover in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { featureToggleRoutes } from '../../src/routes/feature-toggle.routes.js';
import { errorHandler, AppError } from '../../src/server/errors.js';

const listFeatureToggles = vi.fn();
const setFeatureToggle = vi.fn();
const clearFeatureToggle = vi.fn();

vi.mock('../../src/services/feature-toggle.service.js', () => ({
  listFeatureToggles: (...args: unknown[]) => listFeatureToggles(...args),
  setFeatureToggle: (...args: unknown[]) => setFeatureToggle(...args),
  clearFeatureToggle: (...args: unknown[]) => clearFeatureToggle(...args),
}));

let app: FastifyInstance;

/** Builds a bare app with the routes under test and NO staff decorated (every request 401s). */
async function buildUnauthenticated(): Promise<FastifyInstance> {
  const a = Fastify();
  a.decorateRequest('staff', null);
  a.setErrorHandler(errorHandler);
  await a.register(featureToggleRoutes);
  await a.ready();
  return a;
}

/** Builds a bare app where every request is treated as an authenticated staff session. */
async function buildAuthenticated(): Promise<FastifyInstance> {
  const a = Fastify();
  a.decorateRequest('staff', null);
  a.addHook('onRequest', async (req) => {
    req.staff = { id: 'staff-unit-test', username: 'operator' };
  });
  a.setErrorHandler(errorHandler);
  await a.register(featureToggleRoutes);
  await a.ready();
  return a;
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): also clears any mockResolvedValue/mockRejectedValue
  // implementation set by a PRIOR test, so a test that forgets to set one never silently inherits
  // another test's return value.
  vi.resetAllMocks();
});

afterEach(async () => {
  if (app) await app.close();
});

// ---------------------------------------------------------------------------------------------
// requireStaff — 401 guard, isolated from the real session/cookie machinery
// ---------------------------------------------------------------------------------------------

describe('requireStaff — 401 without req.staff (parent REQ-012)', () => {
  it('GET /api/feature-toggles returns 401 and never calls the service when staff is unset', async () => {
    app = await buildUnauthenticated();
    const res = await app.inject({ method: 'GET', url: '/api/feature-toggles' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ message: 'Not authenticated' });
    expect(listFeatureToggles).not.toHaveBeenCalled();
  });

  it('PUT /api/feature-toggles/:featureKey returns 401 and never calls the service', async () => {
    app = await buildUnauthenticated();
    const res = await app.inject({ method: 'PUT', url: '/api/feature-toggles/k', payload: { enabled: true } });
    expect(res.statusCode).toBe(401);
    expect(setFeatureToggle).not.toHaveBeenCalled();
  });

  it('DELETE /api/feature-toggles/:featureKey/override returns 401 and never calls the service', async () => {
    app = await buildUnauthenticated();
    const res = await app.inject({ method: 'DELETE', url: '/api/feature-toggles/k/override' });
    expect(res.statusCode).toBe(401);
    expect(clearFeatureToggle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// GET — thin passthrough
// ---------------------------------------------------------------------------------------------

describe('GET /api/feature-toggles — passthrough to the service', () => {
  it('sends the service result verbatim as the 200 body', async () => {
    app = await buildAuthenticated();
    const view = { customerLabel: 'Acme', features: [], counts: { enabled: 0, disabled: 0, total: 0 } };
    listFeatureToggles.mockReturnValue(view);
    const res = await app.inject({ method: 'GET', url: '/api/feature-toggles' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(view);
  });
});

// ---------------------------------------------------------------------------------------------
// PUT — body handling
// ---------------------------------------------------------------------------------------------

describe('PUT /api/feature-toggles/:featureKey — body handling', () => {
  it('passes the decoded featureKey, actor id, and enabled value straight through to the service', async () => {
    app = await buildAuthenticated();
    setFeatureToggle.mockResolvedValue({ featureKey: 'k', enabled: true });
    const res = await app.inject({ method: 'PUT', url: '/api/feature-toggles/k', payload: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(setFeatureToggle).toHaveBeenCalledWith('staff-unit-test', 'k', true);
  });

  it('an entirely missing body (no payload at all) is treated as {} — enabled forwarded as undefined, and a rejected AppError maps to its status', async () => {
    app = await buildAuthenticated();
    setFeatureToggle.mockRejectedValue(new AppError(400, 'enabled must be true or false'));
    const res = await app.inject({ method: 'PUT', url: '/api/feature-toggles/k' });
    // The route itself never inspects `enabled` — it forwards whatever the body destructures to,
    // and the service's own AppError is what the errorHandler maps to the { message } response.
    expect(setFeatureToggle).toHaveBeenCalledWith('staff-unit-test', 'k', undefined);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: 'enabled must be true or false' });
  });

  it('a non-boolean enabled value in the body is forwarded as-is (validation is the service’s job, not the route’s)', async () => {
    app = await buildAuthenticated();
    setFeatureToggle.mockRejectedValue(Object.assign(new Error('enabled must be true or false'), { status: 400 }));
    await app.inject({ method: 'PUT', url: '/api/feature-toggles/k', payload: { enabled: 'yes' } });
    expect(setFeatureToggle).toHaveBeenCalledWith('staff-unit-test', 'k', 'yes');
  });
});

// ---------------------------------------------------------------------------------------------
// Opaque featureKey param decoding (REQ-F005-028) — Fastify's own router behavior for edge shapes
// ---------------------------------------------------------------------------------------------

describe('opaque featureKey param — edge-shaped path segments (REQ-F005-028)', () => {
  it('a simple percent-encoded key decodes exactly once and is forwarded literally', async () => {
    app = await buildAuthenticated();
    setFeatureToggle.mockResolvedValue({ featureKey: 'a/b c' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/feature-toggles/${encodeURIComponent('a/b c')}`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(setFeatureToggle).toHaveBeenCalledWith('staff-unit-test', 'a/b c', true);
  });

  it('a DOUBLE-encoded key (%252F) decodes only ONCE — the service sees the literal "%2F", not "/"', async () => {
    app = await buildAuthenticated();
    setFeatureToggle.mockResolvedValue({ featureKey: '%2F' });
    // %25 decodes to a literal '%'; the rest ('2F') is not itself a percent-escape.
    const res = await app.inject({ method: 'PUT', url: '/api/feature-toggles/%252F', payload: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(setFeatureToggle).toHaveBeenCalledWith('staff-unit-test', '%2F', true);
  });

  it('a malformed percent-sequence returns 400 before the handler/service ever runs', async () => {
    app = await buildAuthenticated();
    const res = await app.inject({ method: 'PUT', url: '/api/feature-toggles/%E0%A4%A', payload: { enabled: true } });
    expect(res.statusCode).toBe(400);
    expect(setFeatureToggle).not.toHaveBeenCalled();
  });

  it('a 100-char key (Fastify\'s default per-param length cap) is forwarded to the service intact', async () => {
    app = await buildAuthenticated();
    const longKey = 'k'.repeat(100);
    setFeatureToggle.mockResolvedValue({ featureKey: longKey });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/feature-toggles/${encodeURIComponent(longKey)}`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(setFeatureToggle).toHaveBeenCalledWith('staff-unit-test', longKey, true);
  });

  // OBSERVATION (not a spec violation — REQ-F005-028 does not pin a max featureKey length, and no
  // realistic manifest-declared key is likely to approach this): buildApp() (src/index.ts) constructs
  // Fastify() with no `maxParamLength` override, so find-my-way's DEFAULT 100-character cap on a
  // single route param applies to every deployment, not just this test's isolated instance. A
  // featureKey whose percent-encoded segment exceeds 100 chars is rejected 414 by the ROUTER itself,
  // before requireStaff/the service ever runs — never a 400 "malformed feature key" or a 404 "unknown
  // feature", and with no BFF-authored { message } body (this is Fastify's own default text response,
  // bypassing the product error-mapping contract, parent REQ-097a). Documented here so a future
  // catalog with long generated keys doesn't silently lose reachability without a clear diagnosis.
  it('a key beyond the 100-char param cap is rejected 414 by the ROUTER, before requireStaff or the service run', async () => {
    app = await buildAuthenticated();
    const overCap = 'k'.repeat(150);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/feature-toggles/${encodeURIComponent(overCap)}`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(414);
    expect(setFeatureToggle).not.toHaveBeenCalled();
  });

  it('an empty featureKey path segment (trailing slash, nothing to decode) is forwarded to the service as the literal empty string', async () => {
    app = await buildAuthenticated();
    setFeatureToggle.mockResolvedValue({ featureKey: '' });
    // Fastify's router matches a trailing-slash request against `:featureKey` with an empty capture
    // rather than 404ing — the route itself does no length/emptiness validation, so an empty string
    // reaches the service exactly like any other decoded literal (REQ-F005-030's 404-for-undeclared-
    // key check is the service's job, via findEntry('') returning undefined for any real catalog).
    const res = await app.inject({ method: 'PUT', url: '/api/feature-toggles/', payload: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(setFeatureToggle).toHaveBeenCalledWith('staff-unit-test', '', true);
  });
});

// ---------------------------------------------------------------------------------------------
// DELETE — thin passthrough
// ---------------------------------------------------------------------------------------------

describe('DELETE /api/feature-toggles/:featureKey/override — passthrough to the service', () => {
  it('passes the decoded featureKey and actor id through, and returns the service result verbatim', async () => {
    app = await buildAuthenticated();
    clearFeatureToggle.mockResolvedValue({ featureKey: 'k', enabled: false, hasOverride: false });
    const res = await app.inject({ method: 'DELETE', url: '/api/feature-toggles/k/override' });
    expect(res.statusCode).toBe(200);
    expect(clearFeatureToggle).toHaveBeenCalledWith('staff-unit-test', 'k');
    expect(res.json()).toEqual({ featureKey: 'k', enabled: false, hasOverride: false });
  });

  it('propagates a service-thrown AppError(404) as a 404 { message } body', async () => {
    app = await buildAuthenticated();
    clearFeatureToggle.mockRejectedValue(new AppError(404, 'unknown feature'));
    const res = await app.inject({ method: 'DELETE', url: '/api/feature-toggles/nope/override' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ message: 'unknown feature' });
  });
});
