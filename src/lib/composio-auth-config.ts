import type { Composio } from "@composio/core"
import { log } from "@/lib/logger"

/**
 * Resolve an auth config id for a toolkit (list existing, or create Composio-managed).
 * Mirrors SDK `toolkits.authorize` resolution so `connectedAccounts.initiate` can supply callbackUrl.
 */
export async function resolveAuthConfigIdForToolkit(
  composio: Composio,
  toolkitSlug: string
): Promise<string> {
  const listed = await composio.authConfigs.list({ toolkit: toolkitSlug, limit: 25 })
  const existing = listed.items[0]?.id
  if (existing) {
    return existing
  }

  const toolkit = await composio.toolkits.get(toolkitSlug)
  const hasAuthDetails = Boolean(toolkit.authConfigDetails?.length)

  if (!hasAuthDetails) {
    throw new Error(
      `No Composio auth configuration for toolkit "${toolkitSlug}". Enable this toolkit in the Composio dashboard.`
    )
  }

  try {
    const created = await composio.authConfigs.create(toolkitSlug, {
      type: "use_composio_managed_auth",
      name: `${toolkit.name} (Claws)`,
    })
    return created.id
  } catch (err) {
    log.error("Composio auth config create failed", {
      toolkitSlug,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new Error(
      `Could not create auth config for "${toolkitSlug}". Configure this integration in the Composio dashboard.`
    )
  }
}
