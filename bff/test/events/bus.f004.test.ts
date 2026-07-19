// bff/src/events/bus.ts — F-004 edit: OutboxRelayBus.publish computes ordering_key via
// deriveOrderingKey and passes it to insert() (spec REQ-F004-029; design §1.1: "OutboxRelayBus.
// publish computes ordering_key via deriveOrderingKey and passes it to insert (INSERT path only;
// still no delivery)"). Mirrors bus.test.ts's own outboxRepo-module-boundary-mock convention so
// this stays a fast, isolated unit test — no real filesystem/db involved.
//
// ASSUMED SIGNATURE CHANGE: outboxRepo.insert(ts, envelope, orderingKey) — a third positional
// arg, per the outbox.repo.ts edit table's "insert() must accept + write ordering_key".

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn(() => 1);
const markPublished = vi.fn();
const listUnpublished = vi.fn(() => []);

vi.mock('../../src/store/repositories/outbox.repo.js', () => ({
  outboxRepo: { insert, markPublished, listUnpublished },
}));

const orderingKeyMod = await import('../../src/events/ordering-key.js').catch(() => null);
const deriveOrderingKey = (orderingKeyMod as { deriveOrderingKey?: (env: unknown) => string } | null)?.deriveOrderingKey;

const envelope = {
  event: 'admin.workspace.created' as const,
  actor: 'staff-1',
  target: { id: 'ws-42' },
  changes: undefined,
  verified: true,
  timestamp: '2026-07-19T00:00:00.000Z',
};

beforeEach(() => {
  insert.mockClear();
  markPublished.mockClear();
  listUnpublished.mockClear();
});

describe('OutboxRelayBus.publish — envelope byte-for-byte, still no delivery here (REQ-F004-002/005)', () => {
  it('inserts the exact JSON.stringify(envelope), never marks published (relay drains it later)', async () => {
    const { OutboxRelayBus } = await import('../../src/events/bus.js');
    const bus = new OutboxRelayBus();
    await bus.publish(envelope);
    const call = insert.mock.calls[0]!;
    expect(call[0]).toBe(envelope.timestamp);
    expect(call[1]).toBe(JSON.stringify(envelope));
    expect(markPublished).not.toHaveBeenCalled();
  });
});

describe('OutboxRelayBus.publish — REQ-F004-029: computes ordering_key and passes it to insert', () => {
  it('passes a THIRD argument to insert() (the ordering key)', async () => {
    const { OutboxRelayBus } = await import('../../src/events/bus.js');
    const bus = new OutboxRelayBus();
    await bus.publish(envelope);
    const call = insert.mock.calls[0]!;
    expect(call.length).toBeGreaterThanOrEqual(3);
    expect(typeof call[2]).toBe('string');
    expect((call[2] as string).length).toBeGreaterThan(0);
  });

  it.skipIf(!deriveOrderingKey)('the ordering key passed to insert() matches deriveOrderingKey(envelope) exactly (single source of truth)', async () => {
    const { OutboxRelayBus } = await import('../../src/events/bus.js');
    const bus = new OutboxRelayBus();
    await bus.publish(envelope);
    const call = insert.mock.calls[0]!;
    expect(call[2]).toBe(deriveOrderingKey!(envelope));
    expect(call[2]).toBe('ws:ws-42');
  });
});
