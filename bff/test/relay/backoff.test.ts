// bff/src/relay/backoff.ts — capped-exponential backoff schedule + MAX_ATTEMPTS constant of
// record (spec REQ-F004-013/032: "capped exponential backoff (base, factor, cap) with a max
// attempt count before park-in-place is RATIFIED; the concrete values are fixed as a documented
// BFF constant of record. Cap edge is INCLUSIVE at the Nth failure").
//
// ASSUMED EXPORTS (the spec pins the SHAPE, not concrete values or literal names — "documented
// constants of record", design §5 open question #2):
//   export const MAX_ATTEMPTS: number;
//   export function backoffMs(attemptNumber: number): number;  // attemptNumber = 1-based

import { describe, it, expect } from 'vitest';

const mod = await import('../../src/relay/backoff.js').catch((e: unknown) => ({ __importError: e as Error }));
const backoffMs = (mod as { backoffMs?: (n: number) => number }).backoffMs;
const MAX_ATTEMPTS = (mod as { MAX_ATTEMPTS?: number }).MAX_ATTEMPTS;

describe('backoff.ts — module resolution', () => {
  it('exists and exports backoffMs + MAX_ATTEMPTS', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail(`bff/src/relay/backoff.ts does not exist yet — expected pre-implementation RED signal.`);
    }
    expect(typeof backoffMs).toBe('function');
    expect(typeof MAX_ATTEMPTS).toBe('number');
  });
});

describe.skipIf(!backoffMs)('backoffMs — REQ-F004-013 capped exponential shape', () => {
  it('is monotonically non-decreasing across successive attempt numbers', () => {
    let prev = -Infinity;
    for (let attempt = 1; attempt <= (MAX_ATTEMPTS ?? 10); attempt++) {
      const delay = backoffMs!(attempt);
      expect(delay).toBeGreaterThanOrEqual(prev);
      prev = delay;
    }
  });

  it('is CAPPED — the schedule does not grow unbounded (a late attempt is not astronomically larger than an early one)', () => {
    const late = backoffMs!((MAX_ATTEMPTS ?? 10) + 50);
    // A capped schedule bounds the delay; this is a sanity ceiling (1 hour) generous enough not
    // to encode the spec's undocumented concrete constant, only the RATIFIED "capped" shape.
    expect(late).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('returns a non-negative delay for the first attempt', () => {
    expect(backoffMs!(1)).toBeGreaterThanOrEqual(0);
  });
});

describe.skipIf(typeof MAX_ATTEMPTS !== 'number')('MAX_ATTEMPTS — REQ-F004-013 inclusive-at-N park cap (rev-9 N2)', () => {
  it('is a positive integer >= 2 (at least one retry before park is meaningful)', () => {
    expect(Number.isInteger(MAX_ATTEMPTS)).toBe(true);
    expect(MAX_ATTEMPTS as number).toBeGreaterThanOrEqual(2);
  });
});
