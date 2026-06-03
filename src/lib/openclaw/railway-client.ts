import { log } from '@/lib/logger';
import type { RawContainerEnv } from './container-env-actual';

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

const RAILWAY_TOKEN = process.env.RAILWAY_API_TOKEN;
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID;

const OPENCLAW_IMAGE =
  process.env.OPENCLAW_DOCKER_IMAGE ?? 'ghcr.io/laxcorp-research/openclaw-runtime:latest';

const GHCR_USERNAME = process.env.GHCR_USERNAME;
const GHCR_PAT = process.env.GHCR_PAT;

const UNPACK_NODE_SCRIPT = [
  'const fs=require("fs"),path=require("path");',
  'const b=s=>Buffer.from(s,"base64").toString();',
  'const w=(p,c)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,c)};',
  'const d="/home/node/.openclaw/";',
  'fs.mkdirSync(d,{recursive:true});',
  'if(process.env.CLAWS_CONFIG_B64)w(d+"openclaw.json",b(process.env.CLAWS_CONFIG_B64));',
  'if(process.env.CLAWS_ENV_B64)w(d+".env",b(process.env.CLAWS_ENV_B64));',
  'if(process.env.CLAWS_FILES_B64){const f=JSON.parse(b(process.env.CLAWS_FILES_B64));for(const[p,c]of Object.entries(f))w(d+p,String(c))};',
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

const START_COMMAND =
  '/bin/sh -c "echo $CLAWS_BOOT_B64 | base64 -d > /tmp/boot.sh && exec sh /tmp/boot.sh"';

// ---------------------------------------------------------------------------
// Configuration check
// ---------------------------------------------------------------------------

export function isRailwayConfigured(): boolean {
  return !!(RAILWAY_TOKEN && RAILWAY_PROJECT_ID && RAILWAY_ENVIRONMENT_ID);
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
): Promise<T> {
  if (!RAILWAY_TOKEN) {
    throw new Error('RAILWAY_API_TOKEN is not configured');
  }

  const body = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt <= RAILWAY_MAX_RETRIES; attempt++) {
    let res: Response;

    try {
      res = await fetch(RAILWAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RAILWAY_TOKEN}`,
        },
        body,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (networkErr) {
      if (attempt < RAILWAY_MAX_RETRIES) {
        log.warn('Railway API network error, retrying', {
          attempt: attempt + 1,
          error: networkErr instanceof Error ? networkErr.message : String(networkErr),
        });
        await new Promise((r) => setTimeout(r, RAILWAY_RETRY_DELAYS[attempt]));
        continue;
      }
      throw new RailwayApiError(0, `Railway API network error after ${RAILWAY_MAX_RETRIES + 1} attempts: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
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

    if (res.status >= 500 && attempt < RAILWAY_MAX_RETRIES) {
      log.warn('Railway API 5xx, retrying', { status: res.status, attempt: attempt + 1 });
      await new Promise((r) => setTimeout(r, RAILWAY_RETRY_DELAYS[attempt]));
      continue;
    }

    // PR-8a/B: honor 429 rate limiting. Railway sends Retry-After (seconds);
    // sleep that long (or the default backoff if absent) and retry within the
    // existing budget. The read-heavy reconciliation cron is the first caller
    // that can realistically hit this (limits: 1000 RPH Hobby / 10000 Pro).
    if (res.status === 429 && attempt < RAILWAY_MAX_RETRIES) {
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
      input: {
        source: { image: imageToUse },
        startCommand: START_COMMAND,
        healthcheckPath: '/healthz',
        healthcheckTimeout: 120,
        ...(GHCR_USERNAME && GHCR_PAT ? {
          registryCredentials: { username: GHCR_USERNAME, password: GHCR_PAT },
        } : {}),
      },
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

  const domain = domainData.serviceDomainCreate.domain;

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

async function queryServiceDomain(serviceId: string): Promise<string | null> {
  try {
    const data = await railwayGql<{
      environment: { config: Record<string, unknown> };
    }>(
      `query($envId: String!) {
        environment(id: $envId) { config(decryptVariables: false) }
      }`,
      { envId: RAILWAY_ENVIRONMENT_ID },
    );

    const services = (data.environment.config as Record<string, unknown>).services as
      Record<string, { networking?: { serviceDomains?: string[] } }> | undefined;
    if (!services) return null;

    const svc = services[serviceId];
    const domains = svc?.networking?.serviceDomains;
    return domains?.[0] ?? null;
  } catch (err) {
    log.warn('Failed to query service domain from Railway', { serviceId, error: err });
    return null;
  }
}

export async function updateAndRedeployService(
  serviceId: string,
  envVars: Record<string, string>,
  // PR-1: explicit image at the call site (from deployer.resolveDeployImage).
  // Falls back to the module-level OPENCLAW_IMAGE when omitted.
  image?: string,
): Promise<{ serviceId: string; domain: string }> {
  const imageToUse = image ?? OPENCLAW_IMAGE;

  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    {
      serviceId,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      input: {
        source: { image: imageToUse },
        startCommand: START_COMMAND,
        healthcheckPath: '/healthz',
        healthcheckTimeout: 120,
        ...(GHCR_USERNAME && GHCR_PAT ? {
          registryCredentials: { username: GHCR_USERNAME, password: GHCR_PAT },
        } : {}),
      },
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

  let domain = '';
  try {
    const domainData = await railwayGql<{
      serviceDomainCreate: { domain: string };
    }>(
      `mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { domain }
      }`,
      { input: { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID } },
    );
    domain = domainData.serviceDomainCreate.domain;
  } catch {
    // Domain already exists -- query Railway for the actual domain
    domain = await queryServiceDomain(serviceId) ?? '';
  }

  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId: RAILWAY_ENVIRONMENT_ID },
  );

  log.info('Railway service updated and redeployed', { serviceId, domain });
  return { serviceId, domain };
}

export async function deleteService(serviceId: string): Promise<void> {
  await railwayGql(
    `mutation($id: String!) {
      serviceDelete(id: $id)
    }`,
    { id: serviceId },
  );

  log.info('Railway service deleted', { serviceId });
}

export async function redeployService(serviceId: string): Promise<void> {
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
 * SECURITY — RAW SECRET MATERIAL. Returns the service's FULL rendered env: real
 * ANTHROPIC keys, gateway/Composio tokens, channel tokens, CLAWS_ENV_B64, etc.
 * The result is branded `RawContainerEnv` and must flow ONLY into the
 * credential-comparison reducer (fingerprints/booleans) — NEVER logged,
 * returned in a response, or persisted. See container-env-actual.ts banner +
 * CONTAINER_ENV_RECONCILIATION_CONTRACT.md §6.
 *
 * Read counterpart to updateServiceVariables. Uses Railway's `variables` query,
 * verified by live introspection to return the NON_NULL scalar
 * `EnvironmentVariables!` — a flat Record<string,string> of RENDERED (resolved)
 * values, i.e. exactly what the container runs with. `unrendered` is omitted on
 * purpose so references resolve to their real values for comparison.
 */
export async function getServiceVariables(serviceId: string): Promise<RawContainerEnv> {
  const data = await railwayGql<{ variables: Record<string, string> | null }>(
    `query($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    {
      projectId: RAILWAY_PROJECT_ID,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      serviceId,
    },
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
