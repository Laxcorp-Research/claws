import { z } from "zod"

export const CHANNEL_IDS = ["telegram", "discord", "slack", "whatsapp", "msteams"] as const
export const LAUNCH_CHANNEL_IDS = ["telegram", "discord", "slack"] as const
export const STAGED_CHANNEL_IDS = ["whatsapp", "msteams"] as const

export type ChannelId = (typeof CHANNEL_IDS)[number]
export type LaunchChannelId = (typeof LAUNCH_CHANNEL_IDS)[number]

const allowFromStringSchema = z.array(z.string().trim().min(1)).min(1)
const allowFromTelegramSchema = z.array(z.union([z.string().trim().min(1), z.number()])).min(1)

const telegramGroupSchema = z.object({
  requireMention: z.boolean().optional(),
  ingest: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: allowFromTelegramSchema.optional(),
}).strict()

export const telegramChannelConfigSchema = z.object({
  botToken: z.string().trim().min(1),
  allowFrom: allowFromTelegramSchema.optional(),
  groups: z.record(z.string().min(1), telegramGroupSchema.optional()).optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  enabled: z.boolean().optional(),
}).strict()

const discordGuildSchema = z.object({
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: allowFromStringSchema.optional(),
}).strict()

export const discordChannelConfigSchema = z.object({
  token: z.string().trim().min(1),
  applicationId: z.string().trim().min(1).optional(),
  allowFrom: allowFromStringSchema.optional(),
  guilds: z.record(z.string().min(1), discordGuildSchema.optional()).optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  enabled: z.boolean().optional(),
}).strict()

export const slackChannelConfigSchema = z.object({
  mode: z.enum(["socket", "http"]).optional(),
  botToken: z.string().trim().min(1),
  appToken: z.string().trim().min(1),
  signingSecret: z.string().trim().min(1).optional(),
  allowFrom: allowFromStringSchema.optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  enabled: z.boolean().optional(),
}).strict()

export const whatsappChannelConfigSchema = z.object({
  enabled: z.boolean().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  allowFrom: allowFromStringSchema.optional(),
  defaultAccount: z.string().trim().min(1).optional(),
  accounts: z.record(z.string().min(1), z.object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).optional(),
    authDir: z.string().trim().min(1).optional(),
    dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
    allowFrom: allowFromStringSchema.optional(),
  }).strict().optional()).optional(),
}).strict()

export const msteamsChannelConfigSchema = z.object({
  enabled: z.boolean().optional(),
  appId: z.string().trim().min(1),
  appPassword: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).optional(),
  authType: z.enum(["secret", "federated"]).optional(),
  allowFrom: allowFromStringSchema.optional(),
  defaultTo: z.string().trim().min(1).optional(),
  requireMention: z.boolean().optional(),
  webhook: z.object({
    port: z.number().int().positive().optional(),
    path: z.string().trim().min(1).optional(),
  }).strict().optional(),
}).strict()

export const channelConfigMapSchema = z.object({
  telegram: telegramChannelConfigSchema.optional(),
  discord: discordChannelConfigSchema.optional(),
  slack: slackChannelConfigSchema.optional(),
  whatsapp: whatsappChannelConfigSchema.optional(),
  msteams: msteamsChannelConfigSchema.optional(),
}).strict()

export type TelegramChannelConfig = z.infer<typeof telegramChannelConfigSchema>
export type DiscordChannelConfig = z.infer<typeof discordChannelConfigSchema>
export type SlackChannelConfig = z.infer<typeof slackChannelConfigSchema>
export type WhatsAppChannelConfig = z.infer<typeof whatsappChannelConfigSchema>
export type MSTeamsChannelConfig = z.infer<typeof msteamsChannelConfigSchema>
export type ChannelConfigMap = z.infer<typeof channelConfigMapSchema>

export type ChannelPostPayload =
  | { channel: "telegram"; config: TelegramChannelConfig }
  | { channel: "discord"; config: DiscordChannelConfig }
  | { channel: "slack"; config: SlackChannelConfig }
  | { channel: "whatsapp"; config: WhatsAppChannelConfig }
  | { channel: "msteams"; config: MSTeamsChannelConfig }

export type MaskedChannelSummary = {
  configured: boolean
  fields: Record<string, string>
}

export type MaskedChannelConfigMap = Partial<Record<ChannelId, MaskedChannelSummary>>

export type ChannelLiveState = "connected" | "connecting" | "error" | "unknown"

export type ChannelStatusSummary = {
  configured: boolean
  live: ChannelLiveState
  detail?: string
}

export type ChannelStatusMap = Record<ChannelId, ChannelStatusSummary>

const postPayloadSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("telegram"), config: telegramChannelConfigSchema }).strict(),
  z.object({ channel: z.literal("discord"), config: discordChannelConfigSchema }).strict(),
  z.object({ channel: z.literal("slack"), config: slackChannelConfigSchema }).strict(),
  z.object({ channel: z.literal("whatsapp"), config: whatsappChannelConfigSchema }).strict(),
  z.object({ channel: z.literal("msteams"), config: msteamsChannelConfigSchema }).strict(),
])

const deletePayloadSchema = z.object({
  channel: z.enum(CHANNEL_IDS),
}).strict()

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; ")
}

export function parseChannelConfigMap(value: unknown): ChannelConfigMap {
  const parsed = channelConfigMapSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Invalid channelConfigEncrypted plaintext: ${formatZodError(parsed.error)}`)
  }
  return parsed.data
}

export function parseChannelPostPayload(value: unknown): ChannelPostPayload {
  const parsed = postPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error))
  }
  return parsed.data
}

export function parseChannelDeletePayload(value: unknown): { channel: ChannelId } {
  const parsed = deletePayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error))
  }
  return parsed.data
}

export function parseChannelConfigBlob(
  encryptedBlob: string | null | undefined,
  decrypt: (encrypted: string) => string,
): ChannelConfigMap {
  if (!encryptedBlob) return {}
  const plaintext = decrypt(encryptedBlob)
  return parseChannelConfigMap(JSON.parse(plaintext))
}

export function serializeChannelConfigMap(config: ChannelConfigMap): string {
  return JSON.stringify(config)
}

export function upsertChannelConfig(
  current: ChannelConfigMap,
  payload: ChannelPostPayload,
): ChannelConfigMap {
  return {
    ...current,
    [payload.channel]: payload.config,
  }
}

export function deleteChannelConfig(current: ChannelConfigMap, channel: ChannelId): ChannelConfigMap {
  const next = { ...current }
  delete next[channel]
  return next
}

export function hasConfiguredChannels(config: ChannelConfigMap): boolean {
  return CHANNEL_IDS.some((channel) => config[channel] !== undefined)
}

export function configuredChannelIds(config: ChannelConfigMap): ChannelId[] {
  return CHANNEL_IDS.filter((channel) => config[channel] !== undefined)
}

export function emptyChannelStatusMap(config: ChannelConfigMap): ChannelStatusMap {
  return Object.fromEntries(
    CHANNEL_IDS.map((channel) => [
      channel,
      {
        configured: config[channel] !== undefined,
        live: "unknown" as const,
      },
    ]),
  ) as ChannelStatusMap
}

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return "****"
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

export function maskChannelConfig(config: ChannelConfigMap): MaskedChannelConfigMap {
  const masked: MaskedChannelConfigMap = {}
  if (config.telegram) masked.telegram = { configured: true, fields: { botToken: maskSecret(config.telegram.botToken) } }
  if (config.discord) masked.discord = { configured: true, fields: { token: maskSecret(config.discord.token) } }
  if (config.slack) {
    masked.slack = {
      configured: true,
      fields: {
        botToken: maskSecret(config.slack.botToken),
        appToken: maskSecret(config.slack.appToken),
      },
    }
  }
  if (config.whatsapp) masked.whatsapp = { configured: true, fields: {} }
  if (config.msteams) {
    masked.msteams = {
      configured: true,
      fields: {
        appId: maskSecret(config.msteams.appId),
        tenantId: config.msteams.tenantId ? maskSecret(config.msteams.tenantId) : "not set",
      },
    }
  }
  return masked
}

export function buildOpenClawChannelsConfig(config: ChannelConfigMap): Record<string, unknown> {
  const channels: Record<string, unknown> = {}

  if (config.telegram) {
    channels.telegram = {
      ...config.telegram,
      groups: config.telegram.groups ?? { "*": { requireMention: true } },
    }
  }

  if (config.discord) {
    channels.discord = {
      ...config.discord,
      guilds: config.discord.guilds ?? { "*": { requireMention: true } },
    }
  }

  if (config.slack) {
    channels.slack = {
      mode: config.slack.mode ?? "socket",
      ...config.slack,
    }
  }

  if (config.whatsapp) {
    channels.whatsapp = {
      dmPolicy: "pairing",
      ...config.whatsapp,
    }
  }

  if (config.msteams) {
    channels.msteams = config.msteams
  }

  return channels
}

export function buildChannelEnvVars(config: ChannelConfigMap): Record<string, string> {
  const env: Record<string, string> = {}
  if (config.telegram) env.TELEGRAM_BOT_TOKEN = config.telegram.botToken
  if (config.discord) env.DISCORD_BOT_TOKEN = config.discord.token
  if (config.slack) {
    env.SLACK_BOT_TOKEN = config.slack.botToken
    env.SLACK_APP_TOKEN = config.slack.appToken
  }
  return env
}
