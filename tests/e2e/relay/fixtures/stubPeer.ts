// Ephemeral localhost HTTP peer double for HttpPeerTransport (bff/src/relay/http-peer-transport.ts).
// A real `node:http` server on a real OS-assigned port -- the relay's `fetch()` POST hits this
// exactly as it would hit a real peer. Every received request is recorded (method, headers, raw
// body, parsed JSON) so tests can assert byte-for-byte envelope delivery. Response behavior is
// scriptable per test (status code queues, hangs, always-status) to drive retry/park/crash
// journeys deterministically -- no sleep()-based flakiness.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface PeerRequest {
  deliveryId: string;
  rawBody: string;
  envelope: unknown;
  receivedAt: number;
}

export type PeerResponder = (req: PeerRequest) => number | Promise<number>;

export interface StubPeer {
  url: string;
  requests: PeerRequest[];
  /** Requests whose response has not yet been sent (mid-flight -- used for crash journeys). */
  pendingCount(): number;
  /** Set the status code returned for every future request. Default 200. */
  setStatus(status: number): void;
  /** Set a per-request responder function overriding setStatus. */
  setResponder(fn: PeerResponder): void;
  /** Hold the response open (no reply sent) until releaseHang() is called for that deliveryId. */
  hang(deliveryId: string): void;
  /** Release a previously-hung request with the given status. No-op if nothing is hanging. */
  releaseHang(deliveryId: string, status: number): void;
  /** Drop hang bookkeeping WITHOUT writing a response -- for a client that already died (e.g. a
   *  crash-simulation SIGKILL), where the socket is gone and there is nothing to respond to. Also
   *  clears the "hang the next request for this id" arm so a subsequent (post-restart) request
   *  for the same deliveryId is answered normally instead of hanging forever. */
  clearHang(deliveryId: string): void;
  requestsFor(deliveryId: string): PeerRequest[];
  close(): Promise<void>;
}

export async function startStubPeer(): Promise<StubPeer> {
  const requests: PeerRequest[] = [];
  let status = 200;
  let responder: PeerResponder | null = null;
  const hanging = new Map<string, ServerResponse>();
  const inflight = new Set<IncomingMessage>();

  const server: Server = createServer((req, res) => {
    inflight.add(req);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const deliveryId = String(req.headers['x-event-delivery-id'] ?? '');
        let envelope: unknown = undefined;
        try {
          envelope = JSON.parse(rawBody);
        } catch {
          envelope = undefined;
        }
        const record: PeerRequest = { deliveryId, rawBody, envelope, receivedAt: Date.now() };
        requests.push(record);
        inflight.delete(req);

        if (hanging.has(deliveryId)) {
          // Guard against an "unhandled 'error' on ServerResponse" crashing the test process if
          // the client (e.g. a SIGKILLed relay in the crash-restart journey) disconnects while we
          // are deliberately withholding the response.
          res.on('error', () => {});
          hanging.set(deliveryId, res); // caller will releaseHang()/clearHang() explicitly
          return;
        }
        const code = responder ? await responder(record) : status;
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: code < 300 }));
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('stub peer: expected an AddressInfo from listen(0)');
  }
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    requests,
    pendingCount: () => inflight.size,
    setStatus: (s: number) => {
      status = s;
    },
    setResponder: (fn: PeerResponder) => {
      responder = fn;
    },
    hang: (deliveryId: string) => {
      hanging.set(deliveryId, undefined as unknown as ServerResponse);
    },
    releaseHang: (deliveryId: string, code: number) => {
      const res = hanging.get(deliveryId);
      hanging.delete(deliveryId);
      if (res) {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: code < 300 }));
      }
    },
    clearHang: (deliveryId: string) => {
      hanging.delete(deliveryId);
    },
    requestsFor: (deliveryId: string) => requests.filter((r) => r.deliveryId === deliveryId),
    close: () =>
      new Promise<void>((resolve, reject) => {
        // `server.close()` alone waits for every open (including idle keep-alive) connection to
        // end, which can hang indefinitely if a client (e.g. a SIGKILLed relay in the
        // crash-restart journey) never sends the FIN the OS is supposed to generate on process
        // teardown promptly enough for this test's afterEach. Force-close everything immediately
        // -- correct for teardown since no test should be asserting on requests after this point.
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
