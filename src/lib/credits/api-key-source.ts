import type { ApiKeySource, Workspace, User } from "@/generated/prisma/client"

export function getApiKeySource(
  workspace: Workspace & { user?: User },
  user?: User
): ApiKeySource {
  if (workspace.apiKeySourceOverride) return workspace.apiKeySourceOverride
  const u = user || workspace.user
  if (u?.apiKeySource) return u.apiKeySource
  return "NONE"
}
