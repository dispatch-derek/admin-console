// config.ts — requireEnv + parsed config shape (design 04-cross-cutting.md §h, REQ-001,
// REQ-019a, REQ-020, REQ-095). config.ts is a load-time const that throws on a missing
// required var, so every case here mutates process.env directly and (re)imports the
// module fresh via vi.resetModules() + a dynamic import().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Unconditionally required at load (REQ-001, REQ-013). Missing → process exits at startup.
const REQUIRED_KEYS = [
  'ANYTHINGLLM_BASE_URL',
  'ANYTHINGLLM_API_KEY',
  'SESSION_SECRET',
  'SECRETS_ENC_KEY',
] as const;

// REQ-019a: required ONLY at first boot (empty staff store), enforced in bootstrap.ts —
// NOT via requireEnv. Their absence must NOT block config load / startup.
const BOOTSTRAP_KEYS = ['ADMIN_BOOTSTRAP_USERNAME', 'ADMIN_BOOTSTRAP_TOKEN'] as const;

const VALID_ENV: Record<string, string> = {
  ANYTHINGLLM_BASE_URL: 'http://localhost:3001/',
  ANYTHINGLLM_API_KEY: 'engine-key',
  ADMIN_BOOTSTRAP_USERNAME: 'admin',
  ADMIN_BOOTSTRAP_TOKEN: 'bootstrap-token',
  SESSION_SECRET: 'session-secret-0123456789abcdef01', // >= 32 chars (sec review L-5)
  SECRETS_ENC_KEY: 'secrets-key-0123456789abcdef012345', // >= 32 chars (sec review L-5)
};

// Keys this suite pokes at, beyond the required six, that must be restored between tests.
const OPTIONAL_KEYS = [
  'PORT',
  'NODE_ENV',
  'WEB_ORIGINS',
  'EVENT_BUS_MODE',
  'EVENT_BUS_URL',
  'DB_PATH',
  'COOKIE_INSECURE',
  'FEATURE_CATALOG_MANIFEST_PATH',
  'CUSTOMER_LABEL',
];

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const key of [...REQUIRED_KEYS, ...BOOTSTRAP_KEYS, ...OPTIONAL_KEYS]) snapshot[key] = process.env[key];
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

describe('config.ts — requireEnv', () => {
  it.each(REQUIRED_KEYS)('throws when %s is missing', async (missingKey) => {
    delete process.env[missingKey];
    await expect(loadConfig()).rejects.toThrow(
      `Missing required environment variable: ${missingKey}`,
    );
  });

  it.each(REQUIRED_KEYS)('throws when %s is an empty string (falsy, not just unset)', async (key) => {
    process.env[key] = '';
    await expect(loadConfig()).rejects.toThrow(`Missing required environment variable: ${key}`);
  });

  it('builds the config object when all required vars are present', async () => {
    const { config } = await loadConfig();
    expect(config.anythingLLMApiKey).toBe('engine-key');
    expect(config.adminBootstrapUsername).toBe('admin');
    expect(config.adminBootstrapToken).toBe('bootstrap-token');
    expect(config.sessionSecret).toBe('session-secret-0123456789abcdef01');
    expect(config.secretsKey).toBe('secrets-key-0123456789abcdef012345');
  });

  it.each(BOOTSTRAP_KEYS)('loads WITHOUT %s — bootstrap vars are optional at load (REQ-019a)', async (key) => {
    delete process.env[key];
    const { config } = await loadConfig();
    // Config load must not throw; the missing var surfaces as undefined and is enforced
    // conditionally in bootstrap.ts only when the staff store is empty.
    expect(config[key === 'ADMIN_BOOTSTRAP_USERNAME' ? 'adminBootstrapUsername' : 'adminBootstrapToken']).toBeUndefined();
  });

  it('loads with BOTH bootstrap vars unset (non-first-boot startup, REQ-019a)', async () => {
    delete process.env['ADMIN_BOOTSTRAP_USERNAME'];
    delete process.env['ADMIN_BOOTSTRAP_TOKEN'];
    const { config } = await loadConfig();
    expect(config.adminBootstrapUsername).toBeUndefined();
    expect(config.adminBootstrapToken).toBeUndefined();
  });

  it('strips a trailing slash from ANYTHINGLLM_BASE_URL', async () => {
    process.env['ANYTHINGLLM_BASE_URL'] = 'http://engine.local:3001/';
    const { config } = await loadConfig();
    expect(config.anythingLLMBaseUrl).toBe('http://engine.local:3001');
  });

  it('leaves a base URL with no trailing slash unchanged', async () => {
    process.env['ANYTHINGLLM_BASE_URL'] = 'http://engine.local:3001';
    const { config } = await loadConfig();
    expect(config.anythingLLMBaseUrl).toBe('http://engine.local:3001');
  });
});

describe('config.ts — PORT (REQ-020)', () => {
  it('defaults to 3002 when PORT is unset', async () => {
    const { config } = await loadConfig();
    expect(config.port).toBe(3002);
  });

  it('parses a numeric PORT from the environment', async () => {
    process.env['PORT'] = '4100';
    const { config } = await loadConfig();
    expect(config.port).toBe(4100);
  });
});

describe('config.ts — corsMode (REQ-095)', () => {
  it('is "strict" when NODE_ENV=production', async () => {
    process.env['NODE_ENV'] = 'production';
    // REQ-F004-021/039: production requires EVENT_BUS_MODE='bus' or config load hard-refuses.
    // This test is about corsMode, not the event bus, so supply a valid mode — the dedicated
    // EVENT_BUS_MODE throw/hard-refuse behavior is already owned by config.f004.test.ts.
    process.env['EVENT_BUS_MODE'] = 'bus';
    const { config } = await loadConfig();
    expect(config.corsMode).toBe('strict');
  });

  it.each([undefined, 'development', 'test'])('is "permissive" when NODE_ENV=%s', async (env) => {
    if (env === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = env;
    const { config } = await loadConfig();
    expect(config.corsMode).toBe('permissive');
  });
});

describe('config.ts — webOrigins (REQ-095 strict allowlist)', () => {
  it('is an empty array when WEB_ORIGINS is unset', async () => {
    const { config } = await loadConfig();
    expect(config.webOrigins).toEqual([]);
  });

  it('splits a comma-separated WEB_ORIGINS into an array', async () => {
    process.env['WEB_ORIGINS'] = 'https://a.example.com,https://b.example.com';
    const { config } = await loadConfig();
    expect(config.webOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('filters out empty entries (e.g. a trailing comma)', async () => {
    process.env['WEB_ORIGINS'] = 'https://a.example.com,,https://b.example.com,';
    const { config } = await loadConfig();
    expect(config.webOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });
});

describe('config.ts — event bus mode (04c)', () => {
  it('defaults eventBusMode to "inproc"', async () => {
    const { config } = await loadConfig();
    expect(config.eventBusMode).toBe('inproc');
    expect(config.eventBusUrl).toBeUndefined();
  });

  it('honors an explicit EVENT_BUS_MODE and EVENT_BUS_URL', async () => {
    process.env['EVENT_BUS_MODE'] = 'bus';
    process.env['EVENT_BUS_URL'] = 'redis://localhost:6379';
    const { config } = await loadConfig();
    expect(config.eventBusMode).toBe('bus');
    expect(config.eventBusUrl).toBe('redis://localhost:6379');
  });
});

describe('config.ts — dbPath', () => {
  it('defaults to data/console.db when DB_PATH is unset', async () => {
    const { config } = await loadConfig();
    expect(config.dbPath).toBe('data/console.db');
  });

  it('honors an explicit DB_PATH', async () => {
    process.env['DB_PATH'] = '/tmp/somewhere/console.db';
    const { config } = await loadConfig();
    expect(config.dbPath).toBe('/tmp/somewhere/console.db');
  });
});

describe('config.ts — featureCatalogPath (F-005, REQ-F005-058/044)', () => {
  it('is undefined when FEATURE_CATALOG_MANIFEST_PATH is unset', async () => {
    const { config } = await loadConfig();
    expect(config.featureCatalogPath).toBeUndefined();
  });

  it('is undefined when FEATURE_CATALOG_MANIFEST_PATH is an empty string (falsy, treated as unset)', async () => {
    process.env['FEATURE_CATALOG_MANIFEST_PATH'] = '';
    const { config } = await loadConfig();
    expect(config.featureCatalogPath).toBeUndefined();
  });

  it('honors an explicit FEATURE_CATALOG_MANIFEST_PATH', async () => {
    process.env['FEATURE_CATALOG_MANIFEST_PATH'] = '/etc/admin-console/feature-catalog.json';
    const { config } = await loadConfig();
    expect(config.featureCatalogPath).toBe('/etc/admin-console/feature-catalog.json');
  });
});

describe('config.ts — customerLabel (F-005, REQ-F005-060 amends -048/027)', () => {
  it('REQ-F005-060 — falls back to the fixed neutral literal "this install" when CUSTOMER_LABEL is unset, never an engine-derived value', async () => {
    process.env['ANYTHINGLLM_BASE_URL'] = 'http://engine.local:3001/';
    delete process.env['CUSTOMER_LABEL'];
    const { config } = await loadConfig();
    expect(config.customerLabel).toBe('this install');
    // The point of the ruling: no engine address/origin ever leaks into the fallback label.
    expect(config.customerLabel).not.toBe('http://engine.local:3001');
    expect(config.customerLabel).not.toContain('engine.local');
  });

  it('REQ-F005-060 — falls back to "this install" when CUSTOMER_LABEL is an empty string (falsy), never the engine base URL', async () => {
    process.env['ANYTHINGLLM_BASE_URL'] = 'http://engine.local:3001';
    process.env['CUSTOMER_LABEL'] = '';
    const { config } = await loadConfig();
    expect(config.customerLabel).toBe('this install');
    expect(config.customerLabel).not.toBe('http://engine.local:3001');
    expect(config.customerLabel).not.toContain('engine.local');
  });

  it('honors an explicit CUSTOMER_LABEL, taking precedence over the "this install" fallback', async () => {
    process.env['CUSTOMER_LABEL'] = 'Acme Corp — prod install';
    const { config } = await loadConfig();
    expect(config.customerLabel).toBe('Acme Corp — prod install');
  });
});

describe('config.ts — secret minimum length (sec review L-5)', () => {
  it.each(['SESSION_SECRET', 'SECRETS_ENC_KEY'] as const)(
    'throws when %s is shorter than 32 characters',
    async (key) => {
      process.env[key] = 'a-short-secret'; // 14 chars, well under the 32-char minimum
      await expect(loadConfig()).rejects.toThrow(
        `Environment variable ${key} must be at least 32 characters`,
      );
    },
  );

  it('throws when a secret is exactly 31 characters (one short of the minimum)', async () => {
    process.env['SESSION_SECRET'] = 'a'.repeat(31);
    await expect(loadConfig()).rejects.toThrow(
      'Environment variable SESSION_SECRET must be at least 32 characters',
    );
  });

  it('accepts a secret that is exactly 32 characters long (boundary)', async () => {
    process.env['SESSION_SECRET'] = 'a'.repeat(32);
    process.env['SECRETS_ENC_KEY'] = 'b'.repeat(32);
    const { config } = await loadConfig();
    expect(config.sessionSecret).toBe('a'.repeat(32));
    expect(config.secretsKey).toBe('b'.repeat(32));
  });

  it('a too-short secret is caught before an empty-string check would fire (distinct error message)', async () => {
    process.env['SESSION_SECRET'] = 'not-empty-but-too-short';
    await expect(loadConfig()).rejects.toThrow(/must be at least 32 characters/);
    await expect(loadConfig()).rejects.not.toThrow(/Missing required environment variable/);
  });
});

describe('config.ts — cookieSecure (sec review M-1)', () => {
  it('defaults to true in dev when COOKIE_INSECURE is unset', async () => {
    delete process.env['NODE_ENV'];
    delete process.env['COOKIE_INSECURE'];
    const { config } = await loadConfig();
    expect(config.cookieSecure).toBe(true);
  });

  it('is false in dev when COOKIE_INSECURE=1 (explicit opt-out)', async () => {
    delete process.env['NODE_ENV'];
    process.env['COOKIE_INSECURE'] = '1';
    const { config } = await loadConfig();
    expect(config.cookieSecure).toBe(false);
  });

  it('is true in production EVEN with COOKIE_INSECURE=1 (fail closed, cannot be overridden)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'bus'; // REQ-F004-021/039: valid mode so prod config loads
    process.env['COOKIE_INSECURE'] = '1';
    const { config } = await loadConfig();
    expect(config.cookieSecure).toBe(true);
  });

  it('is true in production when COOKIE_INSECURE is unset', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'bus'; // REQ-F004-021/039: valid mode so prod config loads
    delete process.env['COOKIE_INSECURE'];
    const { config } = await loadConfig();
    expect(config.cookieSecure).toBe(true);
  });
});

describe('config.ts — corsOrigins (REQ-095, sec review M-1: never a bare `true`)', () => {
  it('equals the parsed WEB_ORIGINS allowlist when set', async () => {
    process.env['WEB_ORIGINS'] = 'https://a.example.com,https://b.example.com';
    const { config } = await loadConfig();
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('is [] in production when WEB_ORIGINS is unset (fail closed)', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'bus'; // REQ-F004-021/039: valid mode so prod config loads
    delete process.env['WEB_ORIGINS'];
    const { config } = await loadConfig();
    expect(config.corsOrigins).toEqual([]);
  });

  it('defaults to the localhost dev origins in dev when WEB_ORIGINS is unset', async () => {
    delete process.env['NODE_ENV'];
    delete process.env['WEB_ORIGINS'];
    const { config } = await loadConfig();
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://localhost:3000']);
  });

  it('honors an explicit WEB_ORIGINS allowlist even in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'bus'; // REQ-F004-021/039: valid mode so prod config loads
    process.env['WEB_ORIGINS'] = 'https://console.example.com';
    const { config } = await loadConfig();
    expect(config.corsOrigins).toEqual(['https://console.example.com']);
  });

  it('is never the boolean `true`, in dev or production', async () => {
    delete process.env['NODE_ENV'];
    delete process.env['WEB_ORIGINS'];
    const dev = await loadConfig();
    expect(dev.config.corsOrigins).not.toBe(true);
    expect(Array.isArray(dev.config.corsOrigins)).toBe(true);

    process.env['NODE_ENV'] = 'production';
    process.env['EVENT_BUS_MODE'] = 'bus'; // REQ-F004-021/039: valid mode so prod config loads
    const prod = await loadConfig();
    expect(prod.config.corsOrigins).not.toBe(true);
    expect(Array.isArray(prod.config.corsOrigins)).toBe(true);
  });
});
