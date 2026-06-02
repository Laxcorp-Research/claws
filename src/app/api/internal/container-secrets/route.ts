import { NextRequest } from "next/server"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"
import { deriveContainerEnv } from "@/lib/openclaw/derive-container-env"
import {
  requireActivityEndpoint,
  requireMeteringEndpoint,
  assertEndpointHostMatchesApp,
} from "@/lib/openclaw/env-guards"
import { randomBytes, createCipheriv } from "crypto"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("Authorization")
  if (auth !== `Bearer ${process.env.CONTAINER_AGENT_SECRET}`) {
    return apiError("UNAUTHORIZED", "Invalid agent secret", 401)
  }

  // PR-2b #1 + #2: fail-closed on unset/mismatched endpoint env BEFORE we
  // load workspace data. This route is called on-demand by containers to
  // refresh their secrets; we must NEVER hand back a misrouted env. See
  // src/lib/openclaw/env-guards.ts for full root-cause writeup.
  //
  // We run the guards up-front (before workspace lookup) so a misconfigured
  // deploy fails the same way for every workspace — no per-workspace skew.
  let activityEndpoint: string
  let meteringEndpoint: string
  try {
    meteringEndpoint = requireMeteringEndpoint()
    assertEndpointHostMatchesApp({ endpointUrl: meteringEndpoint, endpointName: "METERING_ENDPOINT" })
    activityEndpoint = requireActivityEndpoint()
    assertEndpointHostMatchesApp({ endpointUrl: activityEndpoint, endpointName: "ACTIVITY_ENDPOINT" })
  } catch (err) {
    return apiError(
      "ENDPOINT_CONFIG_INVALID",
      err instanceof Error ? err.message : String(err),
      500,
    )
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
  // PR-8a: credential env from the single source of truth.
  const credential = deriveContainerEnv(workspace, workspace.user)

  // PR2: ungated for universal state preservation. These 3 vars (WORKSPACE_ID,
  // METERING_ENDPOINT, METERING_SECRET) were credit-mode-gated until 2026-04-28.
  // process-manager.mjs's syncState() requires all three; without them sync
  // short-circuits silently. Emitting them for every container makes state
  // preservation universal. Credit-proxy-specific vars (CLAWS_USER_ID,
  // ANTHROPIC_*) stay gated below because they require the proxy process.
  envVars.push(`CLAWS_WORKSPACE_ID=${workspaceId}`)
  envVars.push(`CLAWS_METERING_ENDPOINT=${meteringEndpoint}`)
  envVars.push(`CLAWS_METERING_SECRET=${process.env.METERING_MASTER_SECRET}`)

  // PR-2: Activity Wire — universal, mirrors the metering triplet above.
  // The claws-activity-reporter overlay plugin (loaded by the OpenClaw
  // gateway from /opt/claws-activity-reporter) reads both and POSTs
  // batched events. Must match src/lib/openclaw/deployer.ts:buildRailwayEnvVars.
  envVars.push(`CLAWS_ACTIVITY_ENDPOINT=${activityEndpoint}`)
  envVars.push(`CLAWS_ACTIVITY_SECRET=${process.env.ACTIVITY_PIPELINE_SECRET ?? ""}`)

  // Stamp the derived credential into this route's envVars[] shape. NOTE the
  // distinction from buildRailwayEnvVars (deploy path): this runtime path emits
  // the decrypted BYOK key DIRECTLY (non-credit), whereas the deploy path bakes
  // the BYOK key into CLAWS_ENV_B64 via the generator. Both now derive from the
  // same deriveContainerEnv output; only the output SHAPE differs.
  if (credential.ANTHROPIC_API_KEY) {
    envVars.push(`ANTHROPIC_API_KEY=${credential.ANTHROPIC_API_KEY}`)
  }
  if (credential.ANTHROPIC_BASE_URL) {
    envVars.push(`ANTHROPIC_BASE_URL=${credential.ANTHROPIC_BASE_URL}`)
  }
  if (credential.CLAWS_CREDIT_MODE) {
    envVars.push(`CLAWS_CREDIT_MODE=true`)
    envVars.push(`CLAWS_USER_ID=${workspace.userId}`)
  } else {
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
