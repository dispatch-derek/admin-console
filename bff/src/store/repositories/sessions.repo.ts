// sessions repository (REQ-011, REQ-014). Session token value lives in an httpOnly
// cookie; the row is the server-side record. Guard rejects when now > expires_at.

import { db } from '../db.js';

export interface SessionRow {
  id: string;
  staff_id: string;
  created_at: string;
  expires_at: string;
}

const insertStmt = db.prepare(
  `INSERT INTO sessions (id, staff_id, created_at, expires_at)
   VALUES (@id, @staff_id, @created_at, @expires_at)`,
);
const findByIdStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const deleteStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const deleteForStaffStmt = db.prepare(`DELETE FROM sessions WHERE staff_id = ?`);
const touchStmt = db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`);

export const sessionsRepo = {
  insert(row: SessionRow): void {
    insertStmt.run(row);
  },
  findById(id: string): SessionRow | undefined {
    return findByIdStmt.get(id) as SessionRow | undefined;
  },
  delete(id: string): void {
    deleteStmt.run(id);
  },
  deleteForStaff(staffId: string): void {
    deleteForStaffStmt.run(staffId);
  },
  touchExpiry(id: string, expiresAt: string): void {
    touchStmt.run(expiresAt, id);
  },
};
