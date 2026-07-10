// White-box unit tests for the F-002 danger-gate binding token module
// (src/baseline/confirm-token.ts), exercised directly — no HTTP, no DB. The module keeps a
// single-slot in-process singleton snapshot, so every test resets it via clearSnapshot() in
// beforeEach. Covers: token tampering, staleness triggers (mode/baseline/target-set change),
// snapshot round-trip fidelity, and the single-slot "newer mint supersedes" semantics.
//
// Note: `typedConfirmation` vs `confirmationPhrase` matching is NOT this module's job — this
// module only exposes the phrase on the minted snapshot; the equality check against
// `typedConfirmation` happens one layer up in baseline.service.ts (REQ-F002-048). That
// service-level behavior is covered by the route-level spec tests and (for the fan-out
// aggregation contract) by test/services/baseline.service.test.ts in this suite.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mintSnapshot,
  validateToken,
  clearSnapshot,
  type MintInput,
  type SnapshotItem,
} from '../../src/baseline/confirm-token.js';

function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    workspaceId: 'ws-1',
    resolvedMode: 'prepend',
    currentPromptHash: 'hash-1',
    willChange: true,
    overridden: false,
    writeTarget: 'composed-1',
    remainderToStore: 'remainder-1',
    ...overrides,
  };
}

function baseInput(overrides: Partial<MintInput> = {}): MintInput {
  return {
    operatorMode: 'prepend',
    baselineText: 'B',
    targetWorkspaceIds: ['ws-1'],
    items: [item()],
    ...overrides,
  };
}

beforeEach(() => {
  clearSnapshot();
});

describe('mintSnapshot', () => {
  it('mints a non-empty opaque token and a human-typeable confirmationPhrase', () => {
    const snap = mintSnapshot(baseInput());
    expect(typeof snap.token).toBe('string');
    expect(snap.token.length).toBeGreaterThan(0);
    expect(snap.phrase).toMatch(/^apply-baseline-[0-9a-f]{8}$/);
  });

  it('each mint produces a fresh, unique token and phrase', () => {
    const a = mintSnapshot(baseInput());
    const b = mintSnapshot(baseInput());
    expect(a.token).not.toBe(b.token);
    expect(a.phrase).not.toBe(b.phrase);
  });

  it('sorts targetWorkspaceIds regardless of input order (membership comparison is order-independent)', () => {
    const snap = mintSnapshot(baseInput({ targetWorkspaceIds: ['ws-3', 'ws-1', 'ws-2'] }));
    expect(snap.targetWorkspaceIds).toEqual(['ws-1', 'ws-2', 'ws-3']);
  });

  it('round-trips every field of the input, including optional per-item override candidates, byte-for-byte', () => {
    const overriddenItem = item({
      workspaceId: 'ws-overridden',
      overridden: true,
      writeTarget: undefined,
      remainderToStore: undefined,
      composedIfPreserve: 'preserve-value',
      remainderIfPreserve: 'preserve-remainder',
      composedIfDiscard: 'discard-value',
      remainderIfDiscard: null,
    });
    const input = baseInput({
      operatorMode: 'overwrite',
      baselineText: 'The Baseline Text',
      targetWorkspaceIds: ['ws-overridden'],
      items: [overriddenItem],
    });
    const snap = mintSnapshot(input);
    expect(snap.operatorMode).toBe('overwrite');
    expect(snap.baselineText).toBe('The Baseline Text');
    expect(snap.items).toEqual([overriddenItem]);
  });

  it('preserves a null baselineText (cleared baseline) rather than coercing it to a string', () => {
    const snap = mintSnapshot(baseInput({ baselineText: null }));
    expect(snap.baselineText).toBeNull();
  });
});

describe('validateToken — malformed/absent token (400)', () => {
  it('an undefined token is rejected 400', () => {
    const result = validateToken({
      token: undefined,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: [],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('an empty-string token is rejected 400', () => {
    const result = validateToken({
      token: '',
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: [],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('a non-string token (number, object, array) is rejected 400', () => {
    for (const bad of [123, {}, [], null, true]) {
      const result = validateToken({
        token: bad,
        mode: 'prepend',
        currentBaselineText: 'B',
        currentTargetWorkspaceIds: [],
      });
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
  });
});

describe('validateToken — staleness/superseded (409)', () => {
  it('a token presented when no snapshot was ever minted is rejected 409 (unknown token)', () => {
    const result = validateToken({
      token: 'some-random-token-nobody-minted',
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: [],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('a tampered token (any string different from the minted one) is rejected 409', () => {
    const snap = mintSnapshot(baseInput());
    const result = validateToken({
      token: snap.token + '-tampered',
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1'],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('a mode differing from the one the token was minted under is rejected 409', () => {
    const snap = mintSnapshot(baseInput({ operatorMode: 'prepend' }));
    const result = validateToken({
      token: snap.token,
      mode: 'overwrite',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1'],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('a baseline text that changed since preview is rejected 409, including cleared-to-defined and defined-to-cleared', () => {
    const snap = mintSnapshot(baseInput({ baselineText: 'B' }));
    expect(
      validateToken({
        token: snap.token,
        mode: 'prepend',
        currentBaselineText: 'B-changed',
        currentTargetWorkspaceIds: ['ws-1'],
      }),
    ).toMatchObject({ ok: false, status: 409 });

    const snap2 = mintSnapshot(baseInput({ baselineText: null }));
    expect(
      validateToken({
        token: snap2.token,
        mode: 'prepend',
        currentBaselineText: 'now defined',
        currentTargetWorkspaceIds: ['ws-1'],
      }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it('a target-set membership change (workspace added) is rejected 409', () => {
    const snap = mintSnapshot(baseInput({ targetWorkspaceIds: ['ws-1'] }));
    const result = validateToken({
      token: snap.token,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1', 'ws-2'],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('a target-set membership change (workspace removed) is rejected 409', () => {
    const snap = mintSnapshot(baseInput({ targetWorkspaceIds: ['ws-1', 'ws-2'] }));
    const result = validateToken({
      token: snap.token,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1'],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('an unrelated workspace swap of the SAME cardinality (same count, different ids) is rejected 409', () => {
    const snap = mintSnapshot(baseInput({ targetWorkspaceIds: ['ws-1', 'ws-2'] }));
    const result = validateToken({
      token: snap.token,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1', 'ws-3'],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('minting a newer snapshot supersedes the previous token, which then fails validation (single-slot store)', () => {
    const first = mintSnapshot(baseInput());
    mintSnapshot(baseInput()); // supersedes `first`
    const result = validateToken({
      token: first.token,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1'],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('clearSnapshot() invalidates even a just-minted, otherwise-valid token (used after a consumed apply)', () => {
    const snap = mintSnapshot(baseInput());
    clearSnapshot();
    const result = validateToken({
      token: snap.token,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1'],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });
});

describe('validateToken — success', () => {
  it('a matching token/mode/baseline/target-set validates ok and returns the exact minted snapshot', () => {
    const input = baseInput({ targetWorkspaceIds: ['ws-2', 'ws-1'] });
    const snap = mintSnapshot(input);
    const result = validateToken({
      token: snap.token,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: ['ws-1', 'ws-2'], // different order, same membership
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.token).toBe(snap.token);
      expect(result.snapshot.items).toEqual(input.items);
    }
  });

  it('a null baselineText matches only a currentBaselineText that is also null (not the empty string)', () => {
    const snap = mintSnapshot(baseInput({ baselineText: null }));
    expect(
      validateToken({
        token: snap.token,
        mode: 'prepend',
        currentBaselineText: null,
        currentTargetWorkspaceIds: ['ws-1'],
      }).ok,
    ).toBe(true);
    expect(
      validateToken({
        token: snap.token,
        mode: 'prepend',
        currentBaselineText: '',
        currentTargetWorkspaceIds: ['ws-1'],
      }).ok,
    ).toBe(false);
  });

  it('an empty target set (baseline cleared with no tracked workspaces) round-trips and validates', () => {
    const snap = mintSnapshot(baseInput({ targetWorkspaceIds: [], items: [] }));
    const result = validateToken({
      token: snap.token,
      mode: 'prepend',
      currentBaselineText: 'B',
      currentTargetWorkspaceIds: [],
    });
    expect(result.ok).toBe(true);
  });
});
