// Generic verify-after-write runner (REQ-028, REQ-092a). Perform the write, re-read the
// relevant engine state, then assert the outcome predicate before returning success. On an
// unconfirmed change it throws AppError(409) — the single-delta failure path (01-bff §verify).
//
// Per-mutation confirm predicates and the batched-settings-write map logic (slice 5) live
// in their own services; this is only the generic runner.

import { AppError } from '../server/errors.js';

export async function verifiedWrite<T>(opts: {
  write: () => Promise<void>;
  reread: () => Promise<T>; // re-fetch the relevant engine state
  confirm: (state: T) => boolean; // predicate: did the intended change land?
  onUnconfirmed?: string; // message when confirm() is false
}): Promise<T> {
  await opts.write();
  const state = await opts.reread();
  if (!opts.confirm(state)) {
    throw new AppError(409, opts.onUnconfirmed ?? 'could not confirm the change was saved');
  }
  return state;
}
