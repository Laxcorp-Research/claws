/**
 * Public app origin for alert / email links. Must follow the environment
 * (staging vs production). Never hardcode app.buildclaws.ai.
 */
export function resolvePublicAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : "")
  return raw.replace(/\/$/, "")
}

export function dashboardUrl(workspaceId?: string): string {
  const base = resolvePublicAppUrl()
  if (!base) return "/dashboard"
  if (workspaceId) return `${base}/dashboard/${workspaceId}`
  return `${base}/dashboard`
}
