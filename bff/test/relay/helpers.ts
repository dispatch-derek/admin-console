// Shared, test-only helpers for the F-004 relay suite (bff/test/relay/**, plus reused by
// bff/test/events/ordering-key.test.ts and bff/test/store/repositories/outbox.repo.f004.test.ts).
// NOT implementation — this file is never imported by bff/src/**. It deliberately has ZERO
// dependency on any not-yet-built `bff/src/relay/*` module: `FakeTransport` is a structural
// (duck-typed) stand-in for the REQ-F004-049 `EventTransport` interface
// (`deliver(envelope, deliveryId): Promise<void>` + optional `release(deliveryId)`), so files that
// only need an envelope builder or a fake transport can run even before `transport.ts` exists.
//
// Spec: specs/F-004-production-event-bus.md (rev 10). Design: docs/design/09-F004-production-event-bus.md.

import Database from 'better-sqlite3';

// ── Envelope builder (grounded against bff/src/events/catalog.ts, the FROZEN contract F-004
// consumes as opaque bytes — REQ-F004-002/004) ────────────────────────────────────────────────
export interface EnvelopeOverrides {
  actor?: string;
  changes?: unknown;
  verified?: boolean | Record<string, boolean>;
  timestamp?: string;
  payload?: unknown;
}

export function makeEnvelope(
  event: string,
  target: Record<string, unknown>,
  overrides: EnvelopeOverrides = {},
): Record<string, unknown> {
  return {
    event,
    actor: overrides.actor ?? 'staff-1',
    target,
    changes: overrides.changes,
    verified: overrides.verified ?? true,
    timestamp: overrides.timestamp ?? '2026-07-19T00:00:00.000Z',
    payload: overrides.payload,
  };
}

export function envJson(event: string, target: Record<string, unknown>, overrides?: EnvelopeOverrides): string {
  return JSON.stringify(makeEnvelope(event, target, overrides));
}

// The 21 event names / 8 families grounded from bff/src/events/catalog.ts's `AdminEventName`
// union (read as the frozen, out-of-scope contract F-004 consumes — REQ-F004-002/004), paired
// with a representative `target` shape and the §3-derivation-table's expected ordering key.
// This is the single source of truth the ordering-key + migration-backfill suites both draw from.
export const CATALOG_FAMILY_CASES: Array<{ event: string; target: Record<string, unknown>; expectKey: string }> = [
  { event: 'admin.workspace.created', target: { id: 'ws-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.workspace.updated', target: { id: 'ws-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.workspace.deleted', target: { id: 'ws-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.workspace.documents_changed', target: { id: 'ws-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.workspace.knowledge_pinned', target: { id: 'ws-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.workspace.knowledge_unpinned', target: { id: 'ws-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.workspace_user.assigned', target: { workspace: 'ws-1', user: 'u-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.workspace_user.unassigned', target: { workspace: 'ws-1', user: 'u-1' }, expectKey: 'ws:ws-1' },
  { event: 'admin.user.created', target: { id: 'u-1' }, expectKey: 'user:u-1' },
  { event: 'admin.user.updated', target: { id: 'u-1' }, expectKey: 'user:u-1' },
  { event: 'admin.user.suspended', target: { id: 'u-1' }, expectKey: 'user:u-1' },
  { event: 'admin.user.reactivated', target: { id: 'u-1' }, expectKey: 'user:u-1' },
  { event: 'admin.user.deleted', target: { id: 'u-1' }, expectKey: 'user:u-1' },
  { event: 'admin.invite.created', target: { id: 'inv-1' }, expectKey: 'invite:inv-1' },
  { event: 'admin.invite.revoked', target: { id: 'inv-1' }, expectKey: 'invite:inv-1' },
  { event: 'admin.instance.setting_changed', target: { keys: ['a'] }, expectKey: 'instance' },
  { event: 'admin.instance.provider_changed', target: { selector: 'llm.provider' }, expectKey: 'instance' },
  { event: 'admin.raw_env.written', target: {}, expectKey: 'instance' },
  { event: 'admin.baseline_prompt.updated', target: { baseline: 'singleton' }, expectKey: 'baseline' },
  { event: 'admin.baseline_prompt.applied', target: { baseline: 'singleton' }, expectKey: 'baseline' },
  { event: 'admin.feature_toggle.changed', target: { featureKey: 'billing' }, expectKey: '__unkeyed__' },
];

// ── FakeTransport — a scriptable, structural EventTransport double ────────────────────────────
// Duck-types the REQ-F004-049 seam: `deliver(envelope, deliveryId): Promise<void>` resolves on
// ack, rejects with `.classification` ('transient' | 'permanent', REQ-F004-047), and an optional
// `release(deliveryId)` the orchestration layer calls on a terminal outcome (REQ-F004-051(c)).
export type Classification = 'transient' | 'permanent';

export class FakeTransportError extends Error {
  readonly classification: Classification;
  constructor(message: string, classification: Classification) {
    super(message);
    this.classification = classification;
    this.name = 'FakeTransportError';
  }
}

export interface DeliverCall {
  envelope: string;
  deliveryId: string;
  seq: number;
}

type Outcome = 'ack' | 'transient' | 'permanent';

export class FakeTransport {
  calls: DeliverCall[] = [];
  releases: string[] = [];
  private seq = 0;
  private scripts = new Map<string, Outcome[]>();
  private defaultOutcome: Outcome = 'ack';
  private hanging = new Set<string>();
  private hangControllers = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

  setDefaultOutcome(outcome: Outcome): void {
    this.defaultOutcome = outcome;
  }

  // Queue outcomes consumed in order across successive deliver() calls for this deliveryId
  // (models the stateful re-drive scenarios: fail once then succeed, etc.).
  script(deliveryId: string, outcomes: Outcome[]): void {
    this.scripts.set(deliveryId, [...outcomes]);
  }

  // Mark a deliveryId's next deliver() call as HANGING — it returns a promise the test
  // controls explicitly via settleHang(), for graceful-shutdown-set tests (REQ-F004-020).
  hang(deliveryId: string): void {
    this.hanging.add(deliveryId);
  }

  settleHang(deliveryId: string, outcome: Outcome): void {
    const ctrl = this.hangControllers.get(deliveryId);
    if (!ctrl) throw new Error(`FakeTransport.settleHang: no pending hang registered for ${deliveryId}`);
    this.hangControllers.delete(deliveryId);
    this.hanging.delete(deliveryId);
    if (outcome === 'ack') ctrl.resolve();
    else ctrl.reject(new FakeTransportError(`fake ${outcome} failure`, outcome));
  }

  isHanging(deliveryId: string): boolean {
    return this.hangControllers.has(deliveryId);
  }

  async deliver(envelope: string, deliveryId: string): Promise<void> {
    this.calls.push({ envelope, deliveryId, seq: this.seq++ });
    if (this.hanging.has(deliveryId)) {
      return new Promise<void>((resolve, reject) => {
        this.hangControllers.set(deliveryId, { resolve, reject });
      });
    }
    const queue = this.scripts.get(deliveryId);
    const outcome = queue && queue.length ? (queue.shift() as Outcome) : this.defaultOutcome;
    if (outcome === 'ack') return;
    throw new FakeTransportError(`fake ${outcome} failure`, outcome);
  }

  release(deliveryId: string): void {
    this.releases.push(deliveryId);
  }

  callsFor(deliveryId: string): DeliverCall[] {
    return this.calls.filter((c) => c.deliveryId === deliveryId);
  }
}

// ── Raw event_outbox row seeding (bypasses outboxRepo.insert so tests can plant rows in ANY
// bookkeeping state — parked, mid-backoff, acked, etc. — independent of the enqueue path's own
// not-yet-finalized signature) ──────────────────────────────────────────────────────────────────
export interface SeedRowOpts {
  ts?: string;
  envelope: string;
  orderingKey: string | null;
  publishedAt?: string | null;
  parkedAt?: string | null;
  nextAttemptAt?: string | null;
  attemptCount?: number;
  lastError?: string | null;
  ackedAt?: string | null;
}

export function seedRow(db: Database.Database, opts: SeedRowOpts): number {
  const info = db
    .prepare(
      `INSERT INTO event_outbox
         (ts, envelope, published_at, ordering_key, attempt_count, next_attempt_at, last_error, parked_at, acked_at)
       VALUES (@ts, @envelope, @published_at, @ordering_key, @attempt_count, @next_attempt_at, @last_error, @parked_at, @acked_at)`,
    )
    .run({
      ts: opts.ts ?? '2026-07-19T00:00:00.000Z',
      envelope: opts.envelope,
      published_at: opts.publishedAt ?? null,
      ordering_key: opts.orderingKey,
      attempt_count: opts.attemptCount ?? 0,
      next_attempt_at: opts.nextAttemptAt ?? null,
      last_error: opts.lastError ?? null,
      parked_at: opts.parkedAt ?? null,
      acked_at: opts.ackedAt ?? null,
    });
  return Number(info.lastInsertRowid);
}

export function readRow(db: Database.Database, id: number): Record<string, unknown> {
  return db.prepare(`SELECT * FROM event_outbox WHERE id = ?`).get(id) as Record<string, unknown>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
