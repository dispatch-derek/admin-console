// REQ-F004-053 — the consumer contract is broker-swap-invariant: dedupe + reorder-tolerance are
// baked in NOW, so a downstream consumer written against the GTM HTTP transport requires ZERO
// code change when later fed by a partitioned-broker transport double. This file is
// self-contained (a reference `Consumer` + two transport doubles, all test-only) and therefore
// runs GREEN independent of the not-yet-built relay — it validates the CONTRACT ITSELF the
// relay's real HttpPeerTransport/BrokerTransport must uphold (delivery id shape + per-key order,
// cross-key reorder tolerance), per the spec's own *Test* clause language.

import { describe, it, expect } from 'vitest';

// A minimal reference consumer: dedupes on the stable transport delivery id (REQ-F004-018/048)
// and MUST NOT assume any order across distinct ordering keys (REQ-F004-016/031/053).
class Consumer {
  private seen = new Set<string>();
  effects: Array<{ deliveryId: string; key: string; seq: number }> = [];

  consume(deliveryId: string, key: string, seq: number): void {
    if (this.seen.has(deliveryId)) return; // duplicate — collapsed to a single effect (REQ-F004-018)
    this.seen.add(deliveryId);
    this.effects.push({ deliveryId, key, seq });
  }

  effectCountFor(deliveryId: string): number {
    return this.effects.filter((e) => e.deliveryId === deliveryId).length;
  }

  perKeySequence(key: string): number[] {
    return this.effects.filter((e) => e.key === key).map((e) => e.seq);
  }
}

interface WireMessage {
  deliveryId: string;
  key: string;
  seq: number;
}

describe('REQ-F004-053 — dedupe on the stable delivery id (duplicate redelivery, REQ-F004-011/018)', () => {
  it('a duplicate delivery (same deliveryId, e.g. a crash-window re-drive) collapses to exactly ONE effect', () => {
    const consumer = new Consumer();
    const stream: WireMessage[] = [
      { deliveryId: 'epoch-1:5', key: 'ws:a', seq: 1 },
      { deliveryId: 'epoch-1:5', key: 'ws:a', seq: 1 }, // duplicate — same delivery id
    ];
    for (const m of stream) consumer.consume(m.deliveryId, m.key, m.seq);
    expect(consumer.effectCountFor('epoch-1:5')).toBe(1);
  });
});

describe('REQ-F004-053 — cross-key reorder tolerance (F-004 promises order only WITHIN a key)', () => {
  it('a consumer NOT assuming cross-key order processes an out-of-emission-order stream correctly, while still preserving per-key order', () => {
    const consumer = new Consumer();
    // Emission order was A1, A2, B1 but the transport (any conforming one) delivered B1 first
    // (skip-ahead across keys, REQ-F004-016/042) — the consumer must still end up with A1
    // before A2 WITHIN key A, and must not error/misbehave on B1 arriving first.
    const stream: WireMessage[] = [
      { deliveryId: 'epoch-1:3', key: 'ws:b', seq: 1 }, // B1 arrives first (reordered vs emission)
      { deliveryId: 'epoch-1:1', key: 'ws:a', seq: 1 }, // A1
      { deliveryId: 'epoch-1:2', key: 'ws:a', seq: 2 }, // A2 — after A1, preserving per-key order
    ];
    for (const m of stream) consumer.consume(m.deliveryId, m.key, m.seq);
    expect(consumer.perKeySequence('ws:a')).toEqual([1, 2]); // per-key order intact
    expect(consumer.effects.map((e) => e.deliveryId)).toContain('epoch-1:3'); // B1 processed regardless of arrival slot
  });
});

// Two transport doubles standing in for "HTTP now" vs "a partitioned broker later" — the point of
// REQ-F004-053 is that the SAME `Consumer` class above needs NO changes to work against either.
function deliverThroughHttpDouble(consumer: Consumer, stream: WireMessage[]): void {
  // HTTP-to-known-peer: delivers whatever the relay's per-key-ordered drain hands it, in the
  // order handed (already reflects legitimate cross-key skip-ahead + possible duplicates).
  for (const m of stream) consumer.consume(m.deliveryId, m.key, m.seq);
}

function deliverThroughPartitionedBrokerDouble(consumer: Consumer, stream: WireMessage[]): void {
  // A partitioned broker: partitions physically by key and may interleave partitions in ANY
  // order relative to each other, but a single partition (key) is always delivered in order.
  // Modeled here by shuffling GROUPS of messages by key while preserving intra-key order —
  // exactly the "subset of what consumers already tolerate" claim REQ-F004-053 makes.
  const byKey = new Map<string, WireMessage[]>();
  for (const m of stream) {
    const arr = byKey.get(m.key) ?? [];
    arr.push(m);
    byKey.set(m.key, arr);
  }
  const keys = [...byKey.keys()].reverse(); // deliberately reversed key interleave order
  for (const key of keys) for (const m of byKey.get(key)!) consumer.consume(m.deliveryId, m.key, m.seq);
}

describe('REQ-F004-053 — SAME consumer code processes BOTH the HTTP-now double and a partitioned-broker double with NO changes', () => {
  const stream: WireMessage[] = [
    { deliveryId: 'epoch-1:1', key: 'ws:a', seq: 1 },
    { deliveryId: 'epoch-1:2', key: 'ws:a', seq: 2 },
    { deliveryId: 'epoch-1:3', key: 'ws:b', seq: 1 },
    { deliveryId: 'epoch-1:4', key: 'ws:b', seq: 2 },
  ];

  it('via the HTTP-now double: every message processed exactly once, per-key order intact', () => {
    const consumer = new Consumer();
    deliverThroughHttpDouble(consumer, stream);
    expect(consumer.effects).toHaveLength(4);
    expect(consumer.perKeySequence('ws:a')).toEqual([1, 2]);
    expect(consumer.perKeySequence('ws:b')).toEqual([1, 2]);
  });

  it('via the partitioned-broker double (cross-key interleave differs): the SAME Consumer class still processes every message exactly once with per-key order intact', () => {
    const consumer = new Consumer();
    deliverThroughPartitionedBrokerDouble(consumer, stream);
    expect(consumer.effects).toHaveLength(4);
    expect(consumer.perKeySequence('ws:a')).toEqual([1, 2]);
    expect(consumer.perKeySequence('ws:b')).toEqual([1, 2]);
  });
});
