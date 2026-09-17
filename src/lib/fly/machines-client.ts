/**
 * Fly.io Machines API client (REST, api.machines.dev) + the one GraphQL
 * call the REST surface lacks (shared IPv4 allocation for <app>.fly.dev).
 *
 * Provider shape: ONE Fly App per claw (`${FLY_APP_PREFIX}-<workspaceId>`,
 * per-app 6PN network isolation) holding ONE machine. Mirrors Railway's
 * service-per-claw layout so the platform's containerId/containerName/
 * containerHost columns map 1:1 (machineId / appName / <app>.fly.dev).
 *
 * HWD on Fly is NATIVE: machine stop keeps the machine + app + domain, and
 * `guest.persist_rootfs: "restart"` keeps the rootfs across nap/wake (the
 * platform Postgres state-sync remains the durable layer - unchanged).
 *
 * GHCR gap (Phase A): the Machines API cannot pull private external
 * registries. resolveFlyImage() maps a ghcr.io image ref onto
 * FLY_IMAGE_MIRROR_PREFIX (registry.fly.io/<runtime app>), same tag - the
 * image pipeline pushes each version there alongside GHCR.
 * See docs/FLY_MACHINES_ADAPTER.md.
 */

import { log } from '@/lib/logger';

// Env is read at CALL time (not module load) so serverless env updates and
// test harnesses take effect without a module-cache bust - same discipline
// as service-pool.ts knobs.
const FLY_MACHINES_API_URL = () => process.env.FLY_MACHINES_API_URL ?? 'https://api.machines.dev';
const FLY_GRAPHQL_URL = () => process.env.FLY_GRAPHQL_URL ?? 'https://api.fly.io/graphql';
const flyToken = () => process.env.FLY_API_TOKEN;
const flyOrgSlug = () => process.env.FLY_ORG_SLUG;
const flyRegion = () => process.env.FLY_REGION ?? 'iad';
const flyImageMirrorPrefix = () => process.env.FLY_IMAGE_MIRROR_PREFIX;
const flyAppPrefix = () => process.env.FLY_APP_PREFIX ?? 'claw';

export const FLY_INTERNAL_PORT = 18789;

const DEFAULT_MEMORY_MB = 1024;
const FLY_MAX_RETRIES = 3;
const FLY_RETRY_DELAYS = [1000, 3000, 8000];

export function isFlyConfigured(): boolean {
  return !!(flyToken() && flyOrgSlug() && flyImageMirrorPrefix());
}

export function flyAppNameForWorkspace(workspaceId: string): string {
  // Fly app names are DNS labels (lowercase alnum + hyphen, max 63).
  return `${flyAppPrefix()}-${workspaceId}`.toLowerCase().substring(0, 60);
}

export function flyAppDomain(appName: string): string {
  return `${appName}.fly.dev`;
}

/**
 * Map the resolved (version-pinned) GHCR image onto the Fly registry mirror,
 * preserving the tag so version-aware resolution stays intact.
 * ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5
 *   -> ${FLY_IMAGE_MIRROR_PREFIX}:2026.9.4-5
 */
export function resolveFlyImage(image: string): string {
  const prefix = flyImageMirrorPrefix();
  if (!prefix) {
    throw new Error('FLY_IMAGE_MIRROR_PREFIX is not configured');
  }
  if (image.startsWith('registry.fly.io/')) return image;
  const lastColon = image.lastIndexOf(':');
  const tag = lastColon > image.lastIndexOf('/') ? image.slice(lastColon + 1) : 'latest';
  return `${prefix}:${tag}`;
}

export function parseFlyMemoryMb(raw = process.env.FLY_MACHINE_MEMORY_MB): number {
  const n = Number(raw);
  // Fly requires a multiple of 256.
  return Number.isFinite(n) && n >= 256 && n % 256 === 0 ? n : DEFAULT_MEMORY_MB;
}

export class FlyApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FlyApiError';
    this.status = status;
    Object.setPrototypeOf(this, FlyApiError.prototype);
  }
}

export function isMissingFlyResourceError(err: unknown): boolean {
  if (err instanceof FlyApiError) return err.status === 404;
  const msg = err instanceof Error ? err.message : String(err);
  return /not\s+found|404/i.test(msg);
}

async function flyFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number; maxRetries?: number } = {},
): Promise<T> {
  const token = flyToken();
  if (!token) {
    throw new Error('FLY_API_TOKEN is not configured');
  }
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxRetries = options.maxRetries ?? FLY_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${FLY_MACHINES_API_URL()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (networkErr) {
      if (attempt < maxRetries) {
        log.warn('Fly API network error, retrying', {
          path,
          attempt: attempt + 1,
          error: networkErr instanceof Error ? networkErr.message : String(networkErr),
        });
        await new Promise((r) => setTimeout(r, FLY_RETRY_DELAYS[attempt]));
        continue;
      }
      throw new FlyApiError(0, `Fly API network error after ${maxRetries + 1} attempts: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
    }

    // Retry 5xx and 429 (Machines API: 1 r/s per action per machine, burst 3).
    if ((res.status >= 500 || res.status === 429) && attempt < maxRetries) {
      log.warn('Fly API retryable status', { path, status: res.status, attempt: attempt + 1 });
      await new Promise((r) => setTimeout(r, FLY_RETRY_DELAYS[attempt]));
      continue;
    }

    const text = await res.text();
    if (!res.ok) {
      throw new FlyApiError(res.status, `Fly API ${method} ${path} returned ${res.status}: ${text.substring(0, 300)}`);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }
  throw new FlyApiError(0, 'Fly API: unreachable');
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

export async function createFlyApp(appName: string): Promise<void> {
  try {
    await flyFetch('/v1/apps', {
      method: 'POST',
      body: {
        app_name: appName,
        org_slug: flyOrgSlug(),
        // Per-app private network: claws cannot see each other over 6PN.
        network: appName,
      },
    });
    log.info('Fly app created', { appName });
  } catch (err) {
    // 422 = name taken. Idempotent create: ours from a prior partial deploy.
    if (err instanceof FlyApiError && err.status === 422) {
      log.info('Fly app already exists (reusing)', { appName });
      return;
    }
    throw err;
  }
}

export async function destroyFlyApp(appName: string): Promise<void> {
  await flyFetch(`/v1/apps/${appName}`, { method: 'DELETE' });
  log.info('Fly app destroyed', { appName });
}

// ---------------------------------------------------------------------------
// Shared IPv4 (GraphQL - required for <app>.fly.dev to route)
// ---------------------------------------------------------------------------

async function flyGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = flyToken();
  if (!token) throw new Error('FLY_API_TOKEN is not configured');
  const res = await fetch(FLY_GRAPHQL_URL(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new FlyApiError(res.status, `Fly GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  if (!json.data) throw new FlyApiError(res.status, 'Fly GraphQL returned no data');
  return json.data;
}

/**
 * Query-first (same discipline as Railway DOMAIN_REUSE_QUERY_FIRST): allocate
 * a shared IPv4 only when the app has none. Without an IP, <app>.fly.dev
 * never routes.
 */
export async function ensureSharedIpV4(appName: string): Promise<void> {
  const existing = await flyGraphql<{ app: { sharedIpAddress: string | null } | null }>(
    `query($name: String!) { app(name: $name) { sharedIpAddress } }`,
    { name: appName },
  );
  if (existing.app?.sharedIpAddress) return;

  await flyGraphql(
    `mutation($input: AllocateIPAddressInput!) {
      allocateIpAddress(input: $input) { ipAddress { address } }
    }`,
    { input: { appId: appName, type: 'shared_v4' } },
  );
  log.info('Fly shared IPv4 allocated', { appName });
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

export type FlyMachineState =
  | 'created'
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'suspending'
  | 'suspended'
  | 'replacing'
  | 'destroying'
  | 'destroyed'
  | 'failed';

export interface FlyMachine {
  id: string;
  name: string;
  state: FlyMachineState;
  region: string;
  instance_id?: string;
  private_ip?: string;
  config?: { image?: string; env?: Record<string, string> };
}

/**
 * Full machine config. We own EVERY field (no GET-merge needed): the same
 * env payload builder as Railway (buildRailwayEnvVars) and the same
 * /healthz surface, so a claw boots identically on either provider.
 */
export function buildFlyMachineConfig(args: {
  image: string;
  env: Record<string, string>;
}): Record<string, unknown> {
  return {
    image: args.image,
    env: args.env,
    guest: {
      cpu_kind: 'shared',
      cpus: 1,
      memory_mb: parseFlyMemoryMb(),
      // HWD: rootfs survives machine stop/start (nap/wake). NOT durable
      // storage - the platform state-sync snapshot remains the source of
      // truth (unchanged); this only preserves warm runtime files between
      // naps, matching Railway's keep-service semantics.
      persist_rootfs: 'restart',
    },
    services: [
      {
        protocol: 'tcp',
        internal_port: FLY_INTERNAL_PORT,
        // Never let the Fly proxy auto-stop/start machines: wake MUST go
        // through canWakeHibernatedWorkspace (same rider as Railway's
        // sleepApplication=false).
        autostop: 'off',
        autostart: false,
        ports: [
          { port: 443, handlers: ['tls', 'http'] },
          { port: 80, handlers: ['http'] },
        ],
      },
    ],
    checks: {
      healthz: {
        type: 'http',
        port: FLY_INTERNAL_PORT,
        method: 'GET',
        path: '/healthz',
        interval: '15s',
        timeout: '10s',
      },
    },
    restart: { policy: 'on-failure', max_retries: 3 },
  };
}

export async function createFlyMachine(
  appName: string,
  args: { name: string; image: string; env: Record<string, string> },
): Promise<FlyMachine> {
  const machine = await flyFetch<FlyMachine>(`/v1/apps/${appName}/machines`, {
    method: 'POST',
    body: {
      name: args.name,
      region: flyRegion(),
      config: buildFlyMachineConfig({ image: args.image, env: args.env }),
    },
  });
  log.info('Fly machine created', { appName, machineId: machine.id, region: machine.region });
  return machine;
}

/** Full-config replace (Machines API has no PATCH). Triggers a boot cycle. */
export async function updateFlyMachineConfig(
  appName: string,
  machineId: string,
  args: { image: string; env: Record<string, string> },
): Promise<FlyMachine> {
  const machine = await flyFetch<FlyMachine>(`/v1/apps/${appName}/machines/${machineId}`, {
    method: 'POST',
    body: { config: buildFlyMachineConfig({ image: args.image, env: args.env }) },
  });
  log.info('Fly machine config updated', { appName, machineId });
  return machine;
}

export async function getFlyMachine(appName: string, machineId: string): Promise<FlyMachine> {
  return flyFetch<FlyMachine>(`/v1/apps/${appName}/machines/${machineId}`);
}

export async function listFlyMachines(appName: string): Promise<FlyMachine[]> {
  return (await flyFetch<FlyMachine[]>(`/v1/apps/${appName}/machines`)) ?? [];
}

export async function startFlyMachine(appName: string, machineId: string): Promise<void> {
  try {
    await flyFetch(`/v1/apps/${appName}/machines/${machineId}/start`, { method: 'POST' });
  } catch (err) {
    // Per Fly docs it is safe to start a running machine and ignore the error.
    const msg = err instanceof Error ? err.message : String(err);
    if (/already|started/i.test(msg)) {
      log.info('Fly machine already started', { appName, machineId });
      return;
    }
    throw err;
  }
  log.info('Fly machine started', { appName, machineId });
}

/** HWD nap: machine + app + domain persist; rootfs persists (persist_rootfs). */
export async function stopFlyMachine(appName: string, machineId: string): Promise<void> {
  await flyFetch(`/v1/apps/${appName}/machines/${machineId}/stop`, { method: 'POST' });
  log.info('Fly machine stopped (nap - app/domain kept)', { appName, machineId });
}

export async function restartFlyMachine(appName: string, machineId: string): Promise<void> {
  await flyFetch(`/v1/apps/${appName}/machines/${machineId}/restart`, { method: 'POST' });
  log.info('Fly machine restarted', { appName, machineId });
}

export async function waitForFlyMachineState(
  appName: string,
  machineId: string,
  state: 'started' | 'stopped' | 'destroyed',
  timeoutSec = 60,
): Promise<void> {
  await flyFetch(
    `/v1/apps/${appName}/machines/${machineId}/wait?state=${state}&timeout=${timeoutSec}`,
    { timeoutMs: (timeoutSec + 10) * 1000, maxRetries: 1 },
  );
}

/** Terminal teardown only (no pool on Fly - machine creates are uncapped). */
export async function destroyFlyMachine(appName: string, machineId: string): Promise<void> {
  await flyFetch(`/v1/apps/${appName}/machines/${machineId}?force=true`, { method: 'DELETE' });
  log.info('Fly machine destroyed', { appName, machineId });
}

/**
 * Best-effort recent logs. The Machines REST API has no logs endpoint
 * (Phase A partial gap) - this uses the legacy api.fly.io list endpoint and
 * degrades to a placeholder on any failure.
 */
export async function getFlyLogs(appName: string, lines = 100): Promise<string> {
  const token = flyToken();
  if (!token) return '[Fly logs unavailable: FLY_API_TOKEN not configured]';
  try {
    const res = await fetch(
      `https://api.fly.io/api/v1/apps/${appName}/logs`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return `[Fly logs unavailable: ${res.status}]`;
    const json = (await res.json()) as {
      data?: Array<{ attributes?: { timestamp?: string; message?: string } }>;
    };
    const rows = (json.data ?? [])
      .map((d) => `${d.attributes?.timestamp ?? ''} ${d.attributes?.message ?? ''}`)
      .slice(-lines);
    return rows.length > 0 ? rows.join('\n') : '[No Fly logs returned]';
  } catch {
    return '[Failed to fetch logs from Fly]';
  }
}
