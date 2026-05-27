import { NextRequest } from "next/server"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import { randomBytes, createCipheriv } from "crypto"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("Authorization")
  if (auth !== `Bearer ${process.env.CONTAINER_AGENT_SECRET}`) {
    return apiError("UNAUTHORIZED", "Invalid agent secret", 401)
  }

  const { workspaceId } = await req.json()

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      user: { include: { apiKeys: true, creditAccount: true } },
    },
  })

  if (!workspace) return ERRORS.NOT_FOUND("Workspace")

  const envVars: string[] = []
  const source = getApiKeySource(workspace, workspace.user)

  // PR2: ungated for universal state preservation. These 3 vars (WORKSPACE_ID,
  // METERING_ENDPOINT, METERING_SECRET) were credit-mode-gated until 2026-04-28.
  // process-manager.mjs's syncState() requires all three; without them sync
  // short-circuits silently. Emitting them for every container makes state
  // preservation universal. Credit-proxy-specific vars (CLAWS_USER_ID,
  // ANTHROPIC_*) stay gated below because they require the proxy process.
  envVars.push(`CLAWS_WORKSPACE_ID=${workspaceId}`)
  envVars.push(
    `CLAWS_METERING_ENDPOINT=${process.env.METERING_ENDPOINT || "https://app.buildclaws.ai/api/internal/metering"}`
  )
  envVars.push(`CLAWS_METERING_SECRET=${process.env.METERING_MASTER_SECRET}`)

  // PR-2: Activity Wire — universal, mirrors the metering triplet above.
  // The claws-activity-reporter overlay plugin (loaded by the OpenClaw
  // gateway from /opt/claws-activity-reporter) reads both and POSTs
  // batched events. Must match src/lib/openclaw/deployer.ts:buildRailwayEnvVars.
  envVars.push(
    `CLAWS_ACTIVITY_ENDPOINT=${process.env.ACTIVITY_ENDPOINT || "https://app.buildclaws.ai/api/internal/activity"}`
  )
  envVars.push(`CLAWS_ACTIVITY_SECRET=${process.env.ACTIVITY_PIPELINE_SECRET ?? ""}`)

  if (source === "PLATFORM_CREDIT") {
    envVars.push(`ANTHROPIC_API_KEY=${process.env.CLAWS_MASTER_ANTHROPIC_KEY}`)
    envVars.push(`ANTHROPIC_BASE_URL=http://localhost:3789`)
    envVars.push(`CLAWS_CREDIT_MODE=true`)
    envVars.push(`CLAWS_USER_ID=${workspace.userId}`)
  } else {
    const anthropicKey = workspace.user.apiKeys.find((k) => k.provider === "ANTHROPIC")
    if (anthropicKey) {
      envVars.push(`ANTHROPIC_API_KEY=${decrypt(anthropicKey.encryptedKey)}`)
    }
    envVars.push(`CLAWS_CREDIT_MODE=false`)
  }

  if (workspace.gatewayToken) {
    envVars.push(`OPENCLAW_GATEWAY_TOKEN=${decrypt(workspace.gatewayToken)}`)
  }

  if (workspace.channelConfigEncrypted) {
    const ch = JSON.parse(decrypt(workspace.channelConfigEncrypted))
    if (ch.telegram?.botToken) envVars.push(`TELEGRAM_BOT_TOKEN=${ch.telegram.botToken}`)
    if (ch.discord?.botToken) envVars.push(`DISCORD_BOT_TOKEN=${ch.discord.botToken}`)
    if (ch.slack?.botToken) envVars.push(`SLACK_BOT_TOKEN=${ch.slack.botToken}`)
    if (ch.slack?.appToken) envVars.push(`SLACK_APP_TOKEN=${ch.slack.appToken}`)
  }

  const transportKey = process.env.AGENT_TRANSPORT_KEY
  if (transportKey) {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(transportKey, "hex"), iv)
    let encrypted = cipher.update(JSON.stringify(envVars), "utf8", "base64")
    encrypted += cipher.final("base64")
    const authTag = cipher.getAuthTag().toString("base64")

    return apiSuccess({
      encrypted: `${iv.toString("base64")}:${authTag}:${encrypted}`,
    })
  }

  return apiSuccess({ envVars })
}
