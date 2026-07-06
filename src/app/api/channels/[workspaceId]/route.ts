import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { decrypt, encrypt } from "@/lib/encryption"
import {
  configuredChannelIds,
  deleteChannelConfig,
  hasConfiguredChannels,
  maskChannelConfig,
  parseChannelConfigBlob,
  parseChannelDeletePayload,
  parseChannelPostPayload,
  serializeChannelConfigMap,
  upsertChannelConfig,
  type ChannelConfigMap,
} from "@/lib/openclaw/channel-config"

function readConfig(blob: string | null | undefined): ChannelConfigMap {
  return parseChannelConfigBlob(blob, decrypt)
}

function encryptedOrNull(config: ChannelConfigMap): string | null {
  return hasConfiguredChannels(config) ? encrypt(serializeChannelConfigMap(config)) : null
}

async function requireOwnedWorkspace(workspaceId: string, userId: string) {
  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, userId)
  if (error === "NOT_FOUND") return { response: ERRORS.NOT_FOUND("Workspace"), workspace: null }
  if (error === "FORBIDDEN") return { response: ERRORS.FORBIDDEN(), workspace: null }
  return { response: null, workspace }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { response, workspace } = await requireOwnedWorkspace(workspaceId, user.id)
  if (response) return response

  const config = readConfig(workspace!.channelConfigEncrypted)
  return apiSuccess({
    channels: maskChannelConfig(config),
    configuredChannelIds: configuredChannelIds(config),
    hasConfiguredChannels: hasConfiguredChannels(config),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { response, workspace } = await requireOwnedWorkspace(workspaceId, user.id)
  if (response) return response

  let payload
  try {
    payload = parseChannelPostPayload(await req.json())
  } catch (err) {
    return ERRORS.VALIDATION(err instanceof Error ? err.message : "Invalid channel payload")
  }

  const current = readConfig(workspace!.channelConfigEncrypted)
  const next = upsertChannelConfig(current, payload)
  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { channelConfigEncrypted: encryptedOrNull(next) },
    select: { channelConfigEncrypted: true },
  })

  const saved = readConfig(updated.channelConfigEncrypted)
  return apiSuccess({
    channels: maskChannelConfig(saved),
    configuredChannelIds: configuredChannelIds(saved),
    hasConfiguredChannels: hasConfiguredChannels(saved),
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { response, workspace } = await requireOwnedWorkspace(workspaceId, user.id)
  if (response) return response

  let payload
  try {
    payload = parseChannelDeletePayload(await req.json())
  } catch (err) {
    return ERRORS.VALIDATION(err instanceof Error ? err.message : "Invalid channel delete payload")
  }

  const current = readConfig(workspace!.channelConfigEncrypted)
  const next = deleteChannelConfig(current, payload.channel)
  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: { channelConfigEncrypted: encryptedOrNull(next) },
    select: { channelConfigEncrypted: true },
  })

  const saved = readConfig(updated.channelConfigEncrypted)
  return apiSuccess({
    channels: maskChannelConfig(saved),
    configuredChannelIds: configuredChannelIds(saved),
    hasConfiguredChannels: hasConfiguredChannels(saved),
  })
}
