// events/emitter.ts — emitAdminEvent (REQ-029/029c/029d, 03-data-models.md "Event name
// type"). We mock the outboxRepo module boundary (same rationale as bus.test.ts) so this
// stays fast/isolated and exercises emitAdminEvent's own logic: envelope shape, secret
// redaction (REQ-062/094) via engine/env-keys.ts, and delegation to the configured bus.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn(() => 1);
const markPublished = vi.fn();

vi.mock('../../src/store/repositories/outbox.repo.js', () => ({
  outboxRepo: { insert, markPublished, listUnpublished: vi.fn(() => []) },
}));

beforeEach(() => {
  insert.mockClear();
  markPublished.mockClear();
  vi.useRealTimers();
});

describe('emitAdminEvent — EVENT_BUS_MODE=inproc (REQ-029, REQ-029d)', () => {
  it('publishes exactly one outbox row and marks it published', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    insert.mockReturnValue(11);
    const { emitAdminEvent } = await import('../../src/events/emitter.js');

    await emitAdminEvent('admin.workspace.created', 'staff-1', { workspaceId: 5 }, true);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(markPublished).toHaveBeenCalledTimes(1);
    expect(markPublished).toHaveBeenCalledWith(11, expect.any(String));
  });

  it('emits the envelope in-process on the event-name channel and the "*" firehose', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { emitAdminEvent } = await import('../../src/events/emitter.js');
    const { getEventBus } = await import('../../src/events/bus.js');
    const bus = getEventBus() as import('../../src/events/bus.js').InProcessBus;

    const byName = vi.fn();
    const byFirehose = vi.fn();
    bus.emitter.on('admin.user.suspended', byName);
    bus.emitter.on('*', byFirehose);

    await emitAdminEvent('admin.user.suspended', 'staff-9', { userId: 3 }, true);

    expect(byName).toHaveBeenCalledTimes(1);
    expect(byFirehose).toHaveBeenCalledTimes(1);
    const envSeenByName = byName.mock.calls[0][0];
    const envSeenByFirehose = byFirehose.mock.calls[0][0];
    expect(envSeenByName).toBe(envSeenByFirehose); // same envelope object on both channels
    expect(envSeenByName).toMatchObject({
      event: 'admin.user.suspended',
      actor: 'staff-9',
      target: { userId: 3 },
      verified: true,
    });
  });

  it('builds the envelope with an ISO-8601 timestamp and no `changes` when omitted', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { emitAdminEvent } = await import('../../src/events/emitter.js');

    await emitAdminEvent('admin.invite.revoked', 'staff-1', { inviteId: 2 }, false);

    expect(insert).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(insert.mock.calls[0][1] as string);
    expect(envelope.changes).toBeUndefined();
    expect(envelope.verified).toBe(false);
    expect(envelope.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('redacts secret VALUES in `changes` by key name (REQ-062/094) while keeping non-secret values and all key names', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { emitAdminEvent } = await import('../../src/events/emitter.js');
    const { isSecretKey } = await import('../../src/engine/env-keys.js');

    // Sanity: these are the exact keys the source-of-truth module marks secret/non-secret.
    expect(isSecretKey('OpenAiKey')).toBe(true);
    expect(isSecretKey('LLMProvider')).toBe(false);

    await emitAdminEvent(
      'admin.instance.provider_changed',
      'staff-1',
      { selector: 'llm.provider' },
      true,
      { LLMProvider: 'openai', OpenAiKey: 'sk-super-secret-value' },
    );

    const envelope = JSON.parse(insert.mock.calls[0][1] as string);
    expect(envelope.changes).toEqual({
      LLMProvider: 'openai', // non-secret value preserved
      OpenAiKey: '[redacted]', // secret VALUE redacted
    });
    // Key names are never dropped or renamed.
    expect(Object.keys(envelope.changes).sort()).toEqual(['LLMProvider', 'OpenAiKey']);
  });

  it('carries a scalar `verified` unchanged for single-delta events', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { emitAdminEvent } = await import('../../src/events/emitter.js');

    await emitAdminEvent('admin.workspace.deleted', 'staff-1', { workspaceId: 1 }, true);

    const envelope = JSON.parse(insert.mock.calls[0][1] as string);
    expect(envelope.verified).toBe(true);
  });

  it('carries a per-control-id `verified` map unchanged for admin.instance.setting_changed (REQ-029f)', async () => {
    process.env['EVENT_BUS_MODE'] = 'inproc';
    vi.resetModules();
    const { emitAdminEvent } = await import('../../src/events/emitter.js');

    const verifiedMap = { 'llm.provider': true, 'llm.temperature': false };
    await emitAdminEvent(
      'admin.instance.setting_changed',
      'staff-1',
      { categories: ['llm'] },
      verifiedMap,
      { categories: ['llm'], controlIds: ['llm.provider', 'llm.temperature'], verified: verifiedMap },
    );

    const envelope = JSON.parse(insert.mock.calls[0][1] as string);
    expect(envelope.verified).toEqual(verifiedMap);
  });
});

describe('emitAdminEvent — EVENT_BUS_MODE=bus (REQ-029d outbox-relay path)', () => {
  it('durably enqueues an unpublished outbox row and does not require any in-process emit', async () => {
    process.env['EVENT_BUS_MODE'] = 'bus';
    vi.resetModules();
    const { emitAdminEvent } = await import('../../src/events/emitter.js');

    await emitAdminEvent('admin.user.created', 'staff-1', { userId: 8 }, true);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(markPublished).not.toHaveBeenCalled();
  });
});
