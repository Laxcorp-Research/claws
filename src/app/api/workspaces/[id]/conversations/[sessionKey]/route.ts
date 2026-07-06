import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import { readGatewaySessionHistory } from "@/lib/openclaw/gateway-conversations-client"
import { normalizeConversationMessages, type ConversationMessage } from "@/lib/openclaw/conversations"

export const dynamic = "force-dynamic"

const GATEWAY_READ_TIMEOUT_MS = 2_500
const READABLE_STATUSES = new Set(["RUNNING", "PAUSED"])

type ConversationDetailResponse =
  | { available: true; sessionKey: string; messages: ConversationMessage[] }
  | { available: false; reason: "not_running" | "unreachable"; messages: [] }

interface ConversationDetailDeps {
  history: typeof readGatewaySessionHistory
}

const defaultDeps: ConversationDetailDeps = { history: readGatewaySessionHistory }
let deps: ConversationDetailDeps = defaultDeps

export function __setConversationDetailDepsForTests(next: ConversationDetailDeps | null) {
  deps = next ?? defaultDeps
}

function unavailable(reason: "not_running" | "unreachable") {
  return apiSuccess<ConversationDetailResponse>({ available: false, reason, messages: [] })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionKey: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id, sessionKey } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      containerHost: true,
      gatewayToken: true,
    },
  })

  if (!READABLE_STATUSES.has(workspace.status)) return unavailable("not_running")
  if (!workspace.containerHost || !workspace.gatewayToken) return unavailable("unreachable")

  try {
    const connection = await getGatewayConnectionInfo(id)
    if (!connection) return unavailable("unreachable")
    const payload = await deps.history({
      wsUrl: connection.wsUrl,
      token: connection.token,
      sessionKey,
      timeoutMs: GATEWAY_READ_TIMEOUT_MS,
    })
    if (!payload) return unavailable("unreachable")
    return apiSuccess<ConversationDetailResponse>({
      available: true,
      sessionKey,
      messages: normalizeConversationMessages(payload),
    })
  } catch {
    return unavailable("unreachable")
  }
}
