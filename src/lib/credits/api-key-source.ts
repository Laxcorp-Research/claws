import type { ApiKeySource, Workspace, User } from "@/generated/prisma/client"

type WorkspaceForKeySource = Pick<Workspace, "apiKeySourceOverride"> & {
  user?: Pick<User, "apiKeySource"> | null
}

type UserForKeySource = Pick<User, "apiKeySource">

export function getApiKeySource(
  workspace: WorkspaceForKeySource,
  user?: UserForKeySource | null
): ApiKeySource {
  if (workspace.apiKeySourceOverride) return workspace.apiKeySourceOverride
  const u = user || workspace.user
  if (u?.apiKeySource) return u.apiKeySource
  return "NONE"
}

export function isCreditUser(source: ApiKeySource | null | undefined): boolean {
  return source === "PLATFORM_CREDIT"
}
