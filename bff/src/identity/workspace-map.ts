// Opaque-handle identity for workspaces (boundary rule 3, REQ-021b, §6.4). Owns handle
// resolution + reconcile: the product exposes/mints an opaque product_id; the engine keeps
// its own opaque slug + numeric id. Handles are LOOKED UP here, NEVER parsed. Wraps the
// workspace_map repo; the service layer calls into this, not the repo directly.

import { randomUUID } from 'node:crypto';
import { AppError } from '../server/errors.js';
import type { EngineWorkspace } from '../engine/engine-types.js';
import {
  workspaceMapRepo,
  type WorkspaceMapRow,
} from '../store/repositories/workspace-map.repo.js';

// Resolve a product handle to its map row; 404 if the handle is unknown.
export function resolveRow(productId: string): WorkspaceMapRow {
  const row = workspaceMapRepo.findByProductId(productId);
  if (!row) throw new AppError(404, 'Workspace not found');
  return row;
}

// Resolve a product handle to the engine slug the adapter needs.
export function resolveSlug(productId: string): string {
  return resolveRow(productId).engine_slug;
}

// Build a fresh map row for an engine workspace (minting a new product handle).
function mint(engine: EngineWorkspace): WorkspaceMapRow {
  return {
    product_id: randomUUID(),
    engine_slug: engine.slug,
    engine_numeric_id: engine.id ?? null,
    display_name: engine.name,
    created_at: new Date().toISOString(),
  };
}

// Reconcile the engine's current workspace list against the map (REQ-021b): mint a handle
// for any workspace not yet mapped, and backfill a missing numeric id when the engine now
// reports one. Returns engine slug → product id so the caller can label list results.
export function reconcile(engineWorkspaces: EngineWorkspace[]): Map<string, string> {
  const bySlug = new Map<string, string>();
  for (const engine of engineWorkspaces) {
    const existing = workspaceMapRepo.findBySlug(engine.slug);
    if (!existing) {
      const row = mint(engine);
      workspaceMapRepo.insert(row);
      bySlug.set(engine.slug, row.product_id);
      continue;
    }
    if (existing.engine_numeric_id === null && engine.id !== undefined && engine.id !== null) {
      workspaceMapRepo.updateNumericId(existing.product_id, engine.id);
    }
    bySlug.set(engine.slug, existing.product_id);
  }
  return bySlug;
}

// Mint + persist a handle for a just-created workspace (used by createWorkspace).
export function recordNew(engine: EngineWorkspace): WorkspaceMapRow {
  const row = mint(engine);
  workspaceMapRepo.insert(row);
  return row;
}

// Backfill the numeric id for a handle whose row still has null, using a fresh engine list
// (supports REQ-037 MIN-4 follow-up lookup when the create response omitted the numeric id).
export function ensureNumericId(productId: string, engineWorkspaces: EngineWorkspace[]): void {
  const row = workspaceMapRepo.findByProductId(productId);
  if (!row || row.engine_numeric_id !== null) return;
  const engine = engineWorkspaces.find((w) => w.slug === row.engine_slug);
  if (engine && engine.id !== undefined && engine.id !== null) {
    workspaceMapRepo.updateNumericId(productId, engine.id);
  }
}

// Drop a handle after a verified delete (REQ-038).
export function forget(productId: string): void {
  workspaceMapRepo.delete(productId);
}
