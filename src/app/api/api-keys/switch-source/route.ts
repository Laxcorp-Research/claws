import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

export async function POST() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const userId = user.id

  const validKey = await prisma.userApiKey.findFirst({
    where: { userId, provider: "ANTHROPIC", isValid: true },
  })

  if (!validKey) {
    return apiError("NO_VALID_KEY", "Add and validate an Anthropic API key first", 400)
  }

  await prisma.user.update({
    where: { id: userId },
    data: { apiKeySource: "USER_OWN_KEY" },
  })

  await prisma.creditAccount.updateMany({
    where: { userId, status: "ACTIVE" },
    data: { status: "CONVERTED" },
  })

  const running = await prisma.workspace.findMany({
    where: { userId, status: { in: ["RUNNING", "HIBERNATED", "WAKING"] } },
  })

  // TODO: Queue container recycle via DO agent
  for (const ws of running) {
    log.info("Container recycle needed", { workspaceId: ws.id, reason: "API_KEY_SOURCE_CHANGED" })
  }

  return apiSuccess({
    switched: true,
    recyclingCount: running.length,
    message: "Your agents will restart with your own API key. This takes about 30 seconds.",
  })
}
