// bff/src/events/ordering-key.ts — pure, total deriveOrderingKey(envelope) (spec §3;
// design docs/design/09-F004-production-event-bus.md §3.3; REQ-F004-029/031/016). Design §1.1
// names this the shared source of truth for BOTH the enqueue path (OutboxRelayBus.publish) and
// the migration backfill (bff/src/store/db.ts's inline `deriveOrderingKeyForBackfill`, already
// implemented). Every expectation below is grounded byte-for-byte against that ALREADY-SHIPPED
// migration copy so the two can never silently diverge (design §3.2's own warning).
//
// ASSUMED SIGNATURE (not pinned verbatim by the spec, chosen as the most defensible reading of
// design §1.1 "shared by the enqueue path", which holds the PARSED AdminEventEnvelope object,
// not a JSON string, before JSON.stringify happens in OutboxRelayBus.publish):
//   deriveOrderingKey(envelope: { event: string; target?: Record<string, unknown> }): string

import { describe, it, expect } from 'vitest';
import { makeEnvelope, CATALOG_FAMILY_CASES } from '../relay/helpers.js';

const mod = await import('../../src/events/ordering-key.js').catch((e: unknown) => {
  return { __importError: e as Error };
});
const deriveOrderingKey = (mod as { deriveOrderingKey?: (env: unknown) => string }).deriveOrderingKey;

describe('deriveOrderingKey — module resolution (bff/src/events/ordering-key.ts, REQ-F004-029)', () => {
  it('exists and exports a deriveOrderingKey function', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail(
        `bff/src/events/ordering-key.ts does not exist yet (${(mod as { __importError?: Error }).__importError?.message}) — ` +
          'expected pre-implementation RED signal per design §1.1.',
      );
    }
    expect(typeof deriveOrderingKey).toBe('function');
  });
});

describe.skipIf(!deriveOrderingKey)('deriveOrderingKey — §3 total derivation over all 8 live catalog families (REQ-F004-029/031)', () => {
  it.each(CATALOG_FAMILY_CASES)('$event -> $expectKey', ({ event, target, expectKey }) => {
    const key = deriveOrderingKey!(makeEnvelope(event, target));
    expect(key).toBe(expectKey);
  });

  it('REQ-F004-002 — exactly 21 event names / 8 families are covered by the grounded fixture set', () => {
    expect(CATALOG_FAMILY_CASES.length).toBe(21);
    const families = new Set(CATALOG_FAMILY_CASES.map((c) => c.event.split('.').slice(0, 2).join('.')));
    expect(families.size).toBe(8);
  });

  it('admin.workspace_user.* keys on target.workspace, NOT target.user (ruling BR2)', () => {
    const key = deriveOrderingKey!(makeEnvelope('admin.workspace_user.assigned', { workspace: 'ws-7', user: 'u-9' }));
    expect(key).toBe('ws:ws-7');
    expect(key).not.toBe('user:u-9');
  });

  it('admin.workspace_user.* shares the SAME key as admin.workspace.* for that workspace (MN5 caveat)', () => {
    const membership = deriveOrderingKey!(makeEnvelope('admin.workspace_user.assigned', { workspace: 'ws-7', user: 'u-9' }));
    const lifecycle = deriveOrderingKey!(makeEnvelope('admin.workspace.updated', { id: 'ws-7' }));
    expect(membership).toBe(lifecycle);
  });

  it('admin.raw_env.* and admin.instance.* share the SAME "instance" singleton key (MN4)', () => {
    const rawEnv = deriveOrderingKey!(makeEnvelope('admin.raw_env.written', {}));
    const instance = deriveOrderingKey!(makeEnvelope('admin.instance.setting_changed', { keys: ['a'] }));
    expect(rawEnv).toBe('instance');
    expect(instance).toBe('instance');
  });

  it('admin.baseline_prompt.* gets its OWN "baseline" singleton, DISTINCT from "instance" (rev-7 Fix 1)', () => {
    const baseline = deriveOrderingKey!(makeEnvelope('admin.baseline_prompt.updated', { baseline: 'singleton' }));
    expect(baseline).toBe('baseline');
    expect(baseline).not.toBe('instance');
  });

  it('admin.feature_toggle.* is INTENTIONALLY __unkeyed__ (rev-7 Fix 2, not a totality fallthrough)', () => {
    const key = deriveOrderingKey!(makeEnvelope('admin.feature_toggle.changed', { featureKey: 'billing' }));
    expect(key).toBe('__unkeyed__');
  });
});

describe.skipIf(!deriveOrderingKey)('deriveOrderingKey — trailing-dot prefix match (N6, load-bearing)', () => {
  it('admin.workspace_user.assigned is NOT misparsed as admin.workspace.* (no bare startsWith("admin.workspace"))', () => {
    // A naive startsWith('admin.workspace') would read target.id (absent on a membership event,
    // which carries {workspace, user}) and either throw or silently fall to __unkeyed__, LOSING
    // membership ordering on ws:<workspace>. The correct trailing-dot match reads target.workspace.
    const key = deriveOrderingKey!(makeEnvelope('admin.workspace_user.assigned', { workspace: 'ws-3', user: 'u-1' }));
    expect(key).toBe('ws:ws-3');
    expect(key).not.toBe('__unkeyed__');
  });
});

describe.skipIf(!deriveOrderingKey)('deriveOrderingKey — totality edge cases (N5, resolves review N5)', () => {
  it('a matched-prefix event with a MISSING target.id falls back to __unkeyed__, never "ws:undefined"', () => {
    const key = deriveOrderingKey!(makeEnvelope('admin.workspace.updated', {}));
    expect(key).toBe('__unkeyed__');
    expect(key).not.toContain('undefined');
  });

  it('a matched-prefix event with an EMPTY-STRING target.id falls back to __unkeyed__', () => {
    const key = deriveOrderingKey!(makeEnvelope('admin.workspace.updated', { id: '' }));
    expect(key).toBe('__unkeyed__');
  });

  it('an unrecognized event name (no rule) falls back to __unkeyed__ (total function, never throws)', () => {
    expect(() => deriveOrderingKey!(makeEnvelope('admin.something_unknown.happened', { id: 'x' }))).not.toThrow();
    expect(deriveOrderingKey!(makeEnvelope('admin.something_unknown.happened', { id: 'x' }))).toBe('__unkeyed__');
  });

  it('a numeric target field is accepted (coerced to string) — id: 42 -> "ws:42"', () => {
    const key = deriveOrderingKey!(makeEnvelope('admin.workspace.created', { id: 42 }));
    expect(key).toBe('ws:42');
  });

  it('is a pure function: same input always yields the same output', () => {
    const a = deriveOrderingKey!(makeEnvelope('admin.user.created', { id: 'u-5' }));
    const b = deriveOrderingKey!(makeEnvelope('admin.user.created', { id: 'u-5' }));
    expect(a).toBe(b);
  });
});

describe.skipIf(!deriveOrderingKey)('deriveOrderingKey — __unkeyed__ rows are independent (ruling BR1, §3)', () => {
  it('two different __unkeyed__-mapped events produce the identical literal key "__unkeyed__" (not per-row-unique)', () => {
    const a = deriveOrderingKey!(makeEnvelope('admin.feature_toggle.changed', { featureKey: 'a' }));
    const b = deriveOrderingKey!(makeEnvelope('admin.feature_toggle.changed', { featureKey: 'b' }));
    expect(a).toBe('__unkeyed__');
    expect(b).toBe('__unkeyed__');
    // They collapse to the SAME literal key; independence (no head-of-line among them) is an
    // ELIGIBILITY-QUERY property (REQ-F004-041), exercised in outbox.repo.f004.test.ts, not here.
  });
});
