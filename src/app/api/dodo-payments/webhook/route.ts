import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import type { AuditAction } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { createWorkspaceFromTemplate } from "@/lib/workspace-from-template"
import { log } from "@/lib/logger"
import { createMarketplaceSale, cancelPayout } from "@/lib/marketplace/payouts"
import { marketplaceFeeFromPaid, paidDollarsFromWebhook } from "@/lib/marketplace/paid-amount"
import { isOwnListing } from "@/lib/marketplace/own-listing"
import {
  DEPLOYED_EVIDENCE_STATUSES,
  decideRefundWorkspaceAction,
} from "@/lib/marketplace/refund-policy"
import { destroyContainer } from "@/lib/openclaw/deployer"
import { enqueueProvisioning } from "@/lib/railway/governor"
import { sendCustomerNudge } from "@/lib/alerts/customer-nudge"
import type { HealConditionId } from "@/lib/healing/conditions"

/**
 * Ledger a subscription lifecycle webhook into AuditLog.
 * Uses existing AuditAction enums; `resource` carries the exact event name
 * (e.g. subscription.active) so the ledger stays queryable by event.
 */
async function ledgerSubscriptionLifecycle(args: {
  userId: string
  eventType: string
  subscriptionId?: string | null
  status: string
  workspaceId?: string | null
}): Promise<void> {
  const action = subscriptionEventAuditAction(args.eventType)
  try {
    await prisma.auditLog.create({
      data: {
        userId: args.userId,
        workspaceId: args.workspaceId ?? null,
        action,
        resource: args.eventType,
        resourceId: args.subscriptionId ?? args.userId,
        after: JSON.stringify({
          eventType: args.eventType,
          subscriptionStatus: args.status,
          subscriptionId: args.subscriptionId ?? null,
        }),
      },
    })
  } catch (err) {
    // Never fail the webhook over ledger write - Dodo retries on non-200.
    log.error("dodo-webhook: failed to ledger subscription lifecycle", {
      userId: args.userId,
      eventType: args.eventType,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function nudgeOwnerWorkspaces(userId: string, condition: HealConditionId): Promise<void> {
  try {
    const workspaces = await prisma.workspace.findMany({
      where: { userId },
      select: { id: true },
    })
    for (const workspace of workspaces) {
      try {
        await sendCustomerNudge({ workspaceId: workspace.id, condition })
      } catch (err) {
        log.error("dodo-webhook: customer nudge failed", {
          userId,
          workspaceId: workspace.id,
          condition,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    log.error("dodo-webhook: nudge workspace lookup failed", {
      userId,
      condition,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function subscriptionEventAuditAction(eventType: string): AuditAction {
  switch (eventType) {
    case "subscription.active":
    case "subscription.on_hold":
      return "SUBSCRIPTION_STARTED"
    case "subscription.cancelled":
    case "subscription.expired":
      return "SUBSCRIPTION_CANCELED"
    case "subscription.failed":
      return "PAYMENT_FAILED"
    default:
      return "SUBSCRIPTION_STARTED"
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.DODO_PAYMENTS_API_KEY || !process.env.DODO_PAYMENTS_WEBHOOK_KEY) {
    log.error("Webhook not configured: missing DODO_PAYMENTS_API_KEY or DODO_PAYMENTS_WEBHOOK_KEY")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  const webhookClient = new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
    environment: (process.env.DODO_PAYMENTS_ENVIRONMENT as "live_mode" | "test_mode") || "live_mode",
  })

  try {
    const rawBody = await req.text()
    const headers = {
      "webhook-id": req.headers.get("webhook-id") || "",
      "webhook-signature": req.headers.get("webhook-signature") || "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
    }

    let payload: Record<string, unknown>
    try {
      payload = webhookClient.webhooks.unwrap(rawBody, { headers }) as unknown as Record<string, unknown>
    } catch {
      log.warn("Webhook signature verification failed", { category: "payment" })
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    const eventType = (payload.type ?? payload.event_type) as string
    const data = payload.data as Record<string, unknown> | undefined
    const metadata = (data?.metadata ?? {}) as Record<string, string>
    const customerEmail = (data?.customer as Record<string, string>)?.email

    log.info("Webhook received", {
      eventType,
      metadataType: metadata.type,
      metadataUserId: metadata.userId,
      metadataEmail: metadata.email,
      customerEmail,
      hasData: !!data,
      dataKeys: data ? Object.keys(data).join(",") : "none",
    })

    switch (eventType) {
      case "payment.succeeded":
        await handlePaymentSucceeded(data, metadata, customerEmail)
        break
      case "payment.failed":
        await handlePaymentFailed(data, metadata)
        break
      case "subscription.active":
        await handleSubscriptionActive(data, metadata, customerEmail)
        break
      case "subscription.on_hold":
        await handleSubscriptionOnHold(data, metadata, customerEmail)
        break
      case "subscription.cancelled":
        await handleSubscriptionCancelled(data, metadata, customerEmail)
        break
      case "subscription.failed":
        await handleSubscriptionFailed(data, metadata, customerEmail)
        break
      case "subscription.expired":
        await handleSubscriptionExpired(data, metadata, customerEmail)
        break
      case "refund.succeeded":
        await handleRefundSucceeded(data)
        break
      default:
        log.warn(`Unhandled webhook event: ${eventType}`, { category: "payment" })
    }

    log.paymentEvent({ event: "webhook_processed", status: "success" })
    return NextResponse.json({ received: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown"
    log.error("Webhook processing failed", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    })
    log.paymentEvent({ event: "webhook_error", status: "error", error: message })
    return NextResponse.json({ error: `Webhook processing failed: ${message}` }, { status: 500 })
  }
}

async function resolveUser(
  metadataUserId: string | undefined,
  email: string | undefined,
  context: string,
): Promise<{ id: string }> {
  log.info(`resolveUser called`, { context, metadataUserId, email })

  if (metadataUserId) {
    const user = await prisma.user.findUnique({ where: { id: metadataUserId }, select: { id: true } })
    if (user) {
      log.info(`resolveUser: found by ID`, { context, userId: user.id })
      return user
    }
    log.warn(`${context}: userId ${metadataUserId} not found in DB, trying email fallback`, { userId: metadataUserId, email })
  }

  if (email) {
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true } })
    if (user) {
      log.info(`${context}: resolved user by email fallback`, { email, resolvedUserId: user.id, originalUserId: metadataUserId })
      return user
    }
  }

  throw new Error(`${context}: user not found (userId: ${metadataUserId ?? "none"}, email: ${email ?? "none"})`)
}

async function handlePaymentSucceeded(
  data: Record<string, unknown> | undefined,
  metadata: Record<string, string>,
  customerEmail: string | undefined,
) {
  const isPurchase = metadata.type === "claw_purchase" || metadata.type === "community_purchase"
  if (!isPurchase) return

  const paymentId = data?.payment_id as string
  if (!paymentId) return

  // PR-7: community skill purchase (no Purchase/workspace row).
  if (metadata.type === "community_purchase" && metadata.skillId) {
    const existingSale = await prisma.marketplaceSale.findFirst({ where: { dodoPaymentId: paymentId } })
    if (existingSale) return

    const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onPaymentSucceeded.skill")
    const skill = await prisma.marketplaceSkill.findUnique({
      where: { id: metadata.skillId },
      include: { creator: { select: { userId: true } } },
    })
    if (!skill?.creatorId) return
    if (isOwnListing(skill.creator?.userId, user.id)) {
      log.warn("onPaymentSucceeded.skill: ignoring self-sale", {
        paymentId,
        skillId: skill.id,
        userId: user.id,
      })
      return
    }

    const paid = paidDollarsFromWebhook(data)
    if (paid == null) {
      log.error("onPaymentSucceeded.skill: missing data.total_amount - refusing list-price sale", {
        paymentId,
        skillId: skill.id,
      })
      return
    }
    const { amount, processingFee } = marketplaceFeeFromPaid(paid)
    await createMarketplaceSale({
      skillId: skill.id,
      buyerId: user.id,
      creatorId: skill.creatorId,
      amount,
      processingFee,
      dodoPaymentId: paymentId,
    })
    await prisma.skillInstall.upsert({
      where: { skillId_userId: { skillId: skill.id, userId: user.id } },
      create: { skillId: skill.id, userId: user.id },
      update: {},
    })
    await prisma.marketplaceSkill.update({
      where: { id: skill.id },
      data: { installCount: { increment: 1 } },
    })

    const customerId = (data?.customer as Record<string, string>)?.customer_id
    if (customerId) {
      await prisma.user.update({ where: { id: user.id }, data: { dodoCustomerId: customerId } })
    }
    log.paymentEvent({ event: "skill_purchased", templateId: skill.id, userId: user.id, status: "success" })
    return
  }

  if (!metadata.templateId) return

  const existing = await prisma.purchase.findFirst({ where: { dodoPaymentId: paymentId } })
  if (existing) return

  const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onPaymentSucceeded")

  const template = await prisma.clawTemplate.findUnique({
    where: { id: metadata.templateId },
    include: { creator: { select: { userId: true } } },
  })
  if (
    metadata.type === "community_purchase" &&
    isOwnListing(template?.creator?.userId, user.id)
  ) {
    log.warn("onPaymentSucceeded: ignoring self-sale", {
      paymentId,
      templateId: metadata.templateId,
      userId: user.id,
    })
    return
  }

  const { workspaceId } = await createWorkspaceFromTemplate({
    userId: user.id,
    templateId: metadata.templateId,
  })

  await prisma.purchase.create({
    data: {
      userId: user.id,
      clawTemplateId: metadata.templateId,
      workspaceId,
      amountPaid: paidDollarsFromWebhook(data) ?? 0,
      currency: (data?.currency as string) ?? "usd",
      dodoPaymentId: paymentId,
      status: "COMPLETED",
    },
  })

  if (metadata.type === "community_purchase" && metadata.creatorId && template?.creatorId) {
    const paid = paidDollarsFromWebhook(data)
    if (paid == null) {
      log.error("onPaymentSucceeded: missing data.total_amount - refusing list-price sale", {
        paymentId,
        templateId: metadata.templateId,
      })
    } else {
      const { amount, processingFee } = marketplaceFeeFromPaid(paid)
      await createMarketplaceSale({
        templateId: metadata.templateId,
        buyerId: user.id,
        creatorId: template.creatorId,
        amount,
        processingFee,
        dodoPaymentId: paymentId,
      })
    }
  }

  const customerId = (data?.customer as Record<string, string>)?.customer_id
  if (customerId) {
    await prisma.user.update({ where: { id: user.id }, data: { dodoCustomerId: customerId } })
  }

  log.paymentEvent({ event: "claw_purchased", templateId: metadata.templateId, userId: user.id, status: "success" })
}

async function handlePaymentFailed(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  const isPurchase = metadata.type === "claw_purchase" || metadata.type === "community_purchase"
  if (isPurchase && metadata.userId && metadata.templateId) {
    await prisma.purchase.create({
      data: { userId: metadata.userId, clawTemplateId: metadata.templateId, amountPaid: 0, dodoPaymentId: data?.payment_id as string, status: "FAILED" },
    })
  }
  if (metadata.userId) {
    await nudgeOwnerWorkspaces(metadata.userId, "payment-failed")
  }
}

async function handleSubscriptionActive(
  data: Record<string, unknown> | undefined,
  metadata: Record<string, string>,
  customerEmail: string | undefined,
) {
  const subscriptionId = data?.subscription_id as string
  const customerId = (data?.customer as Record<string, string>)?.customer_id

  log.info("handleSubscriptionActive called", {
    metadataType: metadata.type,
    metadataUserId: metadata.userId,
    subscriptionId,
    customerId,
    customerEmail,
  })

  if (metadata.type === "claw_platform") {
    const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onSubscriptionActive")

    log.info("Updating user subscription", { userId: user.id, subscriptionId, customerId })

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        hasActiveSubscription: true,
        subscriptionId: subscriptionId ?? undefined,
        subscriptionStatus: "active",
        // Reset GRACE-24 notify marker so a later cancel→re-expire cycle
        // can notify again (grace always anchors on notification time).
        trialExpiryNotifiedAt: null,
        trialWinbackSentAt: null,
        subscriptionOnHoldAt: null,
        ...(customerId ? { dodoCustomerId: customerId } : {}),
      },
      select: { id: true, hasActiveSubscription: true, subscriptionId: true },
    })

    const stopped =
      (await prisma.workspace.findMany({
        where: { userId: user.id, status: "STOPPED" },
        select: { id: true },
      })) ?? []
    for (const ws of stopped) {
      try {
        await enqueueProvisioning(ws.id, "resubscribe")
      } catch (err) {
        log.error("subscription.active: redeploy enqueue failed", {
          userId: user.id,
          workspaceId: ws.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    log.info("User subscription updated", { userId: updated.id, hasActiveSubscription: updated.hasActiveSubscription, subscriptionId: updated.subscriptionId })

    // ToS §12: resubscribing inside the retention window resumes the account
    // - clear the retention clock stamped at expiry.
    await prisma.workspace.updateMany({
      where: { userId: user.id, canceledAt: { not: null } },
      data: { canceledAt: null, stateRetainedUntil: null },
    })

    log.paymentEvent({ event: "subscription_activated", userId: user.id, status: "success" })
    await ledgerSubscriptionLifecycle({
      userId: user.id,
      eventType: "subscription.active",
      subscriptionId,
      status: "active",
      workspaceId: metadata.workspaceId,
    })
  } else {
    log.warn("handleSubscriptionActive: metadata.type is not claw_platform", { metadataType: metadata.type, metadata: JSON.stringify(metadata) })
  }

  if (metadata.type === "claw_purchase" && metadata.userId) {
    const purchase = await prisma.purchase.findFirst({ where: { userId: metadata.userId }, orderBy: { createdAt: "desc" } })
    if (purchase) {
      await prisma.purchase.update({ where: { id: purchase.id }, data: { subscriptionId, subscriptionStatus: "ACTIVE" } })
    }
  }
}

async function handleSubscriptionCancelled(
  data: Record<string, unknown> | undefined,
  metadata: Record<string, string>,
  customerEmail: string | undefined,
) {
  const subscriptionId = data?.subscription_id as string

  if (metadata.type === "claw_platform") {
    const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onSubscriptionCancelled")
    await prisma.user.update({
      where: { id: user.id },
      data: { hasActiveSubscription: false, subscriptionStatus: "cancelled" },
    })
    await ledgerSubscriptionLifecycle({
      userId: user.id,
      eventType: "subscription.cancelled",
      subscriptionId,
      status: "cancelled",
      workspaceId: metadata.workspaceId,
    })
  }

  if (metadata.type === "claw_purchase") {
    const purchase = await prisma.purchase.findFirst({ where: { subscriptionId } })
    if (purchase) await prisma.purchase.update({ where: { id: purchase.id }, data: { subscriptionStatus: "CANCELED" } })
  }
}

/**
 * Renewal dunning. Keep access (hasActiveSubscription=true, grace) and stamp
 * subscriptionStatus=on_hold so trial-expiry stop SKIPSs (be82fa9 race).
 * Eligibility reason is subscription_on_hold + update_card warning, never
 * silent subscribed. Customer nudge: update your card.
 */
async function handleSubscriptionOnHold(
  data: Record<string, unknown> | undefined,
  metadata: Record<string, string>,
  customerEmail: string | undefined,
) {
  const subscriptionId = data?.subscription_id as string | undefined
  if (metadata.type === "claw_platform") {
    const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onSubscriptionOnHold")
    const prior = await prisma.user.findUnique({
      where: { id: user.id },
      select: { subscriptionOnHoldAt: true },
    })
    await prisma.user.update({
      where: { id: user.id },
      data: {
        hasActiveSubscription: true,
        subscriptionStatus: "on_hold",
        ...(subscriptionId ? { subscriptionId } : {}),
        // First dunning event starts the 14-day cap. Later on_hold
        // webhooks must not reset it.
        ...(prior?.subscriptionOnHoldAt ? {} : { subscriptionOnHoldAt: new Date() }),
      },
    })
    log.info("Subscription on_hold (dunning) - trial-expiry stop will skip", {
      userId: user.id,
      subscriptionId: subscriptionId ?? null,
    })
    await ledgerSubscriptionLifecycle({
      userId: user.id,
      eventType: "subscription.on_hold",
      subscriptionId,
      status: "on_hold",
      workspaceId: metadata.workspaceId,
    })
    await nudgeOwnerWorkspaces(user.id, "subscription-on-hold")
  }
}

async function handleSubscriptionFailed(
  _data: Record<string, unknown> | undefined,
  metadata: Record<string, string>,
  customerEmail: string | undefined,
) {
  if (metadata.type === "claw_platform") {
    const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onSubscriptionFailed")
    await prisma.user.update({
      where: { id: user.id },
      data: { hasActiveSubscription: false, subscriptionStatus: "failed" },
    })
    await ledgerSubscriptionLifecycle({
      userId: user.id,
      eventType: "subscription.failed",
      subscriptionId: (_data?.subscription_id as string | undefined) ?? null,
      status: "failed",
      workspaceId: metadata.workspaceId,
    })

    if (metadata.workspaceId) {
      // Wrap in try/catch: failing the webhook (non-200) would trigger Dodo
      // retry storms. Log and continue.
      try {
        await destroyContainer(metadata.workspaceId)
        // Dodo enforcement: subscription.failed - serviceDelete is correct.
      } catch (err) {
        log.error("Failed to destroy container on subscription failure", {
          workspaceId: metadata.workspaceId,
          userId: user.id,
          error: String(err),
        })
      }
    }
  }
}

async function handleSubscriptionExpired(
  _data: Record<string, unknown> | undefined,
  metadata: Record<string, string>,
  customerEmail: string | undefined,
) {
  if (metadata.type === "claw_platform") {
    const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onSubscriptionExpired")
    await prisma.user.update({
      where: { id: user.id },
      data: {
        hasActiveSubscription: false,
        subscriptionId: null,
        subscriptionEndsAt: null,
        subscriptionStatus: "expired",
      },
    })
    // ToS §12 retention clock (bookkeeping - nothing deletes data yet):
    // cancellation took effect NOW; the ToS grants a 7-day resubscribe grace
    // BEFORE the retention timeline starts, then 30 days resumable.
    // stateRetainedUntil = now + 7 + 30 days marks the end of the resumable
    // window. Deletion at day 90 is NOT implemented (deliberately - see the
    // legal audit; founder decision pending), so these stamps are the truth
    // source for a future enforcement job and for dashboard surfacing.
    // MUTATION: remove the stamp → retention-clock test fails.
    const canceledAt = new Date()
    const stateRetainedUntil = new Date(
      canceledAt.getTime() + (7 + 30) * 24 * 60 * 60 * 1000,
    )
    await prisma.workspace.updateMany({
      where: { userId: user.id, canceledAt: null },
      data: { canceledAt, stateRetainedUntil },
    })
    await ledgerSubscriptionLifecycle({
      userId: user.id,
      eventType: "subscription.expired",
      subscriptionId: (_data?.subscription_id as string | undefined) ?? null,
      status: "expired",
      workspaceId: metadata.workspaceId,
    })
  }
}

async function handleRefundSucceeded(data: Record<string, unknown> | undefined) {
  const paymentId = data?.payment_id as string
  if (!paymentId) return

  const purchase = await prisma.purchase.findFirst({ where: { dodoPaymentId: paymentId } })
  const sale = await prisma.marketplaceSale.findFirst({
    where: { dodoPaymentId: paymentId },
    select: { id: true, skillId: true, buyerId: true },
  })
  // Template purchases have Purchase; skill community sales may be sale-only.
  if (!purchase && !sale) return

  if (purchase) {
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { status: "REFUNDED", refundedAt: new Date() },
    })
  }

  // Claw back MarketplaceSale while still PENDING/RELEASABLE (before PAID).
  // Applies to community template + skill sales (PR-6 / PR-7).
  await cancelPayout(paymentId)

  if (!purchase) {
    log.info("Refund clawed back community sale without Purchase row", {
      category: "payment",
      paymentId,
      saleId: sale?.id,
      skillId: sale?.skillId,
    })
    return
  }

  let hasSuccessfulDeploy = false
  if (purchase.workspaceId) {
    const deployEvidence = await prisma.deployment.findFirst({
      where: {
        workspaceId: purchase.workspaceId,
        status: { in: [...DEPLOYED_EVIDENCE_STATUSES] },
      },
      select: { id: true },
    })
    hasSuccessfulDeploy = !!deployEvidence
  }

  const decision = decideRefundWorkspaceAction({
    hasWorkspace: !!purchase.workspaceId,
    purchaseCreatedAt: purchase.createdAt,
    hasSuccessfulDeploy,
  })

  if (decision.deleteWorkspace && purchase.workspaceId) {
    await prisma.workspace.delete({ where: { id: purchase.workspaceId } })
    log.info("Refund deleted never-deployed workspace within 7-day window", {
      category: "payment",
      purchaseId: purchase.id,
      workspaceId: purchase.workspaceId,
      reason: decision.reason,
    })
    return
  }

  // Outside window or already deployed: keep workspace; ledger note for ops.
  try {
    await prisma.auditLog.create({
      data: {
        userId: purchase.userId,
        workspaceId: purchase.workspaceId,
        action: "PAYMENT_FAILED",
        resource: "refund.succeeded.workspace_retained",
        resourceId: purchase.id,
        after: JSON.stringify({
          paymentId,
          decision: decision.reason,
          deleteWorkspace: false,
          hasSuccessfulDeploy,
        }),
      },
    })
  } catch (err) {
    log.warn("Failed to ledger refund workspace-retained note", {
      category: "payment",
      purchaseId: purchase.id,
      error: String(err),
    })
  }

  log.info("Refund recorded; workspace retained", {
    category: "payment",
    purchaseId: purchase.id,
    workspaceId: purchase.workspaceId,
    reason: decision.reason,
  })
}
