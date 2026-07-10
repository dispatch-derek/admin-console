// White-box unit tests for the pure F-002 composition/classification module
// (src/baseline/compose.ts), exercised directly — no HTTP, no DB, no engine, no mocks.
// The spec-level route tests (baseline-prompt.compose.test.ts / .resolution.test.ts) already
// pin the byte-exact contracts end-to-end through the route layer; this file targets branch/
// boundary coverage of the pure functions themselves: every branch of compose() across all 3
// modes x (empty/non-empty B) x (empty/non-empty R), unicode/very-long-string inputs, no
// mutation of inputs, the classifyState precedence order (including the "hash can't be stale
// when appliedComposedHash is null" branch), and NULL vs out-of-domain composition_mode
// handling in resolveEffectiveMode / classifyModeOf.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  SENTINEL,
  compose,
  deriveRemainderOnFirstApply,
  resolveEffectiveMode,
  classifyModeOf,
  effective,
  classifyState,
  isOperatorMode,
  isBlank,
  sha256Hex,
} from '../../src/baseline/compose.js';

describe('compose — prepend mode (REQ-F002-011)', () => {
  it('both B and R empty/null -> empty string', () => {
    expect(compose(null, null, 'prepend')).toBe('');
    expect(compose('', '', 'prepend')).toBe('');
    expect(compose(null, '', 'prepend')).toBe('');
    expect(compose('', null, 'prepend')).toBe('');
  });

  it('B empty/null, R non-empty -> R exactly (cleared baseline restores the remainder alone)', () => {
    expect(compose(null, 'Answer in French.', 'prepend')).toBe('Answer in French.');
    expect(compose('', 'Answer in French.', 'prepend')).toBe('Answer in French.');
  });

  it('B non-empty, R empty/null -> B exactly', () => {
    expect(compose('You are helpful.', null, 'prepend')).toBe('You are helpful.');
    expect(compose('You are helpful.', '', 'prepend')).toBe('You are helpful.');
  });

  it('both non-empty -> B + SENTINEL + R byte-for-byte', () => {
    const B = 'You are helpful.';
    const R = 'Answer only in French.';
    expect(compose(B, R, 'prepend')).toBe(B + SENTINEL + R);
  });

  it('does not mutate or trim the inputs (whitespace-padded B/R are preserved verbatim)', () => {
    const B = '  padded baseline  ';
    const R = '  padded remainder  ';
    expect(compose(B, R, 'prepend')).toBe(B + SENTINEL + R);
  });

  it('handles unicode (multi-byte, combining, emoji) inputs byte-exact', () => {
    const B = 'あなたは親切なアシスタントです。😀';
    const R = 'Répondez seulement en français. héllo';
    expect(compose(B, R, 'prepend')).toBe(B + SENTINEL + R);
    expect(compose(B, null, 'prepend')).toBe(B);
    expect(compose(null, R, 'prepend')).toBe(R);
  });

  it('handles very long strings without truncation', () => {
    const B = 'B'.repeat(200_000);
    const R = 'R'.repeat(200_000);
    const out = compose(B, R, 'prepend');
    expect(out.length).toBe(B.length + SENTINEL.length + R.length);
    expect(out.startsWith(B)).toBe(true);
    expect(out.endsWith(R)).toBe(true);
    expect(out.slice(B.length, B.length + SENTINEL.length)).toBe(SENTINEL);
  });
});

describe('compose — overwrite mode (REQ-F002-056)', () => {
  it('B non-empty -> B exactly, R (even non-empty, even sentinel-bearing) is completely ignored', () => {
    expect(compose('B-only', 'ignored remainder', 'overwrite')).toBe('B-only');
    expect(compose('B-only', 'x' + SENTINEL + 'y', 'overwrite')).toBe('B-only');
  });

  it('B empty/null -> R exactly (clear-then-apply strips the field regardless of mode)', () => {
    expect(compose(null, 'remainder', 'overwrite')).toBe('remainder');
    expect(compose('', 'remainder', 'overwrite')).toBe('remainder');
  });

  it('B empty/null AND R empty/null -> empty string', () => {
    expect(compose(null, null, 'overwrite')).toBe('');
    expect(compose('', '', 'overwrite')).toBe('');
  });
});

describe('compose — fill mode (REQ-F002-057)', () => {
  it('B non-empty -> B exactly, R ignored (contract: caller only ever passes R="" for fill)', () => {
    expect(compose('B-only', '', 'fill')).toBe('B-only');
    expect(compose('B-only', 'some other value', 'fill')).toBe('B-only');
  });

  it('B empty/null -> R (there is nothing to fill; caller decides to skip before calling)', () => {
    expect(compose(null, 'R', 'fill')).toBe('R');
    expect(compose('', 'R', 'fill')).toBe('R');
    expect(compose(null, null, 'fill')).toBe('');
  });
});

describe('deriveRemainderOnFirstApply — REQ-F002-012', () => {
  it('blank/empty/whitespace-only/null/undefined P -> empty remainder', () => {
    expect(deriveRemainderOnFirstApply(null)).toBe('');
    expect(deriveRemainderOnFirstApply(undefined as unknown as string | null)).toBe('');
    expect(deriveRemainderOnFirstApply('')).toBe('');
    expect(deriveRemainderOnFirstApply('   \n\t  ')).toBe('');
  });

  it('P with no sentinel is captured verbatim (operator-authored prompt preserved)', () => {
    expect(deriveRemainderOnFirstApply('Answer only in French.')).toBe('Answer only in French.');
  });

  it('P containing the sentinel: remainder is everything AFTER the first occurrence; the pre-sentinel segment (a prior baseline) is discarded', () => {
    const P = 'OLD_BASELINE' + SENTINEL + 'Y';
    expect(deriveRemainderOnFirstApply(P)).toBe('Y');
  });

  it('P containing the sentinel TWICE uses the FIRST occurrence as the split point (prevents a doubled baseline)', () => {
    const P = 'OLD_BASELINE' + SENTINEL + 'MIDDLE' + SENTINEL + 'TAIL';
    expect(deriveRemainderOnFirstApply(P)).toBe('MIDDLE' + SENTINEL + 'TAIL');
  });

  it('P that is exactly the sentinel with nothing after it -> empty remainder', () => {
    const P = 'OLD' + SENTINEL;
    expect(deriveRemainderOnFirstApply(P)).toBe('');
  });

  it('P that is exactly the sentinel with nothing before it -> remainder is everything after', () => {
    const P = SENTINEL + 'TAIL';
    expect(deriveRemainderOnFirstApply(P)).toBe('TAIL');
  });
});

describe('resolveEffectiveMode — REQ-F002-059 (preview/apply path only)', () => {
  it('stored "append" -> "prepend", regardless of the operator-selected mode', () => {
    expect(resolveEffectiveMode('prepend', 'append')).toBe('prepend');
    expect(resolveEffectiveMode('overwrite', 'append')).toBe('prepend');
    expect(resolveEffectiveMode('fill', 'append')).toBe('prepend');
  });

  it('stored "inherit" -> "baseline-only", regardless of the operator-selected mode', () => {
    expect(resolveEffectiveMode('prepend', 'inherit')).toBe('baseline-only');
    expect(resolveEffectiveMode('overwrite', 'inherit')).toBe('baseline-only');
    expect(resolveEffectiveMode('fill', 'inherit')).toBe('baseline-only');
  });

  it('stored NULL or undefined -> falls back to the operator-selected mode (backward-compat, REQ-F002-010d)', () => {
    expect(resolveEffectiveMode('prepend', null)).toBe('prepend');
    expect(resolveEffectiveMode('overwrite', null)).toBe('overwrite');
    expect(resolveEffectiveMode('fill', null)).toBe('fill');
    expect(resolveEffectiveMode('overwrite', undefined)).toBe('overwrite');
  });

  it('an out-of-domain stored value (e.g. "override", which F-003 never writes) falls back to the operator mode and NEVER selects overwrite through the stored-mode path (resolves R4-5/R5-N1)', () => {
    expect(resolveEffectiveMode('prepend', 'override')).toBe('prepend');
    expect(resolveEffectiveMode('fill', 'override')).toBe('fill');
    // Even when the operator DID select overwrite, an out-of-domain stored value just falls
    // through to that operator default — it never independently triggers destruction.
    expect(resolveEffectiveMode('overwrite', 'override')).toBe('overwrite');
    expect(resolveEffectiveMode('prepend', 'garbage-value')).toBe('prepend');
    expect(resolveEffectiveMode('prepend', '')).toBe('prepend');
  });
});

describe('classifyModeOf — REQ-F002-023 (status path only, no operator mode)', () => {
  it('"inherit" -> "baseline-only"', () => {
    expect(classifyModeOf('inherit')).toBe('baseline-only');
  });

  it('"append", NULL, undefined, and any out-of-domain value -> "prepend" (mode-agnostic reconstruction)', () => {
    expect(classifyModeOf('append')).toBe('prepend');
    expect(classifyModeOf(null)).toBe('prepend');
    expect(classifyModeOf(undefined)).toBe('prepend');
    expect(classifyModeOf('override')).toBe('prepend');
    expect(classifyModeOf('garbage')).toBe('prepend');
    expect(classifyModeOf('')).toBe('prepend');
  });
});

describe('effective — the current-baseline reconstruction used by classification', () => {
  it('"baseline-only" -> B alone (empty string when B is null), even when remainder is non-empty', () => {
    expect(effective('B', 'non-empty-remainder', 'baseline-only')).toBe('B');
    expect(effective(null, 'non-empty-remainder', 'baseline-only')).toBe('');
  });

  it('"prepend" -> compose(B, remainder, "prepend")', () => {
    expect(effective('B', 'R', 'prepend')).toBe(compose('B', 'R', 'prepend'));
    expect(effective('B', null, 'prepend')).toBe('B');
  });

  it('an empty remainder collapses every branch to B (or "" when B is null)', () => {
    expect(effective('B', '', 'prepend')).toBe('B');
    expect(effective('B', '', 'baseline-only')).toBe('B');
    expect(effective(null, '', 'prepend')).toBe('');
  });
});

describe('classifyState — REQ-F002-023 first-match-wins precedence', () => {
  const args = (overrides: Partial<Parameters<typeof classifyState>[0]>) => ({
    livePrompt: 'P',
    baseline: 'B',
    hasStateRow: true,
    remainder: null,
    appliedComposedHash: null,
    storedCompositionMode: null,
    ...overrides,
  });

  it('never-applied wins outright when there is no state row, regardless of every other field', () => {
    expect(
      classifyState(
        args({
          hasStateRow: false,
          livePrompt: 'B',
          appliedComposedHash: sha256Hex('B'),
        }),
      ),
    ).toBe('never-applied');
  });

  it('synced — live prompt equals the classifyMode reconstruction', () => {
    expect(
      classifyState(
        args({ livePrompt: 'B', baseline: 'B', remainder: null, storedCompositionMode: null }),
      ),
    ).toBe('synced');
  });

  it('synced beats stale when both predicates would technically match (precedence: synced is checked FIRST)', () => {
    // P equals the reconstruction (B) AND happens to equal sha256Hex(P)===appliedComposedHash too
    // (we set appliedComposedHash to hash('B') deliberately) — synced must win, not stale.
    const P = 'B';
    expect(
      classifyState(
        args({
          livePrompt: P,
          baseline: 'B',
          remainder: null,
          appliedComposedHash: sha256Hex(P),
        }),
      ),
    ).toBe('synced');
  });

  it('stale — live prompt does not match current reconstruction, but its hash matches applied_composed_hash (baseline changed after a clean apply)', () => {
    const lastComposed = 'B-old' /* the composed value written at the time of the last apply */;
    expect(
      classifyState(
        args({
          livePrompt: lastComposed,
          baseline: 'B-new', // baseline changed since that apply
          remainder: null,
          appliedComposedHash: sha256Hex(lastComposed),
        }),
      ),
    ).toBe('stale');
  });

  it('overridden — live prompt matches neither the reconstruction nor the applied hash', () => {
    expect(
      classifyState(
        args({
          livePrompt: 'someone typed this directly',
          baseline: 'B',
          remainder: 'R',
          appliedComposedHash: sha256Hex('B' + SENTINEL + 'R-old'),
        }),
      ),
    ).toBe('overridden');
  });

  it('a NULL applied_composed_hash can never match the stale predicate — falls straight to overridden (a workspace with a state row but no console-verified apply hash yet)', () => {
    expect(
      classifyState(
        args({
          livePrompt: 'anything at all',
          baseline: 'B',
          remainder: null,
          appliedComposedHash: null,
        }),
      ),
    ).toBe('overridden');
  });

  it('an out-of-domain stored composition_mode (e.g. "override") classifies exactly like NULL/"append" — via classifyMode "prepend"', () => {
    const P = compose('B', 'R', 'prepend');
    const withOutOfDomain = classifyState(
      args({ livePrompt: P, baseline: 'B', remainder: 'R', storedCompositionMode: 'override' }),
    );
    const withNull = classifyState(
      args({ livePrompt: P, baseline: 'B', remainder: 'R', storedCompositionMode: null }),
    );
    expect(withOutOfDomain).toBe('synced');
    expect(withOutOfDomain).toBe(withNull);
  });

  it('null vs empty-string remainder classify identically (both collapse via isEmpty)', () => {
    const withNull = classifyState(args({ livePrompt: 'B', baseline: 'B', remainder: null }));
    const withEmpty = classifyState(args({ livePrompt: 'B', baseline: 'B', remainder: '' }));
    expect(withNull).toBe('synced');
    expect(withEmpty).toBe('synced');
  });

  it('a null live prompt is treated as the empty string, not literal null (P ?? "")', () => {
    expect(
      classifyState(
        args({ livePrompt: null, baseline: null, remainder: null, appliedComposedHash: null }),
      ),
    ).toBe('synced'); // reconstruction of (null, null, prepend) is '' too
  });
});

describe('isOperatorMode', () => {
  it('accepts exactly the three documented operator modes', () => {
    expect(isOperatorMode('prepend')).toBe(true);
    expect(isOperatorMode('overwrite')).toBe(true);
    expect(isOperatorMode('fill')).toBe(true);
  });

  it('rejects out-of-domain strings, "baseline-only" (a resolved mode, not an operator mode), and non-string values', () => {
    expect(isOperatorMode('baseline-only')).toBe(false);
    expect(isOperatorMode('append')).toBe(false);
    expect(isOperatorMode('inherit')).toBe(false);
    expect(isOperatorMode('')).toBe(false);
    expect(isOperatorMode(undefined)).toBe(false);
    expect(isOperatorMode(null)).toBe(false);
    expect(isOperatorMode(42)).toBe(false);
    expect(isOperatorMode({})).toBe(false);
    expect(isOperatorMode(['prepend'])).toBe(false);
  });
});

describe('isBlank', () => {
  it('null, undefined, empty, and whitespace-only (including unicode-esque tab/newline mixes) are blank', () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('\t\n  \n')).toBe(true);
  });

  it('any non-whitespace content is not blank, including a single non-space char or padded content', () => {
    expect(isBlank('x')).toBe(false);
    expect(isBlank('  x  ')).toBe(false);
    expect(isBlank('0')).toBe(false);
  });
});

describe('sha256Hex — REQ-F002-010c hash algorithm', () => {
  it('matches the well-known SHA-256 digest of the empty string, lowercase hex', () => {
    expect(sha256Hex('')).toBe(createHash('sha256').update('', 'utf8').digest('hex'));
    expect(sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is computed over the exact UTF-8 bytes, matching node:crypto directly, for a unicode string', () => {
    const s = '日本語のプロンプト 😀';
    const expected = createHash('sha256').update(s, 'utf8').digest('hex');
    expect(sha256Hex(s)).toBe(expected);
  });

  it('a one-byte change produces a different digest', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });

  it('two calls with byte-identical input produce identical digests', () => {
    const s = 'identical content';
    expect(sha256Hex(s)).toBe(sha256Hex(s));
  });
});
