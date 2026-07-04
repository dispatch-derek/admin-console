// login_challenges repository (§3.2). Transient two-step login state: holds the
// password-verified-but-not-MFA'd state between login and the MFA/enroll/set-password
// step so no session exists mid-flow (REQ-016). Short TTL; deleted on completion.

import { db } from '../db.js';

export type ChallengeStage = 'mfa' | 'enroll' | 'setPassword';

export interface LoginChallengeRow {
  id: string;
  staff_id: string;
  stage: ChallengeStage;
  expires_at: string;
}

const insertStmt = db.prepare(
  `INSERT INTO login_challenges (id, staff_id, stage, expires_at)
   VALUES (@id, @staff_id, @stage, @expires_at)`,
);
const findByIdStmt = db.prepare(`SELECT * FROM login_challenges WHERE id = ?`);
const setStageStmt = db.prepare(`UPDATE login_challenges SET stage = ? WHERE id = ?`);
const deleteStmt = db.prepare(`DELETE FROM login_challenges WHERE id = ?`);
const deleteForStaffStmt = db.prepare(`DELETE FROM login_challenges WHERE staff_id = ?`);

export const loginChallengesRepo = {
  insert(row: LoginChallengeRow): void {
    insertStmt.run(row);
  },
  findById(id: string): LoginChallengeRow | undefined {
    return findByIdStmt.get(id) as LoginChallengeRow | undefined;
  },
  setStage(id: string, stage: ChallengeStage): void {
    setStageStmt.run(stage, id);
  },
  delete(id: string): void {
    deleteStmt.run(id);
  },
  deleteForStaff(staffId: string): void {
    deleteForStaffStmt.run(staffId);
  },
};
