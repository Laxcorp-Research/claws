import { log } from '@/lib/logger';

const CONTAINER_HOST = process.env.CONTAINER_HOST;
const CONTAINER_SECRET = process.env.CONTAINER_AGENT_SECRET;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContainerCreateParams {
  name: string;
  image: string;
  env: Record<string, string>;
  memoryMb?: number;
  cpus?: number;
  volumeName?: string;
  volumePath?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  running: boolean;
  startedAt: string;
  restartCount: number;
  hostPort: number | null;
}

export interface ContainerCreateResult {
  success: boolean;
  containerId: string;
  name: string;
  hostPort: number | null;
}

export interface ContainerListItem {
  ID: string;
  Names: string;
  Image: string;
  Status: string;
  State: string;
  Ports: string;
}

// ---------------------------------------------------------------------------
// Configuration check
// ---------------------------------------------------------------------------

export function isContainerHostConfigured(): boolean {
  return !!(CONTAINER_HOST && CONTAINER_SECRET);
}

// ---------------------------------------------------------------------------
// Agent HTTP client
// ---------------------------------------------------------------------------

async function agentRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  if (!CONTAINER_HOST || !CONTAINER_SECRET) {
    throw new Error(
      'Container host not configured. Set CONTAINER_HOST and CONTAINER_AGENT_SECRET env vars.',
    );
  }

  const url = `${CONTAINER_HOST}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONTAINER_SECRET}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      throw new Error((data.error as string) || `Agent returned ${res.status}`);
    }

    return data;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Container agent request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkAgentHealth(): Promise<boolean> {
  try {
    if (!CONTAINER_HOST) return false;
    const res = await fetch(`${CONTAINER_HOST}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { status: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

export async function createContainer(
  params: ContainerCreateParams,
): Promise<ContainerCreateResult> {
  log.deployEvent({
    event: 'started',
    workspaceId: params.name,
    userId: 'system',
  });

  const result = await agentRequest(
    'POST',
    '/containers/create',
    params as unknown as Record<string, unknown>,
    60000,
  );
  return result as unknown as ContainerCreateResult;
}

export async function stopContainer(name: string): Promise<void> {
  await agentRequest('POST', `/containers/${name}/stop`);
}

export async function startContainer(
  name: string,
): Promise<{ hostPort: number | null }> {
  const result = await agentRequest('POST', `/containers/${name}/start`);
  return { hostPort: (result.hostPort as number | null) ?? null };
}

export async function restartContainer(
  name: string,
): Promise<{ hostPort: number | null }> {
  const result = await agentRequest('POST', `/containers/${name}/restart`);
  return { hostPort: (result.hostPort as number | null) ?? null };
}

export async function removeContainer(name: string): Promise<void> {
  await agentRequest('DELETE', `/containers/${name}`);
}

export async function inspectContainer(
  name: string,
): Promise<ContainerInfo> {
  const result = await agentRequest('GET', `/containers/${name}`);
  return result as unknown as ContainerInfo;
}

export async function getContainerLogs(
  name: string,
  tail = 100,
): Promise<string> {
  const data = await agentRequest(
    'GET',
    `/containers/${name}/logs?tail=${tail}`,
  );
  return (data.logs as string) ?? '';
}

export async function writeFilesToVolume(
  volumeName: string,
  files: Record<string, string>,
): Promise<void> {
  await agentRequest(
    'POST',
    `/volumes/${volumeName}/files`,
    { files } as Record<string, unknown>,
    60000,
  );
}

export async function listContainers(): Promise<ContainerListItem[]> {
  const data = await agentRequest('GET', '/containers');
  return (data.containers as ContainerListItem[]) ?? [];
}

export async function pullImage(image: string): Promise<void> {
  await agentRequest('POST', '/images/pull', { image }, 120000);
}
