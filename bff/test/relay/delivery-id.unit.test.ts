// White-box unit tests for bff/src/relay/delivery-id.ts — supplements
// bff/test/relay/delivery-id.test.ts (qa-engineer's spec-level suite, NOT modified here).
// composeDeliveryId is a one-line template-string composer; this file covers formatting
// boundaries the spec suite's happy-path fixtures don't exercise (rowId 0, negative rowId,
// an epoch value that itself contains the ':' delimiter).

import { describe, it, expect } from 'vitest';

const { composeDeliveryId } = await import('../../src/relay/delivery-id.js');

describe('composeDeliveryId — formatting boundaries', () => {
  it('rowId 0 composes "<epoch>:0", not an empty/falsy-collapsed segment', () => {
    expect(composeDeliveryId('epoch-1', 0)).toBe('epoch-1:0');
  });

  it('a negative rowId (defensive, should never occur in practice) still composes literally', () => {
    expect(composeDeliveryId('epoch-1', -5)).toBe('epoch-1:-5');
  });

  it('an empty-string epoch still composes (leading colon), does not throw', () => {
    expect(composeDeliveryId('', 7)).toBe(':7');
  });

  it('an epoch value that itself contains a colon is NOT re-escaped — composed literally', () => {
    // Documents current behavior: the format is not delimiter-safe against an epoch containing
    // ':'. In practice the epoch is a UUID/opaque token generated once per DB (db.ts), so this
    // is a defensive boundary check, not an expected production input.
    expect(composeDeliveryId('epoch:with:colons', 3)).toBe('epoch:with:colons:3');
  });

  it('a large rowId composes without precision loss (well within Number.MAX_SAFE_INTEGER)', () => {
    expect(composeDeliveryId('epoch-1', 9_007_199_254_740)).toBe('epoch-1:9007199254740');
  });
});
