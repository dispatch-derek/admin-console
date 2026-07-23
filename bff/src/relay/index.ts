// bff/src/relay/index.ts — the relay process entrypoint (spec REQ-F004-020/021/033/044/045/052;
// design §1.1/§2.4). A SEPARATE supervised process from the BFF: it validates the relay-scoped
// config (hard-refuse on load, §5), constructs the transport via the EVENT_BUS_TRANSPORT branch,
// runs the drain loop on a poll cadence, serves the relay-only GET /ready probe, and installs
// graceful-shutdown handlers that bounded-drain the in-flight delivery SET (REQ-F004-020).
//
// A process supervisor (systemd unit / container restart policy — a deployment concern,
// REQ-F004-020) keeps EXACTLY ONE instance running (the single-drainer constraint, REQ-F004-017).

import { config } from './config.js';
import { createTransport } from './transport.js';
import { createDrainer } from './drainer.js';
import { buildReadyApp } from './ready.js';
import { getBacklogCount, getRelayLagMs } from './metrics.js';
import { outboxRepo } from '../store/repositories/outbox.repo.js';

// Implementation-defined poll cadence (REQ-F004-010/M8) and graceful-shutdown drain bound.
const POLL_INTERVAL_MS = 1_000;
const SHUTDOWN_DRAIN_MS = 10_000;
const READY_PORT = Number.parseInt(process.env['RELAY_READY_PORT'] ?? '3003', 10);
// Outbox retention (REQ-F004-019/035): published rows older than the window are pruned so the outbox
// does not grow without bound; unpublished and parked rows are NEVER pruned regardless of age. The
// window and the prune cadence are provisional constants of record, operator-tunable via
// EVENT_BUS_RETENTION_MS / EVENT_BUS_PRUNE_EVERY_CYCLES (relay-scoped config; defaults 7 days /
// 3600 ticks, unchanged). The prune runs once every `pruneEveryCycles` poll ticks, not every tick.
const RETENTION_MS = config.retentionMs;
const PRUNE_EVERY_CYCLES = config.pruneEveryCycles;

async function main(): Promise<void> {
  const transport = createTransport({
    kind: config.transportKind,
    peerUrls: config.peerUrls,
    peerTimeoutMs: config.peerTimeoutMs, // EVENT_BUS_PEER_TIMEOUT_MS → wire timeout inside the transport
    peerAuthToken: config.peerAuthToken, // EVENT_BUS_PEER_AUTH_TOKEN → shared-secret credential (F-010)
  });
  const drainer = createDrainer({ transport });

  // Transport reachability for /ready is derived from the last drain outcome (design open Q#4
  // leaves the probe to the implementation): a tick that delivers or finds nothing keeps it
  // reachable; a tick where every attempt failed marks it unreachable until the next success.
  let transportReachable = true;

  const ready = buildReadyApp({
    isTransportReachable: () => transportReachable,
    eventBusUrlConfigured: config.peerUrls.length > 0,
    getBacklogCount,
    getRelayLagMs: () => getRelayLagMs(),
    backlogThreshold: config.backlogThreshold,
    lagThresholdMs: config.lagThresholdMs,
    // Surface the ratified store-unwritable 503 reason (REQ-F004-011/044) via a real probe write.
    isStoreWritable: () => outboxRepo.isWritable(),
  });
  await ready.listen({ port: READY_PORT, host: '0.0.0.0' });

  let stopped = false;
  let cycle = 0;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await drainer.runOnce();
        transportReachable = true;
      } catch (err) {
        // The only top-level error boundary for the drain loop — do NOT swallow silently; a bare
        // console.error is the accepted convention here (the relay has no Fastify request context).
        console.error('[relay] drain tick failed:', err);
        transportReachable = false;
      }
      // Periodic retention prune (REQ-F004-019/035). Isolated try/catch so a prune failure never
      // stops the drain loop or corrupts reachability state.
      if (++cycle % PRUNE_EVERY_CYCLES === 0) {
        try {
          outboxRepo.pruneShipped(new Date(Date.now() - RETENTION_MS).toISOString());
        } catch (err) {
          console.error('[relay] retention prune failed:', err);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };
  void loop();

  const shutdown = async (): Promise<void> => {
    stopped = true;
    await drainer.shutdown(SHUTDOWN_DRAIN_MS);
    await ready.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
