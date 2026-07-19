// White-box unit tests for bff/src/events/ordering-key.ts's deriveOrderingKey — supplements
// bff/test/events/ordering-key.test.ts (qa-engineer's spec-level suite, NOT modified here).
// Targets branches read directly from the source that the spec-level suite's 21-fixture sweep
// does not independently exercise:
//   - name typeof guard (line 20): a non-string / missing `event` must short-circuit to
//     __unkeyed__ BEFORE any `.startsWith` call (a non-string would throw on .startsWith).
//   - target nullish-coalescing (line 21): envelope.target entirely absent.
//   - admin.workspace_user.* UNKEYED fallback (line 32) — the qa suite always supplies
//     target.workspace, so the missing/empty-field ternary branch is unexercised.
//   - admin.invite.* UNKEYED fallback (line 37) — likewise, qa's fixtures always populate
//     target.id for invites.
// This file never imports/edits bff/src/**; it only reads it to target these branches.

import { describe, it, expect } from 'vitest';

const { deriveOrderingKey } = await import('../../src/events/ordering-key.js');

describe('deriveOrderingKey — name-guard totality (ordering-key.ts:20)', () => {
  it('a numeric `event` (non-string) resolves to __unkeyed__ without throwing', () => {
    expect(() => deriveOrderingKey({ event: 42 as unknown as string, target: { id: 'x' } })).not.toThrow();
    expect(deriveOrderingKey({ event: 42 as unknown as string, target: { id: 'x' } })).toBe('__unkeyed__');
  });

  it('a completely missing `event` key resolves to __unkeyed__', () => {
    expect(deriveOrderingKey({} as { event?: unknown })).toBe('__unkeyed__');
  });

  it('event: null resolves to __unkeyed__', () => {
    expect(deriveOrderingKey({ event: null as unknown as string })).toBe('__unkeyed__');
  });

  it('event: "" (empty string) is a valid string that matches no family prefix -> __unkeyed__', () => {
    expect(deriveOrderingKey({ event: '' })).toBe('__unkeyed__');
  });
});

describe('deriveOrderingKey — target nullish-coalescing (ordering-key.ts:21)', () => {
  it('envelope.target entirely absent (undefined) falls back to __unkeyed__, never throws', () => {
    expect(() => deriveOrderingKey({ event: 'admin.workspace.updated' })).not.toThrow();
    expect(deriveOrderingKey({ event: 'admin.workspace.updated' })).toBe('__unkeyed__');
  });

  it('envelope.target: null falls back to __unkeyed__', () => {
    expect(deriveOrderingKey({ event: 'admin.user.created', target: null })).toBe('__unkeyed__');
  });
});

describe('deriveOrderingKey — admin.workspace_user.* UNKEYED fallback (ordering-key.ts:32)', () => {
  it('a missing target.workspace resolves to __unkeyed__, never "ws:undefined"', () => {
    const key = deriveOrderingKey({ event: 'admin.workspace_user.assigned', target: { user: 'u-1' } });
    expect(key).toBe('__unkeyed__');
    expect(key).not.toContain('undefined');
  });

  it('an empty-string target.workspace resolves to __unkeyed__', () => {
    expect(deriveOrderingKey({ event: 'admin.workspace_user.unassigned', target: { workspace: '', user: 'u-1' } })).toBe(
      '__unkeyed__',
    );
  });
});

describe('deriveOrderingKey — admin.invite.* UNKEYED fallback (ordering-key.ts:37)', () => {
  it('a missing target.id resolves to __unkeyed__, never "invite:undefined"', () => {
    const key = deriveOrderingKey({ event: 'admin.invite.created', target: {} });
    expect(key).toBe('__unkeyed__');
    expect(key).not.toContain('undefined');
  });

  it('an empty-string target.id resolves to __unkeyed__', () => {
    expect(deriveOrderingKey({ event: 'admin.invite.revoked', target: { id: '' } })).toBe('__unkeyed__');
  });

  it('a non-empty target.id resolves to invite:<id> (sanity control for the branch above)', () => {
    expect(deriveOrderingKey({ event: 'admin.invite.created', target: { id: 'inv-9' } })).toBe('invite:inv-9');
  });
});

describe('deriveOrderingKey — field() totality over non-string/non-number target values', () => {
  it('a boolean target field is not a usable key component -> __unkeyed__ (not "ws:true")', () => {
    expect(deriveOrderingKey({ event: 'admin.workspace.updated', target: { id: true } })).toBe('__unkeyed__');
  });

  it('an object target field is not a usable key component -> __unkeyed__', () => {
    expect(deriveOrderingKey({ event: 'admin.user.updated', target: { id: { nested: true } } })).toBe('__unkeyed__');
  });

  it('an array target field is not a usable key component -> __unkeyed__', () => {
    expect(deriveOrderingKey({ event: 'admin.user.updated', target: { id: ['a', 'b'] } })).toBe('__unkeyed__');
  });

  it('a numeric 0 target field IS usable (numbers are accepted regardless of falsy-ness)', () => {
    expect(deriveOrderingKey({ event: 'admin.workspace.updated', target: { id: 0 } })).toBe('ws:0');
  });
});
