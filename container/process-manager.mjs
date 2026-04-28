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

const CREDIT_MODE = process.env.CLAWS_CREDIT_MODE === 'true';
const GATEWAY_PORT = process.env.PORT || '18789';
const PROXY_MAX_RESTART_ATTEMPTS = 10;
const PROXY_RESTART_DELAY_MS = 1000;
const PROXY_HEALTH_TIMEOUT_MS = 10000;
const PROXY_HEALTH_POLL_MS = 500;

const STATE_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const OPENCLAW_APP_DIR = '/app';
const OPENCLAW_DATA_DIR = '/home/node/.openclaw';
const METERING_ENDPOINT = process.env.CLAWS_METERING_ENDPOINT;
const METERING_SECRET = process.env.CLAWS_METERING_SECRET;
const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID;
const STATE_ENDPOINT = METERING_ENDPOINT
  ? METERING_ENDPOINT.replace(/\/metering\/?$/, '/state')
  : null;

const children = new Set();
let proxyRestartCount = 0;
let shuttingDown = false;

// ─── Runtime State Sync ─────────────────────────────────

const CONFIG_FILES = new Set([
  'openclaw.json',
  '.env',
  'cron',
]);

function isRuntimeFile(relativePath) {
  const topLevel = relativePath.split('/')[0];
  if (CONFIG_FILES.has(topLevel)) return false;
  if (topLevel.startsWith('.') && topLevel !== '.openclaw') return false;
  if (topLevel === 'node_modules') return false;
  return true;
}

function bundleRuntimeState() {
  const files = {};
  let totalSize = 0;

  function walkDir(dir, prefix = '') {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!isRuntimeFile(relativePath)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath, relativePath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath);
          files[relativePath] = content.toString('base64');
          totalSize += content.length;
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walkDir(OPENCLAW_DATA_DIR);
  return { files, totalSize };
}

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

async function syncState() {
  if (!STATE_ENDPOINT || !METERING_SECRET || !WORKSPACE_ID) return;

  try {
    const state = bundleRuntimeState();
    if (Object.keys(state.files).length === 0) return;

    const jsonStr = JSON.stringify(state);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr));
    const fileCount = Object.keys(state.files).length;
    const sizeKb = Math.round(compressed.length / 1024);

    const res = await fetch(`${STATE_ENDPOINT}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Metering-Secret': METERING_SECRET,
      },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        compressedState: compressed.toString('base64'),
        uncompressedSize: Buffer.byteLength(jsonStr),
      }),
      signal: AbortSignal.timeout(30000),
    });

    // PR2.5: differentiated outcomes instead of always logging "synced"
    // regardless of server acceptance. Three distinct states:
    //   1. HTTP !ok       -> server rejected; state NOT persisted
    //   2. HTTP ok, count=0 -> server accepted but updateMany matched 0
    //                        rows; state silently discarded (this was
    //                        the PR2 initial-sync race — now closed at
    //                        deployer.ts, but we keep the tripwire here
    //                        in case a future regression opens it back up)
    //   3. HTTP ok, count>=1 -> state persisted; the only safe case
    if (!res.ok) {
      console.warn(`[process-manager] State sync failed (HTTP ${res.status}): server rejected (${fileCount} files, ${sizeKb}KB)`);
      return;
    }

    let bodyCount = null;
    try {
      const body = await res.json();
      if (typeof body?.count === 'number') bodyCount = body.count;
    } catch {
      // Older server version that doesn't return count — treat as unknown
      // and fall through to the success log so we don't flag a benign
      // version skew. The server-side log.warn is still the source of
      // truth for count=0 on any server >=PR2.5.
    }

    if (bodyCount === 0) {
      console.warn(`[process-manager] State sync accepted but NOT persisted (count=0; ContainerState row missing) — ${fileCount} files, ${sizeKb}KB discarded`);
      return;
    }

    console.log(`[process-manager] State synced (${fileCount} files, ${sizeKb}KB compressed)`);
  } catch (err) {
    console.error('[process-manager] State sync failed:', err.message);
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

  await restoreStateFromPlatform();

  if (CREDIT_MODE) {
    spawnProxy();
    const healthy = await waitForProxyHealth();
    if (!healthy) {
      console.error('[process-manager] Proxy unhealthy, starting gateway anyway');
    }
  }

  spawnGateway();

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

main().catch(err => {
  console.error('[process-manager] Fatal error:', err);
  process.exit(1);
});
