import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { log } from "@/lib/logger"
import {
  gateHttpCall,
  parseLedgerOp,
  writeHttpLedger,
} from "@/lib/openclaw/http-action"
import { buildHttpLedgerRow } from "@/lib/openclaw/http-ledger"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function headersFromBody(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const expected = process.env.ACTIVITY_PIPELINE_SECRET
  if (!expected) {
    log.error("ACTIVITY_PIPELINE_SECRET not configured; rejecting http-action")
    return apiError(
      "ACTIVITY_SECRET_UNCONFIGURED",
      "Activity secret not configured on this deployment",
      401,
    )
  }
  if (req.headers.get("X-Activity-Secret") !== expected) {
    return apiError("UNAUTHORIZED", "Invalid activity secret", 401)
  }

  const { workspaceId } = await params
  if (!workspaceId) {
    return apiError("VALIDATION_ERROR", "workspaceId path segment is required", 400)
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  })
  if (!workspace) {
    return apiError("WORKSPACE_NOT_FOUND", `Workspace ${workspaceId} not found`, 404)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError("VALIDATION_ERROR", "Request body must be JSON", 400)
  }
  if (!isRecord(body)) {
    return apiError("VALIDATION_ERROR", "Request body must be an object", 400)
  }

  const op = body.op
  if (op !== "gate" && op !== "ledger") {
    return apiError("VALIDATION_ERROR", "op must be gate or ledger", 400)
  }

  if (op === "ledger") {
    const parsed = parseLedgerOp(body)
    if (!parsed) {
      return apiError("VALIDATION_ERROR", "ledger requires toolId, skill, method, host/path or url, class, status", 400)
    }
    const written = await writeHttpLedger({
      workspaceId,
      agentSlug: typeof body.agentSlug === "string" ? body.agentSlug : null,
      row: buildHttpLedgerRow(parsed),
    })
    return apiSuccess({
      id: written.id,
      toolId: parsed.toolId,
      eventKind: "http_tool_call",
    })
  }

  if (typeof body.skill !== "string" || body.skill.trim().length === 0) {
    return apiError("VALIDATION_ERROR", "skill is required", 400)
  }
  if (typeof body.method !== "string" || body.method.trim().length === 0) {
    return apiError("VALIDATION_ERROR", "method is required", 400)
  }

  const result = await gateHttpCall({
    workspaceId,
    skill: body.skill.trim(),
    method: body.method,
    url: typeof body.url === "string" ? body.url : undefined,
    host: typeof body.host === "string" ? body.host : undefined,
    path: typeof body.path === "string" ? body.path : undefined,
    headers: headersFromBody(body.headers),
    body: body.body,
    agentSlug: typeof body.agentSlug === "string" ? body.agentSlug : null,
  })

  return apiSuccess(result)
}
