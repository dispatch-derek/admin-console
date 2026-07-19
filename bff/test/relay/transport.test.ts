// bff/src/relay/transport.ts — the EventTransport interface + TransportError + the
// EVENT_BUS_TRANSPORT factory branch (spec REQ-F004-049/050/052; design §2.1, §1.1).
//
// ASSUMED EXPORTS (design §1.1: "The EventTransport interface + the EVENT_BUS_TRANSPORT factory
// (`http` -> HttpPeerTransport; `broker` -> hard-refuse in this build)"; §2.1 pins TransportError's
// shape exactly):
//   export class TransportError extends Error { readonly classification: 'transient' | 'permanent'; }
//   export function createTransport(opts: { kind: string | undefined; peerUrls: string[] }): EventTransport

import { describe, it, expect } from 'vitest';

const mod = await import('../../src/relay/transport.js').catch((e: unknown) => ({ __importError: e as Error }));
type TransportMod = {
  TransportError?: new (message: string, classification: 'transient' | 'permanent') => Error;
  createTransport?: (opts: { kind: string | undefined; peerUrls: string[] }) => { deliver: (...a: unknown[]) => Promise<void> };
};
const { TransportError, createTransport } = mod as TransportMod;

describe('transport.ts — module resolution', () => {
  it('exists and exports TransportError + createTransport', () => {
    if ((mod as { __importError?: Error }).__importError) {
      expect.fail(`bff/src/relay/transport.ts does not exist yet — expected pre-implementation RED signal.`);
    }
    expect(typeof TransportError).toBe('function');
    expect(typeof createTransport).toBe('function');
  });
});

describe.skipIf(!TransportError)('TransportError — REQ-F004-043(c)/047 permanent-vs-transient classification carrier', () => {
  it('carries a classification of "transient" or "permanent"', () => {
    const t = new TransportError!('boom', 'transient');
    const p = new TransportError!('boom', 'permanent');
    expect(t.classification).toBe('transient');
    expect(p.classification).toBe('permanent');
  });

  it('is a real Error (message + stack)', () => {
    const e = new TransportError!('nope', 'permanent');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('nope');
  });
});

describe.skipIf(!createTransport)('createTransport — EVENT_BUS_TRANSPORT selector (REQ-F004-050/052)', () => {
  it('kind "http" (or undefined, default) selects a transport exposing deliver()', () => {
    const t1 = createTransport!({ kind: 'http', peerUrls: ['http://peer-a.example'] });
    const t2 = createTransport!({ kind: undefined, peerUrls: ['http://peer-a.example'] });
    expect(typeof t1.deliver).toBe('function');
    expect(typeof t2.deliver).toBe('function');
  });

  it('kind "broker" HARD-REFUSES — "broker transport not available in this build" (REQ-F004-052(3), rev-9/rev-10)', () => {
    expect(() => createTransport!({ kind: 'broker', peerUrls: ['http://peer-a.example'] })).toThrow(
      /broker transport not available in this build/i,
    );
  });

  it('an out-of-set kind value also refuses (same closed-set posture as EVENT_BUS_MODE, REQ-F004-046)', () => {
    expect(() => createTransport!({ kind: 'kafka', peerUrls: ['http://peer-a.example'] })).toThrow();
  });

  it('the "broker" refusal is environment-independent — throws identically whether NODE_ENV is production or development (rev-10 human ruling, deliberately NOT the REQ-F004-045 dev-soft posture)', () => {
    const prev = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      expect(() => createTransport!({ kind: 'broker', peerUrls: [] })).toThrow(/broker transport not available/i);
      process.env['NODE_ENV'] = 'development';
      expect(() => createTransport!({ kind: 'broker', peerUrls: [] })).toThrow(/broker transport not available/i);
      delete process.env['NODE_ENV'];
      expect(() => createTransport!({ kind: 'broker', peerUrls: [] })).toThrow(/broker transport not available/i);
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prev;
    }
  });
});
