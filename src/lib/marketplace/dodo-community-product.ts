/**
 * DYNAMIC-AT-APPROVAL: mint a Dodo one-time product for a paid community listing.
 * Idempotent by stored dodoProductId on the item.
 *
 * Phase A: dodopayments SDK exposes `client.products.create(ProductCreateParams)`.
 */
import { getDodoClient } from "@/lib/dodo-payments"
import { log } from "@/lib/logger"

const MOCK_MODE = !process.env.DODO_PAYMENTS_ENVIRONMENT || !process.env.DODO_PAYMENTS_API_KEY

export type CommunityProductKind = "template" | "skill"

export async function ensureCommunityDodoProduct(params: {
  kind: CommunityProductKind
  itemId: string
  name: string
  priceUsd: number
  existingDodoProductId?: string | null
}): Promise<string> {
  if (params.existingDodoProductId) {
    return params.existingDodoProductId
  }

  if (!(params.priceUsd > 0)) {
    throw new Error("DODO_PRODUCT_REQUIRES_PRICE")
  }

  if (MOCK_MODE) {
    return `mock_community_${params.kind}_${params.itemId}`
  }

  const dodo = getDodoClient()
  const product = await dodo.products.create({
    name: params.name.slice(0, 120),
    description: `Claws marketplace ${params.kind}: ${params.name}`.slice(0, 500),
    tax_category: "digital_products",
    price: {
      type: "one_time_price",
      currency: "USD",
      price: Math.round(params.priceUsd * 100),
      discount: 0,
      purchasing_power_parity: false,
    },
    metadata: {
      clawsKind: params.kind,
      clawsItemId: params.itemId,
    },
  })

  const productId = product.product_id
  if (!productId) {
    throw new Error("DODO_PRODUCT_CREATE_MISSING_ID")
  }

  log.info("Created community Dodo product", {
    category: "payment",
    kind: params.kind,
    itemId: params.itemId,
    productId,
  })

  return productId
}
