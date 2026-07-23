// Launches the REAL relay entrypoint (bff/src/relay/index.ts) as a separate OS process -- exactly
// how a process supervisor (systemd unit / container) runs it in production. This is what makes
// the suite E2E rather than an in-process integration test: it exercises real env-var parsing,
// real process boot order, a real bound TCP port for GET /ready, real SIGTERM/SIGKILL semantics,
// and a real separate `better-sqlite3` connection onto the shared DB file.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BFF_DIR = join(__dirname, '..', '..', '..', '..', 'bff');
const TSX_BIN = join(BFF_DIR, 'node_modules', '.bin', 'tsx');
const RELAY_ENTRY = join(BFF_DIR, 'src', 'relay', 'index.ts');

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('getFreePort: no AddressInfo')));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

export interface RelayHandle {
  proc: ChildProcessWithoutNullStreams;
  readyPort: number;
  readyUrl: string;
  stdout: string;
  stderr: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** True once the child process has exited (any reason). */
  hasExited(): boolean;
  fetchReady(): Promise<{ status: number; body: unknown } | undefined>;
  /** Poll GET /ready until it returns any HTTP response (i.e. the process is accepting
   *  connections) or the child exits early. Throws with captured stdio on timeout/early-exit. */
  waitUntilServing(timeoutMs?: number): Promise<void>;
  /** Poll GET /ready until its status matches `predicate`. */
  waitForReadyStatus(predicate: (status: number) => boolean, timeoutMs?: number): Promise<{ status: number; body: unknown }>;
  kill(signal?: NodeJS.Signals): void;
}

// The relay's own config.ts (bff/src/relay/config.ts) documents that it needs ONLY the DB path +
// EVENT_BUS_* family -- it explicitly does NOT import the BFF's config.ts. This USED to be false in
// practice (store/db.ts transitively pulled in the BFF's secret-requiring config.ts, requiring
// ANYTHINGLLM_BASE_URL/ANYTHINGLLM_API_KEY/SESSION_SECRET/SECRETS_ENC_KEY at import time -- see git
// history of this file / boot-config.e2e.test.ts for the bug this suite found). Fixed via
// bff/src/store/db-path.ts (a secret-free path resolver shared by store/db.ts and relay/config.ts),
// confirmed by boot-config.e2e.test.ts. Every journey below now spawns the relay with ONLY the
// vars explicitly listed here -- these four are actively STRIPPED (not just "not added") so the
// suite proves the relay boots without them regardless of what the host shell happens to export.
export const BFF_ONLY_SECRET_ENV_VARS = [
  'ANYTHINGLLM_BASE_URL',
  'ANYTHINGLLM_API_KEY',
  'SESSION_SECRET',
  'SECRETS_ENC_KEY',
] as const;

export interface SpawnRelayOpts {
  dbPath: string;
  peerUrls?: string[];
  backlogThreshold?: number;
  lagThresholdMs?: number;
  transport?: string;
  nodeEnv?: string;
  // Phase 7 review-gate remediation knobs (bff/src/relay/config.ts), left undefined = relay
  // default (7d retention / 3600-cycle cadence / 10s peer timeout).
  retentionMs?: number; // EVENT_BUS_RETENTION_MS (REQ-F004-019/035)
  pruneEveryCycles?: number; // EVENT_BUS_PRUNE_EVERY_CYCLES
  peerTimeoutMs?: number; // EVENT_BUS_PEER_TIMEOUT_MS (REQ-F004-055 wire concern / security F1)
  extraEnv?: Record<string, string | undefined>;
}

/** Spawns the relay as a real child process. Caller MUST kill() it (see afterEach in each spec). */
export async function spawnRelay(opts: SpawnRelayOpts): Promise<RelayHandle> {
  const readyPort = await getFreePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: opts.nodeEnv ?? 'development',
    DB_PATH: opts.dbPath,
    // D-010 (GH #48): the e2e stub peer (fixtures/stubPeer.ts) serves https:// over a self-signed
    // loopback cert (fixtures/tls.ts) so credential-configured journeys can satisfy the D-006
    // https-only-peer boot guard (bff/src/relay/config.ts ~82-92). The relay's outbound `fetch()`
    // would otherwise reject that cert as untrusted. This is scoped to ONLY this spawned relay
    // CHILD PROCESS's env (never process.env of the test runner itself, never bff/src) -- test-only,
    // never appropriate outside a harness that controls exactly which peer it is trusting.
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    EVENT_BUS_URL: (opts.peerUrls ?? []).join(','),
    EVENT_BUS_TRANSPORT: opts.transport ?? 'http',
    EVENT_BUS_BACKLOG_THRESHOLD: String(opts.backlogThreshold ?? 1000),
    EVENT_BUS_LAG_THRESHOLD_MS: String(opts.lagThresholdMs ?? 30_000),
    RELAY_READY_PORT: String(readyPort),
    ...(opts.retentionMs !== undefined ? { EVENT_BUS_RETENTION_MS: String(opts.retentionMs) } : {}),
    ...(opts.pruneEveryCycles !== undefined
      ? { EVENT_BUS_PRUNE_EVERY_CYCLES: String(opts.pruneEveryCycles) }
      : {}),
    ...(opts.peerTimeoutMs !== undefined ? { EVENT_BUS_PEER_TIMEOUT_MS: String(opts.peerTimeoutMs) } : {}),
    ...opts.extraEnv,
  };
  // Strip any of the four BFF-only secrets the relay must never need (REQ-F004-033/045), even if
  // the host shell running `npm test` happens to have them exported -- the boot-config journey's
  // guarantee should not depend on the ambient shell being "clean".
  for (const key of BFF_ONLY_SECRET_ENV_VARS) delete env[key];

  const proc = spawn(TSX_BIN, [RELAY_ENTRY], { cwd: BFF_DIR, env });

  const state = { stdout: '', stderr: '', exited: false as boolean };
  proc.stdout.on('data', (d: Buffer) => {
    state.stdout += d.toString('utf8');
  });
  proc.stderr.on('data', (d: Buffer) => {
    state.stderr += d.toString('utf8');
  });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    proc.on('exit', (code, signal) => {
      state.exited = true;
      resolve({ code, signal });
    });
  });

  const readyUrl = `http://127.0.0.1:${readyPort}/ready`;

  const fetchReady = async (): Promise<{ status: number; body: unknown } | undefined> => {
    try {
      const res = await fetch(readyUrl, { signal: AbortSignal.timeout(2000) });
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      return { status: res.status, body };
    } catch {
      return undefined;
    }
  };

  const diagnostics = (): string =>
    `--- relay stdout ---\n${state.stdout}\n--- relay stderr ---\n${state.stderr}\n---`;

  const waitUntilServing = async (timeoutMs = 15_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (state.exited) {
        throw new Error(`relay process exited before serving /ready\n${diagnostics()}`);
      }
      const r = await fetchReady();
      if (r !== undefined) return;
      if (Date.now() > deadline) {
        throw new Error(`relay process never served /ready within ${timeoutMs}ms\n${diagnostics()}`);
      }
      await new Promise((r2) => setTimeout(r2, 50));
    }
  };

  const waitForReadyStatus = async (
    predicate: (status: number) => boolean,
    timeoutMs = 15_000,
  ): Promise<{ status: number; body: unknown }> => {
    const deadline = Date.now() + timeoutMs;
    let last: { status: number; body: unknown } | undefined;
    for (;;) {
      if (state.exited) {
        throw new Error(
          `relay process exited while waiting for a matching /ready status (last: ${JSON.stringify(last)})\n${diagnostics()}`,
        );
      }
      const r = await fetchReady();
      if (r !== undefined) {
        last = r;
        if (predicate(r.status)) return r;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `/ready never matched predicate within ${timeoutMs}ms (last: ${JSON.stringify(last)})\n${diagnostics()}`,
        );
      }
      await new Promise((r2) => setTimeout(r2, 50));
    }
  };

  return {
    proc,
    readyPort,
    readyUrl,
    get stdout() {
      return state.stdout;
    },
    get stderr() {
      return state.stderr;
    },
    exited,
    hasExited: () => state.exited,
    fetchReady,
    waitUntilServing,
    waitForReadyStatus,
    kill: (signal: NodeJS.Signals = 'SIGTERM') => {
      if (!state.exited) proc.kill(signal);
    },
  };
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) {
      throw new Error(opts.message ?? `waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
