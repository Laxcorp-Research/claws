export const DEFAULT_SYNC_TIMEOUT_MS = 18_000

export type SyncNowOutcome = { synced: true } | { synced: false; reason: string }

/**
 * POST /internal/sync-now on the container (claws-activity-reporter).
 * Never throws. Used by destroy/hibernate and by the stale-sync heal.
 */
/** Hosted containers are TLS. Self-host Docker publishes plain HTTP. */
export function syncNowRequestUrl(containerHost: string): string {
  const scheme = process.env.CLAWS_PROFILE === "self-host" ? "http" : "https"
  return `${scheme}://${containerHost}/internal/sync-now`
}

export async function trySyncNow(containerHost: string, timeoutMs: number): Promise<SyncNowOutcome> {
  const secret = process.env.METERING_MASTER_SECRET
  if (!secret) {
    return { synced: false, reason: "unconfigured" }
  }

  const url = syncNowRequestUrl(containerHost)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "X-Metering-Secret": secret },
    })
  } catch (err) {
    const isTimeout = controller.signal.aborted || (err instanceof Error && err.name === "AbortError")
    return { synced: false, reason: isTimeout ? "timeout" : "unreachable" }
  } finally {
    clearTimeout(timer)
  }

  if (res.status !== 200) {
    let serverStatus: string | undefined
    try {
      const body = (await res.json()) as { status?: unknown }
      if (typeof body?.status === "string") serverStatus = body.status
    } catch {
      /* non-JSON */
    }
    return { synced: false, reason: serverStatus ?? `http-${res.status}` }
  }

  let body: { persisted?: unknown; empty?: unknown }
  try {
    body = (await res.json()) as { persisted?: unknown; empty?: unknown }
  } catch {
    return { synced: false, reason: "unparseable" }
  }

  if (body.persisted === true || body.empty === true) {
    return { synced: true }
  }
  return { synced: false, reason: "unconfirmed" }
}
