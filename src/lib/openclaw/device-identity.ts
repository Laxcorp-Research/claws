// PR-9/A-vercel: Ed25519 device identity for the chat send endpoint.
//
// WHY THIS EXISTS: a REMOTE gateway client authenticating with the shared
// OPENCLAW_GATEWAY_TOKEN but presenting NO device identity gets its
// requested scopes CLEARED by OpenClaw's connect policy — the connection is
// allowed (role operator) but chat.send then fails "missing scope:
// operator.write". Verified live in the PR-9/0 spike; full protocol
// evidence in docs/OPENCLAW_GATEWAY_PROTOCOL.md §3. So every send presents
// an Ed25519 device identity whose signature covers the server's
// connect.challenge nonce.
//
// Key material lives on Workspace.chatDeviceKeyEncrypted as ONE AES-256-GCM
// blob (same pipeline as gatewayToken): {deviceId, publicKeyRawB64u,
// privateKeyPem}. Generated lazily on first send — no backfill.
//
// Wire formats (verified against upstream v2026.5.22 + live captures):
//   deviceId       = sha256 hex of the RAW 32-byte Ed25519 public key
//   publicKey      = base64url of the raw 32-byte public key
//   signature      = base64url(Ed25519-sign(v3 payload))
//   v3 payload     = "v3|deviceId|clientId|clientMode|role|scopes(comma)|
//                     signedAtMs|token|nonce|platform|deviceFamily"
//                    with platform/deviceFamily ASCII-lowercased (upstream
//                    device-auth.ts buildDeviceAuthPayloadV3 +
//                    device-metadata-normalization.ts).

import crypto from "node:crypto"
import { encrypt, decrypt } from "@/lib/encryption"

// SPKI prefix for Ed25519 public keys — strip it to get the raw 32 bytes
// (mirrors upstream src/infra/device-identity.ts).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export interface ChatDeviceIdentity {
  deviceId: string
  publicKeyRawB64u: string
  privateKeyPem: string
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

export function generateDeviceIdentity(): ChatDeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer
  const raw = spki.subarray(ED25519_SPKI_PREFIX.length)
  return {
    deviceId: crypto.createHash("sha256").update(raw).digest("hex"),
    publicKeyRawB64u: base64Url(raw),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  }
}

export function encryptDeviceIdentity(identity: ChatDeviceIdentity): string {
  return encrypt(JSON.stringify(identity))
}

export function decryptDeviceIdentity(encrypted: string): ChatDeviceIdentity {
  return JSON.parse(decrypt(encrypted)) as ChatDeviceIdentity
}

/** ASCII-only lowercasing, matching upstream normalizeDeviceMetadataForAuth. */
function normalizeMetadata(value: string | undefined): string {
  const trimmed = (value ?? "").trim()
  return trimmed.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

export interface DeviceAuthSignatureParams {
  identity: ChatDeviceIdentity
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token: string
  nonce: string
  platform: string
  deviceFamily?: string
}

/** Builds + signs the v3 device-auth payload over the challenge nonce. */
export function signDeviceAuthV3(params: DeviceAuthSignatureParams): string {
  const payload = [
    "v3",
    params.identity.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    normalizeMetadata(params.platform),
    normalizeMetadata(params.deviceFamily),
  ].join("|")
  const key = crypto.createPrivateKey(params.identity.privateKeyPem)
  return base64Url(crypto.sign(null, Buffer.from(payload, "utf8"), key))
}
