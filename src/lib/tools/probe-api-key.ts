import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"
import { log } from "@/lib/logger"
import { hasValidator, validateToolKey } from "@/lib/tools/validators"

export const SEP9_HEALTHY_TOKEN_TRANSIENT =
  "Provider didn't respond within 10 seconds"

export const TOOL_STATUS_REPROBE_EVENT_KIND = "tool_status_reprobe"

/** ERROR only on definitive 401/403. 429/5xx/timeouts are silent retry. */
export function isDefinitiveAuthProbeFailure(args: {
  valid: boolean
  error?: string | null
}): boolean {
  if (args.valid) return false
  const error = args.error ?? ""
  return (
    /\b401\b|\b403\b|\b402\b/i.test(error) ||
    /invalid .{0,60}(api key|bearer|token)/i.test(error) ||
    /payment required/i.test(error)
  )
}

export type ProbeTrigger = "redeploy" | "user_request"

export type ApiKeyProbeInput = {
  id: string
  workspaceId: string
  toolSlug: string
  connectionType: string
  status: string
  encryptedCredentials: string | null
}

export type ApiKeyProbeResult = {
  connectionId: string
  toolSlug: string
  outcome: "connected" | "error" | "pending" | "unverified" | "skipped" | "retry"
  status: string
  valid: boolean
  unverified?: boolean
  warning?: string
  error?: string
  message?: string
}

export type ProbeFailureKind =
  | "not_api_key"
  | "needs_credentials"
  | "no_credentials"
  | "decrypt_failed"

export type ProbeFailure = {
  kind: ProbeFailureKind
  error?: string
}

function skipped(
  conn: ApiKeyProbeInput,
  extra: Partial<ApiKeyProbeResult> = {},
): ApiKeyProbeResult {
  return {
    connectionId: conn.id,
    toolSlug: conn.toolSlug,
    outcome: "skipped",
    status: conn.status,
    valid: false,
    ...extra,
  }
}

export async function probeAndPersistApiKeyConnection(
  conn: ApiKeyProbeInput,
  opts?: { userId?: string },
): Promise<{ ok: true; result: ApiKeyProbeResult } | { ok: false; failure: ProbeFailure }> {
  if (conn.connectionType !== "API_KEY") {
    return { ok: false, failure: { kind: "not_api_key" } }
  }
  if (conn.status === "NEEDS_CREDENTIALS") {
    return { ok: false, failure: { kind: "needs_credentials" } }
  }
  if (!conn.encryptedCredentials) {
    return { ok: false, failure: { kind: "no_credentials" } }
  }

  let credentials: Record<string, string>
  try {
    const plaintext = decrypt(conn.encryptedCredentials)
    const parsed = JSON.parse(plaintext) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("encryptedCredentials plaintext is not a JSON object")
    }
    credentials = parsed as Record<string, string>
  } catch (err) {
    log.error("Failed to decrypt tool credentials", {
      category: "tool_validation",
      toolSlug: conn.toolSlug,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      ok: false,
      failure: {
        kind: "decrypt_failed",
        error: "Couldn't read the stored credentials. Remove and reconnect this tool.",
      },
    }
  }

  if (!hasValidator(conn.toolSlug)) {
    await prisma.toolConnection.update({
      where: { id: conn.id },
      data: { lastTestedAt: new Date() },
    })
    return {
      ok: true,
      result: {
        connectionId: conn.id,
        toolSlug: conn.toolSlug,
        outcome: "unverified",
        status: conn.status,
        valid: true,
        unverified: true,
        message:
          "No validator implemented for this tool yet - we can't actually test it from here. The key is saved; the tool will fail at call time if it's wrong.",
      },
    }
  }

  const validated = await validateToolKey(conn.toolSlug, credentials)

  if (!validated.valid && !isDefinitiveAuthProbeFailure(validated)) {
    await prisma.toolConnection.update({
      where: { id: conn.id },
      data: { lastTestedAt: new Date() },
    })
    return {
      ok: true,
      result: {
        connectionId: conn.id,
        toolSlug: conn.toolSlug,
        outcome: "retry",
        status: conn.status,
        valid: false,
        error: validated.error,
        warning: validated.warning,
      },
    }
  }

  if (!validated.valid) {
    const updated = await prisma.toolConnection.update({
      where: { id: conn.id },
      data: {
        status: "ERROR",
        lastTestedAt: new Date(),
        lastError: validated.error ?? "Test failed",
      },
      select: { status: true },
    })
    if (opts?.userId) {
      log.toolEvent({
        event: "failed",
        toolSlug: conn.toolSlug,
        connectionType: conn.connectionType,
        workspaceId: conn.workspaceId,
        userId: opts.userId,
        error: validated.error,
      })
    }
    return {
      ok: true,
      result: {
        connectionId: conn.id,
        toolSlug: conn.toolSlug,
        outcome: "error",
        status: updated.status,
        valid: false,
        error: validated.error,
      },
    }
  }

  if (validated.warning) {
    await prisma.toolConnection.update({
      where: { id: conn.id },
      data: { lastTestedAt: new Date() },
    })
    return {
      ok: true,
      result: {
        connectionId: conn.id,
        toolSlug: conn.toolSlug,
        outcome: "retry",
        status: conn.status,
        valid: true,
        warning: validated.warning,
      },
    }
  }

  const updated = await prisma.toolConnection.update({
    where: { id: conn.id },
    data: {
      status: "CONNECTED",
      lastTestedAt: new Date(),
      lastError: null,
    },
    select: { status: true },
  })
  return {
    ok: true,
    result: {
      connectionId: conn.id,
      toolSlug: conn.toolSlug,
      outcome: "connected",
      status: updated.status,
      valid: true,
    },
  }
}

export async function ledgerToolStatusProbe(args: {
  workspaceId: string
  trigger: ProbeTrigger
  results: Array<Pick<ApiKeyProbeResult, "toolSlug" | "outcome" | "status">>
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action:
          args.trigger === "redeploy"
            ? "Tool status re-probed on deploy"
            : "Tool status re-probed on user request",
        actionType: "SYSTEM",
        detail: `${args.results.length} connection(s) probed`,
        metadata: JSON.stringify({
          eventKind: TOOL_STATUS_REPROBE_EVENT_KIND,
          trigger: args.trigger,
          results: args.results,
        }),
      },
    })
  } catch (err) {
    log.error("tool-status ledger write failed", {
      workspaceId: args.workspaceId,
      trigger: args.trigger,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function skipResultForFailure(
  conn: ApiKeyProbeInput,
  failure: ProbeFailure,
): ApiKeyProbeResult {
  return skipped(conn, { error: failure.error ?? failure.kind })
}
