// Event emitter (REQ-029, REQ-029c). Called ONLY by services, ONLY after verifiedWrite
// resolves (01-bff §chain step 7). Builds the envelope, redacts secret VALUES in changes
// (REQ-062/094), then publishes to the configured EventBus (which durably writes the
// outbox row). See 01-bff-architecture.md §event emitter for the signature.

import { redactSecrets } from '../engine/mappers.js';
import type { AdminEventEnvelope, AdminEventName } from './catalog.js';
import { getEventBus } from './bus.js';

export async function emitAdminEvent<P>(
  name: AdminEventName,
  actor: string,
  target: AdminEventEnvelope['target'],
  verified: boolean | Record<string, boolean>, // map only for setting_changed (REQ-029f)
  changes?: P,
): Promise<void> {
  const envelope: AdminEventEnvelope<P> = {
    event: name,
    actor,
    target,
    changes: changes === undefined ? undefined : (redactSecrets(changes) as P),
    verified,
    timestamp: new Date().toISOString(), // ISO-8601
  };
  await getEventBus().publish(envelope);
}
