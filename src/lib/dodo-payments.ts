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
  if (MOCK_MODE) return { checkoutUrl: null, mockMode: true }

  const productId = params.dodoProductId || getTemplateProductId(params.templatePrice)
  const dodo = getDodoClient()

  const payment = await dodo.payments.create({
    billing: { city: "", country: "US", state: "", street: "", zipcode: "" },
    customer: {
      email: params.userEmail,
      name: params.userName || params.userEmail,
      ...(params.dodoCustomerId ? { customer_id: params.dodoCustomerId } : {}),
    },
    product_cart: [{ product_id: productId, quantity: 1 }],
    payment_link: true,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
    metadata: { userId: params.userId, email: params.userEmail, templateId: params.templateId, templateSlug: params.templateSlug, type: "claw_purchase" },
  })

  return { checkoutUrl: payment.payment_link ?? null, mockMode: false }
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
  templateId: string
  templateSlug: string
  price: number
  userEmail: string
  userName?: string
  userId: string
  creatorId: string
  dodoCustomerId?: string
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  if (MOCK_MODE) return { checkoutUrl: null, mockMode: true }

  const dodo = getDodoClient()

  const payment = await dodo.payments.create({
    billing: { city: "", country: "US", state: "", street: "", zipcode: "" },
    customer: {
      email: params.userEmail,
      name: params.userName || params.userEmail,
      ...(params.dodoCustomerId ? { customer_id: params.dodoCustomerId } : {}),
    },
    product_cart: [{ product_id: params.templateId, quantity: 1 }],
    payment_link: true,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
    metadata: {
      userId: params.userId,
      email: params.userEmail,
      templateId: params.templateId,
      templateSlug: params.templateSlug,
      creatorId: params.creatorId,
      type: "community_purchase",
    },
  })

  return { checkoutUrl: payment.payment_link ?? null, mockMode: false }
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
