import { Badge } from "@/components/ui/badge"
import { CHANNEL_IDS, type ChannelId } from "@/lib/openclaw/channel-config"

const PROVIDER_LABELS: Record<ChannelId, string> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
  msteams: "Microsoft Teams",
}

const KNOWN_PROVIDER_IDS = new Set<string>(CHANNEL_IDS)

export function providerChannelLabel(channelId: string | null | undefined): string | null {
  if (!channelId || !KNOWN_PROVIDER_IDS.has(channelId)) return null
  return PROVIDER_LABELS[channelId as ChannelId]
}

export function ProviderChannelBadge({ channelId, className }: { channelId: string | null | undefined; className?: string }) {
  const label = providerChannelLabel(channelId)
  if (!label) return null
  return <Badge className={className}>via {label}</Badge>
}
