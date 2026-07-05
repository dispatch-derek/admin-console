// First-account bootstrap (REQ-019a). On a fresh deployment with an EMPTY staff store, seed
// exactly one account from ADMIN_BOOTSTRAP_USERNAME/ADMIN_BOOTSTRAP_TOKEN, forcing set-
// password (invalidating the token) + MFA enrollment on first login. Never overwrites a
// non-empty store; there is no public "create first admin" endpoint.

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { staffRepo } from '../store/repositories/staff.repo.js';
import { hashPassword } from './crypto.js';

export async function seedFirstAccount(): Promise<void> {
  if (staffRepo.count() > 0) return; // never overwrite an existing store

  // The store is empty → this IS first boot, so the bootstrap vars are required NOW
  // (REQ-019a: conditional, not blocking startup once an account exists).
  const { adminBootstrapUsername, adminBootstrapToken } = config;
  if (!adminBootstrapUsername || !adminBootstrapToken) {
    throw new Error(
      'First-boot bootstrap requires ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_TOKEN to seed ' +
        'the initial staff account (REQ-019a). Set both env vars on first deployment.',
    );
  }

  const passwordHash = await hashPassword(adminBootstrapToken);
  staffRepo.insert({
    id: randomUUID(),
    username: adminBootstrapUsername,
    password_hash: passwordHash,
    totp_secret: null,
    mfa_enrolled: 0,
    disabled: 0,
    must_set_password: 1, // forces set-password (token invalidation) then MFA enroll
    created_at: new Date().toISOString(),
  });
}
