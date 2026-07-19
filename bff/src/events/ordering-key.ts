// bff/src/events/ordering-key.ts — pure, TOTAL deriveOrderingKey(envelope) (spec §3; design
// docs/design/09-F004-production-event-bus.md §3.3; REQ-F004-016/029/031). This is the single
// source of truth shared by the enqueue path (OutboxRelayBus.publish) and — byte-for-byte — the
// one-time migration backfill copy inlined in bff/src/store/db.ts's
// `deriveOrderingKeyForBackfill`. The two MUST agree so pre-F-004 rows (keyed by the backfill)
// and post-F-004 rows (keyed here) partition identically; if you touch either, reconcile both.
//
// Matches on the FULL dotted prefix INCLUDING the trailing '.' (spec §3 N6): 'admin.workspace_user.'
// must NOT be misparsed as 'admin.workspace.' — with the trailing dot the two prefixes are
// disjoint (after 'admin.workspace' the membership name has '_', not '.').

const UNKEYED = '__unkeyed__';

// The enqueue path (emitter.ts) holds the PARSED AdminEventEnvelope object (before JSON.stringify
// in OutboxRelayBus.publish), so this function takes the object, not a JSON string. It is total:
// any shape (missing event name, missing target field, unknown family) resolves to '__unkeyed__'
// and never throws / never yields a literal 'ws:undefined'.
export function deriveOrderingKey(envelope: { event?: unknown; target?: unknown }): string {
  const name = envelope?.event;
  if (typeof name !== 'string') return UNKEYED; // no usable event name → total fallback
  const target = (envelope.target ?? {}) as Record<string, unknown>;

  // A target field usable as a key component: a non-empty string or a number. Absent / empty /
  // array / object → null, which triggers the '__unkeyed__' totality fallback (never 'ws:undefined').
  const field = (k: string): string | null => {
    const v = target[k];
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string' && v.length > 0) return v;
    return null;
  };

  if (name.startsWith('admin.workspace_user.')) { const w = field('workspace'); return w ? `ws:${w}` : UNKEYED; }
  if (name.startsWith('admin.workspace.'))       { const id = field('id'); return id ? `ws:${id}` : UNKEYED; }
  if (name.startsWith('admin.user.'))            { const id = field('id'); return id ? `user:${id}` : UNKEYED; }
  if (name.startsWith('admin.instance.'))        return 'instance';
  if (name.startsWith('admin.raw_env.'))         return 'instance';           // instance-scoped config (MN4)
  if (name.startsWith('admin.invite.'))          { const id = field('id'); return id ? `invite:${id}` : UNKEYED; }
  if (name.startsWith('admin.baseline_prompt.')) return 'baseline';           // dedicated singleton (rev-7 Fix 1)
  if (name.startsWith('admin.feature_toggle.'))  return UNKEYED;              // intentional (F-005 REQ-F005-052)
  return UNKEYED;                                                             // no rule → __unkeyed__
}
