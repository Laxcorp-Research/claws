import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { createClawCheckout, createPlanCheckout, createHostingCheckout, PLAN_LIMITS } from "@/lib/dodo-payments"

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return ERRORS.UNAUTHORIZED()

  const body = await req.json()
  const { type } = body

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    include: { workspaces: true },
  })
  if (!user) return ERRORS.NOT_FOUND("User")

  try {
    if (type === "claw_purchase") {
      const { templateId } = body
      if (!templateId) return ERRORS.VALIDATION("templateId required")

      const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
      if (!template) return ERRORS.NOT_FOUND("Template")

      const wsCount = user.workspaces.length
      const limit = PLAN_LIMITS[user.subscriptionTier as keyof typeof PLAN_LIMITS]?.maxWorkspaces ?? 1
      if (wsCount >= limit) return apiError("WORKSPACE_LIMIT", `Workspace limit reached (${limit}). Upgrade your plan.`, 403)

      const existing = await prisma.purchase.findFirst({
        where: { userId: user.id, clawTemplateId: template.id, status: "COMPLETED" },
      })
      if (existing) return apiError("ALREADY_OWNED", "You already own this Claw", 409)

      const result = await createClawCheckout({
        templateId: template.id, templateSlug: template.slug,
        dodoProductId: template.dodoProductId ?? "",
        supportProductId: template.dodoSupportProductId ?? undefined,
        userEmail: user.email, userName: user.name ?? undefined,
        userId: user.id, dodoCustomerId: user.dodoCustomerId ?? undefined,
      })

      if (result.mockMode) {
        const workspace = await createWorkspaceFromTemplate(user.id, template)
        await prisma.purchase.create({
          data: { userId: user.id, clawTemplateId: template.id, workspaceId: workspace.id, amountPaid: template.priceSetup, dodoPaymentId: `mock_${Date.now()}`, status: "COMPLETED" },
        })
        return apiSuccess({ mockMode: true, redirectUrl: `/setup/${workspace.id}/step/1` })
      }

      if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
      return apiSuccess({ checkoutUrl: result.checkoutUrl })
    }

    if (type === "plan_upgrade") {
      const { plan } = body
      if (!plan || !["PRO", "ENTERPRISE"].includes(plan)) return ERRORS.VALIDATION("Invalid plan")
      if (user.subscriptionTier === plan) return apiError("ALREADY_ON_PLAN", "Already on this plan", 409)

      const result = await createPlanCheckout({
        plan, userEmail: user.email, userName: user.name ?? undefined,
        userId: user.id, dodoCustomerId: user.dodoCustomerId ?? undefined,
      })

      if (result.mockMode) {
        const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]
        await prisma.user.update({
          where: { id: user.id },
          data: { subscriptionTier: plan, maxWorkspaces: limits.maxWorkspaces, maxAgentsPerWorkspace: limits.maxAgentsPerWorkspace, monthlyApiSpendLimit: limits.monthlyApiSpendLimit },
        })
        return apiSuccess({ mockMode: true, redirectUrl: "/settings?tab=billing" })
      }

      if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
      return apiSuccess({ checkoutUrl: result.checkoutUrl })
    }

    if (type === "cloud_hosting") {
      const { workspaceId } = body
      if (!workspaceId) return ERRORS.VALIDATION("workspaceId required")

      const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, userId: user.id } })
      if (!workspace) return ERRORS.NOT_FOUND("Workspace")

      if (user.subscriptionTier === "ENTERPRISE") return apiSuccess({ mockMode: true, included: true })
      if (user.subscriptionTier === "FREE") return apiError("PLAN_REQUIRED", "Cloud hosting requires Pro or Enterprise plan", 403)

      const result = await createHostingCheckout({
        workspaceId, userEmail: user.email, userName: user.name ?? undefined,
        userId: user.id, dodoCustomerId: user.dodoCustomerId ?? undefined,
      })

      if (result.mockMode) return apiSuccess({ mockMode: true })
      if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
      return apiSuccess({ checkoutUrl: result.checkoutUrl })
    }

    return ERRORS.VALIDATION("Invalid checkout type")
  } catch (error) {
    console.error("[Checkout Error]", error)
    return apiError("CHECKOUT_FAILED", "Checkout failed", 500)
  }
}

async function createWorkspaceFromTemplate(userId: string, template: { id: string; slug: string; name: string; description: string | null; workspaceSnapshot: unknown }) {
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
      data: {
        workspaceId: workspace.id, agentSlug: a.agentSlug, name: a.name,
        role: a.role as "ORCHESTRATOR" | "WORKER" | "CRITIC", model: a.model,
        soulMd: a.soulMd, agentsMd: a.agentsMd, heartbeatMd: a.heartbeatMd ?? null,
        color: a.color ?? "#5BA1F5", qualityThreshold: a.qualityThreshold ?? 8.0,
        positionX: a.positionX ?? 0, positionY: a.positionY ?? 0,
      },
    })
    slugToId[a.agentSlug] = agent.id
  }

  for (const a of snapshot.agents) {
    if (a.reportsTo && slugToId[a.reportsTo]) {
      await prisma.agent.update({ where: { id: slugToId[a.agentSlug] }, data: { reportsTo: slugToId[a.reportsTo] } })
    }
  }

  for (const c of snapshot.connections ?? []) {
    const src = slugToId[c.sourceSlug]
    const tgt = slugToId[c.targetSlug]
    if (src && tgt) {
      await prisma.agentConnection.create({
        data: { workspaceId: workspace.id, sourceAgentId: src, targetAgentId: tgt, condition: c.condition as "ON_COMPLETE" | "ON_APPROVAL" | "ON_REJECTION" | "ON_SCHEDULE" | "ON_HUMAN_APPROVE" | "CUSTOM" },
      })
    }
  }

  return workspace
}
