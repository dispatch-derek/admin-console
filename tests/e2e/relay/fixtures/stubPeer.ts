// Ephemeral localhost HTTPS peer double for HttpPeerTransport (bff/src/relay/http-peer-transport.ts).
// A real `node:https` server (self-signed loopback cert, see fixtures/tls.ts) on a real OS-assigned
// port -- the relay's `fetch()` POST hits this exactly as it would hit a real peer. Every received
// request is recorded (method, headers, raw body, parsed JSON) so tests can assert byte-for-byte
// envelope delivery. Response behavior is scriptable per test (status code queues, hangs,
// always-status) to drive retry/park/crash journeys deterministically -- no sleep()-based flakiness.
//
// D-010 (GH #48): this stub used to serve plain http://, which made the D-006 https-only-peer boot
// guard (bff/src/relay/config.ts ~82-92) refuse to boot the relay in every credential-configured
// journey (a set EVENT_BUS_PEER_AUTH_TOKEN requires every EVENT_BUS_URL peer to be https://) --
// those journeys died at boot before any HTTP exchange. The stub now serves https:// uniformly (see
// startStubPeer below); the spawned relay child trusts the self-signed cert via
// NODE_TLS_REJECT_UNAUTHORIZED=0 scoped to that child process only (fixtures/relayProcess.ts).
//
// F-010 addition: requireAuthToken() turns the stub into a credential-checking peer (standing in
// for cwa's REQ-F005-061 constant-time comparison, at the level of detail an e2e stub needs) --
// it inspects an arbitrary request header (case-insensitive, matching HTTP semantics; Node's
// http parser already lowercases incoming header names) and returns 401 when the value is absent
// or does not match verbatim, 2xx (or whatever the peer's own status/responder says) when it
// matches. Every request's full header set is captured on PeerRequest so a test can assert
// presence of the three F-010 application-level headers without asserting a literal total count
// (REQ-F010-005: the HTTP client also attaches Host/Content-Length/Accept-Encoding/Connection etc).

import { createServer, type Server } from 'node:https';
import type { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http';
import { loadSelfSignedCert } from './tls.js';

export interface PeerRequest {
  deliveryId: string;
  rawBody: string;
  envelope: unknown;
  receivedAt: number;
  /** Every header the stub server observed on this request (Node lowercases header names). */
  headers: IncomingHttpHeaders;
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
  /** Require `headerName` (case-insensitive) to equal `expectedValue` on every future request --
   *  a request missing the header, or carrying any other value, gets 401 (checked BEFORE
   *  setStatus/setResponder/hang, standing in for cwa's credential rejection). Passing this again
   *  overrides the previous requirement; there is no way to unset it on a live stub other than
   *  starting a fresh one -- tests needing "no requirement" simply never call this. */
  requireAuthToken(headerName: string, expectedValue: string): void;
  requestsFor(deliveryId: string): PeerRequest[];
  close(): Promise<void>;
}

export async function startStubPeer(): Promise<StubPeer> {
  const requests: PeerRequest[] = [];
  let status = 200;
  let responder: PeerResponder | null = null;
  let authRequirement: { header: string; expected: string } | null = null;
  const hanging = new Map<string, ServerResponse>();
  const inflight = new Set<IncomingMessage>();

  const { key, cert } = loadSelfSignedCert();
  const server: Server = createServer({ key, cert }, (req, res) => {
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
        const record: PeerRequest = { deliveryId, rawBody, envelope, receivedAt: Date.now(), headers: { ...req.headers } };
        requests.push(record);
        inflight.delete(req);

        if (authRequirement) {
          const actual = req.headers[authRequirement.header];
          const actualValue = Array.isArray(actual) ? actual[0] : actual;
          if (actualValue !== authRequirement.expected) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'unauthorized' }));
            return;
          }
        }

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
  const url = `https://127.0.0.1:${address.port}`;

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
    requireAuthToken: (headerName: string, expectedValue: string) => {
      authRequirement = { header: headerName.toLowerCase(), expected: expectedValue };
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
