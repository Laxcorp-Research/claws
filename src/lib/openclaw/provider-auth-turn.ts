import { sendOwnerAlert } from "@/lib/alerts/owner-alert"
import { ledgerHealAttempt } from "@/lib/healing/ledger"
import { isSelfHost } from "@/lib/profile"

export function isMissingProviderAuth(text: string | null | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return lower.includes("missing-provider-auth") || lower.includes("no api key found for provider")
}

/**
 * Self-host owner plane. The dashboard banner is the chat 502. Telegram and
 * email fire only when the owner alert channels are configured.
 */
export async function noteMissingProviderAuth(workspaceId: string, detail: string): Promise<void> {
  if (!isSelfHost() || !isMissingProviderAuth(detail)) return
  const sentence = detail.trim().slice(0, 500)
  try {
    await ledgerHealAttempt({
      workspaceId,
      condition: "provider_auth_missing",
      outcome: "failed",
      detail: sentence,
    })
  } catch {
    // The chat response must still carry the sentence if the ledger write fails.
  }
  try {
    await sendOwnerAlert({
      alertKey: "provider-auth-missing",
      title: "Model key missing on a turn",
      detail: sentence,
      workspaceId,
    })
  } catch {
    // Unconfigured or failed delivery must not hide the chat error.
  }
}
