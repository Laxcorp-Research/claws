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
 * One-time checkouts (official + community) use Checkout Sessions so the
 * coupon field renders. SDK: CheckoutSessionCreateParams.feature_flags.allow_discount_code.
 * Do NOT set discount_code — the buyer types it at checkout.
 * Platform $79 subscription stays on subscriptions.create (no coupon field).
 */
const ONE_TIME_CHECKOUT_FLAGS = { allow_discount_code: true } as const

async function createOneTimeCheckoutSession(params: {
  productId: string
  userEmail: string
  userName?: string
  dodoCustomerId?: string
  metadata: Record<string, string>
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  if (MOCK_MODE) return { checkoutUrl: null, mockMode: true }

  const dodo = getDodoClient()
  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: params.productId, quantity: 1 }],
    customer: {
      email: params.userEmail,
      name: params.userName || params.userEmail,
      ...(params.dodoCustomerId ? { customer_id: params.dodoCustomerId } : {}),
    },
    billing_address: { city: "", country: "US", state: "", street: "", zipcode: "" },
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
    metadata: params.metadata,
    feature_flags: ONE_TIME_CHECKOUT_FLAGS,
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
  return createOneTimeCheckoutSession({
    productId,
    userEmail: params.userEmail,
    userName: params.userName,
    dodoCustomerId: params.dodoCustomerId,
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
  if (MOCK_MODE) return { checkoutUrl: null, mockMode: true }

  const dodo = getDodoClient()
  const subscription = await dodo.subscriptions.create({
    billing: { city: "", country: "US", state: "", street: "", zipcode: "" },
    customer: {
      email: params.userEmail,
      name: params.userName || params.userEmail,
      ...(params.dodoCustomerId ? { customer_id: params.dodoCustomerId } : {}),
    },
    product_id: CLAW_PLATFORM_PRODUCT,
    quantity: 1,
    payment_link: true,
    return_url: params.returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/checkout/complete`,
    metadata: { userId: params.userId, email: params.userEmail, workspaceId: params.workspaceId, type: "claw_platform" },
  })

  return { checkoutUrl: subscription.payment_link ?? null, mockMode: false }
}

export async function createCommunityCheckout(params: {
  /** Stored Dodo product id from approve-time mint — never a Prisma cuid. */
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
  return createOneTimeCheckoutSession({
    productId: params.dodoProductId,
    userEmail: params.userEmail,
    userName: params.userName,
    dodoCustomerId: params.dodoCustomerId,
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

export function checkDeployEligibility(user: {
  trialUsed: boolean
  trialStartedAt: Date | null
  trialEndsAt: Date | null
  hasActiveSubscription: boolean
}): { canDeploy: boolean; reason: string; needsSubscription: boolean; isFirstDeploy: boolean } {
  const now = new Date()

  if (!user.trialUsed) {
    return { canDeploy: true, reason: "first_deploy_trial", needsSubscription: false, isFirstDeploy: true }
  }

  if (user.trialEndsAt && user.trialEndsAt > now) {
    return { canDeploy: true, reason: "trial_active", needsSubscription: false, isFirstDeploy: false }
  }

  if (user.hasActiveSubscription) {
    return { canDeploy: true, reason: "subscribed", needsSubscription: false, isFirstDeploy: false }
  }

  return { canDeploy: false, reason: "subscription_required", needsSubscription: true, isFirstDeploy: false }
}

export async function getPortalUrl(dodoCustomerId: string): Promise<string | null> {
  if (MOCK_MODE || !dodoCustomerId) return null
  const dodo = getDodoClient()
  const portal = await (dodo.customers as unknown as Record<string, Function>).createCustomerPortalSession(dodoCustomerId)
  return (portal as Record<string, string>).link ?? null
}
