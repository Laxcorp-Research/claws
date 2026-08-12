import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { createClawCheckout, createPlatformSubscription, createCommunityCheckout } from "@/lib/dodo-payments"
import {
  createWorkspaceFromTemplate,
  installLandingPath,
} from "@/lib/workspace-from-template"
import { createMarketplaceSale } from "@/lib/marketplace/payouts"
import { isPubliclyListable } from "@/lib/marketplace/public-visibility"
import { isMarketplaceCommunityPurchaseEnabled } from "@/lib/marketplace/feature-flags"

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
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Checkout Error]", { type, userId: sessionUser.id, error: message, stack: error instanceof Error ? error.stack : undefined })
    return apiError("CHECKOUT_FAILED", `Checkout failed: ${message}`, 500)
  }
}

async function handleFreeTemplate(
  body: Record<string, unknown>,
  user: { id: string },
) {
  const { templateId } = body as { templateId?: string }
  if (!templateId) return ERRORS.VALIDATION("templateId required")

  const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
  if (!template || !isPubliclyListable(template)) return ERRORS.NOT_FOUND("Template")
  if (!template.isFree) return apiError("NOT_FREE", "This template is not free", 400)

  const { workspaceId, isFirstWorkspace } = await createWorkspaceFromTemplate({
    userId: user.id,
    templateId: template.id,
  })

  // D-vi: first install → /onboarding; later → /builder/{id}
  return apiSuccess({ redirectUrl: installLandingPath(workspaceId, isFirstWorkspace) })
}

async function handleClawPurchase(
  body: Record<string, unknown>,
  user: { id: string; email: string; name: string | null; dodoCustomerId: string | null },
) {
  const { templateId } = body as { templateId?: string }
  if (!templateId) return ERRORS.VALIDATION("templateId required")

  const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
  if (!template || !isPubliclyListable(template)) return ERRORS.NOT_FOUND("Template")

  const existingPurchase = await prisma.purchase.findFirst({
    where: { userId: user.id, clawTemplateId: template.id, status: "COMPLETED" },
  })
  if (existingPurchase) {
    const { workspaceId, isFirstWorkspace } = await createWorkspaceFromTemplate({
      userId: user.id,
      templateId: template.id,
    })
    return apiSuccess({ redirectUrl: installLandingPath(workspaceId, isFirstWorkspace) })
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
    const { workspaceId, isFirstWorkspace } = await createWorkspaceFromTemplate({
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
    return apiSuccess({
      mockMode: true,
      redirectUrl: installLandingPath(workspaceId, isFirstWorkspace),
    })
  }

  if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
  return apiSuccess({ checkoutUrl: result.checkoutUrl })
}

async function handleCommunityPurchase(
  body: Record<string, unknown>,
  user: { id: string; email: string; name: string | null; dodoCustomerId: string | null },
) {
  if (!isMarketplaceCommunityPurchaseEnabled()) {
    return apiError("COMING_SOON", "Community marketplace purchases are coming soon", 403)
  }

  const { templateId, skillId } = body as { templateId?: string; skillId?: string }
  if (!!templateId === !!skillId) {
    return ERRORS.VALIDATION("Provide exactly one of templateId or skillId")
  }

  if (skillId) {
    return handleCommunitySkillPurchase(skillId, user)
  }

  return handleCommunityTemplatePurchase(templateId!, user)
}

async function handleCommunityTemplatePurchase(
  templateId: string,
  user: { id: string; email: string; name: string | null; dodoCustomerId: string | null },
) {
  const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
  if (!template || !isPubliclyListable(template)) return ERRORS.NOT_FOUND("Template")
  if (!template.creatorId) return apiError("NOT_COMMUNITY", "This is not a community template", 400)
  if (template.isFree) return apiError("USE_FREE_FLOW", "Use the free_template checkout type for free templates", 400)
  if (template.price < 19) return apiError("PRICE_TOO_LOW", "Community template price must be at least $19", 400)
  if (!template.dodoProductId) {
    return apiError(
      "PRODUCT_NOT_READY",
      "This listing has no Dodo product yet — re-approve after DYNAMIC-AT-APPROVAL mint",
      400,
    )
  }

  const existingPurchase = await prisma.purchase.findFirst({
    where: { userId: user.id, clawTemplateId: template.id, status: "COMPLETED" },
  })
  if (existingPurchase) {
    const { workspaceId, isFirstWorkspace } = await createWorkspaceFromTemplate({
      userId: user.id,
      templateId: template.id,
    })
    return apiSuccess({ redirectUrl: installLandingPath(workspaceId, isFirstWorkspace) })
  }

  const result = await createCommunityCheckout({
    dodoProductId: template.dodoProductId,
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
    const { workspaceId, isFirstWorkspace } = await createWorkspaceFromTemplate({
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

    return apiSuccess({
      mockMode: true,
      redirectUrl: installLandingPath(workspaceId, isFirstWorkspace),
    })
  }

  if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
  return apiSuccess({ checkoutUrl: result.checkoutUrl })
}

async function handleCommunitySkillPurchase(
  skillId: string,
  user: { id: string; email: string; name: string | null; dodoCustomerId: string | null },
) {
  const skill = await prisma.marketplaceSkill.findUnique({ where: { id: skillId } })
  if (!skill || !isPubliclyListable(skill)) return ERRORS.NOT_FOUND("Skill")
  if (!skill.creatorId) return apiError("NOT_COMMUNITY", "This is not a community skill", 400)
  if (skill.isFree || skill.price == null || skill.price <= 0) {
    return apiError("USE_FREE_FLOW", "Free skills install without checkout", 400)
  }
  if (skill.price < 19) return apiError("PRICE_TOO_LOW", "Community skill price must be at least $19", 400)
  if (!skill.dodoProductId) {
    return apiError(
      "PRODUCT_NOT_READY",
      "This listing has no Dodo product yet — re-approve after DYNAMIC-AT-APPROVAL mint",
      400,
    )
  }

  const existingSale = await prisma.marketplaceSale.findFirst({
    where: { skillId: skill.id, buyerId: user.id },
    select: { id: true },
  })
  if (existingSale) {
    return apiSuccess({ purchased: true, skillId: skill.id, skillSlug: skill.slug })
  }

  const result = await createCommunityCheckout({
    dodoProductId: skill.dodoProductId,
    skillId: skill.id,
    skillSlug: skill.slug,
    price: skill.price,
    userEmail: user.email,
    userName: user.name ?? undefined,
    userId: user.id,
    creatorId: skill.creatorId,
    dodoCustomerId: user.dodoCustomerId ?? undefined,
  })

  if (result.mockMode) {
    const paymentId = `mock_skill_${Date.now()}`
    const processingFee = Math.round(skill.price * 0.035 * 100) / 100
    await createMarketplaceSale({
      skillId: skill.id,
      buyerId: user.id,
      creatorId: skill.creatorId,
      amount: skill.price,
      processingFee,
      dodoPaymentId: paymentId,
    })
    await prisma.skillInstall.upsert({
      where: { skillId_userId: { skillId: skill.id, userId: user.id } },
      create: { skillId: skill.id, userId: user.id },
      update: {},
    })
    return apiSuccess({
      mockMode: true,
      purchased: true,
      skillId: skill.id,
      skillSlug: skill.slug,
    })
  }

  if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
  return apiSuccess({ checkoutUrl: result.checkoutUrl })
}

async function handleClawPlatform(
  body: Record<string, unknown>,
  user: {
    id: string
    email: string
    name: string | null
    dodoCustomerId: string | null
    workspaces?: Array<{ id: string }>
  },
) {
  const { workspaceId: bodyWorkspaceId, returnUrl } = body as {
    workspaceId?: string
    returnUrl?: string
  }

  // Billing / lapsed-subscribe may omit workspaceId — entitlement is user-level;
  // metadata.workspaceId is best-effort for failed-sub destroy targeting.
  let workspaceId = bodyWorkspaceId
  if (workspaceId) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId: user.id },
    })
    if (!workspace) return ERRORS.NOT_FOUND("Workspace")
  } else {
    const owned =
      user.workspaces?.[0] ??
      (await prisma.workspace.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      }))
    if (!owned) {
      return ERRORS.VALIDATION("workspaceId required (no workspaces on account)")
    }
    workspaceId = owned.id
  }

  const result = await createPlatformSubscription({
    workspaceId,
    userEmail: user.email,
    userName: user.name ?? undefined,
    userId: user.id,
    dodoCustomerId: user.dodoCustomerId ?? undefined,
    returnUrl: returnUrl ? `${process.env.NEXT_PUBLIC_APP_URL}${returnUrl}` : undefined,
  })

  if (result.mockMode) {
    await prisma.user.update({
      where: { id: user.id },
      data: { hasActiveSubscription: true },
    })
    return apiSuccess({ mockMode: true, workspaceId })
  }

  if (!result.checkoutUrl) return apiError("CHECKOUT_FAILED", "Failed to create checkout session", 500)
  return apiSuccess({ checkoutUrl: result.checkoutUrl, workspaceId })
}
