import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { isLiveGatewayStatus } from "@/lib/openclaw/conversation-readability"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import { readGatewaySessionHistory } from "@/lib/openclaw/gateway-conversations-client"
import { normalizeConversationMessages, type ConversationMessage } from "@/lib/openclaw/conversations"
import {
  loadSnapshotConversationsFromGzip,
  readSnapshotSessionMessages,
} from "@/lib/openclaw/snapshot-conversations"

export const dynamic = "force-dynamic"

const GATEWAY_READ_TIMEOUT_MS = 2_500

type ConversationDetailResponse =
  | {
      available: true
      mode: "live" | "snapshot"
      asOf?: string
      sessionKey: string
      messages: ConversationMessage[]
    }
  | {
      available: false
      reason: "not_running" | "unreachable" | "too_large" | "corrupt" | "not_found"
      message?: string
      asOf?: string
      messages: []
    }

interface ConversationDetailDeps {
  history: typeof readGatewaySessionHistory
}

const defaultDeps: ConversationDetailDeps = { history: readGatewaySessionHistory }
let deps: ConversationDetailDeps = defaultDeps

export function __setConversationDetailDepsForTests(next: ConversationDetailDeps | null) {
  deps = next ?? defaultDeps
}

function unavailable(
  reason: "not_running" | "unreachable" | "too_large" | "corrupt" | "not_found",
  extras: { asOf?: string; message?: string } = {},
) {
  return apiSuccess<ConversationDetailResponse>({
    available: false,
    reason,
    ...(extras.asOf ? { asOf: extras.asOf } : {}),
    ...(extras.message ? { message: extras.message } : {}),
    messages: [],
  })
}

function isArchivedSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith("orphaned:")
}

async function loadSnapshotForWorkspace(workspaceId: string) {
  const row = await prisma.containerState.findUnique({
    where: { workspaceId },
    select: {
      runtimeStateSnapshot: true,
      runtimeStateUpdatedAt: true,
      runtimeStateSizeBytes: true,
    },
  })
  if (!row?.runtimeStateSnapshot || !row.runtimeStateUpdatedAt) return null
  return loadSnapshotConversationsFromGzip({
    workspaceId,
    gzipBytes: Buffer.from(row.runtimeStateSnapshot),
    runtimeStateUpdatedAt: row.runtimeStateUpdatedAt,
    runtimeStateSizeBytes: row.runtimeStateSizeBytes,
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionKey: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id, sessionKey: rawSessionKey } = await params
  const sessionKey = decodeURIComponent(rawSessionKey)

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

  const live = isLiveGatewayStatus(workspace.status)
  const fromSnapshot = !live || isArchivedSessionKey(sessionKey)

  if (live && !fromSnapshot) {
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
        mode: "live",
        sessionKey,
        messages: normalizeConversationMessages(payload),
      })
    } catch {
      return unavailable("unreachable")
    }
  }

  const snap = await loadSnapshotForWorkspace(id)
  if (!snap) return unavailable("not_running")
  if (!snap.ok) {
    if (snap.reason === "too_large") {
      return unavailable("too_large", {
        asOf: snap.asOf,
        message: "too large - wake to view",
      })
    }
    if (snap.reason === "corrupt") {
      return unavailable("corrupt", { asOf: snap.asOf ?? undefined })
    }
    return unavailable("not_running")
  }

  const messages = readSnapshotSessionMessages(snap.files, sessionKey)
  if (messages === null) return unavailable("not_found", { asOf: snap.view.asOf })

  return apiSuccess<ConversationDetailResponse>({
    available: true,
    mode: "snapshot",
    asOf: snap.view.asOf,
    sessionKey,
    messages,
  })
}
