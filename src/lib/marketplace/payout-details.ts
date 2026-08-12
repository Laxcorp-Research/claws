/**
 * MANUAL-RAIL creator payout destination — encrypted at rest (AES-256-GCM).
 * Creators only ever see masked hints; admins decrypt on demand (audited).
 */
import { encrypt, decrypt } from "@/lib/encryption"
import type { PayoutMethod } from "@/generated/prisma/client"

export type BankPayoutDetails = {
  method: "BANK"
  holderName: string
  accountOrIban: string
  swiftOrBic?: string
}

export type WisePayoutDetails = {
  method: "WISE"
  email: string
}

export type PaypalPayoutDetails = {
  method: "PAYPAL"
  email: string
}

export type PayoutDetailsPayload = BankPayoutDetails | WisePayoutDetails | PaypalPayoutDetails

export function validatePayoutDetails(raw: unknown): PayoutDetailsPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("PAYOUT_DETAILS_INVALID")
  }
  const o = raw as Record<string, unknown>
  const method = o.method
  if (method === "BANK") {
    const holderName = String(o.holderName ?? "").trim()
    const accountOrIban = String(o.accountOrIban ?? "").trim().replace(/\s+/g, "")
    const swiftOrBic = String(o.swiftOrBic ?? "").trim() || undefined
    if (holderName.length < 2 || accountOrIban.length < 6) {
      throw new Error("PAYOUT_DETAILS_BANK_INCOMPLETE")
    }
    return { method: "BANK", holderName, accountOrIban, swiftOrBic }
  }
  if (method === "WISE" || method === "PAYPAL") {
    const email = String(o.email ?? "").trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("PAYOUT_DETAILS_EMAIL_INVALID")
    }
    return method === "WISE"
      ? { method: "WISE", email }
      : { method: "PAYPAL", email }
  }
  throw new Error("PAYOUT_DETAILS_METHOD_INVALID")
}

export function encryptPayoutDetails(details: PayoutDetailsPayload): string {
  const json = JSON.stringify(details)
  // Guard: never persist a blob that looks like raw JSON without encryption envelope.
  if (!json.includes('"method"')) throw new Error("PAYOUT_DETAILS_EMPTY")
  const blob = encrypt(json)
  if (blob.includes(details.method === "BANK" ? details.accountOrIban : details.email)) {
    throw new Error("PAYOUT_DETAILS_PLAINTEXT_LEAK")
  }
  return blob
}

export function decryptPayoutDetails(encrypted: string): PayoutDetailsPayload {
  const parsed = JSON.parse(decrypt(encrypted)) as unknown
  return validatePayoutDetails(parsed)
}

/** Last-4 style hint safe for creator UI (no decrypt required on read). */
export function maskPayoutDetails(details: PayoutDetailsPayload): string {
  if (details.method === "BANK") {
    const digits = details.accountOrIban.replace(/[^a-zA-Z0-9]/g, "")
    const last4 = digits.slice(-4)
    return `•••• ${last4}`
  }
  const [local, domain] = details.email.split("@")
  const shown = local.length <= 2 ? "*" : `${local[0]}***${local[local.length - 1]}`
  return `${shown}@${domain}`
}

export function payoutMethodLabel(method: PayoutMethod | string | null | undefined): string {
  switch (method) {
    case "BANK":
      return "Bank transfer"
    case "WISE":
      return "Wise"
    case "PAYPAL":
      return "PayPal"
    default:
      return "Not set"
  }
}
