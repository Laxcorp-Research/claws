import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { decrypt } from "@/lib/encryption"
import {
  CHANNEL_IDS,
  configuredChannelIds,
  emptyChannelStatusMap,
  parseChannelConfigBlob,
  type ChannelConfigMap,
  type ChannelLiveState,
  type ChannelStatusMap,
} from "@/lib/openclaw/channel-config"

const GATEWAY_STATUS_TIMEOUT_MS = 2_500

type WorkspaceForChannels = {
  id: string
  status: string
  containerId: string | null
  containerHost: string | null
  gatewayToken: string | null
  channelConfigEncrypted: string | null
}

type GatewayChannelSnapshot = {
  connected?: unknown
  running?: unknown
  configured?: unknown
  lastError?: unknown
  healthState?: unknown
}

type GatewayChannelsPayload = {
  channels?: Record<string, GatewayChannelSnapshot | undefined>
  channelAccounts?: Record<string, GatewayChannelSnapshot[] | undefined>
}

type AdminRpcEnvelope = {
  ok?: boolean
  payload?: GatewayChannelsPayload
  error?: { message?: string; code?: string }
}

function parseConfig(blob: string | null): ChannelConfigMap {
  return parseChannelConfigBlob(blob, decrypt)
}

function baseResponse(config: ChannelConfigMap) {
  return {
    channels: emptyChannelStatusMap(config),
    configuredChannelIds: configuredChannelIds(config),
    hasConfiguredChannels: configuredChannelIds(config).length > 0,
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function snapshotState(snapshot: GatewayChannelSnapshot | undefined): { live: ChannelLiveState; detail?: string } {
  if (!snapshot) return { live: "unknown" }
  const detail = firstString(snapshot.lastError, snapshot.healthState)
  if (detail) return { live: "error", detail }
  if (snapshot.connected === true) return { live: "connected" }
  if (snapshot.running === true || snapshot.configured === true) return { live: "connecting" }
  return { live: "unknown" }
}

function mergeGatewayStatus(config: ChannelConfigMap, payload: GatewayChannelsPayload): ChannelStatusMap {
  const merged = emptyChannelStatusMap(config)
  for (const channel of CHANNEL_IDS) {
    if (!merged[channel].configured) continue
    const summary = snapshotState(payload.channels?.[channel])
    const accountStates = payload.channelAccounts?.[channel]?.map(snapshotState) ?? []
    const accountError = accountStates.find((state) => state.live === "error")
    const anyConnected = accountStates.some((state) => state.live === "connected")
    const anyConnecting = accountStates.some((state) => state.live === "connecting")

    if (summary.live === "error" || accountError) {
      merged[channel] = { configured: true, live: "error", detail: summary.detail ?? accountError?.detail ?? "Channel reported an error" }
    } else if (summary.live === "connected" || anyConnected) {
      merged[channel] = { configured: true, live: "connected" }
    } else if (summary.live === "connecting" || anyConnecting) {
      merged[channel] = { configured: true, live: "connecting" }
    }
  }
  return merged
}

async function fetchGatewayChannelStatus(workspace: WorkspaceForChannels): Promise<GatewayChannelsPayload | null> {
  if (!workspace.containerId || !workspace.containerHost || !workspace.gatewayToken) return null

  let token: string
  try {
    token = decrypt(workspace.gatewayToken)
  } catch {
    return null
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GATEWAY_STATUS_TIMEOUT_MS)
  try {
    const res = await fetch(`https://${workspace.containerHost}/api/v1/admin/rpc`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "channels.status",
        params: { probe: true, timeoutMs: GATEWAY_STATUS_TIMEOUT_MS },
      }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as AdminRpcEnvelope
    if (body.ok !== true) return null
    return body.payload ?? {}
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<unknown> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params as { workspaceId: string }

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      status: true,
      containerId: true,
      containerHost: true,
      gatewayToken: true,
      channelConfigEncrypted: true,
    },
  })
  if (!workspace) return ERRORS.NOT_FOUND("Workspace")

  const config = parseConfig(workspace.channelConfigEncrypted)
  const response = baseResponse(config)
  if (!["RUNNING", "PAUSED"].includes(workspace.status)) return apiSuccess(response)

  const gatewayPayload = await fetchGatewayChannelStatus(workspace)
  if (!gatewayPayload) return apiSuccess(response)

  return apiSuccess({
    ...response,
    channels: mergeGatewayStatus(config, gatewayPayload),
  })
}
