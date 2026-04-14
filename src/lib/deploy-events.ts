import { redis } from "./redis";

const KEY_PREFIX = "deploy:events";
const TTL_SECONDS = 600;

export interface DeployEvent {
  deploymentId: string;
  status: string;
  timestamp: number;
  error?: string;
}

function listKey(workspaceId: string): string {
  return `${KEY_PREFIX}:${workspaceId}`;
}

export async function publishDeployEvent(
  workspaceId: string,
  deploymentId: string,
  status: string,
  error?: string,
): Promise<void> {
  const event: DeployEvent = { deploymentId, status, timestamp: Date.now(), error };
  const key = listKey(workspaceId);
  const p = redis.pipeline();
  p.rpush(key, JSON.stringify(event));
  p.expire(key, TTL_SECONDS);
  await p.exec();
}

export async function getDeployEvents(
  workspaceId: string,
  fromIndex: number,
): Promise<DeployEvent[]> {
  const raw = await redis.lrange<string>(listKey(workspaceId), fromIndex, -1);
  return raw.map((entry) =>
    typeof entry === "string" ? JSON.parse(entry) as DeployEvent : entry as unknown as DeployEvent,
  );
}

export async function getDeployEventCount(workspaceId: string): Promise<number> {
  return redis.llen(listKey(workspaceId));
}

export async function clearDeployEvents(workspaceId: string): Promise<void> {
  await redis.del(listKey(workspaceId));
}
