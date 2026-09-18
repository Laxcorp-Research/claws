import DodoPayments from "dodopayments"

let client: DodoPayments | null = null

const MOCK_MODE = !process.env.DODO_PAYMENTS_ENVIRONMENT || !process.env.DODO_PAYMENTS_API_KEY

export function getDodoClient(): DodoPayments {
  if (!client) {
    client = new DodoPayments({
      bearerToken: process.env.DODO_PAYMENTS_API_KEY!,
      environment: (process.env.DODO_PAYMENTS_ENVIRONMENT as "live_mode" | "test_mode") || "live_mode",
    })
  }
  return client
}

export const TEMPLATE_PRODUCTS = {
  TEMPLATE_49: process.env.DODO_PRODUCT_TEMPLATE_49 || "mock_template_49",
  TEMPLATE_99: process.env.DODO_PRODUCT_TEMPLATE_99 || "mock_template_99",
} as const

export const CLAW_PLATFORM_PRODUCT = process.env.DODO_PRODUCT_PLATFORM || "mock_claw_platform"

export function getTemplateProductId(price: number): string {
  switch (price) {
    case 49: return TEMPLATE_PRODUCTS.TEMPLATE_49
    case 99: return TEMPLATE_PRODUCTS.TEMPLATE_99
    default: throw new Error(`Unknown template price: ${price}. Free templates should not reach this function.`)
  }
}

/**
 * One-time + platform-sub checkouts use Checkout Sessions.
 * Coupon field: feature_flags.allow_discount_code (one-time only).
 * Do NOT set discount_code - the buyer types it at checkout.
 * Do NOT pre-fill address or country - Dodo locks pre-filled address fields.
 * The subscriptions.create API requires a country; we do not call it.
 */
const EDITABLE_COUNTRY_FLAGS = { allow_customer_editing_country: true } as const
const ONE_TIME_CHECKOUT_FLAGS = {
  ...EDITABLE_COUNTRY_FLAGS,
  allow_discount_code: true,
} as const

async function createCheckoutSession(params: {
  productId: string
  userEmail: string
  userName?: string
  returnUrl: string
  metadata: Record<string, string>
  feature_flags: { allow_customer_editing_country: true; allow_discount_code?: true }
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  if (MOCK_MODE) return { checkoutUrl: null, mockMode: true }

  const dodo = getDodoClient()
  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: params.productId, quantity: 1 }],
    customer: {
      email: params.userEmail,
      name: params.userName || params.userEmail,
    },
    return_url: params.returnUrl,
    metadata: params.metadata,
    feature_flags: params.feature_flags,
  })

  return { checkoutUrl: session.checkout_url ?? null, mockMode: false }
}

export async function createClawCheckout(params: {
  templateId: string
  templateSlug: string
  templatePrice: number
  dodoProductId: string
  userEmail: string
  userName?: string
  userId: string
  dodoCustomerId?: string
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  const productId = params.dodoProductId || getTemplateProductId(params.templatePrice)
  return createCheckoutSession({
    productId,
    userEmail: params.userEmail,
    userName: params.userName,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
    feature_flags: ONE_TIME_CHECKOUT_FLAGS,
    metadata: {
      userId: params.userId,
      email: params.userEmail,
      templateId: params.templateId,
      templateSlug: params.templateSlug,
      type: "claw_purchase",
    },
  })
}

export async function createPlatformSubscription(params: {
  workspaceId: string
  userEmail: string
  userName?: string
  userId: string
  dodoCustomerId?: string
  returnUrl?: string
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  return createCheckoutSession({
    productId: CLAW_PLATFORM_PRODUCT,
    userEmail: params.userEmail,
    userName: params.userName,
    returnUrl: params.returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/checkout/complete`,
    feature_flags: EDITABLE_COUNTRY_FLAGS,
    metadata: {
      userId: params.userId,
      email: params.userEmail,
      workspaceId: params.workspaceId,
      type: "claw_platform",
    },
  })
}

export async function createCommunityCheckout(params: {
  /** Stored Dodo product id from approve-time mint - never a Prisma cuid. */
  dodoProductId: string
  price: number
  userEmail: string
  userName?: string
  userId: string
  creatorId: string
  dodoCustomerId?: string
  templateId?: string
  templateSlug?: string
  skillId?: string
  skillSlug?: string
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  if (!params.dodoProductId) {
    throw new Error("COMMUNITY_CHECKOUT_REQUIRES_DODO_PRODUCT_ID")
  }
  if (params.dodoProductId === params.templateId || params.dodoProductId === params.skillId) {
    throw new Error("COMMUNITY_CHECKOUT_REJECTS_CUID_AS_PRODUCT_ID")
  }
  return createCheckoutSession({
    productId: params.dodoProductId,
    userEmail: params.userEmail,
    userName: params.userName,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
    feature_flags: ONE_TIME_CHECKOUT_FLAGS,
    metadata: {
      userId: params.userId,
      email: params.userEmail,
      creatorId: params.creatorId,
      type: "community_purchase",
      ...(params.templateId
        ? { templateId: params.templateId, templateSlug: params.templateSlug ?? "" }
        : {}),
      ...(params.skillId ? { skillId: params.skillId, skillSlug: params.skillSlug ?? "" } : {}),
    },
  })
}

export const SUBSCRIPTION_ELIGIBILITY_SELECT = {
  trialUsed: true,
  trialStartedAt: true,
  trialEndsAt: true,
  hasActiveSubscription: true,
  subscriptionStatus: true,
} as const

export type DeployEligibilityUser = {
  trialUsed: boolean
  trialStartedAt: Date | null
  trialEndsAt: Date | null
  hasActiveSubscription: boolean
  subscriptionStatus?: string | null
}

export type DeployEligibility = {
  canDeploy: boolean
  reason: string
  needsSubscription: boolean
  isFirstDeploy: boolean
  warning?: "update_card"
}

/** Dunning. Access stays for grace; never report as silent subscribed. */
export function isSubscriptionOnHold(
  user: Pick<DeployEligibilityUser, "subscriptionStatus">,
): boolean {
  return user.subscriptionStatus === "on_hold"
}

export function checkDeployEligibility(user: DeployEligibilityUser): DeployEligibility {
  const now = new Date()

  if (!user.trialUsed) {
    return { canDeploy: true, reason: "first_deploy_trial", needsSubscription: false, isFirstDeploy: true }
  }

  if (user.trialEndsAt && user.trialEndsAt > now) {
    return { canDeploy: true, reason: "trial_active", needsSubscription: false, isFirstDeploy: false }
  }

  // MUTATION: falling through to hasActiveSubscription → reason "subscribed" on on_hold.
  if (isSubscriptionOnHold(user)) {
    return {
      canDeploy: true,
      reason: "subscription_on_hold",
      needsSubscription: false,
      isFirstDeploy: false,
      warning: "update_card",
    }
  }

  if (user.hasActiveSubscription) {
    return { canDeploy: true, reason: "subscribed", needsSubscription: false, isFirstDeploy: false }
  }

  return { canDeploy: false, reason: "subscription_required", needsSubscription: true, isFirstDeploy: false }
}

export async function getPortalUrl(dodoCustomerId: string): Promise<string | null> {
  if (MOCK_MODE || !dodoCustomerId) return null
  const dodo = getDodoClient()
  const portal = await (
    dodo.customers as unknown as {
      createCustomerPortalSession: (customerId: string) => Promise<{ link?: string }>
    }
  ).createCustomerPortalSession(dodoCustomerId)
  return portal.link ?? null
}
