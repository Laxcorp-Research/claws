import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import {
  decryptDeviceIdentity,
  encryptDeviceIdentity,
  generateDeviceIdentity,
  type ChatDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import { listGatewaySessions } from "@/lib/openclaw/gateway-conversations-client"
import { normalizeConversationSummaries, type ConversationSummary } from "@/lib/openclaw/conversations"

export const dynamic = "force-dynamic"

const GATEWAY_READ_TIMEOUT_MS = 2_500
const READABLE_STATUSES = new Set(["RUNNING", "PAUSED"])

type ConversationsResponse =
  | { available: true; conversations: ConversationSummary[] }
  | { available: false; reason: "not_running" | "unreachable"; conversations: [] }

type WorkspaceForConversations = {
  status: string
  containerHost: string | null
  gatewayToken: string | null
  chatDeviceKeyEncrypted: string | null
}

interface ConversationRouteDeps {
  list: typeof listGatewaySessions
}

const defaultDeps: ConversationRouteDeps = { list: listGatewaySessions }
let deps: ConversationRouteDeps = defaultDeps

export function __setConversationRouteDepsForTests(next: ConversationRouteDeps | null) {
  deps = next ?? defaultDeps
}

function unavailable(reason: "not_running" | "unreachable") {
  return apiSuccess<ConversationsResponse>({ available: false, reason, conversations: [] })
}

async function getOrCreateDeviceKey(workspaceId: string, workspace: WorkspaceForConversations): Promise<ChatDeviceIdentity> {
  if (workspace.chatDeviceKeyEncrypted) return decryptDeviceIdentity(workspace.chatDeviceKeyEncrypted)
  const deviceKey = generateDeviceIdentity()
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { chatDeviceKeyEncrypted: encryptDeviceIdentity(deviceKey) },
  })
  return deviceKey
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      containerHost: true,
      gatewayToken: true,
      chatDeviceKeyEncrypted: true,
    },
  })

  if (!READABLE_STATUSES.has(workspace.status)) return unavailable("not_running")
  if (!workspace.containerHost || !workspace.gatewayToken) return unavailable("unreachable")

  try {
    const connection = await getGatewayConnectionInfo(id)
    if (!connection) return unavailable("unreachable")
    const deviceKey = await getOrCreateDeviceKey(id, workspace)
    const payload = await deps.list({
      wsUrl: connection.wsUrl,
      token: connection.token,
      deviceKey,
      timeoutMs: GATEWAY_READ_TIMEOUT_MS,
    })
    if (!payload) return unavailable("unreachable")
    return apiSuccess<ConversationsResponse>({
      available: true,
      conversations: normalizeConversationSummaries(payload),
    })
  } catch {
    return unavailable("unreachable")
  }
}
