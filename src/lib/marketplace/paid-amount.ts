/**
 * Dodo `payment.succeeded` charged amount.
 * Source field: `data.total_amount` — cents the customer paid (post-discount, incl. tax).
 * MUTATION: mint MarketplaceSale from list `template.price` / `skill.price` → tests fail.
 */
export function paidDollarsFromWebhook(data: Record<string, unknown> | undefined): number | null {
  const cents = data?.total_amount
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) return null
  return Math.round(cents) / 100
}

export function marketplaceFeeFromPaid(paidDollars: number): {
  amount: number
  processingFee: number
} {
  const amount = Math.round(paidDollars * 100) / 100
  const processingFee = Math.round(amount * 0.035 * 100) / 100
  return { amount, processingFee }
}
