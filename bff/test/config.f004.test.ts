// bff/src/config.ts — F-004 EVENT_BUS_MODE production hard-refuse (spec REQ-F004-021/039/046).
// Separate file (not editing the existing config.test.ts) so this task's additions stay isolated
// and traceable. Mirrors config.test.ts's own load-time-throw convention exactly.
//
// Per REQ-F004-021/039: under NODE_ENV=production, any non-'bus' EVENT_BUS_MODE (literal
// 'inproc', unset, or an unrecognized typo like 'buss') MUST make the BFF refuse to boot
// (non-zero exit / thrown error naming EVENT_BUS_MODE) — because the grounded factory
// (bus.ts:40) silently falls back to InProcessBus, which marks rows published WITHOUT ever
// delivering them (InProcessBus.publish inserts + immediately markPublished with zero
// subscribers), causing silent, permanent event loss once later switched to `bus` mode
// (REQ-F004-041 excludes already-published rows from the drain). In development the same
// misconfiguration MAY warn and default to `inproc` (REQ-F004-046) — config load must NOT throw.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const VALID_ENV: Record<string, string> = {
  ANYTHINGLLM_BASE_URL: 'http://localhost:3001/',
  ANYTHINGLLM_API_KEY: 'engine-key',
  SESSION_SECRET: 'session-secret-0123456789abcdef01',
  SECRETS_ENC_KEY: 'secrets-key-0123456789abcdef012345',
};
const OPTIONAL_KEYS = ['NODE_ENV', 'EVENT_BUS_MODE', 'EVENT_BUS_URL'];

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const key of [...Object.keys(VALID_ENV), ...OPTIONAL_KEYS]) snapshot[key] = process.env[key];
  for (const [key, value] of Object.entries(VALID_ENV)) process.env[key] = value;
  for (const key of OPTIONAL_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

async function loadConfig() {
  vi.resetModules();
  return import('../src/config.js');
}

describe('config.ts — EVENT_BUS_MODE production hard-refuse (REQ-F004-021/039)', () => {
  it('production + EVENT_BUS_MODE unset -> BFF refuses to boot (throws, names EVENT_BUS_MODE)', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['EVENT_BUS_MODE'];
    await expect(loadConfig()).rejects.toThrow(/EVENT_BUS_MODE/);
  });

  it('production + EVENT_BUS_MODE=inproc (the literal interim value) -> BFF refuses to boot', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'inproc';
    await expect(loadConfig()).rejects.toThrow(/EVENT_BUS_MODE/);
  });

  it('production + EVENT_BUS_MODE="buss" (typo, unrecognized value) -> BFF refuses to boot (REQ-F004-046 M2)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'buss';
    await expect(loadConfig()).rejects.toThrow(/EVENT_BUS_MODE/);
  });

  it('production + EVENT_BUS_MODE=bus (correct value) boots normally', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'bus';
    process.env['EVENT_BUS_URL'] = 'https://peer.example';
    await expect(loadConfig()).resolves.toBeDefined();
  });

  it('development + EVENT_BUS_MODE unset does NOT throw (soft posture, REQ-F004-046)', async () => {
    delete process.env['NODE_ENV'];
    delete process.env['EVENT_BUS_MODE'];
    await expect(loadConfig()).resolves.toBeDefined();
  });

  it('development + EVENT_BUS_MODE="buss" (typo) does NOT throw at load (warns, defaults to inproc)', async () => {
    delete process.env['NODE_ENV'];
    process.env['EVENT_BUS_MODE'] = 'buss';
    const { config } = await loadConfig();
    expect(config.eventBusMode).toBe('inproc');
  });
});
