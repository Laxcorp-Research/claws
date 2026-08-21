import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { isLiveGatewayStatus } from "@/lib/openclaw/conversation-readability"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import {
  decryptDeviceIdentity,
  encryptDeviceIdentity,
  generateDeviceIdentity,
  type ChatDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import { listGatewaySessions } from "@/lib/openclaw/gateway-conversations-client"
import { normalizeConversationSummaries, type ConversationSummary } from "@/lib/openclaw/conversations"
import {
  loadSnapshotConversationsFromGzip,
  type ArchivedSessionSummary,
} from "@/lib/openclaw/snapshot-conversations"

export const dynamic = "force-dynamic"

const GATEWAY_READ_TIMEOUT_MS = 2_500

type ConversationsResponse =
  | {
      available: true
      mode: "live" | "snapshot"
      asOf?: string
      conversations: ConversationSummary[]
      archived: ArchivedSessionSummary[]
    }
  | {
      available: false
      reason: "not_running" | "unreachable" | "too_large" | "corrupt"
      message?: string
      asOf?: string
      conversations: []
      archived: []
    }

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

function unavailable(
  reason: "not_running" | "unreachable" | "too_large" | "corrupt",
  extras: { asOf?: string; message?: string } = {},
) {
  return apiSuccess<ConversationsResponse>({
    available: false,
    reason,
    ...(extras.asOf ? { asOf: extras.asOf } : {}),
    ...(extras.message ? { message: extras.message } : {}),
    conversations: [],
    archived: [],
  })
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

async function loadSnapshotSide(workspaceId: string) {
  const row = await prisma.containerState.findUnique({
    where: { workspaceId },
    select: {
      runtimeStateSnapshot: true,
      runtimeStateUpdatedAt: true,
      runtimeStateSizeBytes: true,
    },
  })
  if (!row?.runtimeStateSnapshot || !row.runtimeStateUpdatedAt) {
    return { kind: "none" as const }
  }
  const result = loadSnapshotConversationsFromGzip({
    workspaceId,
    gzipBytes: Buffer.from(row.runtimeStateSnapshot),
    runtimeStateUpdatedAt: row.runtimeStateUpdatedAt,
    runtimeStateSizeBytes: row.runtimeStateSizeBytes,
  })
  if (!result.ok) {
    if (result.reason === "no_snapshot") return { kind: "none" as const }
    return { kind: "error" as const, result }
  }
  return { kind: "ok" as const, result }
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

  const live = isLiveGatewayStatus(workspace.status)
  const snap = await loadSnapshotSide(id)

  if (live) {
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
      const archived = snap.kind === "ok" ? snap.result.view.archived : []
      return apiSuccess<ConversationsResponse>({
        available: true,
        mode: "live",
        conversations: normalizeConversationSummaries(payload),
        archived,
      })
    } catch {
      return unavailable("unreachable")
    }
  }

  // Snapshot mode: HIBERNATED / STOPPED / WAKING / DEPLOYING / ERROR (and any other non-live)
  if (snap.kind === "error") {
    if (snap.result.reason === "too_large") {
      return unavailable("too_large", {
        asOf: snap.result.asOf,
        message: "too large - wake to view",
      })
    }
    if (snap.result.reason === "corrupt") {
      return unavailable("corrupt", {
        asOf: snap.result.asOf ?? undefined,
      })
    }
  }

  if (snap.kind === "ok") {
    return apiSuccess<ConversationsResponse>({
      available: true,
      mode: "snapshot",
      asOf: snap.result.view.asOf,
      conversations: snap.result.view.conversations,
      archived: snap.result.view.archived,
    })
  }

  return unavailable("not_running")
}
