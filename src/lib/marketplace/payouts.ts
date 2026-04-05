import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

const PAYOUT_HOLD_DAYS = 7
const MINIMUM_PAYOUT_THRESHOLD = 10

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
    },
    select: { creatorPayout: true },
  })

  const totalAmount = Math.round(pending.reduce((s, r) => s + r.creatorPayout, 0) * 100) / 100

  const result = await prisma.marketplaceSale.updateMany({
    where: {
      payoutStatus: "PENDING",
      payoutHeldUntil: { lte: now },
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
  }>
> {
  const releasableSales = await prisma.marketplaceSale.findMany({
    where: { payoutStatus: "RELEASABLE" },
    include: {
      creator: {
        select: { displayName: true, dodoBeneficiaryId: true },
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
    }
  >()

  for (const sale of releasableSales) {
    const existing = byCreator.get(sale.creatorId) ?? {
      displayName: sale.creator.displayName,
      totalPayout: 0,
      saleCount: 0,
      saleIds: [] as string[],
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
    }))
}

export async function markPayoutProcessing(saleIds: string[], batchId: string): Promise<void> {
  await prisma.marketplaceSale.updateMany({
    where: { id: { in: saleIds } },
    data: {
      payoutStatus: "PROCESSING",
      payoutBatchId: batchId,
    },
  })

  log.info("Payout batch processing", {
    category: "payout",
    batchId,
    saleCount: saleIds.length,
  })
}

export async function markPayoutPaid(batchId: string): Promise<void> {
  await prisma.marketplaceSale.updateMany({
    where: { payoutBatchId: batchId },
    data: {
      payoutStatus: "PAID",
      paidAt: new Date(),
    },
  })

  log.info("Payout batch completed", { category: "payout", batchId })
}

export async function cancelPayout(dodoPaymentId: string): Promise<void> {
  await prisma.marketplaceSale.updateMany({
    where: {
      dodoPaymentId,
      payoutStatus: { in: ["PENDING", "RELEASABLE"] },
    },
    data: {
      payoutStatus: "REFUNDED",
    },
  })

  log.info("Payout cancelled (refund)", { category: "payout", dodoPaymentId })
}

export async function getCreatorEarnings(creatorId: string) {
  const [totalEarnedAgg, pendingAgg, nextPending, totalSales, recentSales] = await Promise.all([
    prisma.marketplaceSale.aggregate({
      where: { creatorId, payoutStatus: "PAID" },
      _sum: { creatorPayout: true },
    }),
    prisma.marketplaceSale.aggregate({
      where: {
        creatorId,
        payoutStatus: { in: ["PENDING", "RELEASABLE"] },
      },
      _sum: { creatorPayout: true },
    }),
    prisma.marketplaceSale.findFirst({
      where: { creatorId, payoutStatus: "PENDING" },
      orderBy: { payoutHeldUntil: "asc" },
      select: { payoutHeldUntil: true },
    }),
    prisma.marketplaceSale.count({ where: { creatorId } }),
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
  const pendingPayout = pendingAgg._sum.creatorPayout ?? 0

  return {
    totalEarned: Math.round(totalEarned * 100) / 100,
    pendingPayout: Math.round(pendingPayout * 100) / 100,
    paidOut: Math.round(totalEarned * 100) / 100,
    nextPayoutDate: nextPending?.payoutHeldUntil ?? null,
    totalSales,
    recentSales: recentSales.map((s) => ({
      id: s.id,
      itemName: s.template?.name ?? s.skill?.name ?? "Unknown",
      itemType: s.templateId ? "template" : "skill",
      amount: s.amount,
      creatorPayout: s.creatorPayout,
      payoutStatus: s.payoutStatus,
      createdAt: s.createdAt,
    })),
  }
}
