# Prioritization run — 2026-07-23

Workbook: `feature-value-scoring.xlsx` · weights `Config!B9 = OK` · cut line: none · dry-run: no
Snapshot: `input.xlsx` in this directory.

## What this run did
Two newly-logged Defect rows (D-007, D-008) were triaged (human severity), research-scored
(reach/confidence), ranked into the unified list, and status-written. All other rows were already
Prioritized/Deferred/Implemented and left untouched.

## Ranked list (Features + Defects together, post-recalc)
| rank | score | id | type | status | note |
|---|---|---|---|---|---|
| 1 | 85 | D-003 | Defect | Prioritized | sev5 chat-history JSON leak (unchanged) |
| **2** | **76** | **D-007** | **Defect** | **Scored (HELD)** | **sev5; awaits human sign-off** |
| 3 | 46.2 | F-001 | Feature | Prioritized | unchanged |
| **4** | **39.2** | **D-008** | **Defect** | **Prioritized** | **sev3 observability gap (NEW)** |
| 5 | 36.4 | F-007 | Feature | Prioritized | unchanged |
| 6 | 31.3 | F-010 | Feature | Implemented | out of scope |
| 7 | 29.7 | D-001 | Defect | Prioritized | unchanged |
| 8 | 24.2 | D-002 | Defect | Prioritized | unchanged |
| 9 | 22.1 | F-008 | Feature | Prioritized | unchanged |
| 10 | 21.4 | D-006 | Defect | Prioritized | relay https-only/mTLS hardening (D-007 overlap) |
| 11 | 21.1 | F-005 | Feature | Implemented | out of scope |
| 12 | 20.5 | F-003 | Feature | Prioritized | unchanged |
| 13 | 17.3 | F-002 | Feature | Prioritized | unchanged |
| 14 | 12.9 | F-006 | Feature | Prioritized | unchanged |
| 15 | 10 | F-004 | Feature | Implemented | out of scope |
| 16 | 9.9 | F-009 | Feature | Prioritized | unchanged |
| 17 | 9.5 | F-011 | Feature | Deferred | unchanged |
| 18 | 8 | D-004 | Defect | Prioritized | unchanged |
| 19 | 7.7 | F-012 | Feature | Deferred | unchanged |
| 20 | 7.5 | D-005 | Defect | Prioritized | unchanged |
| 21 | 6 | F-013 | Feature | Deferred | unchanged |

## Scoring detail (this run)
- **D-007** — sev5, reach2, confidence9 → 100 × 0.8 × 0.95 = **76** (rank 2). Cleartext transmission
  of the F-010 shared-secret credential over `http://` peers; exposure gated behind bus-mode relay
  + http:// peer + on-path observer (README ships http:// examples). confidence held at 9 (code-certain,
  no live packet capture).
- **D-008** — sev3, reach1, confidence9 → 55 × 0.75 × 0.95 = **39.2** (rank 4). Partially-delivered-park
  signal is in-process only. Re-verify correction: `getCounters()` exists at metrics.ts:66-68 but is
  dead code (no consumers) → still unobservable; fix is smaller (wire the existing getter).

## Review flags (await human decision)
1. **D-007 — severity=5 mandatory sign-off (HELD at Scored).** The formula already ranks it #2, but a
   one-way-door security exposure needs an explicit human call: prioritize for immediate remediation
   (and does an interim mitigation — force https/mTLS on the peer channel — need to ship first)? Not a
   Won't-Fix candidate on the agent's part; that call is the human's alone.
2. **D-007 ↔ D-006 scope overlap.** D-006 (rank 10) is the broader relay https-only/mTLS hardening row;
   D-007 is the specific cleartext-credential instance within that surface. Decide: fold D-007's fix into
   D-006's scope, or fix D-007 as a narrow urgent patch and keep D-006 separate? Prioritizing D-007 alone
   risks duplicating D-006 work or leaving D-006 under-prioritized once the visible symptom is patched.

## Other lists
- **BLOCKED:** none remaining (D-007/D-008 were the blocked Reported defects; both triaged this run).
- **HUMAN-GATE leftovers:** none (severity supplied for both defects).
- **STALE (>90d):** none.
- **IN-FLIGHT (out of scope, count):** 3 — F-004, F-005, F-010 (Implemented).
- **CANCELLED:** 0.
- **Contract violations:** none (both research agents proposed only permitted fields).

## Config used
weights Reach .20 / UserValue .25 / BizValue .25 / Strategic .20 / TimeSens .10; confidence & risk maps
per Config; defect fast-track severity_base + reach_factor + confidence_mult. Cut line: none. Dry-run: no.
