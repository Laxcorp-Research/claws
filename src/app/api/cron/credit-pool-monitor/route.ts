import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendEmail } from "@/lib/email/send-email"

export const maxDuration = 30

interface PoolStats {
  poolTotalCents: number
  consumedCents: number
  grantedCents: number
  remainingCents: number
  percentUsed: number
  conversionRate: number
  accounts: {
    active: number
    exhausted: number
    converted: number
    suspended: number
    flagged: number
    total: number
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const poolTotalCents = parseInt(process.env.CREDIT_POOL_TOTAL_CENTS || "10000000")

  const consumed = await prisma.creditAccount.aggregate({
    _sum: { totalConsumedCents: true },
  })

  const granted = await prisma.creditAccount.aggregate({
    _sum: { initialGrantCents: true },
  })

  const [active, exhausted, converted, suspended, flagged, total] = await Promise.all([
    prisma.creditAccount.count({ where: { status: "ACTIVE" } }),
    prisma.creditAccount.count({ where: { status: "EXHAUSTED" } }),
    prisma.creditAccount.count({ where: { status: "CONVERTED" } }),
    prisma.creditAccount.count({ where: { status: "SUSPENDED" } }),
    prisma.creditAccount.count({ where: { flaggedForReview: true } }),
    prisma.creditAccount.count(),
  ])

  const consumedCents = consumed._sum.totalConsumedCents ?? 0
  const grantedCents = granted._sum.initialGrantCents ?? 0
  const remainingCents = poolTotalCents - consumedCents
  const percentUsed = poolTotalCents > 0 ? (consumedCents / poolTotalCents) * 100 : 0

  const exhaustedOrConverted = exhausted + converted
  const conversionRate = exhaustedOrConverted > 0
    ? (converted / exhaustedOrConverted) * 100
    : 0

  const stats: PoolStats = {
    poolTotalCents,
    consumedCents,
    grantedCents,
    remainingCents,
    percentUsed: Math.round(percentUsed * 10) / 10,
    conversionRate: Math.round(conversionRate * 10) / 10,
    accounts: { active, exhausted, converted, suspended, flagged, total },
  }

  log.info("Credit pool status", { ...stats, accounts: { ...stats.accounts } })

  const adminEmail = process.env.ADMIN_ALERT_EMAIL || "chaitanya@laxcorp.com"

  if (percentUsed > 90) {
    await sendPoolAlert(adminEmail, "CRITICAL", stats)
  } else if (percentUsed > 75) {
    await sendPoolAlert(adminEmail, "WARNING", stats)
  } else if (percentUsed > 50) {
    await sendPoolAlert(adminEmail, "INFO", stats)
  }

  return Response.json({ success: true, data: stats })
}

async function sendPoolAlert(to: string, level: "INFO" | "WARNING" | "CRITICAL", stats: PoolStats) {
  const remaining = `$${(stats.remainingCents / 100).toFixed(2)}`
  const consumed = `$${(stats.consumedCents / 100).toFixed(2)}`
  const total = `$${(stats.poolTotalCents / 100).toFixed(2)}`

  const subject =
    level === "CRITICAL"
      ? `[CRITICAL] Claws credit pool at ${stats.percentUsed}%`
      : level === "WARNING"
        ? `[WARNING] Claws credit pool at ${stats.percentUsed}%`
        : `Claws credit pool status: ${stats.percentUsed}% used`

  // Wrapper checks the SDK's resolved error field - a rejected send now
  // logs email_failed instead of "Pool alert sent".
  const result = await sendEmail({
    kind: "credit_pool_alert",
    to,
    subject,
      html: `
        <h2>Credit Pool ${level}</h2>
        <p>Pool usage: <strong>${stats.percentUsed}%</strong></p>
        <ul>
          <li>Consumed: ${consumed} of ${total}</li>
          <li>Remaining: ${remaining}</li>
          <li>Total accounts: ${stats.accounts.total}</li>
          <li>Active: ${stats.accounts.active}</li>
          <li>Exhausted: ${stats.accounts.exhausted}</li>
          <li>Converted to own key: ${stats.accounts.converted}</li>
          <li>Conversion rate: ${stats.conversionRate}%</li>
          <li>Flagged for review: ${stats.accounts.flagged}</li>
        </ul>
      `,
  })
  if (result.ok) {
    log.info("Pool alert sent", { level, to, percentUsed: stats.percentUsed })
  } else {
    log.error("Failed to send pool alert email", { level, to, error: result.reason })
  }
}
