import { CHANNEL_IDS } from "@/lib/openclaw/channel-config"
import { prisma } from "@/lib/db"

/**
 * External channel taxonomy for warmIdle honesty.
 * CHANNEL_IDS = telegram|discord|slack|whatsapp|msteams; webchat is treated
 * as a channel surface (dashboard / gateway webchat inbound).
 * channelId may be bare ("telegram") or prefixed ("telegram:chat-id").
 */
export function isExternalChannelInbound(
  actionType: string,
  channelId: string | null | undefined,
): boolean {
  if (actionType !== "MESSAGE_RECEIVED") return false
  if (typeof channelId !== "string" || channelId.length === 0) return false
  const prefix = channelId.split(":")[0]?.toLowerCase()
  if (!prefix) return false
  if (prefix === "webchat") return true
  return (CHANNEL_IDS as readonly string[]).includes(prefix)
}

/**
 * Stamp ContainerState.lastChannelMessageAt on every external-channel inbound.
 * Best-effort: missing ContainerState row is a no-op (updateMany).
 */
export async function touchLastChannelMessageAt(
  workspaceId: string,
  at: Date,
): Promise<void> {
  await prisma.containerState.updateMany({
    where: { workspaceId },
    data: { lastChannelMessageAt: at },
  })
}
