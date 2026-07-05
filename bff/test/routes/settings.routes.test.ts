// routes/settings.routes.ts + services/settings.service.ts + services/discovery.service.ts —
// §7 Instance-wide Settings, raw editor, diagnostics, and model discovery, end-to-end via
// buildApp() + app.inject() (mirrors test/routes/workspaces.routes.test.ts's conventions
// exactly: per-test tmp DB, vi.resetModules() for a fresh module graph, a genuine session
// cookie minted through the real login FSM). The engine adapter is mocked at the module
// boundary (vi.mock) so the BFF never calls a real AnythingLLM instance; adapter mock calls
// are asserted directly to pin down the exact engine request shape (REQ-061/062a/078b).
// Emitted admin.* events are captured via the real (per-test) event_outbox table — the
// inproc bus writes there synchronously.
//
// These tests are derived from specs/admin-console.md §7 (REQ-060..078f, REQ-096/101), NOT
// from reading the settings/discovery service source beforehand.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import type { FastifyInstance } from 'fastify';
import { ACCEPTED_ENV_KEYS } from '../../src/engine/env-keys.js';

const SESSION_COOKIE = 'admin_session';
const OPERATOR_USERNAME = 'operator';
const OPERATOR_PASSWORD = 'Sup3rSecret!';

// --- Mock the engine adapter module boundary (REQ-026/013): the BFF under test must NEVER
// reach a real AnythingLLM instance. Function references are declared outside the factory so
// they survive vi.resetModules() across tests in this file (same pattern as
// test/routes/workspaces.routes.test.ts). ---
const getSystemMock = vi.fn();
const updateEnvMock = vi.fn();
const envDumpMock = vi.fn();
const vectorCountMock = vi.fn();
const ollamaTagsMock = vi.fn();

vi.mock('../../src/engine/adapter.js', () => ({
  engineAdapter: {
    listWorkspaces: vi.fn(),
    getWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    updateEmbeddings: vi.fn(),
    updatePin: vi.fn(),
    listDocuments: vi.fn(),
    isMultiUserMode: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    listInvites: vi.fn(),
    createInvite: vi.fn(),
    deleteInvite: vi.fn(),
    listWorkspaceMembers: vi.fn(),
    manageWorkspaceUsers: vi.fn(),
    workspaceChats: vi.fn(),
    getSystem: getSystemMock,
    updateEnv: updateEnvMock,
    envDump: envDumpMock,
    vectorCount: vectorCountMock,
    ollamaTags: ollamaTagsMock,
  },
}));

const ALL_MOCKS = [getSystemMock, updateEnvMock, envDumpMock, vectorCountMock, ollamaTagsMock];

// A representative (partial, realistic) GET /v1/system `settings` snapshot: a mix of
// non-secret values, set/unset secret booleans, and the §7.8 read-only flags. Deliberately
// omits many accepted keys (e.g. AzureOpenAiEndpoint) so "unknown/write-only" (REQ-078a) is
// exercisable — GET /v1/system never actually returns all 186 keys in practice.
type EngineSettings = Record<string, string | number | boolean | null>;
function baseEngineSettings(overrides: EngineSettings = {}): EngineSettings {
  return {
    LLMProvider: 'ollama',
    ModelRouterId: 'default',
    OllamaLLMBasePath: 'http://localhost:11434',
    OllamaLLMModelPref: 'llama3',
    OllamaLLMTokenLimit: 4096,
    OllamaLLMKeepAliveSeconds: 300,
    OllamaLLMAuthToken: false,
    OpenAiKey: false,
    AnthropicApiKey: false,
    EmbeddingEngine: 'ollama',
    EmbeddingModelPref: 'nomic-embed-text:v1.5',
    VectorDB: 'lancedb',
    TextToSpeechProvider: 'native',
    SpeechToTextProvider: 'native',
    AuthToken: true,
    JWTSecret: true,
    DisableTelemetry: false,
    RequiresAuth: true,
    MultiUserMode: false,
    MemoryEnabled: false,
    MemoryAutoExtraction: false,
    HasExistingEmbeddings: false,
    HasCachedEmbeddings: false,
    ...overrides,
  };
}

interface StoredEvent {
  event: string;
  actor: string;
  target: Record<string, unknown>;
  changes?: unknown;
  verified: boolean | Record<string, boolean>;
  timestamp: string;
}

interface Ctx {
  app: FastifyInstance;
  db: typeof import('../../src/store/db.js').db;
  cookie: string;
  tmpDir: string;
  dbPath: string;
}

let ctx: Ctx | undefined;

async function freshApp(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'settings-routes-test-'));
  const dbPath = join(tmpDir, 'console.db');
  process.env['DB_PATH'] = dbPath;
  process.env['ADMIN_BOOTSTRAP_USERNAME'] = 'admin';
  process.env['ADMIN_BOOTSTRAP_TOKEN'] = 'bootstrap-secret-token-123';
  process.env['LOG_LEVEL'] = 'silent';

  vi.resetModules();
  for (const fn of ALL_MOCKS) fn.mockReset();
  getSystemMock.mockResolvedValue({ settings: baseEngineSettings() });

  const { buildApp } = await import('../../src/index.js');
  const { staffRepo } = await import('../../src/store/repositories/staff.repo.js');
  const { db } = await import('../../src/store/db.js');
  const { hashPassword, encryptSecret } = await import('../../src/auth/crypto.js');

  const app = await buildApp();

  // Seed a fully-enrolled operator and drive the real login FSM to obtain a genuine signed
  // session cookie (matches test/routes/auth.routes.test.ts's seedEnrolledStaff pattern).
  const secret = authenticator.generateSecret();
  staffRepo.insert({
    id: 'staff-operator',
    username: OPERATOR_USERNAME,
    password_hash: await hashPassword(OPERATOR_PASSWORD),
    totp_secret: encryptSecret(secret),
    mfa_enrolled: 1,
    disabled: 0,
    must_set_password: 0,
    created_at: new Date().toISOString(),
  });
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: OPERATOR_USERNAME, password: OPERATOR_PASSWORD },
  });
  const { challengeId } = loginRes.json();
  const mfaRes = await app.inject({
    method: 'POST',
    url: '/api/auth/mfa',
    payload: { challengeId, code: authenticator.generate(secret) },
  });
  const cookie = mfaRes.cookies.find((c: { name: string }) => c.name === SESSION_COOKIE)!.value;

  return { app, db, cookie, tmpDir, dbPath };
}

function eventsNamed(c: Ctx, name: string): StoredEvent[] {
  const rows = c.db.prepare('SELECT envelope FROM event_outbox ORDER BY id ASC').all() as {
    envelope: string;
  }[];
  return rows.map((r) => JSON.parse(r.envelope) as StoredEvent).filter((e) => e.event === name);
}

function auditRows(
  c: Ctx,
  action: string,
  outcome: 'success' | 'failure',
): Array<{ actor: string; action: string; outcome: string; target: string | null; detail: string | null }> {
  return c.db
    .prepare(`SELECT * FROM audit_log WHERE action = ? AND outcome = ?`)
    .all(action, outcome) as Array<{
    actor: string;
    action: string;
    outcome: string;
    target: string | null;
    detail: string | null;
  }>;
}

beforeEach(async () => {
  ctx = await freshApp();
});

afterEach(async () => {
  if (!ctx) return;
  await ctx.app.close();
  ctx.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = ctx.dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }
  rmSync(ctx.tmpDir, { recursive: true, force: true });
  ctx = undefined;
});

describe('REQ-012/REQ-022 — every §7 settings/diagnostics/discovery route requires a staff session', () => {
  const cases: Array<{ method: 'GET' | 'PATCH' | 'PUT'; url: string }> = [
    { method: 'GET', url: '/api/settings' },
    { method: 'PATCH', url: '/api/settings' },
    { method: 'GET', url: '/api/settings/raw' },
    { method: 'PUT', url: '/api/settings/raw' },
    { method: 'GET', url: '/api/diagnostics/vectors' },
    { method: 'GET', url: '/api/diagnostics/env' },
    { method: 'GET', url: '/api/models/ollama' },
  ];

  for (const { method, url } of cases) {
    it(`${method} ${url} → 401 with no session cookie`, async () => {
      const c = ctx!;
      const res = await c.app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe('GET /api/settings (REQ-060/062a)', () => {
  it('groups controls under the 7 §7.1–§7.8 categories in stable order', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { categories: Array<{ id: string }> };
    expect(body.categories.map((cat) => cat.id)).toEqual([
      'llm',
      'embedding',
      'vectorDb',
      'agentSkills',
      'tts',
      'stt',
      'security',
    ]);
  });

  it('secret controls expose `set` (boolean) and NEVER `value`', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({
      settings: baseEngineSettings({ OpenAiKey: true, AnthropicApiKey: false }),
    });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const body = res.json() as { categories: Array<{ controls: Array<Record<string, unknown>> }> };
    const allControls = body.categories.flatMap((cat) => cat.controls);
    const openaiKey = allControls.find((ctrl) => ctrl['id'] === 'llm.openai.apiKey')!;
    expect(openaiKey['secret']).toBe(true);
    expect(openaiKey['set']).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(openaiKey, 'value')).toBe(false);

    const anthropicKey = allControls.find((ctrl) => ctrl['id'] === 'llm.anthropic.apiKey')!;
    expect(anthropicKey['set']).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(anthropicKey, 'value')).toBe(false);
  });

  it('non-secret controls expose `value` (not `set`)', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const body = res.json() as { categories: Array<{ controls: Array<Record<string, unknown>> }> };
    const allControls = body.categories.flatMap((cat) => cat.controls);
    const provider = allControls.find((ctrl) => ctrl['id'] === 'llm.provider')!;
    expect(provider['value']).toBe('ollama');
    expect(Object.prototype.hasOwnProperty.call(provider, 'set')).toBe(false);
  });

  it('the §7.8 read-only flags render with readOnly:true', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({
      settings: baseEngineSettings({ RequiresAuth: true, MultiUserMode: false }),
    });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const body = res.json() as { categories: Array<{ controls: Array<Record<string, unknown>> }> };
    const security = body.categories.find((cat) => cat.id === 'security')!;
    const requiresAuth = security.controls.find((ctrl) => ctrl['id'] === 'security.requiresAuth')!;
    expect(requiresAuth['readOnly']).toBe(true);
    expect(requiresAuth['value']).toBe(true);
    const multiUserMode = security.controls.find((ctrl) => ctrl['id'] === 'security.multiUserMode')!;
    expect(multiUserMode['readOnly']).toBe(true);
    expect(multiUserMode['value']).toBe(false);

    // Non-read-only controls never carry readOnly:true (spot-check).
    const disableTelemetry = security.controls.find((ctrl) => ctrl['id'] === 'security.disableTelemetry')!;
    expect(disableTelemetry['readOnly']).toBeFalsy();
  });

  it('no engine env-key name appears as a control id in the response', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const body = res.json() as { categories: Array<{ controls: Array<Record<string, unknown>> }> };
    for (const control of body.categories.flatMap((cat) => cat.controls)) {
      expect(ACCEPTED_ENV_KEYS.has(control['id'] as string)).toBe(false);
    }
  });

  it('flags exactly the §8 dangerous controls (REQ-083/084/086, slice-5 follow-up b)', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const body = res.json() as { categories: Array<{ controls: Array<Record<string, unknown>> }> };
    const all = body.categories.flatMap((cat) => cat.controls);
    const flagged = new Set(
      all.filter((ctrl) => ctrl['dangerous'] === true).map((ctrl) => ctrl['id'] as string),
    );
    // Exactly the LLM provider (083), embedding engine/model + vector-db (084), and auth-token /
    // jwt-secret (086) controls — tts/stt provider selectors are NOT §8 ops.
    expect(flagged).toEqual(
      new Set([
        'llm.provider',
        'embedding.engine',
        'embedding.model',
        'vectorDb.provider',
        'security.authToken',
        'security.jwtSecret',
      ]),
    );
    // A plain provider selector like tts.provider is NOT flagged dangerous.
    const ttsProvider = all.find((ctrl) => ctrl['id'] === 'tts.provider')!;
    expect(ttsProvider['dangerous']).toBeFalsy();
  });
});

describe('PATCH /api/settings — product→engine mapping (REQ-062a)', () => {
  it('patching { "llm.ollama.baseUrl": "http://x:11434" } calls updateEnv with EXACTLY { OllamaLLMBasePath }', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings() }) // before
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OllamaLLMBasePath: 'http://x:11434' }) }); // after

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.ollama.baseUrl': 'http://x:11434' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateEnvMock).toHaveBeenCalledTimes(1);
    expect(updateEnvMock).toHaveBeenCalledWith({ OllamaLLMBasePath: 'http://x:11434' });
  });
});

describe('PATCH /api/settings — REQ-061 empty-secret-skip', () => {
  it('an empty-string secret value alongside a real non-secret change: the secret key is NOT sent', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.openai.apiKey': '', 'security.disableTelemetry': true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateEnvMock).toHaveBeenCalledWith({ DisableTelemetry: true });
  });

  it('a null secret value alongside a real non-secret change: the secret key is NOT sent', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.openai.apiKey': null, 'security.disableTelemetry': true },
    });

    expect(res.statusCode).toBe(200);
    expect(updateEnvMock).toHaveBeenCalledWith({ DisableTelemetry: true });
  });

  it('a real secret value IS sent', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.openai.apiKey': 'sk-real-value' },
    });

    expect(res.statusCode).toBe(200);
    expect(updateEnvMock).toHaveBeenCalledWith({ OpenAiKey: 'sk-real-value' });
  });

  it('an empty secret as the ONLY submitted change → 400, no engine write (empty effective patch)', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.openai.apiKey': '' },
    });
    expect(res.statusCode).toBe(400);
    expect(updateEnvMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/settings — REQ-061/028 verify-after-write map', () => {
  it('a non-secret whose re-read matches the submitted value → verified[id] === true', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'security.disableTelemetry': true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { verified: Record<string, boolean> };
    expect(body.verified['security.disableTelemetry']).toBe(true);
  });

  it('a non-secret whose re-read does NOT match: verified[id]===false, but setting_changed is STILL emitted (batch exception, REQ-029f)', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: false }) }); // unchanged re-read

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'security.disableTelemetry': true },
    });

    expect(res.statusCode).toBe(200); // NOT suppressed / NOT a 409 — batch exception (REQ-029b/029f)
    const body = res.json() as { verified: Record<string, boolean> };
    expect(body.verified['security.disableTelemetry']).toBe(false);
    expect(eventsNamed(c, 'admin.instance.setting_changed')).toHaveLength(1);
  });

  it('secret unset→set (before false, after true) → verified[id] === true', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.openai.apiKey': 'sk-new' },
    });

    const body = res.json() as { verified: Record<string, boolean> };
    expect(body.verified['llm.openai.apiKey']).toBe(true);
  });

  it('secret overwrite (before true, after true — unobservable) → verified[id] === false', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.openai.apiKey': 'sk-rotated' },
    });

    expect(res.statusCode).toBe(200); // best-effort success, NOT a failure (REQ-028/061)
    const body = res.json() as { verified: Record<string, boolean> };
    expect(body.verified['llm.openai.apiKey']).toBe(false);
    expect(eventsNamed(c, 'admin.instance.setting_changed')).toHaveLength(1);
  });

  it('the emitted setting_changed envelope `verified` is a per-control-id MAP (object), never a scalar', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: true }) });

    await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'security.disableTelemetry': true },
    });

    const [event] = eventsNamed(c, 'admin.instance.setting_changed');
    expect(event).toBeDefined();
    expect(typeof event!.verified).toBe('object');
    expect(Array.isArray(event!.verified)).toBe(false);
    expect((event!.verified as Record<string, boolean>)['security.disableTelemetry']).toBe(true);
  });

  it('the PATCH /api/settings HTTP response also carries the per-control-id verified map (REQ-101 R-3)', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ DisableTelemetry: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'security.disableTelemetry': true },
    });
    const body = res.json() as { verified: Record<string, boolean>; changedCategories: string[] };
    expect(body.verified).toEqual({ 'security.disableTelemetry': true });
    expect(body.changedCategories).toEqual(['security']);
  });
});

describe('PATCH /api/settings — REQ-063 provider_changed cardinality', () => {
  it('changing llm.provider (value actually changes) emits ONE admin.instance.provider_changed in addition to setting_changed', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'openai' }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.provider': 'openai' },
    });

    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.instance.setting_changed')).toHaveLength(1);
    const providerEvents = eventsNamed(c, 'admin.instance.provider_changed');
    expect(providerEvents).toHaveLength(1);
    expect(typeof providerEvents[0]!.verified).toBe('boolean');
    expect(providerEvents[0]!.verified).toBe(true);
  });

  it('a batch changing llm.provider AND embedding.engine emits TWO admin.instance.provider_changed', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({
        settings: baseEngineSettings({ LLMProvider: 'ollama', EmbeddingEngine: 'ollama' }),
      })
      .mockResolvedValueOnce({
        settings: baseEngineSettings({ LLMProvider: 'openai', EmbeddingEngine: 'openai' }),
      });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.provider': 'openai', 'embedding.engine': 'openai' },
    });

    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.instance.provider_changed')).toHaveLength(2);
  });

  it('a non-selector patch emits zero admin.instance.provider_changed', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings() })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OllamaLLMBasePath: 'http://new:11434' }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.ollama.baseUrl': 'http://new:11434' },
    });

    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.instance.provider_changed')).toHaveLength(0);
  });

  it('a selector present but truly unchanged (operator resubmits the already-current value) emits none', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.provider': 'ollama' },
    });

    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.instance.provider_changed')).toHaveLength(0);
  });

  // SPEC: REQ-029b/029f/063 (R-2) — "Failed provider re-read: if a selector's re-read shows
  // the provider did NOT actually change [after an attempted change], its
  // admin.instance.provider_changed is STILL emitted with verified:false (emit-with-false,
  // NOT suppressed)". This is distinct from the true no-op above (operator resubmitting the
  // CURRENT value): here the operator attempts openai but the 2xx engine write silently fails
  // to persist it (re-read still shows ollama). Per R-2 this must still emit one
  // provider_changed with verified:false — it must NOT be silently dropped.
  it('R-2: an attempted provider change whose 2xx write fails to persist STILL emits provider_changed with verified:false', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) }); // write did not persist

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.provider': 'openai' },
    });

    expect(res.statusCode).toBe(200);
    const providerEvents = eventsNamed(c, 'admin.instance.provider_changed');
    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.verified).toBe(false);
  });
});

describe('PATCH /api/settings — REQ-062 secret redaction', () => {
  it('a secret write never carries the secret VALUE in the emitted event or audit row (only in the updateEnv spy arg)', async () => {
    const c = ctx!;
    const SECRET_VALUE = 'sk-super-secret-do-not-leak-9f3a';
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: false }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) });

    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'llm.openai.apiKey': SECRET_VALUE },
    });
    expect(res.statusCode).toBe(200);

    // The value DOES transit to the engine adapter (that's the whole point of the write).
    expect(updateEnvMock).toHaveBeenCalledWith({ OpenAiKey: SECRET_VALUE });

    // But it never appears in the event envelope or the audit row.
    const [event] = eventsNamed(c, 'admin.instance.setting_changed');
    expect(JSON.stringify(event)).not.toContain(SECRET_VALUE);

    const [row] = auditRows(c, 'settings.update', 'success');
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(SECRET_VALUE);

    // Nor does the HTTP response body echo it back.
    expect(res.payload).not.toContain(SECRET_VALUE);
  });
});

describe('PATCH /api/settings — validation (REQ-062a/072/098)', () => {
  it('an unknown control id → 400, no engine write', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'not.a.real.control': 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(updateEnvMock).not.toHaveBeenCalled();
  });

  it('a read-only control id in the patch (e.g. security.multiUserMode) → 400, no engine write', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { 'security.multiUserMode': true },
    });
    expect(res.statusCode).toBe(400);
    expect(updateEnvMock).not.toHaveBeenCalled();
  });

  it('an empty patch body → 400, no engine write', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(updateEnvMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/settings/raw (REQ-078a)', () => {
  it('a secret key with no value set → {state:"notSet"} — never a value', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({ settings: baseEngineSettings({ AnthropicApiKey: false }) });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const entries = res.json() as Array<{ key: string; state: string; value?: string }>;
    const entry = entries.find((e) => e.key === 'AnthropicApiKey')!;
    expect(entry.state).toBe('notSet');
    expect(entry.value).toBeUndefined();
  });

  it('a secret key that IS set → {state:"set"} — never the plaintext value', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({ settings: baseEngineSettings({ AuthToken: true }) });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const entries = res.json() as Array<{ key: string; state: string; value?: string }>;
    const entry = entries.find((e) => e.key === 'AuthToken')!;
    expect(entry.state).toBe('set');
    expect(entry.value).toBeUndefined();
  });

  it('a non-secret key present in GET /v1/system → {state:"value", value}', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const entries = res.json() as Array<{ key: string; state: string; value?: string }>;
    const entry = entries.find((e) => e.key === 'LLMProvider')!;
    expect(entry).toEqual({ key: 'LLMProvider', state: 'value', value: 'ollama' });
  });

  it('an accepted key NOT returned by GET /v1/system → {state:"unknown"} (write-only)', async () => {
    const c = ctx!;
    // AzureOpenAiEndpoint is accepted but absent from baseEngineSettings().
    getSystemMock.mockResolvedValue({ settings: baseEngineSettings() });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const entries = res.json() as Array<{ key: string; state: string; value?: string }>;
    const entry = entries.find((e) => e.key === 'AzureOpenAiEndpoint')!;
    expect(entry.state).toBe('unknown');
    expect(entry.value).toBeUndefined();
  });

  it('the result covers all 186 accepted keys, one entry each', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({ settings: baseEngineSettings() });
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    const entries = res.json() as Array<{ key: string }>;
    expect(entries).toHaveLength(186);
    expect(new Set(entries.map((e) => e.key))).toEqual(ACCEPTED_ENV_KEYS);
  });
});

describe('PUT /api/settings/raw (REQ-078b/096) — key whitelist enforcement', () => {
  it('a body containing NotARealKey → 400, adapter.updateEnv is NEVER called', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'PUT',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { writes: [{ key: 'NotARealKey', value: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(updateEnvMock).not.toHaveBeenCalled();
  });

  it('an empty writes array → 400, no engine write', async () => {
    const c = ctx!;
    const res = await c.app.inject({
      method: 'PUT',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { writes: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(updateEnvMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/settings/raw (REQ-078d) — verify-after-write + event emission', () => {
  it('a write to an observable non-secret key whose re-read matches → verified:true, one admin.raw_env.written(verified:true)', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings() }) // before (no AzureOpenAiEndpoint)
      .mockResolvedValueOnce({
        settings: baseEngineSettings({ AzureOpenAiEndpoint: 'https://example.openai.azure.com' }),
      });

    const res = await c.app.inject({
      method: 'PUT',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { writes: [{ key: 'AzureOpenAiEndpoint', value: 'https://example.openai.azure.com' }] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { verified: boolean; keys: string[] };
    expect(body.verified).toBe(true);
    expect(body.keys).toEqual(['AzureOpenAiEndpoint']);

    const events = eventsNamed(c, 'admin.raw_env.written');
    expect(events).toHaveLength(1);
    expect(events[0]!.verified).toBe(true);
  });

  it('a write to a secret-overwrite key (already set, unobservable) → verified:false, event STILL emitted with verified:false', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) });

    const res = await c.app.inject({
      method: 'PUT',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { writes: [{ key: 'OpenAiKey', value: 'sk-rotated' }] },
    });

    expect(res.statusCode).toBe(200); // best-effort 2xx success, not suppressed (REQ-078d/028)
    const body = res.json() as { verified: boolean };
    expect(body.verified).toBe(false);

    const events = eventsNamed(c, 'admin.raw_env.written');
    expect(events).toHaveLength(1);
    expect(events[0]!.verified).toBe(false);
  });

  it('the admin.raw_env.written envelope `verified` is a SCALAR boolean, never an object', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings() })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ AzureOpenAiEndpoint: 'https://x' }) });

    await c.app.inject({
      method: 'PUT',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { writes: [{ key: 'AzureOpenAiEndpoint', value: 'https://x' }] },
    });

    const [event] = eventsNamed(c, 'admin.raw_env.written');
    expect(typeof event!.verified).toBe('boolean');
  });
});

describe('PUT /api/settings/raw — REQ-078f raw-editor events are distinct (critical)', () => {
  it('a raw write to LLMProvider emits EXACTLY ONE admin.raw_env.written and ZERO setting_changed/provider_changed', async () => {
    const c = ctx!;
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'ollama' }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ LLMProvider: 'openai' }) });

    const res = await c.app.inject({
      method: 'PUT',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { writes: [{ key: 'LLMProvider', value: 'openai' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(eventsNamed(c, 'admin.raw_env.written')).toHaveLength(1);
    expect(eventsNamed(c, 'admin.instance.setting_changed')).toHaveLength(0);
    expect(eventsNamed(c, 'admin.instance.provider_changed')).toHaveLength(0);
  });
});

describe('PUT /api/settings/raw — REQ-078d secret redaction (audit + event)', () => {
  it('the raw write value is sent to the engine but never appears in the event or the audit row', async () => {
    const c = ctx!;
    const SECRET_VALUE = 'sk-raw-editor-secret-value-77dd';
    getSystemMock
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) })
      .mockResolvedValueOnce({ settings: baseEngineSettings({ OpenAiKey: true }) });

    const res = await c.app.inject({
      method: 'PUT',
      url: '/api/settings/raw',
      cookies: { [SESSION_COOKIE]: c.cookie },
      payload: { writes: [{ key: 'OpenAiKey', value: SECRET_VALUE }] },
    });
    expect(res.statusCode).toBe(200);

    expect(updateEnvMock).toHaveBeenCalledWith({ OpenAiKey: SECRET_VALUE });

    const [event] = eventsNamed(c, 'admin.raw_env.written');
    expect(JSON.stringify(event)).not.toContain(SECRET_VALUE);

    const [row] = auditRows(c, 'raw_env.write', 'success');
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(SECRET_VALUE);

    expect(res.payload).not.toContain(SECRET_VALUE);
  });
});

describe('GET /api/diagnostics/vectors (REQ-074)', () => {
  it('returns { vectorCount } from adapter.vectorCount', async () => {
    const c = ctx!;
    vectorCountMock.mockResolvedValue(4242);
    const res = await c.app.inject({
      method: 'GET',
      url: '/api/diagnostics/vectors',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ vectorCount: 4242 });
  });
});

describe('GET /api/diagnostics/env (REQ-074) — masked env-dump', () => {
  it('a secret-bearing key in the env-dump is redacted; a non-secret key passes through', async () => {
    const c = ctx!;
    const PLAINTEXT_SECRET = 'sk-plaintext-should-never-render-55aa';
    envDumpMock.mockResolvedValue({
      OpenAiKey: PLAINTEXT_SECRET,
      DisableTelemetry: 'false',
    });

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/diagnostics/env',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['OpenAiKey']).not.toBe(PLAINTEXT_SECRET);
    expect(res.payload).not.toContain(PLAINTEXT_SECRET);
    expect(body['DisableTelemetry']).toBe('false');
  });
});

describe('GET /api/models/ollama (REQ-075/076)', () => {
  it('with OllamaLLMBasePath set and ollamaTags resolving → {available:true, models:[{name}]}', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({
      settings: baseEngineSettings({ OllamaLLMBasePath: 'http://localhost:11434' }),
    });
    ollamaTagsMock.mockResolvedValue([{ name: 'llama3' }, { name: 'mistral' }]);

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/models/ollama',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      available: true,
      models: [{ name: 'llama3' }, { name: 'mistral' }],
    });
    expect(ollamaTagsMock).toHaveBeenCalledWith('http://localhost:11434');
  });

  it('Ollama unreachable (ollamaTags throws) → {available:false, models:[]} and a 200, NOT a 500', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({
      settings: baseEngineSettings({ OllamaLLMBasePath: 'http://localhost:11434' }),
    });
    ollamaTagsMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/models/ollama',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, models: [] });
  });

  it('no configured base path → {available:false, models:[]}, ollamaTags never called', async () => {
    const c = ctx!;
    getSystemMock.mockResolvedValue({ settings: baseEngineSettings({ OllamaLLMBasePath: '' }) });

    const res = await c.app.inject({
      method: 'GET',
      url: '/api/models/ollama',
      cookies: { [SESSION_COOKIE]: c.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, models: [] });
    expect(ollamaTagsMock).not.toHaveBeenCalled();
  });
});
