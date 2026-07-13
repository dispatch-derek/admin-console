// White-box unit tests for the F-005 feature-toggle service (src/services/feature-toggle.service.ts),
// calling listFeatureToggles/setFeatureToggle/clearFeatureToggle DIRECTLY — no HTTP/Fastify layer, no
// session/auth machinery, no real SQLite — a level below the route-level spec suite
// (test/routes/feature-toggles.*.test.ts), which already exercises the functional/branch contract
// exhaustively through the API. This file mocks the FOUR module boundaries the service actually
// depends on (catalog, repo, audit, event emitter) so it can assert things that are awkward to pin
// down precisely through the route layer:
//   - audit is recorded on EVERY accepted set/clear across all four "effective-state-unchanged /
//     idempotent" transition shapes (REQ-F005-038), even when the event is suppressed (REQ-F005-037);
//   - the store-confirm read-back compares the RIGHT fields (REQ-F005-021) and the 404/undeclared-key
//     path issues NO write and NO audit at all (REQ-F005-030/008);
//   - the emitted event payload's `previous`/`enabled`/`hasOverride` shape and the exact repo.upsert
//     argument list (including the ISO timestamp), independent of any HTTP/DB round trip.
//
// Only the catalog, repo, audit, and emitter module boundaries are mocked; resolveEffective() (the
// spec's own named highest-risk pure function) runs for REAL so these tests double as an integration
// check between the service and the real resolver.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const findEntry = vi.fn();
const getCatalog = vi.fn();
vi.mock('../../src/feature-catalog/catalog.js', () => ({
  findEntry: (...args: unknown[]) => findEntry(...args),
  getCatalog: (...args: unknown[]) => getCatalog(...args),
}));

const repoGet = vi.fn();
const repoList = vi.fn();
const repoUpsert = vi.fn();
const repoDelete = vi.fn();
vi.mock('../../src/store/repositories/feature-toggle.repo.js', () => ({
  featureToggleRepo: {
    get: (...args: unknown[]) => repoGet(...args),
    list: (...args: unknown[]) => repoList(...args),
    upsert: (...args: unknown[]) => repoUpsert(...args),
    delete: (...args: unknown[]) => repoDelete(...args),
  },
}));

const recordAudit = vi.fn();
vi.mock('../../src/audit/audit.js', () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

const emitAdminEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/events/emitter.js', () => ({
  emitAdminEvent: (...args: unknown[]) => emitAdminEvent(...args),
}));

import {
  listFeatureToggles,
  setFeatureToggle,
  clearFeatureToggle,
} from '../../src/services/feature-toggle.service.js';
import { AppError } from '../../src/server/errors.js';
import type { FeatureCatalogEntry } from '../../src/types/product-types.js';
import type { FeatureToggleRow } from '../../src/store/repositories/feature-toggle.repo.js';

function entry(overrides: Partial<FeatureCatalogEntry> = {}): FeatureCatalogEntry {
  return {
    featureKey: 'billing.invoices',
    displayName: 'Invoice viewer',
    description: null,
    category: null,
    defaultEnabled: false,
    ...overrides,
  };
}

function row(overrides: Partial<FeatureToggleRow> = {}): FeatureToggleRow {
  return {
    feature_key: 'billing.invoices',
    enabled: 1,
    updated_at: '2026-07-12T00:00:00.000Z',
    updated_by: 'staff-1',
    ...overrides,
  };
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeEach(() => {
  vi.clearAllMocks();
  emitAdminEvent.mockResolvedValue(undefined);
  repoList.mockReturnValue([]);
  getCatalog.mockReturnValue([]);
});

// ---------------------------------------------------------------------------------------------
// listFeatureToggles — REQ-F005-019/025
// ---------------------------------------------------------------------------------------------

describe('listFeatureToggles', () => {
  it('joins catalog entries with their override rows and computes effective state via the real resolver', () => {
    getCatalog.mockReturnValue([entry({ featureKey: 'a', defaultEnabled: false }), entry({ featureKey: 'b', defaultEnabled: true })]);
    repoList.mockReturnValue([row({ feature_key: 'a', enabled: 1 })]); // override flips 'a' to true
    const view = listFeatureToggles();
    const a = view.features.find((f) => f.featureKey === 'a')!;
    const b = view.features.find((f) => f.featureKey === 'b')!;
    expect(a).toMatchObject({ enabled: true, hasOverride: true });
    expect(b).toMatchObject({ enabled: true, hasOverride: false }); // b's own default, no override
  });

  it('REQ-F005-025 — an override row whose key is not in the catalog (orphan) is excluded from features[] and every count', () => {
    getCatalog.mockReturnValue([entry({ featureKey: 'active', defaultEnabled: true })]);
    repoList.mockReturnValue([
      row({ feature_key: 'active', enabled: 1 }),
      row({ feature_key: 'orphaned.retired.feature', enabled: 1 }),
    ]);
    const view = listFeatureToggles();
    expect(view.features.map((f) => f.featureKey)).toEqual(['active']);
    expect(view.counts).toEqual({ enabled: 1, disabled: 0, total: 1 });
  });

  it('counts are enabled+disabled==total==features.length, computed on EFFECTIVE state', () => {
    getCatalog.mockReturnValue([
      entry({ featureKey: 'a', defaultEnabled: false }), // no override -> disabled
      entry({ featureKey: 'b', defaultEnabled: true }), // no override -> enabled
      entry({ featureKey: 'c', defaultEnabled: false }), // overridden to enabled
    ]);
    repoList.mockReturnValue([row({ feature_key: 'c', enabled: 1 })]);
    const view = listFeatureToggles();
    expect(view.counts).toEqual({ enabled: 2, disabled: 1, total: 3 });
  });

  it('an empty catalog produces an empty features[] and all-zero counts (REQ-F005-024)', () => {
    getCatalog.mockReturnValue([]);
    const view = listFeatureToggles();
    expect(view.features).toEqual([]);
    expect(view.counts).toEqual({ enabled: 0, disabled: 0, total: 0 });
  });

  it('updatedAt/updatedBy are null when a feature has no override', () => {
    getCatalog.mockReturnValue([entry({ featureKey: 'a' })]);
    const view = listFeatureToggles();
    expect(view.features[0]).toMatchObject({ updatedAt: null, updatedBy: null });
  });

  it('updatedAt/updatedBy mirror the override row when one exists', () => {
    getCatalog.mockReturnValue([entry({ featureKey: 'a' })]);
    repoList.mockReturnValue([row({ feature_key: 'a', updated_at: 'T', updated_by: 'staff-9' })]);
    const view = listFeatureToggles();
    expect(view.features[0]).toMatchObject({ updatedAt: 'T', updatedBy: 'staff-9' });
  });

  it('carries a customerLabel string', () => {
    const view = listFeatureToggles();
    expect(typeof view.customerLabel).toBe('string');
  });
});

// ---------------------------------------------------------------------------------------------
// setFeatureToggle — REQ-F005-021/030/037/038
// ---------------------------------------------------------------------------------------------

describe('setFeatureToggle — undeclared featureKey (404)', () => {
  it('throws AppError(404, "unknown feature") and performs NO write and NO audit', async () => {
    findEntry.mockReturnValue(undefined);
    await expect(setFeatureToggle('staff-1', 'never-declared', true)).rejects.toMatchObject({
      status: 404,
      message: 'unknown feature',
    });
    expect(repoUpsert).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });
});

describe('setFeatureToggle — REQ-F005-030 body validation (non-boolean enabled)', () => {
  it.each([undefined, null, 'true', 1, {}, []])('rejects enabled=%p with 400 and records a FAILURE audit entry, no write', async (bad) => {
    findEntry.mockReturnValue(entry());
    await expect(setFeatureToggle('staff-1', 'billing.invoices', bad)).rejects.toMatchObject({
      status: 400,
      message: 'enabled must be true or false',
    });
    expect(repoUpsert).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'staff-1', action: 'feature_toggle.set', outcome: 'failure', target: { featureKey: 'billing.invoices' } }),
    );
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });
});

describe('setFeatureToggle — REQ-F005-021 store-confirm failure (500)', () => {
  it('when the post-upsert read-back is undefined, throws 500, audits failure with verified:false, emits no event', async () => {
    findEntry.mockReturnValue(entry());
    repoGet.mockReturnValue(undefined); // read-back never reflects the write
    await expect(setFeatureToggle('staff-1', 'billing.invoices', true)).rejects.toMatchObject({
      status: 500,
      message: 'could not confirm the change was saved',
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feature_toggle.set',
        outcome: 'failure',
        detail: expect.objectContaining({ verified: false }),
      }),
    );
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });

  it('when the read-back exists but its enabled VALUE disagrees with the intended write, throws 500 (compares the right field)', async () => {
    findEntry.mockReturnValue(entry());
    // Intended write is enabled:true, but the confirmed row still shows enabled:0 (disagreement).
    repoGet.mockReturnValue(row({ enabled: 0 }));
    await expect(setFeatureToggle('staff-1', 'billing.invoices', true)).rejects.toMatchObject({ status: 500 });
  });
});

describe('setFeatureToggle — success, effective-state DELTA (event + audit)', () => {
  it('disabled default -> enabled override: upserts, confirms, audits success, emits one event with previous/enabled', async () => {
    findEntry.mockReturnValue(entry({ defaultEnabled: false }));
    // Prior read (before upsert): no override yet.
    repoGet.mockReturnValueOnce(undefined);
    // Confirm read (after upsert): the new row.
    repoGet.mockReturnValueOnce(row({ enabled: 1, updated_by: 'staff-1' }));

    const result = await setFeatureToggle('staff-1', 'billing.invoices', true);

    expect(repoUpsert).toHaveBeenCalledWith('billing.invoices', true, 'staff-1', expect.stringMatching(ISO_8601));
    expect(result).toMatchObject({ enabled: true, hasOverride: true });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'staff-1',
        action: 'feature_toggle.set',
        outcome: 'success',
        target: { featureKey: 'billing.invoices' },
        detail: expect.objectContaining({ enabled: true, hasOverride: true, verified: true }),
      }),
    );

    expect(emitAdminEvent).toHaveBeenCalledTimes(1);
    expect(emitAdminEvent).toHaveBeenCalledWith(
      'admin.feature_toggle.changed',
      'staff-1',
      { featureKey: 'billing.invoices' },
      true,
      { enabled: true, previous: false, hasOverride: true },
    );
  });
});

describe('setFeatureToggle — success, effective-state UNCHANGED shapes: audited, event suppressed (REQ-F005-037/038)', () => {
  it('shape 1 — creating a first override EQUAL to the catalog default (hasOverride false->true, enabled unchanged)', async () => {
    findEntry.mockReturnValue(entry({ defaultEnabled: false }));
    repoGet.mockReturnValueOnce(undefined); // prior: no override, effective = default(false)
    repoGet.mockReturnValueOnce(row({ enabled: 0 })); // confirmed: override created equal to default

    await setFeatureToggle('staff-1', 'billing.invoices', false);

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', action: 'feature_toggle.set' }));
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });

  it('shape 2 — idempotent re-write of the SAME value (override already true, re-PUT true)', async () => {
    findEntry.mockReturnValue(entry({ defaultEnabled: false }));
    repoGet.mockReturnValueOnce(row({ enabled: 1 })); // prior: already overridden true
    repoGet.mockReturnValueOnce(row({ enabled: 1, updated_at: 'T2' })); // confirmed: still true, refreshed ts

    await setFeatureToggle('staff-1', 'billing.invoices', true);

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    expect(emitAdminEvent).not.toHaveBeenCalled();
    // Still refreshes the row even though the effective value is unchanged (REQ-F005-021).
    expect(repoUpsert).toHaveBeenCalledWith('billing.invoices', true, 'staff-1', expect.any(String));
  });
});

// ---------------------------------------------------------------------------------------------
// clearFeatureToggle — REQ-F005-023/030/037/038
// ---------------------------------------------------------------------------------------------

describe('clearFeatureToggle — undeclared featureKey (404)', () => {
  it('throws 404 and issues no delete/audit/event', async () => {
    findEntry.mockReturnValue(undefined);
    await expect(clearFeatureToggle('staff-1', 'never-declared')).rejects.toMatchObject({ status: 404 });
    expect(repoDelete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });
});

describe('clearFeatureToggle — REQ-F005-023 idempotent no-override success (shape 3)', () => {
  it('when there is no prior override row, repo.delete is never called (nothing to delete), yet the clear is still a 200 success and audited, no event', async () => {
    findEntry.mockReturnValue(entry({ defaultEnabled: false }));
    repoGet.mockReturnValue(undefined); // both the prior read AND the post-delete confirm read

    const result = await clearFeatureToggle('staff-1', 'billing.invoices');

    expect(repoDelete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ enabled: false, hasOverride: false });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feature_toggle.clear',
        outcome: 'success',
        detail: expect.objectContaining({ hasOverride: false }),
      }),
    );
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });
});

describe('clearFeatureToggle — REQ-F005-021 store-confirm failure (500)', () => {
  it('when the row still exists after delete(), throws 500 and audits failure with verified:false, no event', async () => {
    findEntry.mockReturnValue(entry());
    repoGet.mockReturnValueOnce(row({ enabled: 1 })); // prior: an override exists
    repoGet.mockReturnValueOnce(row({ enabled: 1 })); // confirm: STILL present (delete unconfirmed)

    await expect(clearFeatureToggle('staff-1', 'billing.invoices')).rejects.toMatchObject({
      status: 500,
      message: 'could not confirm the change was saved',
    });
    expect(repoDelete).toHaveBeenCalledWith('billing.invoices');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feature_toggle.clear', outcome: 'failure', detail: expect.objectContaining({ verified: false }) }),
    );
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });
});

describe('clearFeatureToggle — success, effective-state DELTA (event + audit)', () => {
  it('clearing an override that differs from the default emits one event with previous/enabled', async () => {
    findEntry.mockReturnValue(entry({ defaultEnabled: false }));
    repoGet.mockReturnValueOnce(row({ enabled: 1 })); // prior: overridden true (differs from default false)
    repoGet.mockReturnValueOnce(undefined); // confirm: gone

    const result = await clearFeatureToggle('staff-1', 'billing.invoices');
    expect(result).toMatchObject({ enabled: false, hasOverride: false });

    expect(emitAdminEvent).toHaveBeenCalledWith(
      'admin.feature_toggle.changed',
      'staff-1',
      { featureKey: 'billing.invoices' },
      true,
      { enabled: false, previous: true, hasOverride: false },
    );
  });
});

describe('clearFeatureToggle — success, effective-state UNCHANGED shape 4 (override equals default): audited, event suppressed', () => {
  it('REQ-F005-056 — clearing an override that already equals the catalog default emits NO event but is still audited', async () => {
    findEntry.mockReturnValue(entry({ defaultEnabled: false }));
    repoGet.mockReturnValueOnce(row({ enabled: 0 })); // prior: override == default (both false)
    repoGet.mockReturnValueOnce(undefined); // confirm: cleared

    await clearFeatureToggle('staff-1', 'billing.invoices');

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'feature_toggle.clear', outcome: 'success' }));
    expect(emitAdminEvent).not.toHaveBeenCalled();
  });
});

describe('clearFeatureToggle — audit target/actor identity', () => {
  it('audits the exact actor id and the opaque featureKey wrapped in the codebase-wide `{ featureKey }` object target (not a bare string)', async () => {
    findEntry.mockReturnValue(entry());
    repoGet.mockReturnValue(undefined);
    await clearFeatureToggle('staff-77', 'billing.invoices');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'staff-77', target: { featureKey: 'billing.invoices' } }),
    );
  });
});
