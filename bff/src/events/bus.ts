// Abstract EventBus + interim implementations (04-cross-cutting.md §c, REQ-029/029d).
// Every publish durably writes an event_outbox row (the durable record), so events
// survive a crash between the verify result and delivery. Two impls behind EVENT_BUS_MODE.
// F-004 adds the production relay that drains the outbox and delivers events over HTTP.

import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { outboxRepo } from '../store/repositories/outbox.repo.js';
import { deriveOrderingKey } from './ordering-key.js';
import type { AdminEventEnvelope } from './catalog.js';

export interface EventBus {
  publish(env: AdminEventEnvelope): Promise<void>;
}

// `inproc` (default): a Node EventEmitter for in-process subscribers. Writes the outbox
// row, emits in-process (by event name and to a '*' firehose), then marks published_at.
export class InProcessBus implements EventBus {
  readonly emitter = new EventEmitter();

  async publish(env: AdminEventEnvelope): Promise<void> {
    const id = outboxRepo.insert(env.timestamp, JSON.stringify(env));
    this.emitter.emit(env.event, env);
    this.emitter.emit('*', env);
    outboxRepo.markPublished(id, new Date().toISOString());
  }
}

// `bus` (EVENT_BUS_URL set): durably enqueue only. A background outbox relay (a later
// slice) drains rows with published_at IS NULL to the real on-box bus and marks them
// published — so events back-fill once the bus appears (04c, 06-risks).
export class OutboxRelayBus implements EventBus {
  async publish(env: AdminEventEnvelope): Promise<void> {
    // F-004 (REQ-F004-029): compute the per-key ordering key from the (parsed) envelope and
    // persist it on the row so the relay enforces per-key order without re-deriving it each drain.
    // INSERT path only — still no delivery here; the relay drains and delivers later.
    outboxRepo.insert(env.timestamp, JSON.stringify(env), deriveOrderingKey(env));
  }
}

// Factory: one bus per process, selected by config.eventBusMode.
let busSingleton: EventBus | null = null;
export function getEventBus(): EventBus {
  if (!busSingleton) {
    busSingleton = config.eventBusMode === 'bus' ? new OutboxRelayBus() : new InProcessBus();
  }
  return busSingleton;
}
