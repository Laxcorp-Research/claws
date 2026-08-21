/**
 * Batch A (A5): safe estimated monthly total for template detail.
 * Never Number(free-text) + 79 - non-numeric ranges must fall back.
 */
const PLATFORM_FEE = 79
const FALLBACK_TOTAL = "120–160"

/**
 * Returns the display string for "~$X/mo" without the leading ~$ or /mo.
 * Examples: "119", "120–160"
 */
export function formatEstimatedMonthlyTotal(
  estimatedMonthlyCost: string | null | undefined,
): string {
  if (estimatedMonthlyCost == null || estimatedMonthlyCost.trim() === "") {
    return FALLBACK_TOTAL
  }
  const trimmed = estimatedMonthlyCost.trim()
  // Plain non-negative number (optional decimals)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return String(Number(trimmed) + PLATFORM_FEE)
  }
  return FALLBACK_TOTAL
}
