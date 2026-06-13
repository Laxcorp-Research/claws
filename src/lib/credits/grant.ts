import { prisma } from "@/lib/db"
import { redis } from "@/lib/redis"
import { createHash } from "crypto"
import { log } from "@/lib/logger"
import { STARTER_CREDIT_CENTS } from "@/lib/credits/constants"

function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split("@")
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "").replace(/\+.*$/, "")}@gmail.com`
  }
  return `${local.replace(/\+.*$/, "")}@${domain}`
}

export async function grantStarterCredits(userId: string, ip: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { creditAccount: true },
  })

  if (!user) return null
  if (user.creditAccount) return null
  if (!user.emailVerifiedForCredits) return null

  const emailHash = createHash("sha256")
    .update(normalizeEmail(user.email))
    .digest("hex")

  const emailDupe = await prisma.creditAccount.findFirst({
    where: { grantFingerprint: emailHash },
  })
  if (emailDupe) {
    log.warn("Duplicate email credit attempt", { userId, emailHash })
    return null
  }

  const oneDayAgo = new Date(Date.now() - 86400000)
  const ipCount = await prisma.creditAccount.count({
    where: { ipAtGrant: ip, grantedAt: { gt: oneDayAgo } },
  })
  if (ipCount >= 10) {
    log.error("IP abuse block on credit grant", { userId, ip, count: ipCount })
    return null
  }
  const flagged = ipCount >= 3

  // Default to the single-source-of-truth constant ($50). The env var remains
  // an operational override knob, but the literal lives only in constants.ts.
  const starterCreditCents = parseInt(
    process.env.CLAWS_STARTER_CREDIT_CENTS || String(STARTER_CREDIT_CENTS),
  )

  try {
    const account = await prisma.creditAccount.create({
      data: {
        userId,
        initialGrantCents: starterCreditCents,
        balanceCents: starterCreditCents,
        status: "ACTIVE",
        grantFingerprint: emailHash,
        ipAtGrant: ip,
        flaggedForReview: flagged,
      },
    })

    await redis.set(`credit:balance:${userId}`, starterCreditCents.toString())

    await prisma.user.update({
      where: { id: userId },
      data: { apiKeySource: "PLATFORM_CREDIT" },
    })

    log.info("Starter credits granted", { userId, cents: starterCreditCents, flagged })
    return account
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return prisma.creditAccount.findUnique({ where: { userId } })
    }
    throw err
  }
}
