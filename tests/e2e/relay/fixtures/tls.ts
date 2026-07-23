// CANONICAL D-010 (GH #48) explanation -- other fixtures (stubPeer.ts, relayProcess.ts) that touch
// TLS point back here rather than repeating this rationale.
//
// D-006 added an https-only peer guard (bff/src/relay/config.ts ~82-92): the relay refuses to boot
// when a credential is configured (EVENT_BUS_PEER_AUTH_TOKEN set) and any EVENT_BUS_URL peer is
// http://. The e2e stub peer used to serve only plain http://, so every credential-configured
// journey died at relay boot before any HTTP exchange. Fix: the stub now serves real HTTPS over the
// self-signed cert loaded here, and the spawned relay child is told to trust exactly that cert via
// NODE_EXTRA_CA_CERTS (see spawnRelay in relayProcess.ts) -- narrower than disabling TLS validation
// wholesale (NODE_TLS_REJECT_UNAUTHORIZED=0), since it leaves hostname/expiry/chain validation
// intact for anything else and trusts only this one fixture CA.
//
// Rather than shelling out to `openssl` at test time (an extra runtime dependency this suite would
// otherwise not need, and a source of CI flakiness if it is ever absent), this ships a pre-generated,
// self-signed, loopback-only certificate as a static fixture -- deterministic, no subprocess, no
// network, no key-generation cost per test run.
//
// Regenerate with (10-year validity, CN/SAN = 127.0.0.1 + localhost):
//   openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
//     -keyout fixtures/tls/self-signed-key.pem -out fixtures/tls/self-signed-cert.pem \
//     -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
//
// This cert/key pair is TEST-ONLY: it is not, and must never be, used by any non-test code, is not
// tied to any real secret, and is safe to check into source control.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TLS_DIR = join(__dirname, 'tls');

/** Absolute path to the fixture CA cert (PEM). Exported so relayProcess.ts can point the spawned
 *  relay child's NODE_EXTRA_CA_CERTS at exactly this file, without hardcoding a second, brittle
 *  relative path to it. */
export const SELF_SIGNED_CERT_PATH = join(TLS_DIR, 'self-signed-cert.pem');
const SELF_SIGNED_KEY_PATH = join(TLS_DIR, 'self-signed-key.pem');

export interface SelfSignedCert {
  key: string;
  cert: string;
}

let cached: SelfSignedCert | undefined;

/** Loads the shared self-signed loopback cert/key fixture (memoized -- same content every call). */
export function loadSelfSignedCert(): SelfSignedCert {
  if (cached === undefined) {
    cached = {
      key: readFileSync(SELF_SIGNED_KEY_PATH, 'utf8'),
      cert: readFileSync(SELF_SIGNED_CERT_PATH, 'utf8'),
    };
  }
  return cached;
}
