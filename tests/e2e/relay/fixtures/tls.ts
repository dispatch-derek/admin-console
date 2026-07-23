// D-010 (GH #48): the e2e stub peer must serve HTTPS so the credential-configured journeys can
// satisfy the D-006 https-only-peer boot guard (bff/src/relay/config.ts ~82-92) instead of dying at
// relay boot before any HTTP exchange happens. Rather than shelling out to `openssl` at test time
// (an extra runtime dependency this suite would otherwise not need, and a source of CI flakiness if
// it is ever absent), this ships a pre-generated, self-signed, loopback-only certificate as a static
// fixture -- deterministic, no subprocess, no network, no key-generation cost per test run.
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

export interface SelfSignedCert {
  key: string;
  cert: string;
}

let cached: SelfSignedCert | undefined;

/** Loads the shared self-signed loopback cert/key fixture (memoized -- same content every call). */
export function loadSelfSignedCert(): SelfSignedCert {
  if (cached === undefined) {
    cached = {
      key: readFileSync(join(TLS_DIR, 'self-signed-key.pem'), 'utf8'),
      cert: readFileSync(join(TLS_DIR, 'self-signed-cert.pem'), 'utf8'),
    };
  }
  return cached;
}
