// White-box unit tests for the F-002 baseline store repository
// (src/store/repositories/baseline.repo.ts), exercised directly against the repo's own API
// (not raw SQL — that schema-shape contract is covered by test/store/baseline-migration.test.ts)
// and not through any route. Targets: singleton upsert semantics for baseline_prompt, the
// "not defined" read-before-write contract, upsertAppliedState's explicit F-002-owned column
// list (REQ-F002-010d — it must NEVER touch composition_mode, on either insert or update), and
// orphan-row cleanup via deleteState (REQ-F002-051).

import { describe, it, expect, beforeEach } from 'vitest';
import { baselineRepo } from '../../../src/store/repositories/baseline.repo.js';
import { db } from '../../../src/store/db.js';

beforeEach(() => {
  db.exec('DELETE FROM baseline_prompt; DELETE FROM workspace_baseline_state;');
});

describe('baselineRepo.getBaseline / setBaseline / clearBaseline — singleton semantics', () => {
  it('reading before any write returns "not defined" (null text, null metadata)', () => {
    expect(baselineRepo.getBaseline()).toEqual({ text: null, updated_at: null, updated_by: null });
  });

  it('setBaseline persists text + metadata and getBaseline reflects it', () => {
    baselineRepo.setBaseline('You are a helpful assistant.', 'staff-1', '2026-07-09T00:00:00.000Z');
    expect(baselineRepo.getBaseline()).toEqual({
      text: 'You are a helpful assistant.',
      updated_at: '2026-07-09T00:00:00.000Z',
      updated_by: 'staff-1',
    });
  });

  it('a second setBaseline call REPLACES the singleton row rather than adding a second row', () => {
    baselineRepo.setBaseline('first', 'staff-1', '2026-07-09T00:00:00.000Z');
    baselineRepo.setBaseline('second', 'staff-2', '2026-07-09T00:00:01.000Z');
    expect(baselineRepo.getBaseline()).toEqual({
      text: 'second',
      updated_at: '2026-07-09T00:00:01.000Z',
      updated_by: 'staff-2',
    });
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM baseline_prompt`).get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('clearBaseline sets text to NULL but keeps updated_at/updated_by current (an audited clear, not a delete)', () => {
    baselineRepo.setBaseline('defined', 'staff-1', '2026-07-09T00:00:00.000Z');
    baselineRepo.clearBaseline('staff-2', '2026-07-09T01:00:00.000Z');
    expect(baselineRepo.getBaseline()).toEqual({
      text: null,
      updated_at: '2026-07-09T01:00:00.000Z',
      updated_by: 'staff-2',
    });
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM baseline_prompt`).get() as { n: number }).n;
    expect(count).toBe(1); // still one singleton row, not deleted
  });

  it('clearBaseline on a never-defined baseline is a harmless no-op that still leaves exactly one row', () => {
    baselineRepo.clearBaseline('staff-1', '2026-07-09T00:00:00.000Z');
    expect(baselineRepo.getBaseline().text).toBeNull();
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM baseline_prompt`).get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('setBaseline after a clear redefines the baseline (clear is not terminal)', () => {
    baselineRepo.setBaseline('first', 'staff-1', '2026-07-09T00:00:00.000Z');
    baselineRepo.clearBaseline('staff-1', '2026-07-09T00:00:01.000Z');
    baselineRepo.setBaseline('redefined', 'staff-1', '2026-07-09T00:00:02.000Z');
    expect(baselineRepo.getBaseline().text).toBe('redefined');
  });
});

describe('baselineRepo.getState / listStates', () => {
  it('getState returns undefined for a workspace with no tracking row', () => {
    expect(baselineRepo.getState('ws-unknown')).toBeUndefined();
  });

  it('listStates returns an empty array when no workspace has been applied to', () => {
    expect(baselineRepo.listStates()).toEqual([]);
  });

  it('listStates returns every tracked row', () => {
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-1',
      remainder: 'R1',
      applied_composed_hash: 'hash-1',
      applied_baseline_hash: 'bhash-1',
      applied_at: '2026-07-09T00:00:00.000Z',
    });
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-2',
      remainder: null,
      applied_composed_hash: 'hash-2',
      applied_baseline_hash: 'bhash-2',
      applied_at: '2026-07-09T00:00:01.000Z',
    });
    const states = baselineRepo.listStates();
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.workspace_id).sort()).toEqual(['ws-1', 'ws-2']);
  });
});

describe('baselineRepo.upsertAppliedState — REQ-F002-010d explicit F-002-owned column list', () => {
  it('an insert (first apply) leaves composition_mode NULL (F-002 never defaults it)', () => {
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-1',
      remainder: 'R',
      applied_composed_hash: 'hash-1',
      applied_baseline_hash: 'bhash-1',
      applied_at: '2026-07-09T00:00:00.000Z',
    });
    const state = baselineRepo.getState('ws-1');
    expect(state?.composition_mode).toBeNull();
  });

  it('a re-apply UPDATE overwrites remainder/hashes/applied_at but NEVER touches an existing composition_mode value (co-written row, F-003 owns that column)', () => {
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-1',
      remainder: 'R-old',
      applied_composed_hash: 'hash-old',
      applied_baseline_hash: 'bhash-old',
      applied_at: '2026-07-09T00:00:00.000Z',
    });
    // Simulate F-003 stamping composition_mode directly onto the shared row (F-002 never writes
    // this column itself — this models F-003's own write path, REQ-F002-010d).
    db.prepare(`UPDATE workspace_baseline_state SET composition_mode = ? WHERE workspace_id = ?`).run(
      'append',
      'ws-1',
    );
    expect(baselineRepo.getState('ws-1')?.composition_mode).toBe('append');

    // A subsequent F-002 re-apply (upsertAppliedState UPDATE branch) must leave that F-003 value
    // completely untouched.
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-1',
      remainder: 'R-new',
      applied_composed_hash: 'hash-new',
      applied_baseline_hash: 'bhash-new',
      applied_at: '2026-07-09T01:00:00.000Z',
    });
    const state = baselineRepo.getState('ws-1');
    expect(state?.remainder).toBe('R-new');
    expect(state?.applied_composed_hash).toBe('hash-new');
    expect(state?.applied_baseline_hash).toBe('bhash-new');
    expect(state?.applied_at).toBe('2026-07-09T01:00:00.000Z');
    expect(state?.composition_mode).toBe('append'); // untouched
  });

  it('upsertAppliedState with a null remainder is stored and read back as null (not coerced to empty string)', () => {
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-1',
      remainder: null,
      applied_composed_hash: 'hash-1',
      applied_baseline_hash: 'bhash-1',
      applied_at: '2026-07-09T00:00:00.000Z',
    });
    expect(baselineRepo.getState('ws-1')?.remainder).toBeNull();
  });

  it('upserting two distinct workspace ids creates two independent rows', () => {
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-1',
      remainder: 'R1',
      applied_composed_hash: 'h1',
      applied_baseline_hash: 'bh1',
      applied_at: '2026-07-09T00:00:00.000Z',
    });
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-2',
      remainder: 'R2',
      applied_composed_hash: 'h2',
      applied_baseline_hash: 'bh2',
      applied_at: '2026-07-09T00:00:01.000Z',
    });
    expect(baselineRepo.getState('ws-1')?.remainder).toBe('R1');
    expect(baselineRepo.getState('ws-2')?.remainder).toBe('R2');
  });
});

describe('baselineRepo.deleteState — REQ-F002-051 orphan cleanup', () => {
  it('deletes the tracking row for the given workspace id only', () => {
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-1',
      remainder: 'R1',
      applied_composed_hash: 'h1',
      applied_baseline_hash: 'bh1',
      applied_at: '2026-07-09T00:00:00.000Z',
    });
    baselineRepo.upsertAppliedState({
      workspace_id: 'ws-2',
      remainder: 'R2',
      applied_composed_hash: 'h2',
      applied_baseline_hash: 'bh2',
      applied_at: '2026-07-09T00:00:01.000Z',
    });
    baselineRepo.deleteState('ws-1');
    expect(baselineRepo.getState('ws-1')).toBeUndefined();
    expect(baselineRepo.getState('ws-2')).toBeDefined();
  });

  it('deleting a workspace id with no row is a harmless no-op', () => {
    expect(() => baselineRepo.deleteState('never-existed')).not.toThrow();
    expect(baselineRepo.listStates()).toEqual([]);
  });
});
