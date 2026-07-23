// bff/src/relay/config.ts — F-010 credential config sourcing + boot posture (spec §3.1/§3.3/§4,
// REQ-F010-003/007/017). A NEW, separate file — mirrors bff/test/config.f004.test.ts's own
// precedent of isolating a feature's config additions in a dedicated file; the F-004-owned
// bff/test/relay/relay-config.test.ts / relay-config.unit.test.ts are left untouched.
//
// ASSUMED CONFIG KEY: the spec pins the env var name (`EVENT_BUS_PEER_AUTH_TOKEN`, REQ-F010-007,
// §8 Q1 ruled) and its read semantics (raw single string, no split/trim) exactly; the exported
// config FIELD name is not spec-pinned. This file assumes `config.peerAuthToken`, mirroring the
// existing camelCase convention for every other peer-scoped key (`peerUrls`, `peerTimeoutMs`).
// Mirrors this repo's own `vi.resetModules() + dynamic import()` load-time-throw testing
// convention (bff/test/relay/relay-config.test.ts, bff/test/config.test.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const RELAY_ONLY_KEYS = [
  'EVENT_BUS_URL',
  'EVENT_BUS_TRANSPORT',
  'EVENT_BUS_PEER_AUTH_TOKEN',
  'EVENT_BUS_BACKLOG_THRESHOLD',
  'EVENT_BUS_LAG_THRESHOLD_MS',
  'DB_PATH',
  'NODE_ENV',
] as const;

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const key of RELAY_ONLY_KEYS) snapshot[key] = process.env[key];
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

describe('relay/config.ts — REQ-F010-003: peer registration reuses the EXISTING EVENT_BUS_URL wire shape unchanged', () => {
  it('a representative cwa-shaped ingest URL added to EVENT_BUS_URL appears in config.peerUrls (REQ-F010-003 fixes the wire SHAPE, not a literal deployment URL)', async () => {
    process.env['EVENT_BUS_URL'] = 'https://cwa.example.com/api/events/ingest';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok';
    const { config } = await loadRelayConfig();
    expect((config as { peerUrls: string[] }).peerUrls).toEqual(['https://cwa.example.com/api/events/ingest']);
  });

  it('with the URL absent from EVENT_BUS_URL, it is not among the configured peers', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['EVENT_BUS_URL'];
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    const { config } = await loadRelayConfig();
    expect((config as { peerUrls: string[] }).peerUrls).not.toContain('https://cwa.example.com/api/events/ingest');
  });
});

describe('relay/config.ts — REQ-F010-007: EVENT_BUS_PEER_AUTH_TOKEN is a NEW relay-scoped key, read as a raw single string', () => {
  it('setting the env var makes it available on config, unmodified', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'raw-secret-value-!@#';
    const { config } = await loadRelayConfig();
    expect((config as { peerAuthToken?: string }).peerAuthToken).toBe('raw-secret-value-!@#');
  });

  it('is NOT comma-split — a value containing a literal comma is preserved whole (contrast with EVENT_BUS_URL peer-list splitting)', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'part-one,part-two';
    const { config } = await loadRelayConfig();
    expect((config as { peerAuthToken?: string }).peerAuthToken).toBe('part-one,part-two');
  });

  it('is NOT whitespace-trimmed — a leading/trailing-space value is preserved verbatim (contrast with EVENT_BUS_URL peer-list trimming, REQ-F004-052)', async () => {
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = '  padded  ';
    const { config } = await loadRelayConfig();
    expect((config as { peerAuthToken?: string }).peerAuthToken).toBe('  padded  ');
  });

  it('is undefined when unset (no invented fallback default)', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    const { config } = await loadRelayConfig();
    expect((config as { peerAuthToken?: string }).peerAuthToken).toBeUndefined();
  });

  it('a static scan of config.ts references the new key and contains no obviously hard-coded secret-shaped literal', () => {
    const path = resolve(import.meta.dirname, '../../src/relay/config.ts');
    if (!existsSync(path)) {
      expect.fail('bff/src/relay/config.ts does not exist.');
      return;
    }
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/EVENT_BUS_PEER_AUTH_TOKEN/); // the key is referenced
    // Heuristic, not exhaustive: no 24+ char quoted literal that looks like a hard-coded secret.
    expect(text).not.toMatch(/['"][A-Za-z0-9+/]{24,}['"]/);
  });
});

describe('relay/config.ts — REQ-F010-017: boot posture on a missing/empty credential while a peer is configured', () => {
  it('production + peer configured + credential ABSENT -> refuses to boot, naming EVENT_BUS_PEER_AUTH_TOKEN', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    await expect(loadRelayConfig()).rejects.toThrow(/EVENT_BUS_PEER_AUTH_TOKEN/);
  });

  it('production + peer configured + credential = "" (zero-length) -> refuses to boot, naming the variable', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = '';
    await expect(loadRelayConfig()).rejects.toThrow(/EVENT_BUS_PEER_AUTH_TOKEN/);
  });

  it('production + peer configured + credential = " " (whitespace-only) -> BOOTS (whitespace-only is NOT empty, REQ-F010-017), value preserved verbatim', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = ' ';
    const { config } = await loadRelayConfig();
    expect((config as { peerAuthToken?: string }).peerAuthToken).toBe(' ');
  });

  it('production + peer configured + credential present -> boots normally', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'real-token';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it('development (NODE_ENV != production) + peer configured + credential UNSET -> boots SOFT (does not throw) — normative per REQ-F010-017, guaranteeing the REQ-F010-024(b-missing) e2e precondition', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it('development + peer configured + credential = "" (zero-length) -> ALSO boots soft (empty is empty regardless of the whitespace/absent distinction)', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = '';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it.each(['production', 'development'] as const)(
    '%s: a credential containing a CR byte refuses to boot (header-legality validation, environment-INDEPENDENT)',
    async (env) => {
      process.env['NODE_ENV'] = env;
      process.env['EVENT_BUS_URL'] = 'https://a.example';
      process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\rmore';
      await expect(loadRelayConfig()).rejects.toThrow();
    },
  );

  it.each(['production', 'development'] as const)(
    '%s: a credential containing an LF byte refuses to boot',
    async (env) => {
      process.env['NODE_ENV'] = env;
      process.env['EVENT_BUS_URL'] = 'https://a.example';
      process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\nmore';
      await expect(loadRelayConfig()).rejects.toThrow();
    },
  );

  it.each(['production', 'development'] as const)(
    '%s: a credential containing a NUL byte refuses to boot',
    async (env) => {
      process.env['NODE_ENV'] = env;
      process.env['EVENT_BUS_URL'] = 'https://a.example';
      process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\u0000more';
      await expect(loadRelayConfig()).rejects.toThrow();
    },
  );

  it('the header-illegal-byte refusal error is distinct from the empty-value refusal error (spec: "this validation is distinct from the empty-value check")', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\r\nmore';
    await expect(loadRelayConfig()).rejects.toThrow(/illegal|invalid|control character|header/i);
  });

  it('CR/LF/NUL are NON-EXHAUSTIVE illustrations — a credential containing another header-illegal byte still refuses (e.g. a bare NEL-adjacent vertical tab, 0x0B, chosen as a plausible non-CR/LF/NUL illegal byte)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'tok\u000Bmore';
    await expect(loadRelayConfig()).rejects.toThrow();
  });
});
