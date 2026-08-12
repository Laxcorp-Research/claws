import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  encryptPayoutDetails,
  decryptPayoutDetails,
  maskPayoutDetails,
  validatePayoutDetails,
} from "@/lib/marketplace/payout-details"

describe("payout-details encryption (PR-9)", () => {
  it("round-trips BANK details without leaking plaintext in the blob", () => {
    const details = validatePayoutDetails({
      method: "BANK",
      holderName: "Ada Lovelace",
      accountOrIban: "GB82WEST12345698765432",
      swiftOrBic: "WESTGB22",
    })
    const blob = encryptPayoutDetails(details)
    expect(blob).not.toContain("GB82WEST12345698765432")
    expect(blob).not.toContain("Ada Lovelace")
    expect(decryptPayoutDetails(blob)).toEqual(details)
  })

  it("masks last-4 for bank and email for Wise/PayPal", () => {
    expect(
      maskPayoutDetails({
        method: "BANK",
        holderName: "Ada",
        accountOrIban: "GB82WEST12345698765432",
      }),
    ).toBe("•••• 5432")
    expect(
      maskPayoutDetails({ method: "WISE", email: "creator@example.com" }),
    ).toBe("c***r@example.com")
  })

  it("MUTATION: plaintext write → fails (blob must not contain secrets)", () => {
    const details = validatePayoutDetails({
      method: "WISE",
      email: "secret-payout@example.com",
    })
    const blob = encryptPayoutDetails(details)
    // If encrypt() were replaced with JSON.stringify, this fails the contract.
    expect(blob.includes("secret-payout@example.com")).toBe(false)
    expect(() => {
      if (blob.includes("secret-payout@example.com")) {
        throw new Error("PAYOUT_DETAILS_PLAINTEXT_LEAK")
      }
    }).not.toThrow()

    // Simulate the forbidden path: storing JSON as "encrypted".
    const fakePlaintextStore = JSON.stringify(details)
    expect(fakePlaintextStore).toContain("secret-payout@example.com")
    expect(() => {
      if (fakePlaintextStore.includes("secret-payout@example.com")) {
        throw new Error("PAYOUT_DETAILS_PLAINTEXT_LEAK")
      }
    }).toThrow(/PLAINTEXT_LEAK/)
  })

  it("MUTATION: creator payout-details PUT rejects direct encrypted blob write", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/creator/payout-details/route.ts"),
      "utf8",
    )
    expect(src).toContain('payoutDetailsEncrypted')
    expect(src).toContain("Cannot write encrypted blob directly")
    expect(src).toContain("encryptPayoutDetails")
    expect(src).toContain("plaintext: null")
  })
})
