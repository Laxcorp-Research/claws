import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY
  if (!key) throw new Error("ENCRYPTION_MASTER_KEY not set")
  return Buffer.from(key, "hex")
}

function deriveKey(masterKey: Buffer, version: string = "v1"): Buffer {
  return crypto.createHmac("sha256", masterKey).update(version).digest()
}

export function encrypt(plaintext: string): string {
  const masterKey = getMasterKey()
  const version = process.env.ENCRYPTION_KEY_VERSION || "v1"
  const key = deriveKey(masterKey, version)
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${version}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`
}

export function decrypt(encoded: string): string {
  const masterKey = getMasterKey()
  const parts = encoded.split(":")

  const version = parts.length === 4 ? parts[0] : "v1"
  const [iv, authTag, ciphertext] = parts.length === 4
    ? parts.slice(1).map((p) => Buffer.from(p, "base64"))
    : parts.map((p) => Buffer.from(p, "base64"))

  const key = deriveKey(masterKey, version)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return decipher.update(ciphertext) + decipher.final("utf8")
}

export function generateKeyHint(apiKey: string): string {
  if (apiKey.length <= 11) return "***"
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`
}
