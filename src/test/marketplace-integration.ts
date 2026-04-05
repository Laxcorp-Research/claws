/**
 * Vitest setup uses DATABASE_URL=postgresql://test:test@localhost:5432/test.
 * Skip marketplace DB integration tests locally unless a real DB URL is provided.
 */
export function skipMarketplaceIntegration(): boolean {
  const url = process.env.DATABASE_URL ?? ""
  if (!url) return true
  if (url.includes("localhost:5432/test")) return true
  if (url.includes("placeholder")) return true
  return false
}
