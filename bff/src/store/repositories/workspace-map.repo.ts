// workspace_map repository (boundary rule 3, REQ-021b, §6.4). Maps the opaque product
// handle we mint/expose to the engine's opaque slug + numeric id. Handles are looked up,
// never parsed. On list/read we reconcile engine workspaces not yet in the map.

import { db } from '../db.js';

export interface WorkspaceMapRow {
  product_id: string;
  engine_slug: string;
  engine_numeric_id: number | null;
  display_name: string | null;
  created_at: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO workspace_map (product_id, engine_slug, engine_numeric_id, display_name, created_at)
   VALUES (@product_id, @engine_slug, @engine_numeric_id, @display_name, @created_at)`,
);
const findByProductIdStmt = db.prepare(`SELECT * FROM workspace_map WHERE product_id = ?`);
const findBySlugStmt = db.prepare(`SELECT * FROM workspace_map WHERE engine_slug = ?`);
const findByNumericIdStmt = db.prepare(
  `SELECT * FROM workspace_map WHERE engine_numeric_id = ?`,
);
const listStmt = db.prepare(`SELECT * FROM workspace_map`);
const updateNumericIdStmt = db.prepare(
  `UPDATE workspace_map SET engine_numeric_id = ? WHERE product_id = ?`,
);
const deleteStmt = db.prepare(`DELETE FROM workspace_map WHERE product_id = ?`);

export const workspaceMapRepo = {
  insert(row: WorkspaceMapRow): void {
    insertStmt.run(row);
  },
  findByProductId(productId: string): WorkspaceMapRow | undefined {
    return findByProductIdStmt.get(productId) as WorkspaceMapRow | undefined;
  },
  findBySlug(engineSlug: string): WorkspaceMapRow | undefined {
    return findBySlugStmt.get(engineSlug) as WorkspaceMapRow | undefined;
  },
  findByNumericId(engineNumericId: number): WorkspaceMapRow | undefined {
    return findByNumericIdStmt.get(engineNumericId) as WorkspaceMapRow | undefined;
  },
  list(): WorkspaceMapRow[] {
    return listStmt.all() as WorkspaceMapRow[];
  },
  updateNumericId(productId: string, numericId: number): void {
    updateNumericIdStmt.run(numericId, productId);
  },
  delete(productId: string): void {
    deleteStmt.run(productId);
  },
};
