// bff/src/relay/config.ts — white-box unit tests for the D-006 (GH #16) non-https peer-scheme
// guard (config.ts:82-92). The regression suite (relay-config.d006.test.ts, NOT modified here)
// covers the 4 main policy branches (prod+cred+http reject, dev+cred+http reject, dev+no-cred+http
// allow, prod+cred+https allow). This file is a NEW, separate file (mirrors this directory's
// per-defect isolation convention) targeting the bypass/edge cases a naive scheme-prefix check
// (`url.toLowerCase().startsWith('https://')`) is prone to: case folding, near-miss schemes, other
// insecure schemes, mixed peer lists, and the full gating matrix. All assertions here characterize
// CURRENT (intended-correct) behavior; any failure is reported as a suspected bypass bug, not fixed
// or weakened here.

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

describe('relay/config.ts — scheme-guard case sensitivity (config.ts:84 url.toLowerCase().startsWith)', () => {
  it('HTTPS:// (uppercase) is ACCEPTED when the guard is gated (production + credential)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'HTTPS://peer.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it('HtTpS:// (mixed case) is ACCEPTED when the guard is gated (production + credential)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'HtTpS://peer.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it('HTTP:// (uppercase) is REJECTED when the guard is gated (production + credential)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = 'HTTP://peer.example';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });
});

describe('relay/config.ts — near-miss / other insecure schemes, all REJECTED when gated (production + credential)', () => {
  const gate = () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
  };

  it('ws:// is rejected', async () => {
    gate();
    process.env['EVENT_BUS_URL'] = 'ws://peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  it('ftp:// is rejected', async () => {
    gate();
    process.env['EVENT_BUS_URL'] = 'ftp://peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  it('file:// is rejected', async () => {
    gate();
    process.env['EVENT_BUS_URL'] = 'file://peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  it('a scheme-less bare host is rejected', async () => {
    gate();
    process.env['EVENT_BUS_URL'] = 'peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  it('https:/peer (single slash, near-miss prefix) is rejected', async () => {
    gate();
    process.env['EVENT_BUS_URL'] = 'https:/peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  it('httpsx:// (near-miss scheme name) is rejected', async () => {
    gate();
    process.env['EVENT_BUS_URL'] = 'httpsx://peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });
});

describe('relay/config.ts — mixed peer lists (config.ts:83 for-of over peerUrls)', () => {
  it('a comma list with one https:// and one http:// entry rejects, naming the offending http entry (http first, credential gate)', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    process.env['EVENT_BUS_URL'] = 'https://good.example,http://bad.example';
    await expect(loadRelayConfig()).rejects.toThrow(/http:\/\/bad\.example/);
    // The error must name the offending http entry, not the https one.
    await expect(loadRelayConfig()).rejects.not.toThrow(/https:\/\/good\.example/);
  });

  it('a comma list with the http:// entry FIRST and https:// second also rejects, naming the http entry (dev + credential gate)', async () => {
    // Uses the dev+credential gate (not production+no-credential): in production, an unset
    // credential with a non-empty peer list is refused by the EARLIER REQ-F010-017 fail-fast
    // (config.ts:68-73) before the scheme loop ever runs, so that combination can't isolate the
    // scheme guard's own ordering/naming behavior.
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    process.env['EVENT_BUS_URL'] = 'http://bad.example,https://good.example';
    await expect(loadRelayConfig()).rejects.toThrow(/http:\/\/bad\.example/);
  });
});

describe('relay/config.ts — full gating matrix', () => {
  it('credential-set + dev + http:// -> rejects', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/https/i);
  });

  it('no-credential + production + http:// -> rejects (in practice via the EARLIER REQ-F010-017 missing-credential fail-fast, config.ts:68-73, since production with a non-empty peer list unconditionally requires a credential before the scheme loop is ever reached; the boot still correctly refuses)', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    await expect(loadRelayConfig()).rejects.toThrow(/EVENT_BUS_PEER_AUTH_TOKEN|https/i);
  });

  it('no-credential + dev + http:// -> allows (boots normally)', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    process.env['EVENT_BUS_URL'] = 'http://peer.example';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it('https:// is allowed with credential-set + dev', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    process.env['EVENT_BUS_URL'] = 'https://peer.example';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  // NOTE: "no-credential + production + https://" is NOT independently testable as a distinct
  // combination: in production, a non-empty peer list unconditionally requires a credential
  // (config.ts:68-73, REQ-F010-017) regardless of scheme, so that state can never boot at all —
  // https:// there would never reach the scheme guard either. See report for detail.

  it('https:// is allowed with no-credential + dev (ungated case, still fine)', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['EVENT_BUS_PEER_AUTH_TOKEN'];
    process.env['EVENT_BUS_URL'] = 'https://peer.example';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });

  it('https:// is allowed with credential-set + production (belt-and-braces on the primary regression case)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    process.env['EVENT_BUS_URL'] = 'https://peer.example';
    await expect(loadRelayConfig()).resolves.toBeDefined();
  });
});

describe('relay/config.ts — no false-reject of a legitimate https:// peer with port/path/query', () => {
  it('https://peer.example:8443/api/events?x=1 boots normally (gated: production + credential)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_PEER_AUTH_TOKEN'] = 'shared-secret';
    process.env['EVENT_BUS_URL'] = 'https://peer.example:8443/api/events?x=1';
    const { config } = await loadRelayConfig();
    expect(config.peerUrls).toEqual(['https://peer.example:8443/api/events?x=1']);
  });
});
