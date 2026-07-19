// bff/src/relay/drainer.ts — the transport-AGNOSTIC drain/orchestration layer (spec
// REQ-F004-010/011/012/013/014/015/016/017/020/041/042/047; design §1.1/§1.2/§2.4/§4/§7). It owns
// everything INDEPENDENT of the wire — polling eligible rows, per-key order + head-of-line,
// retry/backoff, mark-published/acked bookkeeping, park/force-publish, graceful shutdown — and
// reaches the network ONLY through the EventTransport seam. It imports NO HTTP client, no peer
// list, no concrete transport class, and no HTTP status codes (REQ-F004-049 no-leak boundary).

import { outboxRepo, type OutboxRow } from '../store/repositories/outbox.repo.js';
import { composeDeliveryId } from './delivery-id.js';
import { backoffMs, MAX_ATTEMPTS } from './backoff.js';
import type { EventTransport } from './transport.js';
import * as metrics from './metrics.js';

// How many eligible rows to pull per tick. The eligibility query already returns at most the
// oldest row per real ordering key (plus every independent __unkeyed__ row), so this bounds the
// cross-key in-flight fan-out. Generous for the single-instance nominal load (REQ-F004-027/033).
const DRAIN_BATCH = 500;

export interface Drainer {
  runOnce(): Promise<void>; // one select → dispatch → await-settle pass
  shutdown(timeoutMs: number): Promise<void>; // bounded graceful drain of the in-flight SET
}

// The per-row race result: acked, an abandonment signal (graceful shutdown), or a failure carrying
// the transport's transient/permanent classification.
type DeliverResult = 'ack' | 'abandon' | { err: unknown };

export function createDrainer(deps: { transport: EventTransport }): Drainer {
  const { transport } = deps;

  // Row ids currently handed to the transport — the single-drainer in-flight guard (REQ-F004-017):
  // a row already dispatched is never re-selected within the same process, so two concurrent ticks
  // cannot both deliver it. Doubles as the graceful-shutdown SET (REQ-F004-020).
  const inFlight = new Set<number>();
  // Abandon triggers keyed by row id — graceful shutdown resolves any still-hanging delivery as
  // ABANDONED (leave the row untouched) so runOnce can settle instead of hanging forever.
  const abandonTriggers = new Map<number, () => void>();
  let shuttingDown = false;

  function nowIso(): string {
    return new Date().toISOString();
  }

  function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  // A delivery failure (transient or permanent). Applies retry/backoff, poison isolation, and the
  // acked_at-routed post-ack cap (REQ-F004-011/013/014/047).
  function handleFailure(row: OutboxRow, deliveryId: string, err: unknown): void {
    const classification = (err as { classification?: unknown })?.classification === 'permanent'
      ? 'permanent'
      : 'transient';
    const everAcked = row.acked_at != null;

    if (classification === 'permanent') {
      // Permanent rejection → park IMMEDIATELY, no backoff, regardless of attempt count
      // (REQ-F004-047/051(d)). acked_at NULL here (a fully-acked row would have published).
      outboxRepo.park(row.id, nowIso());
      // A fan-out row may have had SOME peers accept before another permanently rejected — that is
      // a partially-delivered park, a distinct signal from never-delivered (REQ-F004-051(e)/025).
      if (everAcked) metrics.recordPartiallyDeliveredPark();
      else metrics.recordNeverDeliveredPark();
      transport.release?.(deliveryId);
      return;
    }

    // Transient failure → increment attempt_count and schedule the next attempt (REQ-F004-013).
    const nextAttempt = row.attempt_count + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      // Cap reached (inclusive-at-N). Route SOLELY by the persisted acked_at marker (REQ-F004-011):
      if (everAcked) {
        // Ever delivered → force-mark published (stop the redelivery loop, let the key resume);
        // never park. Alerted via the post-ack-cap counter — the event reached the consumer.
        outboxRepo.forcePublish(row.id, nowIso());
        metrics.recordPostAckCap();
      } else {
        // Never delivered → genuine poison: record the failing attempt, then park (REQ-F004-014).
        const at = new Date(Date.now() + backoffMs(nextAttempt)).toISOString();
        outboxRepo.recordFailure(row.id, at, errText(err));
        outboxRepo.park(row.id, nowIso());
        metrics.recordNeverDeliveredPark();
      }
      transport.release?.(deliveryId);
      return;
    }

    const at = new Date(Date.now() + backoffMs(nextAttempt)).toISOString();
    outboxRepo.recordFailure(row.id, at, errText(err));
    metrics.recordAttemptFailure();
  }

  async function deliverRow(row: OutboxRow, epoch: string): Promise<void> {
    const deliveryId = composeDeliveryId(epoch, row.id);

    // Race the actual delivery against a graceful-shutdown abandon signal (REQ-F004-020). If the
    // delivery acks/fails first we handle it normally; if shutdown abandons it first we leave the
    // row's bookkeeping untouched (abandonment is neither ack nor failure).
    const abandonPromise = new Promise<'abandon'>((resolve) => {
      abandonTriggers.set(row.id, () => resolve('abandon'));
    });

    try {
      const result = await Promise.race<DeliverResult>([
        transport.deliver(row.envelope, deliveryId).then(
          () => 'ack' as const,
          (err: unknown) => ({ err }),
        ),
        abandonPromise,
      ]);

      if (result === 'abandon') {
        // Left for redelivery — published_at stays NULL, attempt_count untouched (REQ-F004-020).
        return;
      }
      if (result === 'ack') {
        const iso = nowIso();
        // Persist the durable acked marker (REQ-F004-011) before/with markPublished, then publish.
        outboxRepo.markAcked(row.id, iso);
        outboxRepo.markPublished(row.id, iso);
        transport.release?.(deliveryId);
        metrics.recordDelivered();
        return;
      }
      handleFailure(row, deliveryId, result.err);
    } finally {
      abandonTriggers.delete(row.id);
      inFlight.delete(row.id);
    }
  }

  async function runOnce(): Promise<void> {
    if (shuttingDown) return;
    const rows = outboxRepo.selectEligible(nowIso(), DRAIN_BATCH);
    if (rows.length === 0) return;
    const epoch = outboxRepo.getEpoch();

    const dispatched: Promise<void>[] = [];
    for (const row of rows) {
      if (shuttingDown) break;
      if (inFlight.has(row.id)) continue; // already handed to the transport this/another tick
      inFlight.add(row.id);
      dispatched.push(deliverRow(row, epoch));
    }
    // Cross-key parallel: await the whole in-flight set of this tick (REQ-F004-016/027).
    await Promise.all(dispatched);
  }

  async function shutdown(timeoutMs: number): Promise<void> {
    shuttingDown = true;
    // Give in-flight deliveries a bounded, SHARED window to settle naturally (ack → publish).
    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    // Anything still in flight at the bound is ABANDONED — resolve its race so runOnce unblocks;
    // the row keeps published_at NULL and unchanged bookkeeping for redelivery on restart.
    for (const trigger of [...abandonTriggers.values()]) trigger();
  }

  return { runOnce, shutdown };
}
