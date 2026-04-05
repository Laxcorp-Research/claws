import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import { prisma } from "@/lib/db"
import { createWorkspaceFromTemplate } from "@/lib/workspace-from-template"
import { log } from "@/lib/logger"
import { createMarketplaceSale } from "@/lib/marketplace/payouts"

const webhookClient = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY || "placeholder",
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY || "placeholder",
})

export async function POST(req: NextRequest) {
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
      console.error("[Webhook] Signature verification failed")
      return NextResponse.json({ received: true }, { status: 200 })
    }

    const eventType = payload.event_type as string
    const data = payload.data as Record<string, unknown> | undefined
    const metadata = (data?.metadata ?? {}) as Record<string, string>

    switch (eventType) {
      case "payment.succeeded":
        await handlePaymentSucceeded(data, metadata)
        break
      case "payment.failed":
        await handlePaymentFailed(data, metadata)
        break
      case "subscription.active":
        await handleSubscriptionActive(data, metadata)
        break
      case "subscription.cancelled":
        await handleSubscriptionCancelled(data, metadata)
        break
      case "subscription.failed":
        await handleSubscriptionFailed(data, metadata)
        break
      case "subscription.expired":
        await handleSubscriptionExpired(data, metadata)
        break
      case "refund.succeeded":
        await handleRefundSucceeded(data)
        break
      default:
        console.log(`[Webhook] Unhandled event: ${eventType}`)
    }

    log.paymentEvent({ event: "webhook_processed", status: "success" })
  } catch (error) {
    console.error("[Webhook] Top-level error:", error)
    log.paymentEvent({
      event: "webhook_error",
      status: "error",
      error: error instanceof Error ? error.message : "Unknown",
    })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

async function handlePaymentSucceeded(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    const isPurchase = metadata.type === "claw_purchase" || metadata.type === "community_purchase"
    if (!isPurchase || !metadata.userId || !metadata.templateId) return

    const paymentId = data?.payment_id as string
    if (!paymentId) return

    const existing = await prisma.purchase.findFirst({ where: { dodoPaymentId: paymentId } })
    if (existing) return

    const { workspaceId } = await createWorkspaceFromTemplate({
      userId: metadata.userId,
      templateId: metadata.templateId,
    })

    const template = await prisma.clawTemplate.findUnique({ where: { id: metadata.templateId } })

    await prisma.purchase.create({
      data: {
        userId: metadata.userId,
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
        buyerId: metadata.userId,
        creatorId: template.creatorId,
        amount: template.price,
        processingFee,
        dodoPaymentId: paymentId,
      })
    }

    const customerId = (data?.customer as Record<string, string>)?.customer_id
    if (customerId) {
      await prisma.user.update({ where: { id: metadata.userId }, data: { dodoCustomerId: customerId } })
    }

    console.log(`[Webhook] Claw purchased: ${template?.slug ?? metadata.templateId} → workspace ${workspaceId}`)
  } catch (error) { console.error("[Webhook] onPaymentSucceeded error:", error) }
}

async function handlePaymentFailed(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    const isPurchase = metadata.type === "claw_purchase" || metadata.type === "community_purchase"
    if (isPurchase && metadata.userId && metadata.templateId) {
      await prisma.purchase.create({
        data: { userId: metadata.userId, clawTemplateId: metadata.templateId, amountPaid: 0, dodoPaymentId: data?.payment_id as string, status: "FAILED" },
      })
    }
  } catch (error) { console.error("[Webhook] onPaymentFailed error:", error) }
}

async function handleSubscriptionActive(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    const subscriptionId = data?.subscription_id as string

    if (metadata.type === "claw_platform" && metadata.userId) {
      const customerId = (data?.customer as Record<string, string>)?.customer_id
      await prisma.user.update({
        where: { id: metadata.userId },
        data: {
          hasActiveSubscription: true, subscriptionId,
          ...(customerId ? { dodoCustomerId: customerId } : {}),
        },
      })
    }

    if (metadata.type === "claw_purchase" && metadata.userId) {
      const purchase = await prisma.purchase.findFirst({ where: { userId: metadata.userId }, orderBy: { createdAt: "desc" } })
      if (purchase) {
        await prisma.purchase.update({ where: { id: purchase.id }, data: { subscriptionId, subscriptionStatus: "ACTIVE" } })
      }
    }
  } catch (error) { console.error("[Webhook] onSubscriptionActive error:", error) }
}

async function handleSubscriptionCancelled(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    const subscriptionId = data?.subscription_id as string

    if (metadata.type === "claw_platform" && metadata.userId) {
      await prisma.user.update({
        where: { id: metadata.userId },
        data: { hasActiveSubscription: false },
      })
    }

    if (metadata.type === "claw_purchase") {
      const purchase = await prisma.purchase.findFirst({ where: { subscriptionId } })
      if (purchase) await prisma.purchase.update({ where: { id: purchase.id }, data: { subscriptionStatus: "CANCELED" } })
    }
  } catch (error) { console.error("[Webhook] onSubscriptionCancelled error:", error) }
}

async function handleSubscriptionFailed(_data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    if (metadata.type === "claw_platform" && metadata.userId) {
      await prisma.user.update({ where: { id: metadata.userId }, data: { hasActiveSubscription: false } })
    }
    if (metadata.type === "claw_platform" && metadata.workspaceId) {
      await prisma.workspace.update({ where: { id: metadata.workspaceId }, data: { status: "PAUSED" } })
    }
  } catch (error) { console.error("[Webhook] onSubscriptionFailed error:", error) }
}

async function handleSubscriptionExpired(_data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    if (metadata.type === "claw_platform" && metadata.userId) {
      await prisma.user.update({
        where: { id: metadata.userId },
        data: { hasActiveSubscription: false, subscriptionId: null, subscriptionEndsAt: null },
      })
    }
  } catch (error) { console.error("[Webhook] onSubscriptionExpired error:", error) }
}

async function handleRefundSucceeded(data: Record<string, unknown> | undefined) {
  try {
    const paymentId = data?.payment_id as string
    if (!paymentId) return
    const purchase = await prisma.purchase.findFirst({ where: { dodoPaymentId: paymentId } })
    if (!purchase) return
    await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "REFUNDED", refundedAt: new Date() } })
    if (purchase.workspaceId) {
      const days = Math.floor((Date.now() - purchase.createdAt.getTime()) / 86400000)
      if (days <= 7) await prisma.workspace.delete({ where: { id: purchase.workspaceId } })
    }
  } catch (error) { console.error("[Webhook] onRefundSucceeded error:", error) }
}
