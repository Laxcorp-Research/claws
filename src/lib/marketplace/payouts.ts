import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendEmail } from "@/lib/email/send-email"
import { randomBytes } from "node:crypto"

export const PAYOUT_HOLD_DAYS = 7
export const MINIMUM_PAYOUT_THRESHOLD = 10

/** Locked lifecycle: RELEASABLE → PROCESSING → PAID (no skip). */
export const PAYOUT_LEGAL_TRANSITIONS = {
  markProcessingFrom: ["RELEASABLE"] as const,
  markPaidFrom: ["PROCESSING"] as const,
  clawbackDirectFrom: ["PENDING", "RELEASABLE", "PROCESSING"] as const,
} as const

export async function createMarketplaceSale(params: {
  templateId?: string
  skillId?: string
  buyerId: string
  creatorId: string
  amount: number
  processingFee: number
  dodoPaymentId: string
}) {
  const { templateId, skillId, buyerId, creatorId, amount, processingFee, dodoPaymentId } = params

  const payoutHeldUntil = new Date()
  payoutHeldUntil.setDate(payoutHeldUntil.getDate() + PAYOUT_HOLD_DAYS)

  const sale = await prisma.marketplaceSale.create({
    data: {
      templateId,
      skillId,
      buyerId,
      creatorId,
      amount,
      processingFee,
      creatorPayout: Math.round((amount - processingFee) * 100) / 100,
      payoutStatus: "PENDING",
      payoutHeldUntil,
      dodoPaymentId,
    },
  })

  log.marketplaceEvent({
    event: templateId ? "template_purchased" : "skill_purchased",
    itemId: templateId ?? skillId ?? "unknown",
    itemType: templateId ? "template" : "skill",
    userId: buyerId,
    details: { creatorId, amount, processingFee },
  })

  return sale
}

export async function releaseEligiblePayouts(): Promise<{
  released: number
  totalAmount: number
}> {
  const now = new Date()

  const pending = await prisma.marketplaceSale.findMany({
    where: {
      payoutStatus: "PENDING",
      payoutHeldUntil: { lte: now },
      adjustmentOfSaleId: null,
    },
    select: { creatorPayout: true },
  })

  const totalAmount = Math.round(pending.reduce((s, r) => s + r.creatorPayout, 0) * 100) / 100

  const result = await prisma.marketplaceSale.updateMany({
    where: {
      payoutStatus: "PENDING",
      payoutHeldUntil: { lte: now },
      adjustmentOfSaleId: null,
    },
    data: {
      payoutStatus: "RELEASABLE",
    },
  })

  log.info("Payouts released", {
    category: "payout",
    released: result.count,
    totalAmount,
  })

  return {
    released: result.count,
    totalAmount,
  }
}

export async function getReleasablePayoutBatches(): Promise<
  Array<{
    creatorId: string
    displayName: string
    totalPayout: number
    saleCount: number
    saleIds: string[]
    payoutMethod: string | null
    payoutDetailsHint: string | null
    hasPayoutDetails: boolean
  }>
> {
  const releasableSales = await prisma.marketplaceSale.findMany({
    where: { payoutStatus: "RELEASABLE", adjustmentOfSaleId: null },
    include: {
      creator: {
        select: {
          displayName: true,
          payoutMethod: true,
          payoutDetailsHint: true,
          payoutDetailsEncrypted: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  const byCreator = new Map<
    string,
    {
      displayName: string
      totalPayout: number
      saleCount: number
      saleIds: string[]
      payoutMethod: string | null
      payoutDetailsHint: string | null
      hasPayoutDetails: boolean
    }
  >()

  for (const sale of releasableSales) {
    const existing = byCreator.get(sale.creatorId) ?? {
      displayName: sale.creator.displayName,
      totalPayout: 0,
      saleCount: 0,
      saleIds: [] as string[],
      payoutMethod: sale.creator.payoutMethod,
      payoutDetailsHint: sale.creator.payoutDetailsHint,
      hasPayoutDetails: !!sale.creator.payoutDetailsEncrypted,
    }
    existing.totalPayout += sale.creatorPayout
    existing.saleCount += 1
    existing.saleIds.push(sale.id)
    byCreator.set(sale.creatorId, existing)
  }

  return Array.from(byCreator.entries())
    .filter(([, data]) => data.totalPayout >= MINIMUM_PAYOUT_THRESHOLD)
    .map(([creatorId, data]) => ({
      creatorId,
      ...data,
      totalPayout: Math.round(data.totalPayout * 100) / 100,
    }))
}

export async function getProcessingPayoutBatches(): Promise<
  Array<{
    batchId: string
    creatorId: string
    displayName: string
    totalPayout: number
    saleCount: number
    saleIds: string[]
  }>
> {
  const rows = await prisma.marketplaceSale.findMany({
    where: { payoutStatus: "PROCESSING", payoutBatchId: { not: null } },
    include: { creator: { select: { displayName: true } } },
  })

  const byBatch = new Map<
    string,
    {
      creatorId: string
      displayName: string
      totalPayout: number
      saleCount: number
      saleIds: string[]
    }
  >()

  for (const sale of rows) {
    const batchId = sale.payoutBatchId!
    const existing = byBatch.get(batchId) ?? {
      creatorId: sale.creatorId,
      displayName: sale.creator.displayName,
      totalPayout: 0,
      saleCount: 0,
      saleIds: [] as string[],
    }
    existing.totalPayout += sale.creatorPayout
    existing.saleCount += 1
    existing.saleIds.push(sale.id)
    byBatch.set(batchId, existing)
  }

  return Array.from(byBatch.entries()).map(([batchId, data]) => ({
    batchId,
    ...data,
    totalPayout: Math.round(data.totalPayout * 100) / 100,
  }))
}

/**
 * RELEASABLE → PROCESSING only. Skipping is illegal (mutation-locked).
 */
export async function markPayoutProcessing(saleIds: string[], batchId?: string): Promise<string> {
  if (saleIds.length === 0) throw new Error("PAYOUT_EMPTY_BATCH")
  const id = batchId ?? `batch_${randomBytes(8).toString("hex")}`

  const sales = await prisma.marketplaceSale.findMany({
    where: { id: { in: saleIds } },
    select: { id: true, payoutStatus: true },
  })
  if (sales.length !== saleIds.length) throw new Error("PAYOUT_SALE_NOT_FOUND")
  const illegal = sales.filter((s) => s.payoutStatus !== "RELEASABLE")
  if (illegal.length > 0) {
    throw new Error("PAYOUT_ILLEGAL_TRANSITION: markProcessing requires RELEASABLE")
  }

  await prisma.marketplaceSale.updateMany({
    where: { id: { in: saleIds }, payoutStatus: "RELEASABLE" },
    data: {
      payoutStatus: "PROCESSING",
      payoutBatchId: id,
    },
  })

  log.info("Payout batch processing", {
    category: "payout",
    batchId: id,
    saleCount: saleIds.length,
  })
  return id
}

/**
 * PROCESSING → PAID only. Sends Resend notification when possible.
 *
 * `notifyEmail` surfaces the send outcome to the admin who clicked "mark
 * paid" - a payout has no workspace so there is no Telegram escalation
 * target; the human actor in the response IS the escalation path.
 */
export async function markPayoutPaid(params: {
  batchId: string
  transferRef: string
}): Promise<{
  paidCount: number
  totalPayout: number
  notifyEmail: "sent" | "failed" | "skipped"
}> {
  const ref = params.transferRef.trim()
  if (!ref) throw new Error("PAYOUT_TRANSFER_REF_REQUIRED")

  const sales = await prisma.marketplaceSale.findMany({
    where: { payoutBatchId: params.batchId },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
  })
  if (sales.length === 0) throw new Error("PAYOUT_BATCH_NOT_FOUND")
  const illegal = sales.filter((s) => s.payoutStatus !== "PROCESSING")
  if (illegal.length > 0) {
    throw new Error("PAYOUT_ILLEGAL_TRANSITION: markPaid requires PROCESSING (cannot skip from RELEASABLE)")
  }

  const paidAt = new Date()
  const result = await prisma.marketplaceSale.updateMany({
    where: { payoutBatchId: params.batchId, payoutStatus: "PROCESSING" },
    data: {
      payoutStatus: "PAID",
      paidAt,
      payoutTransferRef: ref,
    },
  })

  const totalPayout = Math.round(sales.reduce((s, r) => s + r.creatorPayout, 0) * 100) / 100
  const creator = sales[0]?.creator
  let notifyEmail: "sent" | "failed" | "skipped" = "skipped"
  if (creator?.user?.email && process.env.RESEND_API_KEY) {
    // CRITICAL send (one retry in the wrapper): the money moved - the
    // creator must hear about it, or the admin must see that they didn't.
    const emailResult = await sendEmail({
      kind: "payout_paid",
      critical: true,
      to: creator.user.email,
      subject: `Your payout of $${totalPayout.toFixed(2)} was sent`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
            <h2 style="font-size: 18px; font-weight: 600;">Payout sent</h2>
            <p style="font-size: 14px; color: #555; line-height: 1.6;">
              Hi ${creator.user.name || creator.displayName || "there"},
            </p>
            <p style="font-size: 14px; color: #555; line-height: 1.6;">
              Your payout of <strong>$${totalPayout.toFixed(2)}</strong> was sent
              (ref: <strong>${escapeHtml(ref)}</strong>).
            </p>
          <p style="font-size: 13px; color: #999; margin-top: 24px;">&mdash; The Claws Team</p>
        </div>
        `,
    })
    notifyEmail = emailResult.ok ? "sent" : "failed"
    if (!emailResult.ok) {
      log.warn("Failed to send payout PAID email", {
        category: "payout",
        batchId: params.batchId,
        error: emailResult.reason,
      })
    }
  }

  log.info("Payout batch completed", {
    category: "payout",
    batchId: params.batchId,
    paidCount: result.count,
    transferRef: ref,
    notifyEmail,
  })

  return { paidCount: result.count, totalPayout, notifyEmail }
}

/**
 * Clawback until PAID (PENDING|RELEASABLE|PROCESSING → REFUNDED).
 * After PAID: create negative adjustment row (flagged RELEASABLE for admin).
 */
export async function cancelPayout(dodoPaymentId: string): Promise<{
  mode: "direct_refund" | "post_paid_adjustment" | "noop"
  saleId?: string
  adjustmentId?: string
}> {
  const sale = await prisma.marketplaceSale.findFirst({
    where: { dodoPaymentId },
  })
  if (!sale) return { mode: "noop" }

  if (
    sale.payoutStatus === "PENDING" ||
    sale.payoutStatus === "RELEASABLE" ||
    sale.payoutStatus === "PROCESSING"
  ) {
    await prisma.marketplaceSale.update({
      where: { id: sale.id },
      data: { payoutStatus: "REFUNDED" },
    })
    log.info("Payout cancelled (refund)", {
      category: "payout",
      dodoPaymentId,
      previousStatus: sale.payoutStatus,
    })
    return { mode: "direct_refund", saleId: sale.id }
  }

  if (sale.payoutStatus === "PAID") {
    const existingAdj = await prisma.marketplaceSale.findFirst({
      where: { adjustmentOfSaleId: sale.id },
      select: { id: true },
    })
    if (existingAdj) {
      return { mode: "post_paid_adjustment", saleId: sale.id, adjustmentId: existingAdj.id }
    }

    const adj = await prisma.marketplaceSale.create({
      data: {
        templateId: sale.templateId,
        skillId: sale.skillId,
        buyerId: sale.buyerId,
        creatorId: sale.creatorId,
        amount: -Math.abs(sale.amount),
        processingFee: 0,
        creatorPayout: -Math.abs(sale.creatorPayout),
        payoutStatus: "RELEASABLE",
        dodoPaymentId: `clawback_${dodoPaymentId}`,
        adjustmentOfSaleId: sale.id,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: sale.buyerId,
        action: "PAYOUT_CLAWBACK_ADJUSTMENT",
        resource: "marketplace_sale",
        resourceId: adj.id,
        after: JSON.stringify({
          originalSaleId: sale.id,
          dodoPaymentId,
          creatorPayout: adj.creatorPayout,
          flagged: "admin_manual_rail",
        }),
      },
    })

    log.info("Post-PAID clawback adjustment created", {
      category: "payout",
      dodoPaymentId,
      adjustmentId: adj.id,
      originalSaleId: sale.id,
    })
    return { mode: "post_paid_adjustment", saleId: sale.id, adjustmentId: adj.id }
  }

  return { mode: "noop", saleId: sale.id }
}

export async function getCreatorEarnings(creatorId: string) {
  const [
    totalEarnedAgg,
    pendingAgg,
    releasableAgg,
    processingAgg,
    nextPending,
    totalSales,
    recentSales,
  ] = await Promise.all([
    prisma.marketplaceSale.aggregate({
      where: { creatorId, payoutStatus: "PAID", adjustmentOfSaleId: null },
      _sum: { creatorPayout: true },
    }),
    prisma.marketplaceSale.aggregate({
      where: { creatorId, payoutStatus: "PENDING" },
      _sum: { creatorPayout: true },
    }),
    prisma.marketplaceSale.aggregate({
      where: { creatorId, payoutStatus: "RELEASABLE" },
      _sum: { creatorPayout: true },
    }),
    prisma.marketplaceSale.aggregate({
      where: { creatorId, payoutStatus: "PROCESSING" },
      _sum: { creatorPayout: true },
    }),
    prisma.marketplaceSale.findFirst({
      where: { creatorId, payoutStatus: "PENDING" },
      orderBy: { payoutHeldUntil: "asc" },
      select: { payoutHeldUntil: true },
    }),
    prisma.marketplaceSale.count({
      where: { creatorId, adjustmentOfSaleId: null },
    }),
    (async () => {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      return prisma.marketplaceSale.findMany({
        where: { creatorId, createdAt: { gte: thirtyDaysAgo } },
        include: {
          template: { select: { name: true } },
          skill: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    })(),
  ])

  const totalEarned = totalEarnedAgg._sum.creatorPayout ?? 0
  const pendingHold = pendingAgg._sum.creatorPayout ?? 0
  const releasablePayout = releasableAgg._sum.creatorPayout ?? 0
  const processingPayout = processingAgg._sum.creatorPayout ?? 0
  // Backward-compat: pendingPayout = hold + releasable (pre-split clients).
  const pendingPayout = pendingHold + releasablePayout

  return {
    totalEarned: Math.round(totalEarned * 100) / 100,
    pendingHold: Math.round(pendingHold * 100) / 100,
    releasablePayout: Math.round(releasablePayout * 100) / 100,
    pendingPayout: Math.round(pendingPayout * 100) / 100,
    processingPayout: Math.round(processingPayout * 100) / 100,
    paidOut: Math.round(totalEarned * 100) / 100,
    nextPayoutDate: nextPending?.payoutHeldUntil ?? null,
    totalSales,
    recentSales: recentSales.map((s) => ({
      id: s.id,
      itemName: s.template?.name ?? s.skill?.name ?? "Unknown",
      itemType: s.templateId ? ("template" as const) : ("skill" as const),
      amount: s.amount,
      creatorPayout: s.creatorPayout,
      payoutStatus: s.payoutStatus,
      isAdjustment: !!s.adjustmentOfSaleId,
      createdAt: s.createdAt,
    })),
    lifecycleCopy:
      "Payouts are processed manually in batches. Status moves pending → releasable → processing → paid.",
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
