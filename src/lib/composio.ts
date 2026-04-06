import { Composio } from "@composio/core"

let composioClient: Composio | null = null

/**
 * Composio client singleton. Returns null if COMPOSIO_API_KEY is unset (graceful degradation).
 */
export function getComposio(): Composio | null {
  const key = process.env.COMPOSIO_API_KEY
  if (!key?.trim()) {
    return null
  }

  if (!composioClient) {
    composioClient = new Composio({ apiKey: key })
  }

  return composioClient
}

/**
 * External user id for Composio connected accounts (groups OAuth connections per Claws user).
 */
export function getComposioUserId(clawsUserId: string): string {
  return `claws_${clawsUserId}`
}
