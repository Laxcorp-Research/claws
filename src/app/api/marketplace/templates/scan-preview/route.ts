import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { scanTemplate } from "@/lib/marketplace/template-scan"
import { runLLMSecurityReview } from "@/lib/marketplace/llm-security-review"

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return apiError("UNAUTHORIZED", "Sign in required", 401)

    const body = await request.json()
    const { workspaceId } = body

    if (!workspaceId || typeof workspaceId !== "string") {
      return apiError("VALIDATION", "workspaceId is required", 400)
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { agents: true },
    })

    if (!workspace || workspace.userId !== user.id) {
      return apiError("FORBIDDEN", "Workspace not found or access denied", 403)
    }

    if (workspace.agents.length === 0) {
      return apiError("VALIDATION", "Workspace has no agents", 400)
    }

    const agentData = workspace.agents.map((a) => ({
      name: a.name,
      role: a.role,
      soulMd: a.soulMd,
      agentsMd: a.agentsMd,
      heartbeatMd: a.heartbeatMd || undefined,
    }))

    const regexResult = scanTemplate(agentData)

    let llmResult = null
    if (regexResult.passed) {
      llmResult = await runLLMSecurityReview(agentData)
    }

    const overallPassed = regexResult.passed && (llmResult?.safe !== false)

    const combinedFindings = [
      ...regexResult.findings,
      ...(llmResult?.findings || []).map((f) => ({
        severity: f.severity,
        agentName: f.agentName,
        file: f.file,
        line: 0,
        pattern: "LLM review",
        description: f.description,
        matchedText: f.evidence,
      })),
    ]

    return apiSuccess({
      scanResult: {
        passed: overallPassed,
        findings: combinedFindings,
        scannedAgents: agentData.length,
        totalFindings: combinedFindings.length,
        criticalCount: combinedFindings.filter((f) => f.severity === "critical").length,
        warningCount: combinedFindings.filter((f) => f.severity === "warning").length,
        hasCritical: combinedFindings.some((f) => f.severity === "critical"),
        hasWarnings: combinedFindings.some((f) => f.severity === "warning"),
        regexResult: {
          passed: regexResult.passed,
          criticalCount: regexResult.criticalCount,
          warningCount: regexResult.warningCount,
        },
        llmResult: llmResult
          ? { safe: llmResult.safe, riskLevel: llmResult.riskLevel, summary: llmResult.summary }
          : null,
      },
    })
  } catch (error) {
    console.error("Scan preview error:", error)
    return apiError("SCAN_ERROR", "Failed to run security scan", 500)
  }
}
