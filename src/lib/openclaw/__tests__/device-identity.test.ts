// PR-9/A-vercel: Ed25519 device identity unit tests.
import { describe, it, expect, beforeAll } from "vitest"
import crypto from "node:crypto"

// encryption.ts needs a master key; set one before importing anything that
// transitively pulls it in.
beforeAll(() => {
  process.env.ENCRYPTION_MASTER_KEY = "00".repeat(32)
  process.env.ENCRYPTION_KEY_VERSION = "v1"
})

import {
  generateDeviceIdentity,
  encryptDeviceIdentity,
  decryptDeviceIdentity,
  signDeviceAuthV3,
} from "@/lib/openclaw/device-identity"

describe("device-identity", () => {
  it("generates a valid Ed25519 keypair with deviceId = sha256(raw pubkey)", () => {
    const id = generateDeviceIdentity()
    // publicKeyRawB64u decodes to 32 raw bytes; deviceId is its sha256 hex.
    const raw = Buffer.from(id.publicKeyRawB64u.replaceAll("-", "+").replaceAll("_", "/"), "base64")
    expect(raw.length).toBe(32)
    expect(id.deviceId).toBe(crypto.createHash("sha256").update(raw).digest("hex"))
    expect(id.privateKeyPem).toContain("BEGIN PRIVATE KEY")
  })

  it("encrypt → decrypt round-trips the identity blob", () => {
    const id = generateDeviceIdentity()
    const blob = encryptDeviceIdentity(id)
    expect(blob).not.toContain(id.privateKeyPem) // actually encrypted
    expect(decryptDeviceIdentity(blob)).toEqual(id)
  })

  it("signDeviceAuthV3 produces a signature verifiable against the raw public key over the v3 payload", () => {
    const id = generateDeviceIdentity()
    const nonce = "challenge-nonce-123"
    const signedAtMs = 1781000000000
    const sig = signDeviceAuthV3({
      identity: id,
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      signedAtMs,
      token: "tok",
      nonce,
      platform: "node",
    })
    // Reconstruct the exact v3 payload (platform/deviceFamily lowercased; here both already lower/empty).
    const payload = ["v3", id.deviceId, "gateway-client", "backend", "operator", "operator.read,operator.write", String(signedAtMs), "tok", nonce, "node", ""].join("|")
    const sigBuf = Buffer.from(sig.replaceAll("-", "+").replaceAll("_", "/"), "base64")
    const ok = crypto.verify(null, Buffer.from(payload, "utf8"), crypto.createPublicKey(id.privateKeyPem), sigBuf)
    expect(ok).toBe(true)
  })

  it("each generated identity is unique", () => {
    expect(generateDeviceIdentity().deviceId).not.toBe(generateDeviceIdentity().deviceId)
  })
})
