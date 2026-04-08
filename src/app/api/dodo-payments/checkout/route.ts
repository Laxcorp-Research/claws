import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { createClawCheckout, createPlatformSubscription, createCommunityCheckout } from "@/lib/dodo-payments"
import { createWorkspaceFromTemplate } from "@/lib/workspace-from-template"
import { createMarketplaceSale } from "@/lib/marketplace/payouts"

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
    if (type === "free_template") {
      return await handleFreeTemplate(body, user)
    }

    if (type === "claw_purchase") {
      return await handleClawPurchase(body, user)
    }

    if (type === "community_purchase") {
      return await handleCommunityPurchase(body, user)
    }

    if (type === "claw_platform") {
      return await handleClawPlatform(body, user)
    }

    return ERRORS.VALIDATION("Invalid checkout type")
  } catch (error) {
    console.error("[Checkout Error]", error)
    return apiError("CHECKOUT_FAILED", "Checkout failed", 500)
  }
}

async function handleFreeTemplate(
  body: Record<string, unknown>,
  user: { id: string },
) {
  const { templateId } = body as { templateId?: string }
  if (!templateId) return ERRORS.VALIDATION("templateId required")

  const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
  if (!template) return ERRORS.NOT_FOUND("Template")
  if (!template.isFree) return apiError("NOT_FREE", "This template is not free", 400)

  const { workspaceId } = await createWorkspaceFromTemplate({
    userId: user.id,
    templateId: template.id,
  })

  return apiSuccess({ redirectUrl: `/builder/${workspaceId}` })
}

async function handleClawPurchase(
  body: Record<string, unknown>,
  user: { id: string; email: string; name: string | null; dodoCustomerId: string | null },
) {
  const { templateId } = body as { templateId?: string }
  if (!templateId) return ERRORS.VALIDATION("templateId required")

  const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
  if (!template) return ERRORS.NOT_FOUND("Template")

  const existingPurchase = await prisma.purchase.findFirst({
    where: { userId: user.id, clawTemplateId: template.id, status: "COMPLETED" },
  })
  if (existingPurchase) {
    const { workspaceId } = await createWorkspaceFromTemplate({
      userId: user.id,
      templateId: template.id,
    })
    return apiSuccess({ redirectUrl: `/builder/${workspaceId}` })
  }

  const result = await createClawCheckout({
    templateId: template.id,
    templateSlug: template.slug,
    templatePrice: template.price,
    dodoProductId: template.dodoProductId ?? "",
    userEmail: user.email,
    userName: user.name ?? undefined,
    userId: user.id,
    dodoCustomerId: user.dodoCustomerId ?? undefined,
  })

  if (result.mockMode) {
    const { workspaceId } = await createWorkspaceFromTemplate({
      userId: user.id,
      templateId: template.id,
    })
    await prisma.purchase.create({
      data: {
        userId: user.id,
        clawTemplateId: template.id,
        workspaceId,
        amountPaid: template.price,
        dodoPaymentId: `mock_${Date.now()}`,
        status: "COMPLETED",
      },
    })
    return apiSuccess({ mockMode: true, redirectUrl: `/builder/${workspaceId}` })
  }

  if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
  return apiSuccess({ checkoutUrl: result.checkoutUrl })
}

async function handleCommunityPurchase(
  body: Record<string, unknown>,
  user: { id: string; email: string; name: string | null; dodoCustomerId: string | null },
) {
  const { templateId } = body as { templateId?: string }
  if (!templateId) return ERRORS.VALIDATION("templateId required")

  const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
  if (!template) return ERRORS.NOT_FOUND("Template")
  if (!template.creatorId) return apiError("NOT_COMMUNITY", "This is not a community template", 400)
  if (template.isFree) return apiError("USE_FREE_FLOW", "Use the free_template checkout type for free templates", 400)
  if (template.price < 19) return apiError("PRICE_TOO_LOW", "Community template price must be at least $19", 400)

  const existingPurchase = await prisma.purchase.findFirst({
    where: { userId: user.id, clawTemplateId: template.id, status: "COMPLETED" },
  })
  if (existingPurchase) {
    const { workspaceId } = await createWorkspaceFromTemplate({
      userId: user.id,
      templateId: template.id,
    })
    return apiSuccess({ redirectUrl: `/builder/${workspaceId}` })
  }

  const result = await createCommunityCheckout({
    templateId: template.id,
    templateSlug: template.slug,
    price: template.price,
    userEmail: user.email,
    userName: user.name ?? undefined,
    userId: user.id,
    creatorId: template.creatorId,
    dodoCustomerId: user.dodoCustomerId ?? undefined,
  })

  if (result.mockMode) {
    const { workspaceId } = await createWorkspaceFromTemplate({
      userId: user.id,
      templateId: template.id,
    })

    await prisma.purchase.create({
      data: {
        userId: user.id,
        clawTemplateId: template.id,
        workspaceId,
        amountPaid: template.price,
        dodoPaymentId: `mock_community_${Date.now()}`,
        status: "COMPLETED",
      },
    })

    const processingFee = Math.round(template.price * 0.035 * 100) / 100
    await createMarketplaceSale({
      templateId: template.id,
      buyerId: user.id,
      creatorId: template.creatorId,
      amount: template.price,
      processingFee,
      dodoPaymentId: `mock_sale_${Date.now()}`,
    })

    return apiSuccess({ mockMode: true, redirectUrl: `/builder/${workspaceId}` })
  }

  if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
  return apiSuccess({ checkoutUrl: result.checkoutUrl })
}

async function handleClawPlatform(
  body: Record<string, unknown>,
  user: { id: string; email: string; name: string | null; dodoCustomerId: string | null },
) {
  const { workspaceId } = body as { workspaceId?: string }
  if (!workspaceId) return ERRORS.VALIDATION("workspaceId required")

  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, userId: user.id } })
  if (!workspace) return ERRORS.NOT_FOUND("Workspace")

  const result = await createPlatformSubscription({
    workspaceId,
    userEmail: user.email,
    userName: user.name ?? undefined,
    userId: user.id,
    dodoCustomerId: user.dodoCustomerId ?? undefined,
  })

  if (result.mockMode) {
    await prisma.user.update({
      where: { id: user.id },
      data: { hasActiveSubscription: true },
    })
    return apiSuccess({ mockMode: true })
  }

  if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
  return apiSuccess({ checkoutUrl: result.checkoutUrl })
}
