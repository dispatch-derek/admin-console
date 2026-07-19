// White-box unit tests for bff/src/relay/config.ts — supplements bff/test/relay/relay-config.test.ts
// (qa-engineer's spec-level suite, NOT modified here). Targets `intEnv`'s branches v8 coverage
// showed unexercised by the spec suite (config.ts:39/48):
//   line 39 — `raw === undefined || raw.trim() === ''` short-circuits to the fallback: the spec
//   suite only ever tests the var fully UNSET (undefined), never present-but-BLANK.
//   line 48 — `Number.isFinite(n) ? n : fallback`: the spec suite never supplies a non-numeric
//   string, so the NaN-falls-back-to-default branch is unexercised.
// Also covers an EVENT_BUS_URL comma-list edge the spec suite's parsing-edge block doesn't:
// whitespace-only entries between commas, and the production hard-refuse boundary when the URL
// is present but parses down to an EMPTY peer list (not just literally unset).
//
// Phase 7 review-gate remediation additions (coordinator-directed, 2026-07-19): the three new
// EVENT_BUS_RETENTION_MS / EVENT_BUS_PRUNE_EVERY_CYCLES / EVENT_BUS_PEER_TIMEOUT_MS vars, which
// share the exact same `intEnv` contract (default on unset/blank/invalid, parsed override
// otherwise) as the pre-existing threshold vars above.

import { describe, it, expect, afterEach, vi } from 'vitest';

const RELAY_ONLY_KEYS = [
  'EVENT_BUS_URL',
  'EVENT_BUS_TRANSPORT',
  'EVENT_BUS_BACKLOG_THRESHOLD',
  'EVENT_BUS_LAG_THRESHOLD_MS',
  'EVENT_BUS_RETENTION_MS',
  'EVENT_BUS_PRUNE_EVERY_CYCLES',
  'EVENT_BUS_PEER_TIMEOUT_MS',
  'DB_PATH',
  'NODE_ENV',
] as const;

let snapshot: Record<string, string | undefined> | undefined;

afterEach(() => {
  if (snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  vi.resetModules();
});

function snapshotEnv(): void {
  snapshot = {};
  for (const key of RELAY_ONLY_KEYS) snapshot[key] = process.env[key];
}

async function loadRelayConfig() {
  vi.resetModules();
  return import('../../src/relay/config.js');
}

describe('relay/config.ts — intEnv blank-string branch (config.ts:39, distinct from fully-unset)', () => {
  it('EVENT_BUS_BACKLOG_THRESHOLD set to an empty string falls back to the 1000 default (not NaN/0)', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_BACKLOG_THRESHOLD'] = '';
    const { config } = await loadRelayConfig();
    expect(config.backlogThreshold).toBe(1000);
  });

  it('EVENT_BUS_LAG_THRESHOLD_MS set to whitespace-only falls back to the 30000 default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_LAG_THRESHOLD_MS'] = '   ';
    const { config } = await loadRelayConfig();
    expect(config.lagThresholdMs).toBe(30_000);
  });
});

describe('relay/config.ts — intEnv non-numeric fallback branch (config.ts:48, Number.isFinite guard)', () => {
  it('EVENT_BUS_BACKLOG_THRESHOLD set to a non-numeric string falls back to the default (not NaN)', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_BACKLOG_THRESHOLD'] = 'not-a-number';
    const { config } = await loadRelayConfig();
    expect(config.backlogThreshold).toBe(1000);
    expect(Number.isNaN(config.backlogThreshold)).toBe(false);
  });

  it('a partially-numeric string ("50abc") is parsed by parseInt\'s leading-digits behavior (documents current lenient parsing, not a spec pin)', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_LAG_THRESHOLD_MS'] = '50abc';
    const { config } = await loadRelayConfig();
    // Number.parseInt('50abc', 10) === 50, which IS finite, so the fallback does NOT trigger.
    expect(config.lagThresholdMs).toBe(50);
  });

  it('a negative threshold string is accepted as-is (no floor validation)', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_BACKLOG_THRESHOLD'] = '-5';
    const { config } = await loadRelayConfig();
    expect(config.backlogThreshold).toBe(-5);
  });
});

describe('relay/config.ts — dbPath nullish-coalescing default (shared with store/db-path.ts, same value as before the F-004 db-path.ts extraction)', () => {
  it('DB_PATH entirely unset falls back to the literal "data/console.db" default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['DB_PATH'];
    const { config } = await loadRelayConfig();
    expect(config.dbPath).toBe('data/console.db');
  });

  it('an explicit DB_PATH is honored verbatim, not defaulted', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['DB_PATH'] = '/tmp/custom-relay.db';
    const { config } = await loadRelayConfig();
    expect(config.dbPath).toBe('/tmp/custom-relay.db');
  });
});

describe('relay/config.ts — EVENT_BUS_RETENTION_MS (default 604800000 = 7 days)', () => {
  it('defaults to 604800000ms when unset', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_RETENTION_MS'];
    const { config } = await loadRelayConfig();
    expect(config.retentionMs).toBe(604_800_000);
  });

  it('honors an explicit override', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_RETENTION_MS'] = '86400000';
    const { config } = await loadRelayConfig();
    expect(config.retentionMs).toBe(86_400_000);
  });

  it('blank string falls back to the default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_RETENTION_MS'] = '  ';
    const { config } = await loadRelayConfig();
    expect(config.retentionMs).toBe(604_800_000);
  });

  it('a non-numeric value falls back to the default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_RETENTION_MS'] = 'forever';
    const { config } = await loadRelayConfig();
    expect(config.retentionMs).toBe(604_800_000);
  });
});

describe('relay/config.ts — EVENT_BUS_PRUNE_EVERY_CYCLES (default 3600)', () => {
  it('defaults to 3600 when unset', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_PRUNE_EVERY_CYCLES'];
    const { config } = await loadRelayConfig();
    expect(config.pruneEveryCycles).toBe(3_600);
  });

  it('honors an explicit override', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PRUNE_EVERY_CYCLES'] = '10';
    const { config } = await loadRelayConfig();
    expect(config.pruneEveryCycles).toBe(10);
  });

  it('blank string falls back to the default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PRUNE_EVERY_CYCLES'] = '';
    const { config } = await loadRelayConfig();
    expect(config.pruneEveryCycles).toBe(3_600);
  });

  it('a non-numeric value falls back to the default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PRUNE_EVERY_CYCLES'] = 'often';
    const { config } = await loadRelayConfig();
    expect(config.pruneEveryCycles).toBe(3_600);
  });
});

describe('relay/config.ts — EVENT_BUS_PEER_TIMEOUT_MS (default 10000)', () => {
  it('defaults to 10000ms when unset', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    delete process.env['EVENT_BUS_PEER_TIMEOUT_MS'];
    const { config } = await loadRelayConfig();
    expect(config.peerTimeoutMs).toBe(10_000);
  });

  it('honors an explicit override', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_TIMEOUT_MS'] = '2500';
    const { config } = await loadRelayConfig();
    expect(config.peerTimeoutMs).toBe(2_500);
  });

  it('blank string falls back to the default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_TIMEOUT_MS'] = '   ';
    const { config } = await loadRelayConfig();
    expect(config.peerTimeoutMs).toBe(10_000);
  });

  it('a non-numeric value falls back to the default', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = 'https://a.example';
    process.env['EVENT_BUS_PEER_TIMEOUT_MS'] = 'slow';
    const { config } = await loadRelayConfig();
    expect(config.peerTimeoutMs).toBe(10_000);
  });
});

describe('relay/config.ts — EVENT_BUS_URL parsing edges beyond the spec suite\'s coverage', () => {
  it('an EVENT_BUS_URL of only commas/whitespace parses down to an EMPTY peer list', async () => {
    snapshotEnv();
    process.env['EVENT_BUS_URL'] = '  ,  , ,';
    const { config } = await loadRelayConfig();
    expect(config.peerUrls).toEqual([]);
  });

  it('EVENT_BUS_URL entirely unset yields an empty peerUrls array (not undefined/throw) outside production', async () => {
    snapshotEnv();
    delete process.env['NODE_ENV'];
    delete process.env['EVENT_BUS_URL'];
    const { config } = await loadRelayConfig();
    expect(config.peerUrls).toEqual([]);
    expect(config.eventBusUrl).toBeUndefined();
  });

  it('production + a URL that is present but parses down to an EMPTY peer list (only commas) still hard-refuses (REQ-F004-045 is about the PARSED list, not raw presence)', async () => {
    snapshotEnv();
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_URL'] = ' , , ';
    await expect(loadRelayConfig()).rejects.toThrow(/EVENT_BUS_URL/);
  });
});
