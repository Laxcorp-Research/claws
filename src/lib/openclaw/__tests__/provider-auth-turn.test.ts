import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSendOwnerAlert = vi.fn()
vi.mock("@/lib/alerts/owner-alert", () => ({
  sendOwnerAlert: (...args: unknown[]) => mockSendOwnerAlert(...args),
}))

const mockLedger = vi.fn()
vi.mock("@/lib/healing/ledger", () => ({
  ledgerHealAttempt: (...args: unknown[]) => mockLedger(...args),
}))

import { noteMissingProviderAuth } from "@/lib/openclaw/provider-auth-turn"

const sentence = 'No API key found for provider "anthropic". missing-provider-auth'

describe("noteMissingProviderAuth", () => {
  beforeEach(() => {
    mockSendOwnerAlert.mockReset()
    mockLedger.mockReset()
    mockSendOwnerAlert.mockResolvedValue({ sent: false, channel: "skipped" })
    mockLedger.mockResolvedValue(undefined)
    delete process.env.CLAWS_PROFILE
  })

  it("self-host missing-provider-auth ledgers the condition and alerts the owner plane", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    await noteMissingProviderAuth("ws-1", sentence)
    expect(mockLedger).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "ws-1",
      condition: "provider_auth_missing",
      outcome: "failed",
    }))
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(expect.objectContaining({
      alertKey: "provider-auth-missing",
      workspaceId: "ws-1",
      detail: sentence,
    }))
  })

  it("skips the alert when the turn error is not a missing provider key", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    await noteMissingProviderAuth("ws-1", "origin not allowed")
    expect(mockLedger).not.toHaveBeenCalled()
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("does not page the owner plane outside self-host", async () => {
    await noteMissingProviderAuth("ws-1", sentence)
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })
})
