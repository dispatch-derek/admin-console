// White-box unit tests for the F-005 feature-toggle store repository
// (src/store/repositories/feature-toggle.repo.ts, REQ-F005-012/014/021/023). Exercised directly
// against the repo's own API (not raw SQL — the table's SHAPE contract is covered by
// test/store/feature-toggle-migration.test.ts) and not through any route or service. Targets:
// no-row → undefined, the upsert's last-writer-wins ON CONFLICT semantics (parameter-by-parameter),
// list() including orphan-shaped rows (the repo itself has no catalog awareness — orphan exclusion
// is a SERVICE-layer concern, REQ-F005-025), delete()'s idempotent no-op, and injection-shaped /
// unicode featureKeys to confirm every statement is fully parameterized (no string interpolation).

import { describe, it, expect, beforeEach } from 'vitest';
import { featureToggleRepo } from '../../../src/store/repositories/feature-toggle.repo.js';
import { db } from '../../../src/store/db.js';

beforeEach(() => {
  db.exec('DELETE FROM feature_toggle_state;');
});

describe('featureToggleRepo.get — no-override read', () => {
  it('returns undefined for a feature key with no row', () => {
    expect(featureToggleRepo.get('never-set')).toBeUndefined();
  });

  it('returns the row after an upsert, with enabled coerced to 1/0 integers', () => {
    featureToggleRepo.upsert('billing.invoices', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    const row = featureToggleRepo.get('billing.invoices');
    expect(row).toEqual({
      feature_key: 'billing.invoices',
      enabled: 1,
      updated_at: '2026-07-12T00:00:00.000Z',
      updated_by: 'staff-1',
    });
  });

  it('upsert(false, ...) stores enabled as integer 0, not the boolean or a truthy string', () => {
    featureToggleRepo.upsert('k', false, 'staff-1', '2026-07-12T00:00:00.000Z');
    const row = featureToggleRepo.get('k')!;
    expect(row.enabled).toBe(0);
    expect(typeof row.enabled).toBe('number');
  });
});

describe('featureToggleRepo.upsert — REQ-F005-021 last-writer-wins ON CONFLICT', () => {
  it('a second upsert on the same key overwrites enabled/updated_at/updated_by rather than adding a row', () => {
    featureToggleRepo.upsert('k', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.upsert('k', false, 'staff-2', '2026-07-12T00:00:01.000Z');
    const row = featureToggleRepo.get('k');
    expect(row).toEqual({
      feature_key: 'k',
      enabled: 0,
      updated_at: '2026-07-12T00:00:01.000Z',
      updated_by: 'staff-2',
    });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM feature_toggle_state').get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('an idempotent re-write of the SAME enabled value still refreshes updated_at/updated_by (REQ-F005-021)', () => {
    featureToggleRepo.upsert('k', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.upsert('k', true, 'staff-2', '2026-07-12T00:00:01.000Z');
    const row = featureToggleRepo.get('k')!;
    expect(row.enabled).toBe(1);
    expect(row.updated_at).toBe('2026-07-12T00:00:01.000Z');
    expect(row.updated_by).toBe('staff-2');
  });

  it('two distinct feature keys create two independent rows', () => {
    featureToggleRepo.upsert('a', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.upsert('b', false, 'staff-1', '2026-07-12T00:00:00.000Z');
    expect(featureToggleRepo.get('a')?.enabled).toBe(1);
    expect(featureToggleRepo.get('b')?.enabled).toBe(0);
    expect(featureToggleRepo.list()).toHaveLength(2);
  });

  it('stores the updated_at ISO-8601 string exactly as given — no reformatting/re-derivation', () => {
    const ts = '2026-07-12T03:45:44.123Z';
    featureToggleRepo.upsert('k', true, 'staff-1', ts);
    expect(featureToggleRepo.get('k')?.updated_at).toBe(ts);
  });
});

describe('featureToggleRepo.list — REQ-F005-014 retains ALL rows, including orphan-shaped ones', () => {
  it('returns an empty array when no override has ever been written', () => {
    expect(featureToggleRepo.list()).toEqual([]);
  });

  it('returns every row regardless of whether a catalog would recognize the key — the repo has no catalog awareness', () => {
    featureToggleRepo.upsert('active.feature', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.upsert('retired.feature', false, 'staff-1', '2026-07-12T00:00:00.000Z');
    const keys = featureToggleRepo.list().map((r) => r.feature_key).sort();
    expect(keys).toEqual(['active.feature', 'retired.feature']);
  });
});

describe('featureToggleRepo.delete — REQ-F005-023 idempotent clear', () => {
  it('removes the row for the given key', () => {
    featureToggleRepo.upsert('k', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.delete('k');
    expect(featureToggleRepo.get('k')).toBeUndefined();
  });

  it('deleting a key with no row is a harmless no-op (no throw)', () => {
    expect(() => featureToggleRepo.delete('never-existed')).not.toThrow();
    expect(featureToggleRepo.list()).toEqual([]);
  });

  it('deletes only the targeted key, leaving sibling rows intact', () => {
    featureToggleRepo.upsert('a', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.upsert('b', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.delete('a');
    expect(featureToggleRepo.get('a')).toBeUndefined();
    expect(featureToggleRepo.get('b')).toBeDefined();
  });
});

describe('featureToggleRepo — REQ-F005-018/028 opaque keys are fully parameterized (injection-shaped, unicode, wildcard-shaped)', () => {
  it('a key containing a single quote and SQL-comment-shaped text round-trips literally with no injection', () => {
    const key = `it's; DROP TABLE feature_toggle_state; --`;
    featureToggleRepo.upsert(key, true, 'staff-1', '2026-07-12T00:00:00.000Z');
    expect(featureToggleRepo.get(key)?.feature_key).toBe(key);
    // The table must still exist (a naive string-interpolated query would have dropped it).
    expect(() => db.prepare('SELECT 1 FROM feature_toggle_state LIMIT 1').get()).not.toThrow();
  });

  it('a key containing SQL LIKE wildcard characters (% and _) is matched by exact equality, not pattern', () => {
    featureToggleRepo.upsert('a%b_c', true, 'staff-1', '2026-07-12T00:00:00.000Z');
    featureToggleRepo.upsert('axbyc', false, 'staff-1', '2026-07-12T00:00:00.000Z'); // would match a%b_c as a LIKE pattern
    expect(featureToggleRepo.get('a%b_c')?.enabled).toBe(1);
    expect(featureToggleRepo.get('axbyc')?.enabled).toBe(0); // distinct row, not conflated via wildcard matching
    expect(featureToggleRepo.list()).toHaveLength(2);
  });

  it('a unicode feature key (non-Latin script + emoji) round-trips byte-for-byte', () => {
    const key = '機能.日本語.🎛️';
    featureToggleRepo.upsert(key, true, 'staff-1', '2026-07-12T00:00:00.000Z');
    expect(featureToggleRepo.get(key)?.feature_key).toBe(key);
  });

  it('a key containing a raw "/" (opaque, per REQ-F005-028) is stored and read back exactly, distinct from an encoded sibling', () => {
    const raw = 'a/b c';
    featureToggleRepo.upsert(raw, true, 'staff-1', '2026-07-12T00:00:00.000Z');
    expect(featureToggleRepo.get(raw)?.feature_key).toBe(raw);
    expect(featureToggleRepo.get('a%2Fb%20c')).toBeUndefined(); // the encoded FORM is a different literal string
  });

  it('an overlong feature key (well beyond any realistic length) still round-trips', () => {
    const key = 'x'.repeat(5000);
    featureToggleRepo.upsert(key, true, 'staff-1', '2026-07-12T00:00:00.000Z');
    expect(featureToggleRepo.get(key)?.feature_key).toBe(key);
  });
});
