import { NextRequest } from "next/server"
import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import {
  applyToolRequirementOp,
  listRemovedTemplateTools,
  loadTemplateToolDefaults,
  partitionToolRequirements,
  resolveWorkspaceToolRequirements,
  withCustomizationFlags,
  type ToolRequirementOpName,
} from "@/lib/tools/workspace-tool-requirements"

const OPS = new Set<ToolRequirementOpName>([
  "demote",
  "restore",
  "dismiss",
  "undismiss",
  "remove",
  "swap",
])

/**
 * GET - workspace tool requirement set via dual-read resolver.
 * Returns partitioned required / recommended (dismissed excluded from recommended).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const resolved = await resolveWorkspaceToolRequirements(id)
  const templateDefaults = await loadTemplateToolDefaults(resolved.clawTemplateId)
  const flagged = withCustomizationFlags(resolved.tools, templateDefaults)
  const partitioned = partitionToolRequirements(flagged)
  const removedFromTemplate = listRemovedTemplateTools(
    resolved.tools,
    templateDefaults,
  )
  return apiSuccess({
    tools: flagged,
    required: partitioned.required as typeof flagged,
    recommended: partitioned.recommended as typeof flagged,
    removedFromTemplate,
    source: resolved.source,
    templateSlug: resolved.templateSlug,
  })
}

/**
 * PATCH - demote | restore | dismiss | undismiss | remove | swap.
 * Never touches ToolConnection (disconnect is a separate explicit action).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return ERRORS.VALIDATION("Invalid JSON body")
  }

  const opRaw =
    typeof body === "object" && body !== null && "op" in body
      ? (body as { op: unknown }).op
      : undefined
  const slugRaw =
    typeof body === "object" && body !== null && "slug" in body
      ? (body as { slug: unknown }).slug
      : undefined
  const replaceWithRaw =
    typeof body === "object" && body !== null && "replaceWith" in body
      ? (body as { replaceWith: unknown }).replaceWith
      : undefined

  if (typeof opRaw !== "string" || !OPS.has(opRaw as ToolRequirementOpName)) {
    return ERRORS.VALIDATION(
      `op must be one of: ${Array.from(OPS).join(", ")}`,
    )
  }
  if (typeof slugRaw !== "string" || slugRaw.trim().length === 0) {
    return ERRORS.VALIDATION("slug is required")
  }

  const resolved = await resolveWorkspaceToolRequirements(id)
  const templateDefaults = await loadTemplateToolDefaults(resolved.clawTemplateId)
  const applied = applyToolRequirementOp(
    resolved.tools,
    {
      op: opRaw as ToolRequirementOpName,
      slug: slugRaw,
      replaceWith:
        typeof replaceWithRaw === "string" ? replaceWithRaw : undefined,
    },
    templateDefaults,
  )

  if (!applied.ok) {
    return apiError(applied.code, applied.message, applied.status)
  }

  await prisma.workspace.update({
    where: { id },
    data: { toolRequirements: applied.tools as unknown as Prisma.InputJsonValue },
  })

  const flagged = withCustomizationFlags(applied.tools, templateDefaults)
  const partitioned = partitionToolRequirements(flagged)
  const removedFromTemplate = listRemovedTemplateTools(
    applied.tools,
    templateDefaults,
  )
  return apiSuccess({
    tools: flagged,
    required: partitioned.required as typeof flagged,
    recommended: partitioned.recommended as typeof flagged,
    removedFromTemplate,
    source: "workspace" as const,
    templateSlug: resolved.templateSlug,
  })
}
