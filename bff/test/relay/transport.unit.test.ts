// White-box unit tests for bff/src/relay/transport.ts's createTransport factory — supplements
// bff/test/relay/transport.test.ts (qa-engineer's spec-level suite, NOT modified here). The
// factory's branches are already 100%-branch-covered by the spec suite (http / broker / unknown
// kind); this file adds boundary-value inputs on the SAME branches that are worth pinning
// explicitly as documented behavior: strict string equality (case sensitivity) and the
// nullish-vs-empty-string distinction in `opts.kind ?? 'http'`.

import { describe, it, expect } from 'vitest';

const { createTransport, TransportError } = await import('../../src/relay/transport.js');

describe('createTransport — kind is matched by STRICT equality, not case-insensitively', () => {
  it('kind "HTTP" (uppercase) does NOT match the "http" branch — refuses like any unknown kind', () => {
    expect(() => createTransport({ kind: 'HTTP', peerUrls: ['http://peer.example'] })).toThrow(
      /unknown EVENT_BUS_TRANSPORT/i,
    );
  });

  it('kind "Broker" (mixed case) does NOT match the "broker" hard-refuse branch — falls to the generic unknown-kind refusal, prefixed "unknown EVENT_BUS_TRANSPORT"', () => {
    expect(() => createTransport({ kind: 'Broker', peerUrls: [] })).toThrow(/^unknown EVENT_BUS_TRANSPORT 'Broker'/);
  });
});

describe('createTransport — kind nullish-coalescing default (opts.kind ?? "http")', () => {
  it('kind: "" (empty string, distinct from undefined) is NOT defaulted to "http" — refuses as an unknown kind', () => {
    // `?? 'http'` only substitutes on null/undefined; an explicit empty string passes through.
    expect(() => createTransport({ kind: '', peerUrls: ['http://peer.example'] })).toThrow(
      /unknown EVENT_BUS_TRANSPORT ''/,
    );
  });

  it('kind: undefined IS defaulted to "http"', () => {
    const t = createTransport({ kind: undefined, peerUrls: ['http://peer.example'] });
    expect(typeof t.deliver).toBe('function');
  });
});

describe('createTransport — http with an empty peerUrls array constructs without throwing', () => {
  it('does not validate peer-list non-emptiness itself (that is config.ts\'s REQ-F004-045 concern)', () => {
    expect(() => createTransport({ kind: 'http', peerUrls: [] })).not.toThrow();
  });
});

describe('TransportError — constructor edge values', () => {
  it('accepts an empty message string', () => {
    const e = new TransportError('', 'transient');
    expect(e.message).toBe('');
    expect(e.classification).toBe('transient');
  });

  it('name is "TransportError" (distinguishable from a generic Error in a catch block)', () => {
    const e = new TransportError('x', 'permanent');
    expect(e.name).toBe('TransportError');
  });
});
