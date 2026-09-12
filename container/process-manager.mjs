// Container entrypoint for Claws OpenClaw containers.
// Manages two processes:
//   1. credit-proxy (only if CLAWS_CREDIT_MODE=true)
//   2. OpenClaw gateway (always)
//
// Handles: signal forwarding, proxy auto-restart, graceful shutdown,
//          periodic runtime state sync to platform.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
// PR-1 (sync-now): bundle + upload logic is the single source of truth in
// state-sync.mjs, imported by BOTH this entrypoint and the gateway plugin's
// /internal/sync-now route. The image copies that one file to both
// /usr/local/bin/state-sync.mjs (here) and /opt/state-sync.mjs (the plugin).
import {
  OPENCLAW_DATA_DIR,
  runStateSync,
  postActivityEvent,
  rebuildAllSessionsIndexesFromDisk,
  retainOrphanSessionsEnabled,
} from './state-sync.mjs';
import {
  CATCHUP_OVERLAY_MARKER,
  runHeartbeatCatchupOnBoot,
} from './heartbeat-catchup.mjs';
import { runRuntimeVolumeMigration } from './volume-migration.mjs';

const CREDIT_MODE = process.env.CLAWS_CREDIT_MODE === 'true';
const GATEWAY_PORT = process.env.PORT || '18789';
const PROXY_MAX_RESTART_ATTEMPTS = 10;
const PROXY_RESTART_DELAY_MS = 1000;
const PROXY_HEALTH_TIMEOUT_MS = 10000;
const PROXY_HEALTH_POLL_MS = 500;

const STATE_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const OPENCLAW_APP_DIR = '/app';
const METERING_ENDPOINT = process.env.CLAWS_METERING_ENDPOINT;
const METERING_SECRET = process.env.CLAWS_METERING_SECRET;
const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID;
const STATE_ENDPOINT = METERING_ENDPOINT
  ? METERING_ENDPOINT.replace(/\/metering\/?$/, '/state')
  : null;

const children = new Set();
let proxyRestartCount = 0;
let shuttingDown = false;

// ─── Sync-failure → ERROR (consecutive non-2xx token/finalize) ───────────
// ≥3 consecutive rejected blob-token/finalize responses with an HTTP status
// → one ERROR activity event. Counter resets on success. At most one emit
// per failure streak (no 5-min spam until recovery).

export function isTokenOrFinalizeHttpReject(result) {
  return (
    result != null &&
    result.status === 'rejected' &&
    typeof result.httpStatus === 'number' &&
    (result.path === 'blob-token' || result.path === 'finalize')
  );
}

export function createSyncFailureTracker({
  threshold = 3,
  emitError = async () => {},
} = {}) {
  let consecutive = 0;
  let emittedForStreak = false;

  return {
    async noteResult(result) {
      if (
        result?.status === 'persisted' ||
        result?.status === 'accepted-unconfirmed'
      ) {
        consecutive = 0;
        emittedForStreak = false;
        return { emitted: false, consecutive };
      }

      if (!isTokenOrFinalizeHttpReject(result)) {
        return { emitted: false, consecutive };
      }

      consecutive += 1;
      if (consecutive >= threshold && !emittedForStreak) {
        emittedForStreak = true;
        await emitError({
          httpStatus: result.httpStatus,
          consecutive,
          sizeKb: result.sizeKb ?? 0,
          path: result.path,
        });
        return { emitted: true, consecutive };
      }
      return { emitted: false, consecutive };
    },
    getState() {
      return { consecutive, emittedForStreak };
    },
    __reset() {
      consecutive = 0;
      emittedForStreak = false;
    },
  };
}

async function emitSyncFailureError({ httpStatus, consecutive, sizeKb, path: failPath }) {
  await postActivityEvent({
    type: 'ERROR',
    timestamp: new Date().toISOString(),
    agentId: null,
    runId: null,
    sessionKey: null,
    channelId: null,
    action: `State sync failed: HTTP ${httpStatus} on ${failPath} (${consecutive} consecutive; ${sizeKb}KB)`,
    detail: `consecutiveNon2xx=${consecutive} httpStatus=${httpStatus} path=${failPath} sizeKb=${sizeKb}`,
    metadata: {
      kind: 'state_sync_failure',
      httpStatus,
      consecutive,
      sizeKb,
      path: failPath,
    },
  });
}

const syncFailureTracker = createSyncFailureTracker({
  threshold: 3,
  emitError: emitSyncFailureError,
});

// ─── Runtime State Sync ─────────────────────────────────
// bundleRuntimeState + the gzip/upload/count-check now live in state-sync.mjs
// (single source, shared with the gateway plugin's /internal/sync-now route).
// syncState() below is a thin wrapper that calls the shared runStateSync() and
// reproduces this entrypoint's existing three-state logging UNCHANGED.

function restoreRuntimeState(stateJson) {
  const { files } = stateJson;
  if (!files || typeof files !== 'object') return;

  let restored = 0;
  for (const [relativePath, base64Content] of Object.entries(files)) {
    const fullPath = path.join(OPENCLAW_DATA_DIR, relativePath);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(base64Content, 'base64'));
      restored++;
    } catch (err) {
      console.error(`[process-manager] Failed to restore ${relativePath}:`, err.message);
    }
  }
  console.log(`[process-manager] Restored ${restored} runtime files`);
}

// Thin wrapper over the shared runStateSync(). Delegates the bundle/gzip/upload
// to state-sync.mjs (single source) and reproduces this entrypoint's existing
// three-state logging UNCHANGED:
//   1. HTTP !ok            -> server rejected; state NOT persisted
//   2. HTTP ok, count=0    -> accepted but updateMany matched 0 rows; discarded
//   3. HTTP ok, count>=1   -> persisted (the only safe case)
// (count===null from an older server is treated as a benign success, same as
// before; 'unconfigured'/'empty' are silent early-returns, same as before.)
async function syncState() {
  const r = await runStateSync();
  try {
    await syncFailureTracker.noteResult(r);
  } catch (err) {
    console.error('[process-manager] Sync-failure ERROR emit failed:', err?.message ?? err);
  }
  switch (r.status) {
    case 'unconfigured':
    case 'empty':
      return;
    case 'error':
      console.error('[process-manager] State sync failed:', r.error);
      return;
    case 'rejected':
      if (typeof r.httpStatus === 'number') {
        console.warn(`[process-manager] State sync failed (HTTP ${r.httpStatus}): server rejected (${r.fileCount} files, ${r.sizeKb}KB)`);
      } else {
        console.warn(`[process-manager] State sync accepted but NOT persisted (count=0; ContainerState row missing) - ${r.fileCount} files, ${r.sizeKb}KB discarded`);
      }
      return;
    case 'accepted-unconfirmed':
    case 'persisted':
      console.log(`[process-manager] State synced (${r.fileCount} files, ${r.sizeKb}KB compressed)`);
      return;
  }
}

async function restoreStateFromPlatform() {
  if (!STATE_ENDPOINT || !METERING_SECRET || !WORKSPACE_ID) return;

  try {
    const res = await fetch(
      `${STATE_ENDPOINT}/download?workspaceId=${WORKSPACE_ID}`,
      {
        headers: { 'X-Metering-Secret': METERING_SECRET },
        signal: AbortSignal.timeout(30000),
      },
    );

    const data = await res.json();

    if (!data.success || !data.data?.hasState) {
      console.log('[process-manager] No saved runtime state to restore');
      return;
    }

    const compressed = Buffer.from(data.data.compressedState, 'base64');
    const decompressed = zlib.gunzipSync(compressed);
    const stateJson = JSON.parse(decompressed.toString());

    restoreRuntimeState(stateJson);
    console.log(`[process-manager] Runtime state restored from ${data.data.updatedAt}`);
  } catch (err) {
    console.error('[process-manager] State restore failed:', err.message);
  }
}

// ─── Graceful Shutdown ──────────────────────────────────

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[process-manager] ${signal} received, syncing state before shutdown...`);

  try {
    await Promise.race([
      syncState(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]);
    console.log('[process-manager] Final state sync complete');
  } catch (err) {
    console.error('[process-manager] Final state sync failed:', err.message);
  }

  for (const child of children) {
    if (!child.killed) try { child.kill(signal); } catch {}
  }

  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Proxy Management ───────────────────────────────────

function spawnProxy() {
  const proxy = spawn('node', [
    '--max-old-space-size=64',
    '/usr/local/bin/credit-proxy.mjs',
  ], {
    stdio: 'inherit',
    env: process.env,
  });

  children.add(proxy);

  proxy.on('exit', (code, signal) => {
    children.delete(proxy);

    if (shuttingDown) return;

    console.error(`[process-manager] Credit proxy exited (code=${code}, signal=${signal})`);

    proxyRestartCount++;
    if (proxyRestartCount > PROXY_MAX_RESTART_ATTEMPTS) {
      console.error(`[process-manager] Proxy exceeded max restarts (${PROXY_MAX_RESTART_ATTEMPTS}), giving up`);
      return;
    }

    console.log(`[process-manager] Restarting proxy (attempt ${proxyRestartCount})...`);
    setTimeout(() => {
      if (!shuttingDown) spawnProxy();
    }, PROXY_RESTART_DELAY_MS);
  });

  return proxy;
}

async function waitForProxyHealth() {
  const startTime = Date.now();

  while (Date.now() - startTime < PROXY_HEALTH_TIMEOUT_MS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const res = await fetch('http://127.0.0.1:3789/health', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        console.log('[process-manager] Credit proxy healthy');
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, PROXY_HEALTH_POLL_MS));
  }

  console.error('[process-manager] Credit proxy failed to become healthy');
  return false;
}

/**
 * -9: POST spawn-status ActivityLog (proxy healthy / failed) via internal activity route.
 * Uses TASK_START / ERROR (activity allowlist); SYSTEM is not container-writable.
 */
export async function emitProxySpawnStatus(healthy) {
  const status = healthy ? 'healthy' : 'failed';
  await postActivityEvent({
    type: healthy ? 'TASK_START' : 'ERROR',
    timestamp: new Date().toISOString(),
    agentId: null,
    runId: null,
    sessionKey: null,
    channelId: null,
    action: `Credit proxy spawn ${status}`,
    detail: `CLAWS_CREDIT_MODE proxy health=${status}`,
    metadata: {
      eventKind: 'proxy_spawn_status',
      proxyHealthy: healthy,
      status,
    },
  });
}

// ─── Gateway Management ─────────────────────────────────

function spawnGateway() {
  const gateway = spawn('node', [
    'openclaw.mjs', 'gateway', '--allow-unconfigured', '--bind', 'lan', '--port', GATEWAY_PORT,
  ], {
    stdio: 'inherit',
    env: process.env,
    cwd: OPENCLAW_APP_DIR,
  });

  children.add(gateway);

  gateway.on('exit', (code, signal) => {
    children.delete(gateway);
    console.log(`[process-manager] Gateway exited (code=${code}, signal=${signal})`);
    if (!shuttingDown) process.exit(code ?? 1);
  });

  return gateway;
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  console.log(`[process-manager] Starting (credit_mode=${CREDIT_MODE})`);
  console.log(
    `[process-manager] CLAWS_RETAIN_ORPHAN_SESSIONS=${retainOrphanSessionsEnabled() ? 'true' : 'false'}`,
  );

  await restoreStateFromPlatform();

  // Finding E runtime half: reconstruct sessions.json when missing/empty.
  try {
    rebuildAllSessionsIndexesFromDisk(OPENCLAW_DATA_DIR);
  } catch (err) {
    console.error(
      `[process-manager] rebuild-index failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 9.4: convert leftover jsonl / cron JSON stores to sqlite BEFORE gateway.
  // Fail closed — SessionStoreMigrationRequiredError is a boot refuse.
  try {
    const migration = await runRuntimeVolumeMigration({
      dataDir: OPENCLAW_DATA_DIR,
      appDir: OPENCLAW_APP_DIR,
      ledger: (event) => postActivityEvent(event),
    });
    if (migration.ran) {
      console.log(
        `[process-manager] runtime volume migration: ${JSON.stringify({
          reasons: migration.reasons,
          doctorStatus: migration.doctorStatus,
        })}`,
      );
    } else {
      console.log(`[process-manager] runtime volume migration skipped (${migration.reason})`);
    }
  } catch (err) {
    console.error(
      `[process-manager] runtime volume migration failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }

  if (CREDIT_MODE) {
    spawnProxy();
    const healthy = await waitForProxyHealth();
    try {
      await emitProxySpawnStatus(healthy);
    } catch (err) {
      console.error(
        `[process-manager] proxy spawn ActivityLog failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!healthy) {
      console.error('[process-manager] Proxy unhealthy, starting gateway anyway');
    }
  }

  spawnGateway();

  // -13 catch-up-beat: wait jobs-readable + gateway healthy inside the
  // catch-up module, then fire one missed heartbeat if within CATCHUP_GRACE.
  // Every skip path ledgers heartbeat_catchup_skip (no silent no-op).
  // Non-blocking - never delays state-sync / steady-state loops.
  // Ledger with retries - boot race vs activity reporter used to drop
  // beyond-grace skips (silent no-op class on -11; receipt #2 Aug-11 09:42).
  // -13: module loads croner from /app (base has no cron-parser); catch-up
  // itself ledgers on load failure - this .catch is last-resort only.
  async function ledgerCatchupWithRetry(event) {
    let last = { ok: false, reason: "not-attempted" };
    for (let attempt = 1; attempt <= 4; attempt++) {
      last = await postActivityEvent(event);
      if (last?.ok) return last;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
    console.error(
      `[process-manager] heartbeat catch-up ledger failed after retries:`,
      JSON.stringify(last),
    );
    return last;
  }

  void runHeartbeatCatchupOnBoot({
    dataDir: OPENCLAW_DATA_DIR,
    port: GATEWAY_PORT,
    ledger: (event) => ledgerCatchupWithRetry(event),
  })
    .then((result) => {
      console.log(
        `[process-manager] heartbeat catch-up (${CATCHUP_OVERLAY_MARKER}):`,
        JSON.stringify({
          ran: result.ran,
          reason: result.reason,
          expectedAt: result.expectedAt,
          jobId: result.jobId ?? null,
          nextFireAt: result.nextFireAt ?? null,
        }),
      );
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[process-manager] heartbeat catch-up failed: ${message}`,
      );
      // Last-resort ledger - -12 threw before finishSkip and only logged here.
      try {
        await ledgerCatchupWithRetry({
          type: 'ERROR',
          timestamp: new Date().toISOString(),
          agentId: null,
          runId: null,
          sessionKey: null,
          channelId: null,
          action: `Heartbeat catch-up skipped: cron-parser-unavailable`,
          detail: `marker=${CATCHUP_OVERLAY_MARKER} reason=cron-parser-unavailable`,
          metadata: {
            eventKind: 'heartbeat_catchup_skip',
            reason: 'cron-parser-unavailable',
            marker: CATCHUP_OVERLAY_MARKER,
            expectedAt: null,
            graceMs: null,
            detail: message.slice(0, 300),
          },
        });
      } catch (ledgerErr) {
        console.error(
          `[process-manager] heartbeat catch-up last-resort ledger failed:`,
          ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
        );
      }
    });

  // PR2 (2026-04-28): initial sync delay reduced 2min → 30sec. With state
  // sync now universal (not credit-mode-gated), the faster first snapshot
  // shortens the loss window if a container crashes early in its life.
  // The 5-minute steady-state interval is unchanged.
  setTimeout(() => {
    syncState();
    setInterval(syncState, STATE_SYNC_INTERVAL_MS);
  }, 30 * 1000);

  console.log('[process-manager] All processes started');
}

function isDirectEntrypoint() {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] && path.resolve(process.argv[1]);
    return Boolean(invoked) && thisFile === invoked;
  } catch {
    // If resolution fails, prefer starting (container entrypoint safety).
    return true;
  }
}

if (isDirectEntrypoint()) {
  main().catch(err => {
    console.error('[process-manager] Fatal error:', err);
    process.exit(1);
  });
}

export const __test__ = {
  createSyncFailureTracker,
  isTokenOrFinalizeHttpReject,
  syncFailureTracker,
  syncState,
  isDirectEntrypoint,
  emitProxySpawnStatus,
  waitForProxyHealth,
  runHeartbeatCatchupOnBoot,
};
