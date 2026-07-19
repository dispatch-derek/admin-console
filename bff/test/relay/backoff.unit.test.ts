// White-box unit tests for bff/src/relay/backoff.ts — supplements bff/test/relay/backoff.test.ts
// (qa-engineer's spec-level suite, NOT modified here). Targets the one branch v8 coverage showed
// unexercised by the spec suite: the `attemptNumber < 1` clamp on line 18
// (`const n = attemptNumber < 1 ? 1 : attemptNumber;`) — the spec suite only ever calls
// backoffMs with attempt >= 1. Also pins the exact documented constants of record (BASE_MS=1000,
// FACTOR=2, CAP_MS=30000, MAX_ATTEMPTS=8) read directly from the source — these are
// implementation-chosen "constants of record" per the module's own header comment, not spec-
// pinned values, so this file documents/locks in the CURRENT values rather than asserting the
// spec requires them.

import { describe, it, expect } from 'vitest';

const { backoffMs, MAX_ATTEMPTS } = await import('../../src/relay/backoff.js');

describe('backoffMs — attemptNumber < 1 clamp (backoff.ts:18, branch not hit by attempt>=1 inputs)', () => {
  it('attemptNumber 0 is clamped to the same delay as attemptNumber 1', () => {
    expect(backoffMs(0)).toBe(backoffMs(1));
  });

  it('a negative attemptNumber is clamped to the same delay as attemptNumber 1', () => {
    expect(backoffMs(-1)).toBe(backoffMs(1));
    expect(backoffMs(-100)).toBe(backoffMs(1));
  });

  it('a non-integer attemptNumber (e.g. 0.5) is NOT clamped (0.5 is not < 1... wait it is < 1) -> clamps to attempt-1 delay', () => {
    // 0.5 < 1, so the clamp fires; documents current behavior rather than asserting a spec pin.
    expect(backoffMs(0.5)).toBe(backoffMs(1));
  });
});

describe('backoffMs — exact capped-exponential schedule (documented constants of record)', () => {
  it('attempt 1..5 double each time from a 1000ms base (BASE_MS=1000, FACTOR=2)', () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
    expect(backoffMs(4)).toBe(8_000);
    expect(backoffMs(5)).toBe(16_000);
  });

  it('attempt 6 would be 32000ms uncapped but saturates at the 30000ms cap (CAP_MS=30000)', () => {
    expect(backoffMs(6)).toBe(30_000);
  });

  it('every attempt from the cap point through MAX_ATTEMPTS stays pinned at the cap (no further growth)', () => {
    for (let attempt = 6; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(backoffMs(attempt)).toBe(30_000);
    }
  });

  it('well past MAX_ATTEMPTS the schedule remains capped forever (does not overflow/grow)', () => {
    expect(backoffMs(50)).toBe(30_000);
    expect(backoffMs(1000)).toBe(30_000);
  });
});

describe('MAX_ATTEMPTS — documented constant of record', () => {
  it('is exactly 8 (current documented value; inclusive-at-N park cap)', () => {
    expect(MAX_ATTEMPTS).toBe(8);
  });
});
