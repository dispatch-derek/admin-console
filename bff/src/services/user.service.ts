// User / invite / membership service (§6.1–§6.4, REQ-040–REQ-049). Mirrors
// workspace.service.ts: it owns the per-call responsibility chain (resolve → translate →
// adapter call → re-shape → verify-after-write → emit + audit). Reads do steps 1–5 only.
// Mutations run through verifiedWrite (REQ-028): on success emit the event(s) then write one
// success audit row; on an unconfirmed change verifiedWrite throws 409 and we write a
// failure audit + rethrow.
//
// Identity note: there is NO user/invite mapping table — only workspace_map. So a product
// user id and invite id ARE the engine numeric id rendered as a string; we convert
// string→number when calling the engine (validated with Number.isInteger, else 404).

import { engineAdapter as adapter } from '../engine/adapter.js';
import {
  parseInviteWorkspaceIds,
  toInvite,
  toUser,
  toUserUpdate,
} from '../engine/mappers.js';
import {
  ensureNumericId,
  reconcile,
  resolveRow,
} from '../identity/workspace-map.js';
import { workspaceMapRepo } from '../store/repositories/workspace-map.repo.js';
import { verifiedWrite } from './verify.js';
import { emitAdminEvent } from '../events/emitter.js';
import { recordAudit } from '../audit/audit.js';
import { AppError } from '../server/errors.js';
import type { EngineUser } from '../engine/engine-types.js';
import type { Invite, User } from '../types/product-types.js';

const ROLES = ['default', 'admin', 'manager'] as const;

// Run a mutation through verifiedWrite, writing a failure audit row on the unconfirmed 409
// (or any thrown error) before rethrowing, so audit stays entirely in the service layer.
async function runVerified<T>(
  action: string,
  actorId: string,
  target: Record<string, unknown>,
  opts: {
    write: () => Promise<void>;
    reread: () => Promise<T>;
    confirm: (state: T) => boolean;
    onUnconfirmed: string;
  },
): Promise<T> {
  try {
    return await verifiedWrite(opts);
  } catch (err) {
    recordAudit({
      actor: actorId,
      action,
      outcome: 'failure',
      target,
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

// Convert an opaque product user/invite id to the engine numeric id it wraps. There is no
// mapping table for these — the product id IS the numeric id as a string, so we parse and
// validate it. A non-integer id is a 404 (unknown resource), never a 400.
function toEngineNumericId(productId: string, notFoundMsg: string): number {
  const n = Number(productId);
  if (!Number.isInteger(n)) throw new AppError(404, notFoundMsg);
  return n;
}

// Resolve a workspace's engine numeric id with backfill (design 02 membership note). If the
// map row has no numeric id yet, reconcile against a fresh engine list and re-resolve. If it
// STILL cannot be resolved, the workspace is unusable for a numeric-id call → 409.
export async function resolveWorkspaceNumericId(
  productWorkspaceId: string,
): Promise<{ numericId: number; slug: string }> {
  let row = resolveRow(productWorkspaceId);
  if (row.engine_numeric_id === null) {
    const list = await adapter.listWorkspaces();
    ensureNumericId(productWorkspaceId, list);
    row = resolveRow(productWorkspaceId);
  }
  if (row.engine_numeric_id === null) {
    throw new AppError(409, 'Could not resolve workspace id');
  }
  return { numericId: row.engine_numeric_id, slug: row.engine_slug };
}

// GET /api/multi-user-status — the §6.1 precondition (REQ-040). Read-only. Response shape
// `{ enabled }` per design 02-product-api.md (the contract the web app consumes).
export async function getMultiUserStatus(): Promise<{ enabled: boolean }> {
  return { enabled: await adapter.isMultiUserMode() };
}

// GET /api/users (REQ-041). Read-only; engine suspended 0/1 → product boolean via toUser.
export async function listUsers(): Promise<User[]> {
  const users = await adapter.listUsers();
  return users.map(toUser);
}

// POST /api/users (REQ-042). Create then verify the user exists with the intended role.
export async function createUser(
  actorId: string,
  input: { username: string; password: string; role: string },
): Promise<User> {
  const { username, password, role } = input;
  if (typeof username !== 'string' || username.trim().length === 0) {
    throw new AppError(400, 'username is required');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new AppError(400, 'password is required');
  }
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    throw new AppError(400, "role must be 'default', 'admin', or 'manager'");
  }

  const created = await adapter.createUser({ username, password, role });
  const target = { id: String(created.id) };
  const users = await runVerified<EngineUser[]>('user.create', actorId, target, {
    write: async () => {}, // the create above IS the write; verify by re-reading
    reread: () => adapter.listUsers(),
    confirm: (list) => list.some((u) => u.username === username && u.role === role),
    onUnconfirmed: 'User creation could not be confirmed',
  });

  await emitAdminEvent('admin.user.created', actorId, target, true, { username, role });
  recordAudit({
    actor: actorId,
    action: 'user.create',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
  const found = users.find((u) => u.username === username && u.role === role)!;
  return toUser(found);
}

// PATCH /api/users/:id (REQ-043). Partial edit + verify; additionally emits a
// suspended/reactivated event when the `suspended` state actually flips.
export async function updateUser(
  actorId: string,
  productUserId: string,
  patch: { role?: string; suspended?: boolean; dailyMessageLimit?: number | null },
): Promise<User> {
  if (Object.prototype.hasOwnProperty.call(patch, 'role')) {
    if (!ROLES.includes(patch.role as (typeof ROLES)[number])) {
      throw new AppError(400, "role must be 'default', 'admin', or 'manager'");
    }
  }
  const numericId = toEngineNumericId(productUserId, 'User not found');

  const before = await adapter.listUsers();
  const priorUser = before.find((u) => u.id === numericId);
  if (!priorUser) throw new AppError(404, 'User not found');
  const priorSuspended = priorUser.suspended === 1;

  const engineBody = toUserUpdate(
    patch as Partial<Pick<User, 'role' | 'suspended' | 'dailyMessageLimit'>>,
  );
  const engineKeys = Object.keys(engineBody) as Array<keyof typeof engineBody>;
  if (engineKeys.length === 0) throw new AppError(400, 'No changes provided');

  const target = { id: productUserId };
  const users = await runVerified<EngineUser[]>('user.update', actorId, target, {
    write: () => adapter.updateUser(numericId, engineBody),
    reread: () => adapter.listUsers(),
    confirm: (list) => {
      const u = list.find((x) => x.id === numericId);
      return (
        !!u &&
        engineKeys.every(
          (k) =>
            (u as unknown as Record<string, unknown>)[k] ===
            (engineBody as Record<string, unknown>)[k],
        )
      );
    },
    onUnconfirmed: 'User change could not be confirmed',
  });

  await emitAdminEvent('admin.user.updated', actorId, target, true, engineBody);

  // Additionally emit a lifecycle event when `suspended` was in the patch AND flipped state.
  if (Object.prototype.hasOwnProperty.call(patch, 'suspended')) {
    const nowSuspended = patch.suspended === true;
    if (!priorSuspended && nowSuspended) {
      await emitAdminEvent('admin.user.suspended', actorId, target, true);
    } else if (priorSuspended && !nowSuspended) {
      await emitAdminEvent('admin.user.reactivated', actorId, target, true);
    }
  }

  recordAudit({
    actor: actorId,
    action: 'user.update',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
  const updated = users.find((u) => u.id === numericId)!;
  return toUser(updated);
}

// DELETE /api/users/:id (REQ-044). Delete + verify removal; a 404/absent re-read IS the
// confirmed-success signal and is NOT surfaced as a 404 error.
export async function deleteUser(actorId: string, productUserId: string): Promise<void> {
  const numericId = toEngineNumericId(productUserId, 'User not found');
  const before = await adapter.listUsers();
  const priorUser = before.find((u) => u.id === numericId);
  if (!priorUser) throw new AppError(404, 'User not found');

  const target = { id: productUserId };
  await runVerified<EngineUser[]>('user.delete', actorId, target, {
    write: () => adapter.deleteUser(numericId),
    reread: () => adapter.listUsers(),
    confirm: (list) => !list.some((u) => u.id === numericId),
    onUnconfirmed: 'User deletion could not be confirmed',
  });

  await emitAdminEvent('admin.user.deleted', actorId, target, true);
  recordAudit({
    actor: actorId,
    action: 'user.delete',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
}

// GET /api/invites (REQ-045). Reconcile workspaces first so the numeric→handle mapping is
// populated, then reverse-map each invite's engine workspace ids to product handles.
export async function listInvites(): Promise<Invite[]> {
  const ws = await adapter.listWorkspaces();
  reconcile(ws);
  const invites = await adapter.listInvites();
  return invites.map((inv) =>
    toInvite(
      inv,
      parseInviteWorkspaceIds(inv)
        .map((n) => workspaceMapRepo.findByNumericId(n)?.product_id)
        .filter(Boolean) as string[],
    ),
  );
}

// POST /api/invites (REQ-046). Resolve each product workspace handle → engine numeric id,
// create, then verify the invite exists.
export async function createInvite(
  actorId: string,
  productWorkspaceIds: string[] = [],
): Promise<Invite> {
  const numericIds: number[] = [];
  for (const productWorkspaceId of productWorkspaceIds) {
    const { numericId } = await resolveWorkspaceNumericId(productWorkspaceId);
    numericIds.push(numericId);
  }

  const created = await adapter.createInvite(numericIds);
  const target = { id: String(created.id) };
  await runVerified<Invite[]>('invite.create', actorId, target, {
    write: async () => {}, // the create above IS the write; verify by re-reading
    reread: () => adapter.listInvites().then((list) => list.map((i) => toInvite(i, []))),
    confirm: (list) => list.some((i) => i.id === String(created.id)),
    onUnconfirmed: 'Invite creation could not be confirmed',
  });

  await emitAdminEvent('admin.invite.created', actorId, target, true, {
    workspaceIds: productWorkspaceIds,
  });
  recordAudit({
    actor: actorId,
    action: 'invite.create',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
  return toInvite(created, productWorkspaceIds);
}

// DELETE /api/invites/:id (REQ-047). Revoke + verify removal.
export async function deleteInvite(actorId: string, productInviteId: string): Promise<void> {
  const numericId = toEngineNumericId(productInviteId, 'Invite not found');
  const target = { id: productInviteId };
  await runVerified<Invite[]>('invite.revoke', actorId, target, {
    write: () => adapter.deleteInvite(numericId),
    reread: () => adapter.listInvites().then((list) => list.map((i) => toInvite(i, []))),
    confirm: (list) => !list.some((i) => i.id === String(numericId)),
    onUnconfirmed: 'Invite revoke could not be confirmed',
  });

  await emitAdminEvent('admin.invite.revoked', actorId, target, true);
  recordAudit({
    actor: actorId,
    action: 'invite.revoke',
    outcome: 'success',
    target,
    detail: { verified: true },
  });
}

// GET /api/workspaces/:id/members (REQ-048). Resolve the opaque id → engine numeric id for
// the members read.
export async function listMembers(productWorkspaceId: string): Promise<User[]> {
  const { numericId } = await resolveWorkspaceNumericId(productWorkspaceId);
  const members = await adapter.listWorkspaceMembers(numericId);
  return members.map(toUser);
}

// POST /api/workspaces/:id/members (REQ-049, MAJ-4). Snapshot membership BEFORE the write,
// perform the slug-keyed manage-users write, verify the reread membership, then emit one
// event per ACTUAL delta vs the snapshot. A verified no-op emits NO event.
export async function updateMembers(
  actorId: string,
  productWorkspaceId: string,
  productUserIds: string[],
  reset: boolean,
): Promise<User[]> {
  const { numericId, slug } = await resolveWorkspaceNumericId(productWorkspaceId);
  const engineUserIds = productUserIds.map((id) => toEngineNumericId(id, 'User not found'));
  const engineUserIdSet = new Set(engineUserIds);

  // Snapshot current membership BEFORE the write (step 4, REQ-027).
  const before = await adapter.listWorkspaceMembers(numericId);
  const beforeIds = new Set(before.map((u) => u.id));

  const target = { workspace: productWorkspaceId };
  const members = await runVerified<EngineUser[]>('workspace.members', actorId, target, {
    write: () => adapter.manageWorkspaceUsers(slug, engineUserIds, reset),
    reread: () => adapter.listWorkspaceMembers(numericId),
    confirm: (list) => {
      const now = new Set(list.map((u) => u.id));
      if (reset) {
        return (
          now.size === engineUserIdSet.size &&
          [...engineUserIdSet].every((id) => now.has(id))
        );
      }
      return engineUserIds.every((id) => now.has(id));
    },
    onUnconfirmed: 'Membership change could not be confirmed',
  });

  // Compute the ACTUAL delta vs the pre-write snapshot from the reread membership.
  const afterIds = new Set(members.map((u) => u.id));
  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));

  for (const userId of added) {
    await emitAdminEvent(
      'admin.workspace_user.assigned',
      actorId,
      { workspace: productWorkspaceId, user: String(userId) },
      true,
    );
  }
  for (const userId of removed) {
    await emitAdminEvent(
      'admin.workspace_user.unassigned',
      actorId,
      { workspace: productWorkspaceId, user: String(userId) },
      true,
    );
  }

  recordAudit({
    actor: actorId,
    action: 'workspace.members',
    outcome: 'success',
    target,
    detail: {
      verified: true,
      added: added.map(String),
      removed: removed.map(String),
    },
  });
  return members.map(toUser);
}
