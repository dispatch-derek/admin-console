// events/bus.ts — EventBus implementations + getEventBus() factory (REQ-029/029d,
// 04-cross-cutting.md §c). We mock the outboxRepo module boundary so this stays a fast,
// isolated unit test with no real filesystem/db involved — db.ts's load-time side effects
// (mkdirSync + open + migrate) never even run because outbox.repo.js (which imports
// db.js) is fully replaced by the mock below, before bus.ts is imported.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn(() => 1);
const markPublished = vi.fn();
const listUnpublished = vi.fn(() => []);

vi.mock('../../src/store/repositories/outbox.repo.js', () => ({
  outboxRepo: { insert, markPublished, listUnpublished },
}));

const envelope = {
  event: 'admin.workspace.created' as const,
  actor: 'staff-1',
  target: { workspaceId: 42 },
  changes: undefined,
  verified: true,
  timestamp: '2026-07-04T00:00:00.000Z',
};

beforeEach(() => {
  insert.mockClear();
  markPublished.mockClear();
  listUnpublished.mockClear();
});

describe('InProcessBus.publish (EVENT_BUS_MODE=inproc)', () => {
  it('inserts the outbox row, emits on the event-name channel and on "*", then marks published', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { InProcessBus } = await import('../../src/events/bus.js');
    const bus = new InProcessBus();

    const order: string[] = [];
    insert.mockImplementation(() => {
      order.push('insert');
      return 7;
    });
    markPublished.mockImplementation(() => order.push('markPublished'));

    const byName = vi.fn();
    const byFirehose = vi.fn();
    bus.emitter.on(envelope.event, byName);
    bus.emitter.on('*', byFirehose);

    await bus.publish(envelope);

    expect(insert).toHaveBeenCalledWith(envelope.timestamp, JSON.stringify(envelope));
    expect(byName).toHaveBeenCalledTimes(1);
    expect(byName).toHaveBeenCalledWith(envelope);
    expect(byFirehose).toHaveBeenCalledTimes(1);
    expect(byFirehose).toHaveBeenCalledWith(envelope);
    expect(markPublished).toHaveBeenCalledWith(7, expect.any(String));
    // Durable write happens before the in-process fan-out finishes and before it's marked
    // published (the row must exist — even unpublished — before consumers can observe it).
    expect(order[0]).toBe('insert');
    expect(order[order.length - 1]).toBe('markPublished');
  });

  it('does not emit to a different event-name channel', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { InProcessBus } = await import('../../src/events/bus.js');
    const bus = new InProcessBus();

    const otherChannel = vi.fn();
    bus.emitter.on('admin.user.deleted', otherChannel);

    await bus.publish(envelope);

    expect(otherChannel).not.toHaveBeenCalled();
  });
});

describe('OutboxRelayBus.publish (EVENT_BUS_MODE=bus)', () => {
  it('durably inserts the outbox row but never marks it published (a relay drains it later)', async () => {
    const { OutboxRelayBus } = await import('../../src/events/bus.js');
    const bus = new OutboxRelayBus();

    await bus.publish(envelope);

    // REQ-F004-029: OutboxRelayBus.publish now also derives + passes the ordering_key as a 3rd
    // arg to insert(). This envelope's target is { workspaceId: 42 } — the admin.workspace.*
    // derivation rule keys on target.id (not target.workspaceId), which is absent here, so per
    // the §3 totality fallback it correctly derives to '__unkeyed__' (never a false 'ws:undefined').
    expect(insert).toHaveBeenCalledWith(envelope.timestamp, JSON.stringify(envelope), '__unkeyed__');
    expect(markPublished).not.toHaveBeenCalled();
  });
});

describe('getEventBus() factory (config.eventBusMode)', () => {
  it('returns an InProcessBus by default / when EVENT_BUS_MODE=inproc', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { getEventBus, InProcessBus } = await import('../../src/events/bus.js');
    expect(getEventBus()).toBeInstanceOf(InProcessBus);
  });

  it('returns an OutboxRelayBus when EVENT_BUS_MODE=bus', async () => {
    process.env['EVENT_BUS_MODE'] = 'bus';
    vi.resetModules();
    const { getEventBus, OutboxRelayBus } = await import('../../src/events/bus.js');
    expect(getEventBus()).toBeInstanceOf(OutboxRelayBus);
  });

  it('memoizes a single bus instance per process (singleton)', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { getEventBus } = await import('../../src/events/bus.js');
    expect(getEventBus()).toBe(getEventBus());
  });
});
