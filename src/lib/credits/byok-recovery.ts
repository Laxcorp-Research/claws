import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

/**
 * Flip a user from platform credit → BYOK after they save a valid Anthropic key.
 * - apiKeySource = USER_OWN_KEY
 * - CreditAccount ACTIVE|EXHAUSTED → CONVERTED
 * - STOPPED credit-exhausted claws → HIBERNATED so Wake (not only Redeploy) works
 *
 * Called from switch-source and from POST /api/api-keys when the account is EXHAUSTED.
 */
export async function convertUserToByok(userId: string): Promise<{
  switched: true
  rearmedHibernated: number
}> {
  await prisma.user.update({
    where: { id: userId },
    data: { apiKeySource: "USER_OWN_KEY" },
  })

  await prisma.creditAccount.updateMany({
    where: { userId, status: { in: ["ACTIVE", "EXHAUSTED"] } },
    data: { status: "CONVERTED" },
  })

  // Exhaustion mismatch: Workspace.status=STOPPED + containerPhase=HIBERNATED.
  // Wake requires workspace HIBERNATED - converge only that shape (not user-Stops).
  const rearmed = await prisma.workspace.updateMany({
    where: {
      userId,
      status: "STOPPED",
      containerState: { containerPhase: "HIBERNATED" },
    },
    data: { status: "HIBERNATED" },
  })

  log.info("byok-recovery: converted user to USER_OWN_KEY", {
    userId,
    rearmedHibernated: rearmed.count,
  })

  return { switched: true, rearmedHibernated: rearmed.count }
}
