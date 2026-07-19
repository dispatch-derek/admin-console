// bff/src/relay/backoff.ts — capped-exponential backoff schedule + MAX_ATTEMPTS, the F-004
// constants of record (spec REQ-F004-013/032). The spec pins the SHAPE — capped exponential
// (base, factor, cap) with a max-attempt cap that is INCLUSIVE at the Nth failure — and leaves
// the concrete values to the implementer as documented constants (design §5 open question #2).

// Documented constants of record (provisional, tuned against the REQ-F004-027 SLO):
const BASE_MS = 1_000; // first retry delay
const FACTOR = 2; // exponential growth factor
const CAP_MS = 30_000; // ceiling — the schedule never grows past this

// Max delivery attempts before a never-acked row is parked (REQ-F004-014). INCLUSIVE at N: the
// Nth failure trips the cap (rev-9 N2). A delivery failure OR a persistent post-ack mark failure
// counts toward this (REQ-F004-011/013); a successful ack does NOT reset it.
export const MAX_ATTEMPTS = 8;

// 1-based attempt number → delay before the NEXT attempt, capped. Monotonically non-decreasing.
export function backoffMs(attemptNumber: number): number {
  const n = attemptNumber < 1 ? 1 : attemptNumber;
  const raw = BASE_MS * FACTOR ** (n - 1);
  return Math.min(raw, CAP_MS);
}
