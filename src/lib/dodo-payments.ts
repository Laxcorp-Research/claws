import DodoPayments from "dodopayments"

let client: DodoPayments | null = null

const MOCK_MODE = process.env.DODO_PAYMENTS_ENVIRONMENT !== "live_mode"

export function getDodoClient(): DodoPayments {
  if (!client) {
    client = new DodoPayments({
      bearerToken: process.env.DODO_PAYMENTS_API_KEY!,
    })
  }
  return client
}

export const PLATFORM_PLAN_PRODUCTS: Record<string, string> = {
  PRO: process.env.DODO_PRODUCT_PRO_PLAN || "mock_pro_plan",
  ENTERPRISE: process.env.DODO_PRODUCT_ENTERPRISE_PLAN || "mock_enterprise_plan",
}

export const CLOUD_HOSTING_PRODUCT = process.env.DODO_PRODUCT_CLOUD_HOSTING || "mock_cloud_hosting"

export async function createClawCheckout(params: {
  templateId: string
  templateSlug: string
  dodoProductId: string
  supportProductId?: string
  userEmail: string
  userName?: string
  userId: string
  dodoCustomerId?: string
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  if (MOCK_MODE) return { checkoutUrl: null, mockMode: true }

  const dodo = getDodoClient()
  const items: Array<{ product_id: string; quantity: number }> = [
    { product_id: params.dodoProductId, quantity: 1 },
  ]
  if (params.supportProductId) items.push({ product_id: params.supportProductId, quantity: 1 })

  const payment = await dodo.payments.create({
    billing: { city: "", country: "US", state: "", street: "", zipcode: "" },
    customer: {
      email: params.userEmail,
      name: params.userName || params.userEmail,
      ...(params.dodoCustomerId ? { customer_id: params.dodoCustomerId } : {}),
    },
    product_cart: items,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
    metadata: { userId: params.userId, templateId: params.templateId, templateSlug: params.templateSlug, type: "claw_purchase" },
  })

  return { checkoutUrl: payment.payment_link ?? null, mockMode: false }
}

export async function createPlanCheckout(params: {
  plan: "PRO" | "ENTERPRISE"
  userEmail: string
  userName?: string
  userId: string
  dodoCustomerId?: string
}): Promise<{ checkoutUrl: string | null; mockMode: boolean }> {
  if (MOCK_MODE) return { checkoutUrl: null, mockMode: true }

  const productId = PLATFORM_PLAN_PRODUCTS[params.plan]
  if (!productId) throw new Error(`No Dodo product for plan: ${params.plan}`)

  const dodo = getDodoClient()
  const subscription = await dodo.subscriptions.create({
    billing: { city: "", country: "US", state: "", street: "", zipcode: "" },
    customer: {
      email: params.userEmail,
      name: params.userName || params.userEmail,
      ...(params.dodoCustomerId ? { customer_id: params.dodoCustomerId } : {}),
    },
    product_id: productId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing`,
    metadata: { userId: params.userId, type: "plan_upgrade", plan: params.plan },
  })

  return { checkoutUrl: subscription.payment_link ?? null, mockMode: false }
}

export async function createHostingCheckout(params: {
  workspaceId: string
  userEmail: string
  userName?: string
  userId: string
  dodoCustomerId?: string
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
    product_id: CLOUD_HOSTING_PRODUCT,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/setup/${params.workspaceId}/step/3`,
    metadata: { userId: params.userId, workspaceId: params.workspaceId, type: "cloud_hosting" },
  })

  return { checkoutUrl: subscription.payment_link ?? null, mockMode: false }
}

export async function getPortalUrl(dodoCustomerId: string): Promise<string | null> {
  if (MOCK_MODE || !dodoCustomerId) return null
  const dodo = getDodoClient()
  const portal = await dodo.customers.createCustomerPortalSession(dodoCustomerId)
  return portal.link ?? null
}

export const PLAN_LIMITS = {
  FREE: { maxWorkspaces: 1, maxAgentsPerWorkspace: 3, monthlyApiSpendLimit: 50, cloudHosting: false },
  PRO: { maxWorkspaces: 5, maxAgentsPerWorkspace: 10, monthlyApiSpendLimit: 200, cloudHosting: true },
  ENTERPRISE: { maxWorkspaces: 999, maxAgentsPerWorkspace: 50, monthlyApiSpendLimit: 10000, cloudHosting: true },
} as const

export type PlanTier = keyof typeof PLAN_LIMITS
