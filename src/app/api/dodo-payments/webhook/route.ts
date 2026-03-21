import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import { prisma } from "@/lib/db"
import { PLAN_LIMITS } from "@/lib/dodo-payments"

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
  } catch (error) {
    console.error("[Webhook] Top-level error:", error)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

async function handlePaymentSucceeded(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    if (metadata.type !== "claw_purchase" || !metadata.userId || !metadata.templateId) return

    const paymentId = data?.payment_id as string
    if (!paymentId) return

    const existing = await prisma.purchase.findFirst({ where: { dodoPaymentId: paymentId } })
    if (existing) return

    const template = await prisma.clawTemplate.findUnique({ where: { id: metadata.templateId } })
    if (!template) { console.error(`[Webhook] Template not found: ${metadata.templateId}`); return }

    const workspace = await createWorkspaceFromWebhook(metadata.userId, template)

    await prisma.purchase.create({
      data: {
        userId: metadata.userId, clawTemplateId: metadata.templateId, workspaceId: workspace.id,
        amountPaid: (data?.total_amount as number) ? ((data?.total_amount as number) / 100) : template.priceSetup,
        currency: (data?.currency as string) ?? "usd", dodoPaymentId: paymentId, status: "COMPLETED",
      },
    })

    const customerId = (data?.customer as Record<string, string>)?.customer_id
    if (customerId) {
      await prisma.user.update({ where: { id: metadata.userId }, data: { dodoCustomerId: customerId } })
    }

    console.log(`[Webhook] Claw purchased: ${template.slug} → workspace ${workspace.id}`)
  } catch (error) { console.error("[Webhook] onPaymentSucceeded error:", error) }
}

async function handlePaymentFailed(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    if (metadata.type === "claw_purchase" && metadata.userId && metadata.templateId) {
      await prisma.purchase.create({
        data: { userId: metadata.userId, clawTemplateId: metadata.templateId, amountPaid: 0, dodoPaymentId: data?.payment_id as string, status: "FAILED" },
      })
    }
  } catch (error) { console.error("[Webhook] onPaymentFailed error:", error) }
}

async function handleSubscriptionActive(data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    const subscriptionId = data?.subscription_id as string

    if (metadata.type === "plan_upgrade" && metadata.userId && metadata.plan) {
      const plan = metadata.plan as keyof typeof PLAN_LIMITS
      const limits = PLAN_LIMITS[plan]
      if (limits) {
        const customerId = (data?.customer as Record<string, string>)?.customer_id
        await prisma.user.update({
          where: { id: metadata.userId },
          data: {
            subscriptionTier: plan, subscriptionId,
            maxWorkspaces: limits.maxWorkspaces, maxAgentsPerWorkspace: limits.maxAgentsPerWorkspace,
            monthlyApiSpendLimit: limits.monthlyApiSpendLimit,
            ...(customerId ? { dodoCustomerId: customerId } : {}),
          },
        })
      }
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
    if (metadata.type === "claw_purchase") {
      const purchase = await prisma.purchase.findFirst({ where: { subscriptionId } })
      if (purchase) await prisma.purchase.update({ where: { id: purchase.id }, data: { subscriptionStatus: "CANCELED" } })
    }
  } catch (error) { console.error("[Webhook] onSubscriptionCancelled error:", error) }
}

async function handleSubscriptionFailed(_data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    if (metadata.type === "plan_upgrade" && metadata.userId) {
      await prisma.user.update({ where: { id: metadata.userId }, data: { subscriptionTier: "FREE" } })
    }
    if (metadata.type === "cloud_hosting" && metadata.workspaceId) {
      await prisma.workspace.update({ where: { id: metadata.workspaceId }, data: { status: "PAUSED" } })
    }
  } catch (error) { console.error("[Webhook] onSubscriptionFailed error:", error) }
}

async function handleSubscriptionExpired(_data: Record<string, unknown> | undefined, metadata: Record<string, string>) {
  try {
    if (metadata.type === "plan_upgrade" && metadata.userId) {
      const free = PLAN_LIMITS.FREE
      await prisma.user.update({
        where: { id: metadata.userId },
        data: { subscriptionTier: "FREE", subscriptionId: null, subscriptionEndsAt: null, maxWorkspaces: free.maxWorkspaces, maxAgentsPerWorkspace: free.maxAgentsPerWorkspace, monthlyApiSpendLimit: free.monthlyApiSpendLimit },
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

async function createWorkspaceFromWebhook(userId: string, template: { id: string; slug: string; name: string; description: string | null; workspaceSnapshot: unknown }) {
  const snapshot = template.workspaceSnapshot as {
    agents: Array<{ agentSlug: string; name: string; role: string; model: string; soulMd: string; agentsMd: string; heartbeatMd?: string; color?: string; qualityThreshold?: number; positionX?: number; positionY?: number; reportsTo?: string }>
    connections: Array<{ sourceSlug: string; targetSlug: string; condition: string }>
  }

  const workspace = await prisma.workspace.create({
    data: { userId, name: template.name, slug: `${template.slug}-${Date.now()}`, description: template.description, status: "SETUP_INCOMPLETE", clawTemplateId: template.id },
  })

  const slugToId: Record<string, string> = {}
  for (const a of snapshot.agents) {
    const agent = await prisma.agent.create({
      data: { workspaceId: workspace.id, agentSlug: a.agentSlug, name: a.name, role: a.role as "ORCHESTRATOR" | "WORKER" | "CRITIC", model: a.model, soulMd: a.soulMd, agentsMd: a.agentsMd, heartbeatMd: a.heartbeatMd ?? null, color: a.color ?? "#5BA1F5", qualityThreshold: a.qualityThreshold ?? 8.0, positionX: a.positionX ?? 0, positionY: a.positionY ?? 0 },
    })
    slugToId[a.agentSlug] = agent.id
  }

  for (const a of snapshot.agents) {
    if (a.reportsTo && slugToId[a.reportsTo]) await prisma.agent.update({ where: { id: slugToId[a.agentSlug] }, data: { reportsTo: slugToId[a.reportsTo] } })
  }

  for (const c of snapshot.connections ?? []) {
    const src = slugToId[c.sourceSlug]; const tgt = slugToId[c.targetSlug]
    if (src && tgt) await prisma.agentConnection.create({ data: { workspaceId: workspace.id, sourceAgentId: src, targetAgentId: tgt, condition: c.condition as "ON_COMPLETE" | "ON_APPROVAL" | "ON_REJECTION" | "ON_SCHEDULE" | "ON_HUMAN_APPROVE" | "CUSTOM" } })
  }

  return workspace
}
