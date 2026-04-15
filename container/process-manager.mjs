// Container entrypoint for Claws OpenClaw containers.
// Manages two processes:
//   1. credit-proxy (only if CLAWS_CREDIT_MODE=true)
//   2. OpenClaw gateway (always)
//
// Handles: signal forwarding, proxy auto-restart, graceful shutdown.

import { spawn } from 'child_process';

const CREDIT_MODE = process.env.CLAWS_CREDIT_MODE === 'true';
const GATEWAY_PORT = process.env.PORT || '18789';
const PROXY_MAX_RESTART_ATTEMPTS = 10;
const PROXY_RESTART_DELAY_MS = 1000;
const PROXY_HEALTH_TIMEOUT_MS = 10000;
const PROXY_HEALTH_POLL_MS = 500;

const children = new Set();
let proxyRestartCount = 0;
let shuttingDown = false;

// ─── Signal Handling ────────────────────────────────────

function forwardSignal(signal) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try { child.kill(signal); } catch {}
    }
  }
}

process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGINT', () => forwardSignal('SIGINT'));

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
    cwd: '/home/node/.openclaw',
  });

  children.add(gateway);

  gateway.on('exit', (code, signal) => {
    children.delete(gateway);
    console.log(`[process-manager] Gateway exited (code=${code}, signal=${signal})`);
    process.exit(code ?? 1);
  });

  return gateway;
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  console.log(`[process-manager] Starting (credit_mode=${CREDIT_MODE})`);

  if (CREDIT_MODE) {
    spawnProxy();
    const healthy = await waitForProxyHealth();
    if (!healthy) {
      console.error('[process-manager] Proxy unhealthy, starting gateway anyway');
    }
  }

  spawnGateway();

  console.log('[process-manager] All processes started');
}

main().catch(err => {
  console.error('[process-manager] Fatal error:', err);
  process.exit(1);
});
