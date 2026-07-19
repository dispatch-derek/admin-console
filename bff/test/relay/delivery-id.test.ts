// bff/src/relay/delivery-id.ts — stable delivery id composition (spec REQ-F004-018/048; design
// §2.3: `deliveryId = "<outbox-epoch>:<row-id>"`). This is the load-bearing consumer-dedupe key
// (REQ-F004-018/036) and the epoch qualification that survives a DB reset without collision
// (M6, REQ-F004-048).
//
// ASSUMED EXPORT (design §2.3 pins the composed SHAPE but not a literal function name):
//   composeDeliveryId(epoch: string, rowId: number): string

import { describe, it, expect } from 'vitest';

const mod = await import('../../src/relay/delivery-id.js').catch((e: unknown) => ({ __importError: e as Error }));
const composeDeliveryId = (mod as { composeDeliveryId?: (epoch: string, rowId: number) => string }).composeDeliveryId;

describe('delivery-id.ts — module resolution', () => {
  it('exists and exports composeDeliveryId', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail(`bff/src/relay/delivery-id.ts does not exist yet — expected pre-implementation RED signal.`);
    }
    expect(typeof composeDeliveryId).toBe('function');
  });
});

describe.skipIf(!composeDeliveryId)('composeDeliveryId — REQ-F004-018/048', () => {
  it('composes "<epoch>:<row-id>"', () => {
    expect(composeDeliveryId!('epoch-abc', 42)).toBe('epoch-abc:42');
  });

  it('is IDENTICAL across repeated calls for the same row + epoch (dedupe key stability, REQ-F004-018)', () => {
    const a = composeDeliveryId!('epoch-xyz', 7);
    const b = composeDeliveryId!('epoch-xyz', 7);
    expect(a).toBe(b);
  });

  it('two rows with the SAME numeric id but DIFFERENT epochs (simulated DB reset) yield DIFFERENT delivery ids (M6)', () => {
    const before = composeDeliveryId!('epoch-before-reset', 1);
    const after = composeDeliveryId!('epoch-after-reset', 1);
    expect(before).not.toBe(after);
  });

  it('two DIFFERENT rows under the SAME epoch yield DIFFERENT delivery ids', () => {
    const a = composeDeliveryId!('epoch-1', 1);
    const b = composeDeliveryId!('epoch-1', 2);
    expect(a).not.toBe(b);
  });
});
