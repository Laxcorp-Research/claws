/**
 * Template workspaceSnapshot may carry `recommendedAlwaysOn` (JSON blob -
 * no Prisma migration). Used by deploy UI + seed metadata for Quant Trader.
 */

export function parseRecommendedAlwaysOn(
  workspaceSnapshot: string | null | undefined,
): boolean {
  if (!workspaceSnapshot) return false
  try {
    const snap = JSON.parse(workspaceSnapshot) as { recommendedAlwaysOn?: unknown }
    return snap.recommendedAlwaysOn === true
  } catch {
    return false
  }
}
