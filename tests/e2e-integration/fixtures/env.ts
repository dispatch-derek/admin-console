// Shared constants between playwright.config.ts (which sets these as env vars for the spawned
// bff dev server) and the test spec (which uses them to drive the login flow). Kept in one place
// so the two never drift.

export const WEB_PORT = 5173; // vite.config.ts hardcodes its /api proxy target to BFF_PORT below
export const BFF_PORT = 3002;
export const FAKE_ENGINE_PORT = 3101;

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const BFF_URL = `http://localhost:${BFF_PORT}`;
export const FAKE_ENGINE_URL = `http://localhost:${FAKE_ENGINE_PORT}`;

// First-boot bootstrap account (bff/src/auth/bootstrap.ts, REQ-019a). A fresh, single-use
// per-suite-run sqlite DB (see playwright.config.ts DB_PATH) means this account is created once
// per full `playwright test` invocation and always starts at the set-password/enroll stage.
export const BOOTSTRAP_USERNAME = 'e2e-admin';
export const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token-0123456789'; // first-login "password"
export const NEW_PASSWORD = 'e2e-new-password-0123456789!'; // >= 12 chars (MIN_PASSWORD_LENGTH)

export const SESSION_SECRET = 'e2e-session-secret-0123456789abcdef01';
export const SECRETS_ENC_KEY = 'e2e-secrets-enc-key-0123456789abcdef01';
