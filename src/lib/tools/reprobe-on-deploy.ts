import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendCustomerNudge } from "@/lib/alerts/customer-nudge"
import {
  ledgerToolStatusProbe,
  probeAndPersistApiKeyConnection,
  skipResultForFailure,
  type ApiKeyProbeResult,
} from "@/lib/tools/probe-api-key"

export type ReprobeSummary = {
  probed: number
  connected: number
  errors: number
  unverified: number
  skipped: number
}

export function nudgeConditionForToolError(args: {
  toolSlug: string
  error?: string | null
  warning?: string | null
  message?: string | null
}): "twitter-402-tier" | "tool-connection-error" {
  const blob = `${args.error ?? ""} ${args.warning ?? ""} ${args.message ?? ""}`
  if (args.toolSlug === "twitter-api" && /402/.test(blob)) return "twitter-402-tier"
  return "tool-connection-error"
}

async function nudgeProbeErrors(
  workspaceId: string,
  results: ApiKeyProbeResult[],
): Promise<void> {
  const errors = results.filter((r) => r.outcome === "error")
  if (errors.length === 0) return

  const conditions = new Set<"twitter-402-tier" | "tool-connection-error">()
  for (const row of errors) {
    conditions.add(nudgeConditionForToolError(row))
  }
  for (const condition of conditions) {
    try {
      await sendCustomerNudge({ workspaceId, condition })
    } catch (err) {
      log.warn("tool re-probe nudge failed", {
        workspaceId,
        condition,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export async function reprobeWorkspaceToolConnections(
  workspaceId: string,
): Promise<ReprobeSummary> {
  const rows = await prisma.toolConnection.findMany({
    where: { workspaceId, connectionType: "API_KEY" },
    select: {
      id: true,
      workspaceId: true,
      toolSlug: true,
      connectionType: true,
      status: true,
      encryptedCredentials: true,
    },
  })

  const results: ApiKeyProbeResult[] = []
  for (const row of rows) {
    try {
      const probed = await probeAndPersistApiKeyConnection(row)
      results.push(probed.ok ? probed.result : skipResultForFailure(row, probed.failure))
    } catch (err) {
      log.warn("tool re-probe skipped a connection", {
        category: "tool_validation",
        workspaceId,
        toolSlug: row.toolSlug,
        error: err instanceof Error ? err.message : String(err),
      })
      results.push(skipResultForFailure(row, { kind: "decrypt_failed", error: "probe threw" }))
    }
  }

  if (results.length > 0) {
    await ledgerToolStatusProbe({
      workspaceId,
      trigger: "redeploy",
      results: results.map((r) => ({
        toolSlug: r.toolSlug,
        outcome: r.outcome,
        status: r.status,
      })),
    })
    await nudgeProbeErrors(workspaceId, results)
  }

  return {
    probed: results.length,
    connected: results.filter((r) => r.outcome === "connected").length,
    errors: results.filter((r) => r.outcome === "error").length,
    unverified: results.filter((r) => r.outcome === "unverified").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
  }
}
