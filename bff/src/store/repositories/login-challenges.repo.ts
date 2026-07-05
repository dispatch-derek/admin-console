// login_challenges repository (§3.2). Transient two-step login state: holds the
// password-verified-but-not-MFA'd state between login and the MFA/enroll/set-password
// step so no session exists mid-flow (REQ-016). Short TTL; deleted on completion.

import { db } from '../db.js';

export type ChallengeStage = 'mfa' | 'enroll' | 'setPassword';

export interface LoginChallengeRow {
  id: string;
  staff_id: string;
  stage: ChallengeStage;
  attempts: number;
  expires_at: string;
}

const insertStmt = db.prepare(
  `INSERT INTO login_challenges (id, staff_id, stage, expires_at)
   VALUES (@id, @staff_id, @stage, @expires_at)`,
);
const findByIdStmt = db.prepare(`SELECT * FROM login_challenges WHERE id = ?`);
const setStageStmt = db.prepare(`UPDATE login_challenges SET stage = ? WHERE id = ?`);
const incrementAttemptsStmt = db.prepare(
  `UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?`,
);
const getAttemptsStmt = db.prepare(`SELECT attempts AS n FROM login_challenges WHERE id = ?`);
const deleteStmt = db.prepare(`DELETE FROM login_challenges WHERE id = ?`);
const deleteForStaffStmt = db.prepare(`DELETE FROM login_challenges WHERE staff_id = ?`);

export const loginChallengesRepo = {
  // attempts defaults to 0 in the schema; callers never set it at insert time.
  insert(row: Omit<LoginChallengeRow, 'attempts'>): void {
    insertStmt.run(row);
  },
  findById(id: string): LoginChallengeRow | undefined {
    return findByIdStmt.get(id) as LoginChallengeRow | undefined;
  },
  setStage(id: string, stage: ChallengeStage): void {
    setStageStmt.run(stage, id);
  },
  // Count a bad factor-2 code against this challenge; returns the new attempt count so the
  // route can retire the challenge once the per-challenge cap is hit (sec review H-1).
  incrementAttempts(id: string): number {
    incrementAttemptsStmt.run(id);
    return (getAttemptsStmt.get(id) as { n: number }).n;
  },
  delete(id: string): void {
    deleteStmt.run(id);
  },
  deleteForStaff(staffId: string): void {
    deleteForStaffStmt.run(staffId);
  },
};
