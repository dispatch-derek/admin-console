// White-box unit tests for the F-005 feature-catalog manifest loader
// (src/feature-catalog/catalog.ts, REQ-F005-016/044/053/058). Calls loadCatalog/getCatalog/findEntry
// DIRECTLY — no HTTP layer, no buildApp(), no real filesystem — a level below the route-level spec
// suite (test/routes/feature-toggles.catalog.test.ts), which already drives the same REQ-F005-053
// scenarios end-to-end through a real tmp manifest file + a real app boot. This file instead mocks
// the two module boundaries loadCatalog() actually touches (`node:fs`'s readFileSync and
// `../config.js`'s `featureCatalogPath`) so every branch of parseManifest()'s per-entry schema
// validation — including several entry-level defects the route-level suite does not individually
// enumerate (non-string/empty displayName, non-string description/category, whitespace/empty-string
// featureKey) — is exercised directly and fast, without spinning up SQLite/Fastify/auth for each case.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const mockConfig = vi.hoisted(() => ({ featureCatalogPath: undefined as string | undefined }));

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('../../src/config.js', () => ({ config: mockConfig }));

import { loadCatalog, getCatalog, findEntry } from '../../src/feature-catalog/catalog.js';

const readFileSyncMock = vi.mocked(readFileSync);

function enoent(): NodeJS.ErrnoException {
  const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

function eacces(): NodeJS.ErrnoException {
  const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
  err.code = 'EACCES';
  return err;
}

beforeEach(() => {
  readFileSyncMock.mockReset();
  // Reset to the REQ-F005-053a unset-path state before every test so each test starts from a known,
  // empty catalog regardless of what the previous test left loaded.
  mockConfig.featureCatalogPath = undefined;
  loadCatalog();
});

describe('loadCatalog — REQ-F005-053a split posture: unset / absent path', () => {
  it('an unset path yields an empty catalog and never touches the filesystem', () => {
    mockConfig.featureCatalogPath = undefined;
    loadCatalog();
    expect(getCatalog()).toEqual([]);
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it('an empty-string path is also treated as unset (falsy)', () => {
    mockConfig.featureCatalogPath = '';
    loadCatalog();
    expect(getCatalog()).toEqual([]);
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it('a set path whose file is absent (ENOENT) yields an empty catalog, not a throw', () => {
    mockConfig.featureCatalogPath = '/does/not/exist.json';
    readFileSyncMock.mockImplementation(() => {
      throw enoent();
    });
    expect(() => loadCatalog()).not.toThrow();
    expect(getCatalog()).toEqual([]);
  });
});

describe('loadCatalog — REQ-F005-053b: present-but-unreadable file refuses to start', () => {
  it('a non-ENOENT read error (e.g. permissions) throws, naming the path', () => {
    mockConfig.featureCatalogPath = '/no/permission.json';
    readFileSyncMock.mockImplementation(() => {
      throw eacces();
    });
    expect(() => loadCatalog()).toThrow(/\/no\/permission\.json/);
    expect(() => loadCatalog()).toThrow(/could not be read/);
  });
});

describe('loadCatalog — REQ-F005-058: not valid JSON refuses to start', () => {
  it('unparsable JSON throws, naming the path and "not valid JSON"', () => {
    mockConfig.featureCatalogPath = '/bad.json';
    readFileSyncMock.mockReturnValue('{ this is not json');
    expect(() => loadCatalog()).toThrow(/\/bad\.json/);
    expect(() => loadCatalog()).toThrow(/not valid JSON/);
  });

  it('an empty file (empty string) is not valid JSON either', () => {
    mockConfig.featureCatalogPath = '/empty.json';
    readFileSyncMock.mockReturnValue('');
    expect(() => loadCatalog()).toThrow(/not valid JSON/);
  });
});

describe('loadCatalog — REQ-F005-058: top-level shape validation', () => {
  const cases: Array<[string, string]> = [
    ['a bare JSON array', '[]'],
    ['a JSON string', '"hello"'],
    ['a JSON number', '42'],
    ['JSON null', 'null'],
    ['an object with no "features" key', '{}'],
    ['an object whose "features" is not an array', '{"features": "nope"}'],
    ['an object whose "features" is an object, not an array', '{"features": {}}'],
  ];
  for (const [label, raw] of cases) {
    it(`${label} → refuses to start`, () => {
      mockConfig.featureCatalogPath = '/manifest.json';
      readFileSyncMock.mockReturnValue(raw);
      expect(() => loadCatalog()).toThrow(/\/manifest\.json/);
    });
  }

  it('an empty "features" array is VALID (REQ-F005-024 — empty catalog is a first-class state, not an error)', () => {
    mockConfig.featureCatalogPath = '/manifest.json';
    readFileSyncMock.mockReturnValue('{"features": []}');
    expect(() => loadCatalog()).not.toThrow();
    expect(getCatalog()).toEqual([]);
  });
});

describe('loadCatalog — REQ-F005-058: per-entry schema validation', () => {
  function manifestWith(entry: unknown): string {
    return JSON.stringify({ features: [entry] });
  }

  it('an entry that is not an object (e.g. a string) is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith('not-an-object'));
    expect(() => loadCatalog()).toThrow(/features\[0\] must be an object/);
  });

  it('an entry that is a JSON array (not a plain object) is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith([]));
    expect(() => loadCatalog()).toThrow(/features\[0\] must be an object/);
  });

  it('a missing featureKey is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ displayName: 'X', defaultEnabled: true }));
    expect(() => loadCatalog()).toThrow(/featureKey must be a non-empty string/);
  });

  it('a non-string featureKey (number) is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 123, displayName: 'X', defaultEnabled: true }));
    expect(() => loadCatalog()).toThrow(/featureKey must be a non-empty string/);
  });

  it('an empty-string featureKey is invalid (non-empty is required)', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: '', displayName: 'X', defaultEnabled: true }));
    expect(() => loadCatalog()).toThrow(/featureKey must be a non-empty string/);
  });

  it('a duplicate featureKey across two entries is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        features: [
          { featureKey: 'dup', displayName: 'One', defaultEnabled: true },
          { featureKey: 'dup', displayName: 'Two', defaultEnabled: false },
        ],
      }),
    );
    expect(() => loadCatalog()).toThrow(/duplicate featureKey "dup"/);
  });

  it('a missing displayName is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', defaultEnabled: true }));
    expect(() => loadCatalog()).toThrow(/displayName must be a non-empty string/);
  });

  it('an empty-string displayName is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: '', defaultEnabled: true }));
    expect(() => loadCatalog()).toThrow(/displayName must be a non-empty string/);
  });

  it('a non-string displayName (number) is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: 7, defaultEnabled: true }));
    expect(() => loadCatalog()).toThrow(/displayName must be a non-empty string/);
  });

  it('a non-string, non-null description is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      manifestWith({ featureKey: 'k', displayName: 'K', description: 42, defaultEnabled: true }),
    );
    expect(() => loadCatalog()).toThrow(/description must be a string or null/);
  });

  it('a null description normalizes to null (not a failure)', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      manifestWith({ featureKey: 'k', displayName: 'K', description: null, defaultEnabled: true }),
    );
    loadCatalog();
    expect(findEntry('k')?.description).toBeNull();
  });

  it('an omitted description normalizes to null', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: 'K', defaultEnabled: true }));
    loadCatalog();
    expect(findEntry('k')?.description).toBeNull();
  });

  it('a non-string, non-null category is invalid', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      manifestWith({ featureKey: 'k', displayName: 'K', category: true, defaultEnabled: true }),
    );
    expect(() => loadCatalog()).toThrow(/category must be a string or null/);
  });

  it('a wrong-typed defaultEnabled (string "true") is invalid, not coerced', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: 'K', defaultEnabled: 'true' }));
    expect(() => loadCatalog()).toThrow(/defaultEnabled must be a boolean when present/);
  });

  it('a wrong-typed defaultEnabled (number 1) is invalid, not coerced', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: 'K', defaultEnabled: 1 }));
    expect(() => loadCatalog()).toThrow(/defaultEnabled must be a boolean when present/);
  });

  it('REQ-F005-016 — an omitted defaultEnabled coerces to false, and this is NOT a validation failure', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: 'K' }));
    expect(() => loadCatalog()).not.toThrow();
    expect(findEntry('k')?.defaultEnabled).toBe(false);
  });

  it('defaultEnabled=true is preserved as-is (not coerced)', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: 'K', defaultEnabled: true }));
    loadCatalog();
    expect(findEntry('k')?.defaultEnabled).toBe(true);
  });

  it('defaultEnabled=false is preserved as false (falsy-but-valid — not mistaken for "missing")', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(manifestWith({ featureKey: 'k', displayName: 'K', defaultEnabled: false }));
    loadCatalog();
    expect(findEntry('k')?.defaultEnabled).toBe(false);
  });

  it('the second of two entries failing validation still names the correct index', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        features: [
          { featureKey: 'ok', displayName: 'OK', defaultEnabled: true },
          { featureKey: 'bad', defaultEnabled: true }, // missing displayName
        ],
      }),
    );
    expect(() => loadCatalog()).toThrow(/features\[1\]\.displayName/);
  });
});

describe('loadCatalog — successful multi-entry load', () => {
  it('loads every field for a well-formed multi-entry manifest', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        features: [
          {
            featureKey: 'billing.invoices',
            displayName: 'Invoice viewer',
            description: 'Lets the customer view invoices.',
            category: 'billing',
            defaultEnabled: false,
          },
          { featureKey: 'chat.exports', displayName: 'Chat export', defaultEnabled: true },
        ],
      }),
    );
    loadCatalog();
    expect(getCatalog()).toEqual([
      {
        featureKey: 'billing.invoices',
        displayName: 'Invoice viewer',
        description: 'Lets the customer view invoices.',
        category: 'billing',
        defaultEnabled: false,
      },
      {
        featureKey: 'chat.exports',
        displayName: 'Chat export',
        description: null,
        category: null,
        defaultEnabled: true,
      },
    ]);
  });

  it('a later loadCatalog() call REPLACES the in-memory catalog rather than appending to it', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ features: [{ featureKey: 'a', displayName: 'A', defaultEnabled: true }] }),
    );
    loadCatalog();
    expect(getCatalog()).toHaveLength(1);

    readFileSyncMock.mockReturnValue(
      JSON.stringify({ features: [{ featureKey: 'b', displayName: 'B', defaultEnabled: false }] }),
    );
    loadCatalog();
    expect(getCatalog().map((e) => e.featureKey)).toEqual(['b']); // 'a' is gone, not accumulated
  });

  it('a failed reload leaves the PREVIOUSLY loaded catalog in place (throw happens before setCatalog runs)', () => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ features: [{ featureKey: 'a', displayName: 'A', defaultEnabled: true }] }),
    );
    loadCatalog();
    expect(getCatalog()).toHaveLength(1);

    readFileSyncMock.mockReturnValue('not json at all');
    expect(() => loadCatalog()).toThrow();
    // The previous, still-valid catalog is left in memory rather than being wiped by the failed
    // reload attempt (loadCatalog throws before setCatalog() is ever called on the bad input).
    expect(getCatalog().map((e) => e.featureKey)).toEqual(['a']);
  });
});

describe('findEntry — REQ-F005-018/028 byte-for-byte, case-sensitive lookup', () => {
  beforeEach(() => {
    mockConfig.featureCatalogPath = '/m.json';
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        features: [
          { featureKey: 'Feature.A', displayName: 'Case sensitive', defaultEnabled: true },
          { featureKey: 'a/b c', displayName: 'Slash + space key', defaultEnabled: false },
          { featureKey: '', displayName: 'never reachable' }, // unreachable via manifest (rejected at load) — omitted
        ].slice(0, 2),
      }),
    );
    loadCatalog();
  });

  it('finds an entry by its exact key', () => {
    expect(findEntry('Feature.A')?.displayName).toBe('Case sensitive');
  });

  it('is case-sensitive — a different-case lookup does not match', () => {
    expect(findEntry('feature.a')).toBeUndefined();
  });

  it('returns undefined for a key absent from the catalog', () => {
    expect(findEntry('nope')).toBeUndefined();
  });

  it('matches an opaque key containing "/" and whitespace literally', () => {
    expect(findEntry('a/b c')?.displayName).toBe('Slash + space key');
  });

  it('getCatalog() returns the same array contents on repeated calls (stable read)', () => {
    expect(getCatalog()).toEqual(getCatalog());
  });
});
