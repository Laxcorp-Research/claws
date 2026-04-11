import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import { prisma } from "@/lib/db"
import { createWorkspaceFromTemplate } from "@/lib/workspace-from-template"
import { log } from "@/lib/logger"
import { createMarketplaceSale } from "@/lib/marketplace/payouts"

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
  if (!isPurchase || !metadata.templateId) return

  const paymentId = data?.payment_id as string
  if (!paymentId) return

  const existing = await prisma.purchase.findFirst({ where: { dodoPaymentId: paymentId } })
  if (existing) return

  const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onPaymentSucceeded")

  const { workspaceId } = await createWorkspaceFromTemplate({
    userId: user.id,
    templateId: metadata.templateId,
  })

  const template = await prisma.clawTemplate.findUnique({ where: { id: metadata.templateId } })

  await prisma.purchase.create({
    data: {
      userId: user.id,
      clawTemplateId: metadata.templateId,
      workspaceId,
      amountPaid: (data?.total_amount as number) ? ((data?.total_amount as number) / 100) : (template?.price ?? 0),
      currency: (data?.currency as string) ?? "usd",
      dodoPaymentId: paymentId,
      status: "COMPLETED",
    },
  })

  if (metadata.type === "community_purchase" && metadata.creatorId && template?.price && template.creatorId) {
    const processingFee = Math.round(template.price * 0.035 * 100) / 100
    await createMarketplaceSale({
      templateId: metadata.templateId,
      buyerId: user.id,
      creatorId: template.creatorId,
      amount: template.price,
      processingFee,
      dodoPaymentId: paymentId,
    })
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
        ...(customerId ? { dodoCustomerId: customerId } : {}),
      },
      select: { id: true, hasActiveSubscription: true, subscriptionId: true },
    })

    log.info("User subscription updated", { userId: updated.id, hasActiveSubscription: updated.hasActiveSubscription, subscriptionId: updated.subscriptionId })
    log.paymentEvent({ event: "subscription_activated", userId: user.id, status: "success" })
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
    await prisma.user.update({ where: { id: user.id }, data: { hasActiveSubscription: false } })
  }

  if (metadata.type === "claw_purchase") {
    const purchase = await prisma.purchase.findFirst({ where: { subscriptionId } })
    if (purchase) await prisma.purchase.update({ where: { id: purchase.id }, data: { subscriptionStatus: "CANCELED" } })
  }
}

async function handleSubscriptionFailed(
  _data: Record<string, unknown> | undefined,
  metadata: Record<string, string>,
  customerEmail: string | undefined,
) {
  if (metadata.type === "claw_platform") {
    const user = await resolveUser(metadata.userId, metadata.email ?? customerEmail, "onSubscriptionFailed")
    await prisma.user.update({ where: { id: user.id }, data: { hasActiveSubscription: false } })

    if (metadata.workspaceId) {
      await prisma.workspace.update({ where: { id: metadata.workspaceId }, data: { status: "PAUSED" } })
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
      data: { hasActiveSubscription: false, subscriptionId: null, subscriptionEndsAt: null },
    })
  }
}

async function handleRefundSucceeded(data: Record<string, unknown> | undefined) {
  const paymentId = data?.payment_id as string
  if (!paymentId) return

  const purchase = await prisma.purchase.findFirst({ where: { dodoPaymentId: paymentId } })
  if (!purchase) return

  await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "REFUNDED", refundedAt: new Date() } })

  if (purchase.workspaceId) {
    const days = Math.floor((Date.now() - purchase.createdAt.getTime()) / 86400000)
    if (days <= 7) await prisma.workspace.delete({ where: { id: purchase.workspaceId } })
  }
}
