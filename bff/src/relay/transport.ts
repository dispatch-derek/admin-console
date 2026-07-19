// bff/src/relay/transport.ts — the EventTransport seam (REQ-F004-049), TransportError
// (REQ-F004-043(c)/047), and the EVENT_BUS_TRANSPORT factory (REQ-F004-050/052; design §2.1/§1.1).
// This is the ONE narrow boundary the transport-agnostic drainer delivers through. NO HTTP
// specifics (client, status codes, peer list) live here — those belong to HttpPeerTransport.

import { HttpPeerTransport } from './http-peer-transport.js';

export interface EventTransport {
  // Resolves on FULL positive ack (gates markPublished, REQ-F004-012). Rejects with a
  // TransportError carrying the transient-vs-permanent classification (REQ-F004-047). `envelope`
  // is delivered byte-for-byte — the transport MUST NOT reshape/re-redact/drop fields (REQ-F004-002).
  deliver(envelope: string, deliveryId: string): Promise<void>;
  // Called by the orchestration layer on a TERMINAL row outcome (published OR parked) so a stateful
  // transport can evict per-deliveryId state (REQ-F004-051(c)). No-op for stateless transports.
  release?(deliveryId: string): void;
}

export class TransportError extends Error {
  readonly classification: 'transient' | 'permanent'; // REQ-F004-047

  constructor(message: string, classification: 'transient' | 'permanent') {
    super(message);
    this.name = 'TransportError';
    this.classification = classification;
  }
}

// Factory selected by the EVENT_BUS_TRANSPORT axis (REQ-F004-052), mirroring how getEventBus
// switches on EVENT_BUS_MODE. `http` → HttpPeerTransport (the single GTM implementation). `broker`
// → hard-refuse (no BrokerTransport exists in this build); any other value refuses likewise.
export function createTransport(opts: { kind: string | undefined; peerUrls: string[] }): EventTransport {
  const kind = opts.kind ?? 'http';
  if (kind === 'http') return new HttpPeerTransport(opts.peerUrls);
  if (kind === 'broker') {
    throw new Error('broker transport not available in this build (EVENT_BUS_TRANSPORT=broker)');
  }
  throw new Error(
    `unknown EVENT_BUS_TRANSPORT '${kind}' — only 'http' is available (broker transport not available in this build)`,
  );
}
