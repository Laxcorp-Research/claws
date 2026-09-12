import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { requireAdmin } from "@/lib/api/admin"
import { logAdminAction } from "@/lib/security/audit-log"
import {
  KEEP_CANARY_WORKSPACE_ID,
  isCandidateSoakRuntimeAllowed,
  isKeepCanaryWorkspace,
} from "@/lib/openclaw/candidate-soak"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Admin-only soak flag. Dashboard PATCH must never accept this field.
 * KEEP canary and production CLAWS_ENV are hard-refused.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return apiError("FORBIDDEN", "Admin access required", 403)
  }

  const { id } = await params
  if (isKeepCanaryWorkspace(id)) {
    return apiError(
      "KEEP_CANARY_LOCKED",
      `KEEP canary ${KEEP_CANARY_WORKSPACE_ID} cannot take a candidate image`,
      400,
    )
  }

  if (!isCandidateSoakRuntimeAllowed()) {
    return apiError(
      "FORBIDDEN",
      "Candidate soak is refused when CLAWS_ENV is production",
      403,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("VALIDATION_ERROR", "JSON body required", 400)
  }
  if (!isRecord(body) || typeof body.enabled !== "boolean") {
    return apiError("VALIDATION_ERROR", "enabled must be a boolean", 400)
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    select: {
      id: true,
      candidateRuntimeSoak: true,
      httpFixtureMode: true,
      userMdInterviewCompletedAt: true,
    },
  })
  if (!workspace) return apiError("NOT_FOUND", "Workspace not found", 404)

  const interviewFree = body.interviewFree !== false
  const httpFixture =
    typeof body.httpFixture === "boolean"
      ? body.httpFixture
      : body.enabled
        ? true
        : undefined

  const data: {
    candidateRuntimeSoak: boolean
    httpFixtureMode?: boolean
    userMdInterviewCompletedAt?: Date
  } = { candidateRuntimeSoak: body.enabled }

  if (typeof httpFixture === "boolean") data.httpFixtureMode = httpFixture
  if (
    body.enabled &&
    interviewFree &&
    workspace.userMdInterviewCompletedAt == null
  ) {
    data.userMdInterviewCompletedAt = new Date()
  }

  const updated = await prisma.workspace.update({
    where: { id },
    data,
    select: {
      id: true,
      candidateRuntimeSoak: true,
      httpFixtureMode: true,
      userMdInterviewCompletedAt: true,
    },
  })

  logAdminAction({
    action: "workspace.candidate-soak",
    adminId: admin.id,
    adminEmail: admin.email || "",
    targetId: id,
    targetType: "workspace",
    details: {
      enabled: body.enabled,
      interviewFree,
      httpFixture: updated.httpFixtureMode,
    },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  })

  return apiSuccess({
    workspaceId: updated.id,
    candidateRuntimeSoak: updated.candidateRuntimeSoak,
    httpFixtureMode: updated.httpFixtureMode,
    interviewCompleted: updated.userMdInterviewCompletedAt != null,
    appliesOn: "next deployToCloud / wake",
  })
}
