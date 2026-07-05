// identity/workspace-map.ts — opaque-handle mapping for workspaces (§4.3, REQ-021b, §5).
// Exercised against the real (per-test-file, tmp-dir) sqlite DB seeded by test/setup.ts,
// mirroring test/store/recovery-codes.repo.test.ts's convention: static imports + a
// beforeEach DELETE FROM to isolate rows between tests.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ensureNumericId,
  forget,
  reconcile,
  recordNew,
  resolveRow,
  resolveSlug,
} from '../../src/identity/workspace-map.js';
import { workspaceMapRepo } from '../../src/store/repositories/workspace-map.repo.js';
import { db } from '../../src/store/db.js';
import { AppError } from '../../src/server/errors.js';
import type { EngineWorkspace } from '../../src/engine/engine-types.js';

// A minimal-but-complete engine workspace fixture; only id/slug/name matter to identity.
function engineWs(overrides: Partial<EngineWorkspace> = {}): EngineWorkspace {
  return {
    id: 1,
    name: 'Workspace',
    slug: 'ws',
    chatProvider: null,
    chatModel: null,
    chatMode: 'chat',
    openAiTemp: null,
    openAiHistory: 0,
    openAiPrompt: null,
    similarityThreshold: null,
    topN: null,
    agentProvider: null,
    agentModel: null,
    queryRefusalResponse: null,
    vectorSearchMode: null,
    pfpFilename: null,
    ...overrides,
  };
}

beforeEach(() => {
  db.exec('DELETE FROM workspace_map;');
});

describe('reconcile (REQ-021b) — minting + stability', () => {
  it('mints a stable handle for a new slug', () => {
    const ws = engineWs({ id: 5, slug: 'ws-a', name: 'A' });
    const bySlug = reconcile([ws]);

    const productId = bySlug.get('ws-a');
    expect(typeof productId).toBe('string');
    expect(productId!.length).toBeGreaterThan(0);

    const row = workspaceMapRepo.findBySlug('ws-a');
    expect(row).toBeDefined();
    expect(row!.product_id).toBe(productId);
    expect(row!.engine_numeric_id).toBe(5);
    expect(row!.display_name).toBe('A');
  });

  it('reuses the same product_id on a second reconcile call (no duplicate row minted)', () => {
    const ws = engineWs({ id: 5, slug: 'ws-a', name: 'A' });
    const first = reconcile([ws]).get('ws-a');

    const second = reconcile([ws]).get('ws-a');

    expect(second).toBe(first);
    expect(workspaceMapRepo.list()).toHaveLength(1);
  });

  it('backfills a null numeric id once the engine later reports one', () => {
    // Simulate a create-time row minted with no numeric id yet (engine omitted it).
    const wsNoId = { ...engineWs({ slug: 'ws-b', name: 'B' }) } as Partial<EngineWorkspace>;
    delete wsNoId.id;
    const bySlug1 = reconcile([wsNoId as EngineWorkspace]);
    const productId = bySlug1.get('ws-b')!;
    expect(workspaceMapRepo.findByProductId(productId)!.engine_numeric_id).toBeNull();

    // The engine now reports numeric id 99 for the same slug on a later list.
    const bySlug2 = reconcile([engineWs({ id: 99, slug: 'ws-b', name: 'B' })]);

    expect(bySlug2.get('ws-b')).toBe(productId); // handle identity preserved
    expect(workspaceMapRepo.findByProductId(productId)!.engine_numeric_id).toBe(99);
  });

  it('mints independent handles for multiple distinct slugs in one call', () => {
    const bySlug = reconcile([
      engineWs({ id: 1, slug: 'ws-a', name: 'A' }),
      engineWs({ id: 2, slug: 'ws-b', name: 'B' }),
    ]);
    expect(bySlug.get('ws-a')).not.toBe(bySlug.get('ws-b'));
    expect(workspaceMapRepo.list()).toHaveLength(2);
  });
});

describe('resolveRow / resolveSlug — 404 on an unknown handle', () => {
  it('resolveRow throws AppError(404) for an unknown handle', () => {
    expect(() => resolveRow('no-such-handle')).toThrow(AppError);
    try {
      resolveRow('no-such-handle');
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).status).toBe(404);
    }
  });

  it('resolveSlug throws AppError(404) for an unknown handle', () => {
    expect(() => resolveSlug('no-such-handle')).toThrow(AppError);
    try {
      resolveSlug('no-such-handle');
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).status).toBe(404);
    }
  });

  it('resolveSlug returns the mapped engine slug for a known handle', () => {
    const row = recordNew(engineWs({ id: 1, slug: 'ws-a', name: 'A' }));
    expect(resolveSlug(row.product_id)).toBe('ws-a');
  });
});

describe('recordNew — mint + persist a handle for a just-created workspace', () => {
  it('inserts a row keyed by the new opaque product_id', () => {
    const row = recordNew(engineWs({ id: 7, slug: 'new-ws', name: 'New' }));
    expect(row.engine_slug).toBe('new-ws');
    expect(row.engine_numeric_id).toBe(7);
    expect(workspaceMapRepo.findByProductId(row.product_id)).toBeDefined();
  });

  it('mints distinct product ids for two different workspaces', () => {
    const a = recordNew(engineWs({ id: 1, slug: 'ws-a', name: 'A' }));
    const b = recordNew(engineWs({ id: 2, slug: 'ws-b', name: 'B' }));
    expect(a.product_id).not.toBe(b.product_id);
  });
});

describe('ensureNumericId — backfill from a provided engine list (REQ-037 MIN-4)', () => {
  it('backfills the numeric id when the row is currently null and the list contains a match', () => {
    const noIdWs = { ...engineWs({ slug: 'ws-c', name: 'C' }) } as Partial<EngineWorkspace>;
    delete noIdWs.id;
    const row = recordNew(noIdWs as EngineWorkspace);
    expect(row.engine_numeric_id).toBeNull();

    ensureNumericId(row.product_id, [engineWs({ id: 55, slug: 'ws-c', name: 'C' })]);

    expect(workspaceMapRepo.findByProductId(row.product_id)!.engine_numeric_id).toBe(55);
  });

  it('is a no-op when the row already has a numeric id', () => {
    const row = recordNew(engineWs({ id: 1, slug: 'ws-d', name: 'D' }));
    ensureNumericId(row.product_id, [engineWs({ id: 999, slug: 'ws-d', name: 'D' })]);
    expect(workspaceMapRepo.findByProductId(row.product_id)!.engine_numeric_id).toBe(1);
  });

  it('is a no-op when no engine workspace in the list matches the slug', () => {
    const noIdWs = { ...engineWs({ slug: 'ws-e', name: 'E' }) } as Partial<EngineWorkspace>;
    delete noIdWs.id;
    const row = recordNew(noIdWs as EngineWorkspace);

    ensureNumericId(row.product_id, [engineWs({ id: 1, slug: 'unrelated-slug', name: 'X' })]);

    expect(workspaceMapRepo.findByProductId(row.product_id)!.engine_numeric_id).toBeNull();
  });

  it('is a no-op for an unknown product_id', () => {
    expect(() => ensureNumericId('no-such-handle', [engineWs()])).not.toThrow();
  });
});

describe('forget — removes the mapping (REQ-038)', () => {
  it('removes the row so a subsequent resolveRow throws 404', () => {
    const row = recordNew(engineWs({ id: 1, slug: 'ws-f', name: 'F' }));
    forget(row.product_id);
    expect(workspaceMapRepo.findByProductId(row.product_id)).toBeUndefined();
    expect(() => resolveRow(row.product_id)).toThrow(AppError);
  });

  it('is idempotent — forgetting an already-unknown handle does not throw', () => {
    expect(() => forget('never-existed')).not.toThrow();
  });
});
