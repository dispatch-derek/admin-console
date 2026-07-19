// bff/src/relay/config.ts — the RELAY-SCOPED config (spec REQ-F004-021/033/039/044/045/052;
// design §5, §11 open question #1: "the relay needs a relay-scoped config that requires only
// the DB path + EVENT_BUS_*", explicitly NOT the BFF's `requireEnv`'d engine/auth secrets).
// Mirrors bff/test/config.test.ts's own load-time-throw testing convention
// (vi.resetModules() + dynamic import + rejects.toThrow()).
//
// ASSUMED MODULE PATH / EXPORT (design leaves the exact split as an open question; most
// defensible reading given the file table's "config.ts (edit) *(or a relay-scoped config, see
// §5 / open questions)*" and the explicit "separate process" framing, REQ-F004-033/054):
//   bff/src/relay/config.ts exporting `config` (a load-time const, same pattern as
//   bff/src/config.ts) with: eventBusUrl (raw), peerUrls (parsed array), transportKind,
//   backlogThreshold, lagThresholdMs, dbPath.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const RELAY_ONLY_KEYS = [
  'EVENT_BUS_URL',
  'EVENT_BUS_TRANSPORT',
  'EVENT_BUS_BACKLOG_THRESHOLD',
  'EVENT_BUS_LAG_THRESHOLD_MS',
  'DB_PATH',
  'NODE_ENV',
] as const;

// The BFF-only secrets a relay-scoped config must NOT require (REQ-F004-033 design note).
const BFF_ONLY_SECRETS = ['ANYTHINGLLM_BASE_URL', 'ANYTHINGLLM_API_KEY', 'SESSION_SECRET', 'SECRETS_ENC_KEY'] as const;

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const key of [...RELAY_ONLY_KEYS, ...BFF_ONLY_SECRETS]) snapshot[key] = process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

async function loadRelayConfig() {
  vi.resetModules();
  return import('../../src/relay/config.js');
}

describe('relay/config.ts — module resolution', () => {
  it('exists', async () => {
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    let error: Error | undefined;
    try {
      await loadRelayConfig();
    } catch (e) {
      error = e as Error;
    }
    if (error && /Cannot find module|Failed to resolve/i.test(error.message)) {
      expect.fail('bff/src/relay/config.ts does not exist yet — expected pre-implementation RED signal.');
    }
  });
});

describe('relay/config.ts — REQ-F004-033: requires ONLY the DB path + EVENT_BUS_*, NOT the BFF secrets', () => {
  it('loads successfully with EVERY BFF-only secret UNSET (ANYTHINGLLM_*, SESSION_SECRET, SECRETS_ENC_KEY)', async () => {
    for (const key of BFF_ONLY_SECRETS) delete process.env[key];
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    process.env['NODE_ENV'] = 'development';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });
});

describe('relay/config.ts — EVENT_BUS_URL comma-delimited peer list (REQ-F004-052(1))', () => {
  it('parses a two-URL comma list into exactly two trimmed peers', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example, https://b.example';
    const { config } = await loadRelayConfig();
    expect((config as { peerUrls: string[] }).peerUrls).toEqual(['https://a.example', 'https://b.example']);
  });

  it('drops empty entries (trailing comma)', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example,,https://b.example,';
    const { config } = await loadRelayConfig();
    expect((config as { peerUrls: string[] }).peerUrls).toEqual(['https://a.example', 'https://b.example']);
  });

  it('a single URL yields a single peer', async () => {
    process.env['EVENT_BUS_URL'] = 'https://only.example';
    const { config } = await loadRelayConfig();
    expect((config as { peerUrls: string[] }).peerUrls).toEqual(['https://only.example']);
  });
});

describe('relay/config.ts — EVENT_BUS_TRANSPORT selector (REQ-F004-052(2))', () => {
  it('defaults to "http" when unset', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_TRANSPORT'];
    const { config } = await loadRelayConfig();
    expect((config as { transportKind: string }).transportKind).toBe('http');
  });

  it('honors an explicit EVENT_BUS_TRANSPORT=http', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_TRANSPORT'] = 'http';
    const { config } = await loadRelayConfig();
    expect((config as { transportKind: string }).transportKind).toBe('http');
  });
});

describe('relay/config.ts — /ready thresholds (REQ-F004-026)', () => {
  it('defaults EVENT_BUS_BACKLOG_THRESHOLD to 1000 and EVENT_BUS_LAG_THRESHOLD_MS to 30000', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_BACKLOG_THRESHOLD'];
    delete process.env['EVENT_BUS_LAG_THRESHOLD_MS'];
    const { config } = await loadRelayConfig();
    expect((config as { backlogThreshold: number }).backlogThreshold).toBe(1000);
    expect((config as { lagThresholdMs: number }).lagThresholdMs).toBe(30_000);
  });

  it('honors explicit threshold overrides', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_BACKLOG_THRESHOLD'] = '50';
    process.env['EVENT_BUS_LAG_THRESHOLD_MS'] = '5000';
    const { config } = await loadRelayConfig();
    expect((config as { backlogThreshold: number }).backlogThreshold).toBe(50);
    expect((config as { lagThresholdMs: number }).lagThresholdMs).toBe(5000);
  });
});

describe('relay/config.ts — bus-mode-without-URL hard-refuse (REQ-F004-045, RELAY owns this variable, not the BFF)', () => {
  it('production + empty EVENT_BUS_URL -> the relay REFUSES to boot (throws), citing the missing URL', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['EVENT_BUS_URL'];
    await expect(loadRelayConfig()).rejects.toThrow(/EVENT_BUS_URL/);
  });

  it('development + empty EVENT_BUS_URL does NOT throw at load (soft posture — relay starts, /ready reports not-ready separately)', async () => {
    delete process.env['NODE_ENV'];
    delete process.env['EVENT_BUS_URL'];
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });
});

describe('relay/config.ts — EVENT_BUS_TRANSPORT=broker hard-refuses in ALL environments (REQ-F004-052(3), rev-10)', () => {
  it.each(['production', 'development', undefined])('NODE_ENV=%s + EVENT_BUS_TRANSPORT=broker refuses to boot', async (env) => {
    if (env === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = env;
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_TRANSPORT'] = 'broker';
    await expect(loadRelayConfig()).rejects.toThrow(/broker transport not available/i);
  });
});
