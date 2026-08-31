import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
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
  }

  return {
    probed: results.length,
    connected: results.filter((r) => r.outcome === "connected").length,
    errors: results.filter((r) => r.outcome === "error").length,
    unverified: results.filter((r) => r.outcome === "unverified").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
  }
}
