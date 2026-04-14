import { log } from '@/lib/logger';

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
  'const u=process.env.CLAWS_PUBLIC_URL;',
  'if(u&&fs.existsSync(f)){',
  'const c=JSON.parse(fs.readFileSync(f,"utf8"));',
  'if(!c.gateway)c.gateway={};',
  'if(!c.gateway.controlUi)c.gateway.controlUi={};',
  'const o=c.gateway.controlUi.allowedOrigins||["http://localhost:18789","http://127.0.0.1:18789"];',
  'if(!o.includes(u))o.push(u);',
  'c.gateway.controlUi.allowedOrigins=o;',
  'fs.writeFileSync(f,JSON.stringify(c,null,2));',
  'console.log("Patched allowedOrigins:",o)}',
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
echo "Starting gateway on port $PORT..."
exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port \${PORT:-18789}
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

async function railwayGql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!RAILWAY_TOKEN) {
    throw new Error('RAILWAY_API_TOKEN is not configured');
  }

  const res = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RAILWAY_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Railway API returned ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as GqlResponse<T>;

  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Railway GraphQL error: ${msg}`);
  }

  if (!json.data) {
    throw new Error('Railway API returned no data');
  }

  return json.data;
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
}): Promise<RailwayServiceResult> {
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
        source: { image: OPENCLAW_IMAGE },
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

export async function updateAndRedeployService(
  serviceId: string,
  envVars: Record<string, string>,
): Promise<{ serviceId: string; domain: string }> {
  await railwayGql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
    }`,
    {
      serviceId,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      input: {
        source: { image: OPENCLAW_IMAGE },
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
    // Domain already exists -- leave domain empty so the caller
    // falls back to the previously stored workspace.containerHost.
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
