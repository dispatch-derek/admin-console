// bff/src/relay/config.ts — D-006 (GH #16) regression test. Root-cause per debugger's report:
// EVENT_BUS_URL parsing (config.ts:22-26) performs split/trim/filter with NO URL-scheme
// validation, so an `http://` peer is silently accepted and the relay POSTs the
// `X-Event-Auth-Token` shared secret + `admin.*` envelope in cleartext.
//
// Expected-fixed behavior (per the fix ticket): the relay MUST fail fast at config load/boot on
// any non-`https://` peer URL when a credential is configured (EVENT_BUS_PEER_AUTH_TOKEN set) OR
// NODE_ENV=production; `http://` stays allowed ONLY in development with NO credential.
//
// A NEW, separate file — mirrors this directory's existing per-defect isolation convention
// (relay-config.f010.test.ts alongside relay-config.test.ts): leaves both existing files
// untouched. Mirrors their vi.resetModules() + dynamic import() load-time-throw testing
// convention (bff/test/relay/relay-config.f010.test.ts, relay-config.test.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

describe('relay/config.ts — D-006 (GH #16): non-https peer scheme guard, credential-bearing/production boot', () => {
  // PRIMARY regression assertion: this is the case the defect describes exactly — production +
  // a configured credential + an http:// peer. Today config.ts has no scheme guard at all, so
  // this resolves (boots) instead of throwing naming the offending scheme. That is the RED.
  it('production + credential configured + http:// peer -> refuses to boot, naming the non-https scheme (D-006)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  // Boundary: credential configured but NODE_ENV=development — the fix ticket says the guard
  // fires on "credential configured OR production", so this must ALSO refuse.
  it('development + credential configured + http:// peer -> ALSO refuses to boot (credential-configured triggers the guard regardless of environment)', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  // Boundary: the one case where http:// must remain ALLOWED — dev, no credential at all.
  it('development + NO credential + http:// peer -> still boots (dev-only bare-http allowance, per fix ticket)', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  // Boundary: https:// must always be allowed, even in production with a credential configured.
  it('production + credential configured + https:// peer -> boots normally (https is always allowed)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'https://peer.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });
});
