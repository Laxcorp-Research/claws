import { randomBytes } from "node:crypto"
import { SELF_HOST_APP_ORIGIN } from "@/lib/openclaw/gateway-origin"

/** Header the runtime plugin compares. Same name on hosted and self-host. */
export const SYNC_SECRET_HEADER = "X-Metering-Secret"

/**
 * Env name the published runtime reads (claws-activity-reporter handleSyncNow
 * and state-sync.mjs). Docker must set this name. METERING_MASTER_SECRET on
 * the container is not read.
 */
export const SYNC_SECRET_ENV = "CLAWS_METERING_SECRET"

/** Env name state-sync.mjs turns into the /state upload URL. */
export const SYNC_ENDPOINT_ENV = "CLAWS_METERING_ENDPOINT"

export function mintSyncSecret(): string {
  return randomBytes(32).toString("hex")
}

/**
 * Origin the runtime can dial. Compose sets CONTROL_PLANE_INTERNAL_URL to
 * http://app:3000. CI Next listens on 3001 and sets the same variable to
 * http://app:3001. NEXT_PUBLIC_APP_URL is localhost and is not reachable
 * from another container.
 */
export function syncAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const internal = env.CONTROL_PLANE_INTERNAL_URL?.trim()
  if (internal) return internal.replace(/\/$/, "")
  if (env.CLAWS_PROFILE === "self-host") return SELF_HOST_APP_ORIGIN
  return (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
}

export function syncMeteringEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return `${syncAppOrigin(env)}/api/internal/metering`
}
