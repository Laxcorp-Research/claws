import { log } from '@/lib/logger';
import type { RawContainerEnv } from './container-env-actual';
import {
  planServiceDomainCap,
  isRailwayDomainCapError,
  RailwayDomainCapError,
  type ServiceDomainRecord,
} from './service-domain';

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

const RAILWAY_TOKEN = process.env.RAILWAY_API_TOKEN;
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID;
const CLAWS_ENV = process.env.CLAWS_ENV;
const PROD_RAILWAY_PROJECT_ID_ENV = process.env.PROD_RAILWAY_PROJECT_ID;
const STAGING_RAILWAY_PROJECT_ID_ENV = process.env.STAGING_RAILWAY_PROJECT_ID;

export const PROD_RAILWAY_PROJECT_ID = '00000000-0000-4000-8000-000000000003';
export const STAGING_RAILWAY_PROJECT_ID = '00000000-0000-4000-8000-000000000004';

const OPENCLAW_IMAGE =
  process.env.OPENCLAW_DOCKER_IMAGE ?? 'ghcr.io/laxcorp-research/openclaw-runtime:latest';

const GHCR_USERNAME = process.env.GHCR_USERNAME;
const GHCR_PAT = process.env.GHCR_PAT;

export const UNPACK_NODE_SCRIPT = [
  'const fs=require("fs"),path=require("path"),z=require("zlib");',
  'const b=s=>Buffer.from(s,"base64").toString();',
  'const g=s=>z.gunzipSync(Buffer.from(s,"base64")).toString();',
  'const w=(p,c)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,c)};',
  'const wa=(p,c)=>{if(fs.existsSync(p))return;w(p,c)};',
  'const safe=p=>typeof p==="string"&&!p.includes("..")&&!path.isAbsolute(p);',
  'const d=process.env.CLAWS_UNPACK_DIR||"/home/node/.openclaw/";',
  'fs.mkdirSync(d,{recursive:true});',
  'if(process.env.CLAWS_CONFIG_GZ_B64)w(path.join(d,"openclaw.json"),g(process.env.CLAWS_CONFIG_GZ_B64));else if(process.env.CLAWS_CONFIG_B64)w(path.join(d,"openclaw.json"),b(process.env.CLAWS_CONFIG_B64));',
  'if(process.env.CLAWS_ENV_GZ_B64)w(path.join(d,".env"),g(process.env.CLAWS_ENV_GZ_B64));else if(process.env.CLAWS_ENV_B64)w(path.join(d,".env"),b(process.env.CLAWS_ENV_B64));',
  'if(process.env.CLAWS_FILES_GZ_B64){const f=JSON.parse(g(process.env.CLAWS_FILES_GZ_B64));for(const[p,c]of Object.entries(f))if(safe(p))w(path.join(d,p),String(c))}else if(process.env.CLAWS_FILES_B64){const f=JSON.parse(b(process.env.CLAWS_FILES_B64));for(const[p,c]of Object.entries(f))if(safe(p))w(path.join(d,p),String(c))};',
  'if(process.env.CLAWS_SEED_FILES_GZ_B64){const f=JSON.parse(g(process.env.CLAWS_SEED_FILES_GZ_B64));for(const[p,c]of Object.entries(f))if(safe(p))wa(path.join(d,p),String(c))}else if(process.env.CLAWS_SEED_FILES_B64){const f=JSON.parse(b(process.env.CLAWS_SEED_FILES_B64));for(const[p,c]of Object.entries(f))if(safe(p))wa(path.join(d,p),String(c))};',
  // INFRA-5 A4: relative shared/... from a worker cwd must hit host shared/.
  // Target is ../shared (equals /home/node/.openclaw/shared in prod). Do not
  // replace an existing real directory. No single quotes: this script is
  // embedded in a sh -e string.
  'const ln=()=>{const h=path.join(d,"shared");fs.mkdirSync(h,{recursive:true});for(const n of fs.readdirSync(d)){if(!n.startsWith("workspace-"))continue;const ws=path.join(d,n);try{if(!fs.statSync(ws).isDirectory())continue}catch(e){continue}const l=path.join(ws,"shared");if(fs.existsSync(l))continue;try{fs.symlinkSync(path.join("..","shared"),l,"dir")}catch(e){if(process.platform==="win32")fs.symlinkSync(h,l,"junction");else throw e}}};',
  'ln();',
  'console.log("Unpack complete. Files:",fs.readdirSync(d).join(", "))',
].join('');

const PATCH_ORIGINS_SCRIPT = [
  'const fs=require("fs");',
  'const f="/home/node/.openclaw/openclaw.json";',
  'const rd=process.env.RAILWAY_PUBLIC_DOMAIN;',
  'const u=rd?("https://"+rd):process.env.CLAWS_PUBLIC_URL;',
  'if(u&&fs.existsSync(f)){',
  'const c=JSON.parse(fs.readFileSync(f,"utf8"));',
  'if(!c.gateway)c.gateway={};',
  'if(!c.gateway.controlUi)c.gateway.controlUi={};',
  'const o=c.gateway.controlUi.allowedOrigins||["http://localhost:18789","http://127.0.0.1:18789"];',
  'if(!o.includes(u))o.push(u);',
  'c.gateway.controlUi.allowedOrigins=o;',
  'const tp=Array.isArray(c.gateway.trustedProxies)?c.gateway.trustedProxies:[];',
  'for(const p of ["100.64.0.0/10","10.0.0.0/8","172.16.0.0/12"]){if(!tp.includes(p))tp.push(p)}',
  'c.gateway.trustedProxies=tp;',
  'fs.writeFileSync(f,JSON.stringify(c,null,2));',
  'console.log("Patched allowedOrigins:",o)',
  '}else{console.log("No public URL found, skipping origin patch. RAILWAY_PUBLIC_DOMAIN="+rd)}',
].join('');

const BOOT_SCRIPT = `#!/bin/sh
exec 2>&1
echo "=== CLAWS BOOT ==="
echo "PWD: $(pwd)"
echo "PORT: $PORT"
echo "NODE: $(node --version)"
echo "Unpacking config..."
node -e '${UNPACK_NODE_SCRIPT}'
node -e '${PATCH_ORIGINS_SCRIPT}'
if [ -f "/usr/local/bin/process-manager.mjs" ]; then
  echo "Starting via process-manager (credit_mode=\${CLAWS_CREDIT_MODE:-false})..."
  exec node /usr/local/bin/process-manager.mjs
else
  echo "Starting gateway on port $PORT..."
  exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port \${PORT:-18789}
fi
`;

export const BOOT_SCRIPT_B64 = Buffer.from(BOOT_SCRIPT).toString('base64');

export const START_COMMAND =
  '/bin/sh -c "echo $CLAWS_BOOT_B64 | base64 -d > /tmp/boot.sh && exec sh /tmp/boot.sh"';

/** Rider-2: Railway serverless auto-wakes on HTTP to the kept domain and would skip canWakeHibernatedWorkspace. */
export const SLEEP_APPLICATION_BYPASSES_ENTITLEMENT_GATE =
  'sleepApplication_bypasses_entitlement_gate';

export function assertSleepApplicationNeverEnabled(input: {
  sleepApplication?: boolean | null;
}): void {
  if (input.sleepApplication === true) {
    throw new Error(
      `${SLEEP_APPLICATION_BYPASSES_ENTITLEMENT_GATE}: Railway serverless auto-wake would skip canWakeHibernatedWorkspace`,
    );
  }
}

function buildServiceInstanceUpdateInput(imageToUse: string): {
  source: { image: string };
  startCommand: string;
  healthcheckPath: string;
  healthcheckTimeout: number;
  sleepApplication: false;
  registryCredentials?: { username: string; password: string };
} {
  const input = {
    source: { image: imageToUse },
    startCommand: START_COMMAND,
    healthcheckPath: '/healthz',
    healthcheckTimeout: 120,
    // Explicit false - omitting the field is not an assert. Never enable serverless.
    sleepApplication: false as const,
    ...(GHCR_USERNAME && GHCR_PAT
      ? { registryCredentials: { username: GHCR_USERNAME, password: GHCR_PAT } }
      : {}),
  };
  assertSleepApplicationNeverEnabled(input);
  return input;
}

// ---------------------------------------------------------------------------
// Configuration check
// ---------------------------------------------------------------------------

type ClawsDeployEnvironment = 'staging' | 'production';

function normalizeClawsEnv(value: string | undefined): ClawsDeployEnvironment | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'staging' || normalized === 'production') return normalized;
  return null;
}

function warnOnProjectReferenceDrift(): void {
  if (PROD_RAILWAY_PROJECT_ID_ENV?.trim() && PROD_RAILWAY_PROJECT_ID_ENV.trim() !== PROD_RAILWAY_PROJECT_ID) {
    log.warn('PROD_RAILWAY_PROJECT_ID env does not match baked production Railway project id', {
      envProjectId: PROD_RAILWAY_PROJECT_ID_ENV.trim(),
      bakedProjectId: PROD_RAILWAY_PROJECT_ID,
    });
  }

  if (STAGING_RAILWAY_PROJECT_ID_ENV?.trim() && STAGING_RAILWAY_PROJECT_ID_ENV.trim() !== STAGING_RAILWAY_PROJECT_ID) {
    log.warn('STAGING_RAILWAY_PROJECT_ID env does not match baked staging Railway project id', {
      envProjectId: STAGING_RAILWAY_PROJECT_ID_ENV.trim(),
      bakedProjectId: STAGING_RAILWAY_PROJECT_ID,
    });
  }
}

export function isRailwayConfigured(): boolean {
  warnOnProjectReferenceDrift();
  return !!(normalizeClawsEnv(CLAWS_ENV) && RAILWAY_TOKEN && RAILWAY_PROJECT_ID && RAILWAY_ENVIRONMENT_ID);
}

export function getRailwayTargetProvenance(): {
  railwayProjectId: string | null;
  railwayEnvironmentId: string | null;
} {
  if (!isRailwayConfigured()) {
    return { railwayProjectId: null, railwayEnvironmentId: null };
  }

  return {
    railwayProjectId: RAILWAY_PROJECT_ID ?? null,
    railwayEnvironmentId: RAILWAY_ENVIRONMENT_ID ?? null,
  };
}

export function assertRailwayTargetAllowed(): void {
  warnOnProjectReferenceDrift();

  const clawsEnv = normalizeClawsEnv(CLAWS_ENV);
  if (!clawsEnv) {
    throw new Error('Railway is not configured for this app environment. Set CLAWS_ENV to "staging" or "production".');
  }

  if (clawsEnv === 'staging' && RAILWAY_PROJECT_ID === PROD_RAILWAY_PROJECT_ID) {
    throw new Error('Refusing staging deploy into production Railway project');
  }

  if (clawsEnv === 'production' && RAILWAY_PROJECT_ID !== PROD_RAILWAY_PROJECT_ID) {
    throw new Error('Refusing production deploy outside production Railway project');
  }

  if (clawsEnv === 'staging' && RAILWAY_PROJECT_ID !== STAGING_RAILWAY_PROJECT_ID) {
    throw new Error('Staging RAILWAY_PROJECT_ID does not match STAGING_RAILWAY_PROJECT_ID');
  }
}

// ---------------------------------------------------------------------------
// GraphQL helper
// ---------------------------------------------------------------------------

interface GqlResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{ message: string }>;
}

const RAILWAY_MAX_RETRIES = 3;
const RAILWAY_RETRY_DELAYS = [1000, 3000, 8000];

/**
 * Typed Railway API failure. `status` is the HTTP status (401, 404, 429, 5xx),
 * `0` for a transport/network failure with no HTTP response, or the 2xx status
 * that carried a GraphQL `errors[]` payload. Lets callers (the PR-8
 * reconciliation cron) branch on the failure kind without string-matching the
 * message. Extends Error, so existing broad `catch` sites are unaffected.
 */
export class RailwayApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RailwayApiError';
    this.status = status;
    Object.setPrototypeOf(this, RailwayApiError.prototype);
  }
}

/**
 * Parse a `Retry-After` header to milliseconds. Railway sends seconds (per the
 * public-API rate-limit docs); an HTTP-date form is tolerated defensively.
 * Returns `null` when absent/unparseable → caller falls back to default backoff.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

async function railwayGql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
  options?: { timeoutMs?: number; maxRetries?: number },
): Promise<T> {
  if (!RAILWAY_TOKEN) {
    throw new Error('RAILWAY_API_TOKEN is not configured');
  }

  // PR-8a/C: timeout + retry budget are tunable per call. Defaults preserve the
  // original behavior (90s timeout, 3 retries) for the deploy/write callers; the
  // reconciliation cron passes a tight budget ({ timeoutMs: 10_000, maxRetries:
  // 1 }) so one slow/hung Railway read can't blow the 55s cron tick.
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const maxRetries = options?.maxRetries ?? RAILWAY_MAX_RETRIES;

  const body = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;

    try {
      res = await fetch(RAILWAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RAILWAY_TOKEN}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (networkErr) {
      if (attempt < maxRetries) {
        log.warn('Railway API network error, retrying', {
          attempt: attempt + 1,
          error: networkErr instanceof Error ? networkErr.message : String(networkErr),
        });
        await new Promise((r) => setTimeout(r, RAILWAY_RETRY_DELAYS[attempt]));
        continue;
      }
      throw new RailwayApiError(0, `Railway API network error after ${maxRetries + 1} attempts: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
    }

    if (res.ok) {
      const json = (await res.json()) as GqlResponse<T>;

      if (json.errors?.length) {
        const msg = json.errors.map((e) => e.message).join('; ');
        throw new RailwayApiError(res.status, `Railway GraphQL error: ${msg}`);
      }

      if (!json.data) {
        throw new RailwayApiError(res.status, 'Railway API returned no data');
      }

      return json.data;
    }

    if (res.status >= 500 && attempt < maxRetries) {
      log.warn('Railway API 5xx, retrying', { status: res.status, attempt: attempt + 1 });
      await new Promise((r) => setTimeout(r, RAILWAY_RETRY_DELAYS[attempt]));
      continue;
    }

    // PR-8a/B: honor 429 rate limiting. Railway sends Retry-After (seconds);
    // sleep that long (or the default backoff if absent) and retry within the
    // existing budget. The read-heavy reconciliation cron is the first caller
    // that can realistically hit this (limits: 1000 RPH Hobby / 10000 Pro).
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
      const delay = retryAfterMs ?? RAILWAY_RETRY_DELAYS[attempt];
      log.warn('Railway API 429 rate-limited, retrying', {
        attempt: attempt + 1,
        delayMs: delay,
        retryAfter: res.headers.get('retry-after') ?? null,
      });
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const respBody = await res.text();
    const isHtml = respBody.trimStart().startsWith('<');
    const detail = isHtml ? `(HTML error page)` : respBody.substring(0, 200);
    throw new RailwayApiError(res.status, `Railway API returned ${res.status}: ${detail}`);
  }

  throw new RailwayApiError(0, 'Railway API: unreachable');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RailwayServiceResult {
  serviceId: string;
  domain: string;
}

export type RailwayDeploymentStatus =
  | 'BUILDING'
  | 'DEPLOYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CRASHED'
  | 'REMOVED'
  | 'SLEEPING'
  | 'SKIPPED'
  | 'WAITING'
  | 'QUEUED';

export interface RailwayServiceStatus {
  healthy: boolean;
  status: RailwayDeploymentStatus | 'NO_DEPLOYMENT';
  deploymentId: string | null;
  createdAt: string | null;
}

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

export async function createService(config: {
  name: string;
  envVars: Record<string, string>;
  // PR-1: caller (deployer.resolveDeployImage) picks the image from the
  // canonical OpenClawVersion stable row at deploy time. When omitted, we
  // fall back to the module-level OPENCLAW_IMAGE (env var or hardcoded
  // default) so callers that haven't migrated keep working.
  image?: string;
}): Promise<RailwayServiceResult> {
  assertRailwayTargetAllowed();
  const imageToUse = config.image ?? OPENCLAW_IMAGE;

  const createData = await railwayGql<{ serviceCreate: { id: string } }>(
    `mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id }
    }`,
    {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        name: config.name.substring(0, 32),
      },
    },
  );

  const serviceId = createData.serviceCreate.id;

  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    {
      serviceId,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      input: buildServiceInstanceUpdateInput(imageToUse),
    },
  );

  await railwayGql(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        environmentId: RAILWAY_ENVIRONMENT_ID,
        serviceId,
        variables: config.envVars,
        replace: true,
      },
    },
  );

  // DOMAIN_REUSE_QUERY_FIRST - list via domains(), create only when zero exist.
  const domain = await ensureServiceDomain(serviceId);

  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID },
  );

  log.info('Railway service created', { serviceId, domain, name: config.name });

  return { serviceId, domain };
}

export async function findServiceByName(name: string): Promise<string | null> {
  const data = await railwayGql<{
    project: { services: { edges: Array<{ node: { id: string; name: string } }> } };
  }>(
    `query($id: String!) {
      project(id: $id) { services { edges { node { id name } } } }
    }`,
    { id: RAILWAY_PROJECT_ID },
  );

  const match = data.project.services.edges.find((e) => e.node.name === name);
  return match?.node.id ?? null;
}

/**
 * Live list. Must use domains(projectId, environmentId, serviceId).
 * The environment.config map is hostname -> {}, not an array; do not
 * read index 0 from it. Throw on query failure (never swallow as empty).
 */
export async function listServiceDomains(serviceId: string): Promise<ServiceDomainRecord[]> {
  const data = await railwayGql<{
    domains: { serviceDomains: Array<{ id: string; domain: string; createdAt: string }> | null };
  }>(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        serviceDomains { id domain createdAt }
      }
    }`,
    {
      projectId: RAILWAY_PROJECT_ID,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      serviceId,
    },
  );

  return data.domains?.serviceDomains ?? [];
}

async function deleteServiceDomain(id: string): Promise<void> {
  await railwayGql(
    `mutation($id: String!) {
      serviceDomainDelete(id: $id)
    }`,
    { id },
  );
}

async function createServiceDomain(serviceId: string): Promise<string> {
  const domainData = await railwayGql<{
    serviceDomainCreate: { domain: string };
  }>(
    `mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }`,
    {
      input: {
        serviceId,
        environmentId: RAILWAY_ENVIRONMENT_ID,
      },
    },
  );

  return domainData.serviceDomainCreate.domain;
}

async function pruneServiceDomains(extras: ServiceDomainRecord[]): Promise<void> {
  for (const extra of extras) {
    await deleteServiceDomain(extra.id);
  }
}

/**
 * DOMAIN_REUSE_QUERY_FIRST: list, reuse one, create only when zero exist.
 * Cap error -> prune extras then retry once; never throw a GraphQL cap string.
 */
export async function ensureServiceDomain(
  serviceId: string,
  preferredHost?: string | null,
): Promise<string> {
  const existing = await listServiceDomains(serviceId);
  const plan = planServiceDomainCap({ existing, preferredHost });
  if (plan.prune.length > 0) {
    log.info('Pruning extra Railway service domains', {
      serviceId,
      keep: plan.keep?.domain ?? null,
      pruneCount: plan.prune.length,
    });
    await pruneServiceDomains(plan.prune);
  }
  if (plan.keep && !plan.create) {
    log.info('Reusing existing Railway service domain', { serviceId, domain: plan.keep.domain });
    return plan.keep.domain;
  }

  try {
    return await createServiceDomain(serviceId);
  } catch (err) {
    if (!isRailwayDomainCapError(err)) throw err;
    log.warn('Railway domain cap on create; pruning and retrying', {
      serviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    const again = await listServiceDomains(serviceId);
    const heal = planServiceDomainCap({ existing: again, preferredHost });
    await pruneServiceDomains(heal.prune);
    if (heal.keep && !heal.create) {
      return heal.keep.domain;
    }
    try {
      return await createServiceDomain(serviceId);
    } catch (retryErr) {
      log.error('Railway domain cap heal failed after prune+retry', {
        serviceId,
        error: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
      throw new RailwayDomainCapError();
    }
  }
}

export async function updateAndRedeployService(
  serviceId: string,
  envVars: Record<string, string>,
  // PR-1: explicit image at the call site (from deployer.resolveDeployImage).
  // Falls back to the module-level OPENCLAW_IMAGE when omitted.
  image?: string,
  preferredHost?: string | null,
): Promise<{ serviceId: string; domain: string }> {
  assertRailwayTargetAllowed();
  const imageToUse = image ?? OPENCLAW_IMAGE;

  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    {
      serviceId,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      input: buildServiceInstanceUpdateInput(imageToUse),
    },
  );

  await railwayGql(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        environmentId: RAILWAY_ENVIRONMENT_ID,
        serviceId,
        variables: envVars,
        replace: true,
      },
    },
  );

  // DOMAIN_REUSE_QUERY_FIRST - same path as createService.
  const domain = await ensureServiceDomain(serviceId, preferredHost);

  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID },
  );

  log.info('Railway service updated and redeployed', { serviceId, domain });
  return { serviceId, domain };
}

/**
 * Railway serviceDelete. Since the service pool landed, terminal teardown
 * RECYCLES services back into the pool instead of deleting them (a delete
 * burns banked serviceCreate budget). Allowed callers only:
 *   - service-pool fallback: pool disabled (SERVICE_POOL_ENABLED=false) or a
 *     recycle that cannot proceed - see src/lib/railway/service-pool.ts
 *   - ops/admin cleanup scripts
 * Hibernate MUST use removeLatestDeployment, never this.
 */
export async function deleteService(serviceId: string): Promise<void> {
  assertRailwayTargetAllowed();
  await railwayGql(
    `mutation($id: String!) {
      serviceDelete(id: $id)
    }`,
    { id: serviceId },
  );

  log.info('Railway service deleted', { serviceId });
}

// ---------------------------------------------------------------------------
// Service pool primitives (see src/lib/railway/service-pool.ts)
// ---------------------------------------------------------------------------

/**
 * Rename a service (pool checkout takes the `claw-<wsId>` name so
 * adopt-by-name keeps working; recycle takes a `pool-*` name so a READY
 * banked service can never be adopted outside the pool state machine).
 */
export async function renameService(serviceId: string, name: string): Promise<void> {
  assertRailwayTargetAllowed();
  await railwayGql(
    `mutation($id: String!, $input: ServiceUpdateInput!) {
      serviceUpdate(id: $id, input: $input)
    }`,
    { id: serviceId, input: { name: name.substring(0, 32) } },
  );
  log.info('Railway service renamed', { serviceId, name });
}

/**
 * Bank an EMPTY service for the pool: serviceCreate + domain mint only.
 * Deliberately NO serviceInstanceUpdate and NO serviceInstanceDeployV2 -
 * an empty service with no deployment costs $0; checkout's
 * updateAndRedeployService sets image/startCommand/healthcheck/env exactly
 * like a fresh createService would (boots identically - Rule-36).
 *
 * Domain mint failure is tolerated (domain: null): ensureServiceDomain heals
 * at checkout via the same query-first path.
 */
export async function createEmptyPooledService(
  name: string,
): Promise<{ serviceId: string; domain: string | null }> {
  assertRailwayTargetAllowed();

  const createData = await railwayGql<{ serviceCreate: { id: string } }>(
    `mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id }
    }`,
    {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        name: name.substring(0, 32),
      },
    },
  );
  const serviceId = createData.serviceCreate.id;

  let domain: string | null = null;
  try {
    domain = await ensureServiceDomain(serviceId);
  } catch (err) {
    log.warn('Pool bank: domain mint failed; banking domainless (heals at checkout)', {
      serviceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info('Railway empty service banked for pool', { serviceId, domain, name });
  return { serviceId, domain };
}

/**
 * Volume ids attached to a service (any environment). Recycle privacy gate:
 * every one of these MUST be destroyed before a pooled service flips READY.
 * Throws on query failure - the caller must treat "cannot verify" as unsafe.
 */
export async function listServiceVolumeIds(serviceId: string): Promise<string[]> {
  const data = await railwayGql<{
    project: {
      volumes: {
        edges: Array<{
          node: {
            id: string;
            volumeInstances: { edges: Array<{ node: { serviceId: string | null } }> };
          };
        }>;
      };
    };
  }>(
    `query($id: String!) {
      project(id: $id) {
        volumes {
          edges {
            node {
              id
              volumeInstances { edges { node { serviceId } } }
            }
          }
        }
      }
    }`,
    { id: RAILWAY_PROJECT_ID },
  );

  const edges = data.project.volumes?.edges ?? [];
  return edges
    .filter((e) =>
      (e.node.volumeInstances?.edges ?? []).some((vi) => vi.node.serviceId === serviceId),
    )
    .map((e) => e.node.id);
}

/** Permanently destroy a volume and all its data (recycle privacy gate). */
export async function deleteVolume(volumeId: string): Promise<void> {
  assertRailwayTargetAllowed();
  await railwayGql(
    `mutation($id: String!) {
      volumeDelete(id: $id)
    }`,
    { id: volumeId },
  );
  log.info('Railway volume destroyed', { volumeId });
}

/** Light project service count (single query - refill ceiling guard). */
export async function countProjectServices(): Promise<number> {
  const data = await railwayGql<{
    project: { services: { edges: Array<{ node: { id: string } }> } };
  }>(
    `query($id: String!) {
      project(id: $id) { services { edges { node { id } } } }
    }`,
    { id: RAILWAY_PROJECT_ID },
  );
  return data.project.services.edges.length;
}

/**
 * Remove one Railway deployment; the Service + ServiceDomain + variables remain.
 * HWD hibernate path. Does not count against the 25/day serviceCreate quota.
 */
export async function removeDeployment(deploymentId: string): Promise<void> {
  assertRailwayTargetAllowed();
  await railwayGql(
    `mutation($id: String!) {
      deploymentRemove(id: $id)
    }`,
    { id: deploymentId },
  );
  log.info('Railway deployment removed (service kept)', { deploymentId });
}

/**
 * Remove the latest deployment on a service if one is still running/listed.
 * Idempotent when already REMOVED / NO_DEPLOYMENT (hibernated-with-service).
 */
export async function removeLatestDeployment(serviceId: string): Promise<string | null> {
  const status = await getServiceStatus(serviceId);
  if (
    !status.deploymentId ||
    status.status === 'NO_DEPLOYMENT' ||
    status.status === 'REMOVED'
  ) {
    log.info('Railway latest deployment already gone', {
      serviceId,
      status: status.status,
    });
    return null;
  }

  await removeDeployment(status.deploymentId);
  return status.deploymentId;
}

export async function redeployService(serviceId: string): Promise<void> {
  assertRailwayTargetAllowed();
  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID },
  );

  log.info('Railway service redeployed', { serviceId });
}

export async function updateServiceVariables(
  serviceId: string,
  variables: Record<string, string>,
): Promise<void> {
  assertRailwayTargetAllowed();
  await railwayGql(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        environmentId: RAILWAY_ENVIRONMENT_ID,
        serviceId,
        variables,
        replace: true,
      },
    },
  );
}

/**
 * SECURITY - RAW SECRET MATERIAL. Returns the service's FULL rendered env: real
 * ANTHROPIC keys, gateway/Composio tokens, channel tokens, CLAWS_ENV_GZ_B64 /
 * legacy CLAWS_ENV_B64, etc.
 * The result is branded `RawContainerEnv` and must flow ONLY into the
 * credential-comparison reducer (fingerprints/booleans) - NEVER logged,
 * returned in a response, or persisted. See container-env-actual.ts banner +
 * CONTAINER_ENV_RECONCILIATION_CONTRACT.md §6.
 *
 * Read counterpart to updateServiceVariables. Uses Railway's `variables` query,
 * verified by live introspection to return the NON_NULL scalar
 * `EnvironmentVariables!` - a flat Record<string,string> of RENDERED (resolved)
 * values, i.e. exactly what the container runs with. `unrendered` is omitted on
 * purpose so references resolve to their real values for comparison.
 *
 * `options` (PR-8a/C) tunes the timeout + retry budget. Defaults match the rest
 * of the client (90s / 3 retries); the reconciliation cron passes a tight
 * budget so a single slow/hung read can't blow the tick.
 */
export async function getServiceVariables(
  serviceId: string,
  options?: { timeoutMs?: number; maxRetries?: number },
): Promise<RawContainerEnv> {
  const data = await railwayGql<{ variables: Record<string, string> | null }>(
    `query($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    {
      projectId: RAILWAY_PROJECT_ID,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      serviceId,
    },
    options,
  );
  // Schema is EnvironmentVariables! (non-null), but coerce defensively: a
  // deleted/missing service can surface as null data downstream. Empty map is
  // the right "nothing to compare" signal for the cron.
  return (data.variables ?? {}) as RawContainerEnv;
}

// ---------------------------------------------------------------------------
// Status & logs
// ---------------------------------------------------------------------------

export async function getServiceStatus(
  serviceId: string,
): Promise<RailwayServiceStatus> {
  const data = await railwayGql<{
    deployments: {
      edges: Array<{
        node: {
          id: string;
          status: RailwayDeploymentStatus;
          createdAt: string;
        };
      }>;
    };
  }>(
    `query($input: DeploymentListInput!) {
      deployments(first: 1, input: $input) {
        edges { node { id status createdAt } }
      }
    }`,
    {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        environmentId: RAILWAY_ENVIRONMENT_ID,
        serviceId,
      },
    },
  );

  const latest = data.deployments.edges[0]?.node;
  if (!latest) {
    return { healthy: false, status: 'NO_DEPLOYMENT', deploymentId: null, createdAt: null };
  }

  return {
    healthy: latest.status === 'SUCCESS',
    status: latest.status,
    deploymentId: latest.id,
    createdAt: latest.createdAt,
  };
}

export async function getServiceLogs(
  serviceId: string,
  lines = 100,
): Promise<string> {
  const statusInfo = await getServiceStatus(serviceId);
  if (!statusInfo.deploymentId) return '[No deployment found]';

  try {
    const data = await railwayGql<{
      deploymentLogs: Array<{ message: string; timestamp: string }>;
    }>(
      `query($deploymentId: String!, $limit: Int) {
        deploymentLogs(deploymentId: $deploymentId, limit: $limit) { message timestamp }
      }`,
      { deploymentId: statusInfo.deploymentId, limit: lines },
    );

    return (data.deploymentLogs ?? [])
      .map((l) => `${l.timestamp} ${l.message}`)
      .join('\n');
  } catch {
    return '[Failed to fetch logs from Railway]';
  }
}

// ---------------------------------------------------------------------------
// Project-level queries (admin)
// ---------------------------------------------------------------------------

export async function listProjectServices(): Promise<
  Array<{ id: string; name: string; status: string }>
> {
  const data = await railwayGql<{
    project: {
      services: {
        edges: Array<{ node: { id: string; name: string } }>;
      };
    };
  }>(
    `query($id: String!) {
      project(id: $id) {
        services { edges { node { id name } } }
      }
    }`,
    { id: RAILWAY_PROJECT_ID },
  );

  const services = data.project.services.edges.map((e) => e.node);
  const results: Array<{ id: string; name: string; status: string }> = [];

  for (const svc of services) {
    try {
      const st = await getServiceStatus(svc.id);
      results.push({ id: svc.id, name: svc.name, status: st.status });
    } catch {
      results.push({ id: svc.id, name: svc.name, status: 'UNKNOWN' });
    }
  }

  return results;
}
