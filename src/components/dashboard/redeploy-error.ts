export function getRedeployApiErrorMessage(body: unknown, fallback = "Redeploy failed"): string {
  if (!body || typeof body !== "object") return fallback

  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== "object") return fallback

  const message = (error as { message?: unknown }).message
  return typeof message === "string" && message.trim().length > 0 ? message : fallback
}
