import { randomBytes } from "crypto"

export function generateSecureToken(length = 32): string {
  return randomBytes(length).toString("hex")
}
