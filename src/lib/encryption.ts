import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY
  if (!key) throw new Error("ENCRYPTION_MASTER_KEY not set")
  return Buffer.from(key, "hex")
}

// Optional previous master key, set ONLY during a key rotation window. When
// present, decrypt() falls back to it so a rotation doesn't instantly orphan
// every secret encrypted under the old key. Unset → behavior is identical to
// pre-rotation (no fallback). Secrets migrate forward via decryptWithMigration /
// decryptAndMaybeReencrypt as they're naturally read.
function getPreviousMasterKey(): Buffer | null {
  const key = process.env.ENCRYPTION_MASTER_KEY_PREVIOUS
  if (!key) return null
  return Buffer.from(key, "hex")
}

function deriveKey(masterKey: Buffer, version: string = "v1"): Buffer {
  return crypto.createHmac("sha256", masterKey).update(version).digest()
}

interface ParsedBlob {
  version: string
  iv: Buffer
  authTag: Buffer
  ciphertext: Buffer
}

// 4-part `version:iv:tag:ct`, or legacy 3-part `iv:tag:ct` (treated as v1).
function parseBlob(encoded: string): ParsedBlob {
  const parts = encoded.split(":")
  if (parts.length === 4) {
    return {
      version: parts[0],
      iv: Buffer.from(parts[1], "base64"),
      authTag: Buffer.from(parts[2], "base64"),
      ciphertext: Buffer.from(parts[3], "base64"),
    }
  }
  return {
    version: "v1",
    iv: Buffer.from(parts[0], "base64"),
    authTag: Buffer.from(parts[1], "base64"),
    ciphertext: Buffer.from(parts[2], "base64"),
  }
}

// Throws (GCM auth-tag mismatch) when masterKey is wrong for this blob.
function decryptWith(masterKey: Buffer, b: ParsedBlob): string {
  const key = deriveKey(masterKey, b.version)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, b.iv)
  decipher.setAuthTag(b.authTag)
  return decipher.update(b.ciphertext) + decipher.final("utf8")
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

// Decrypt under the CURRENT master key; on failure, fall back to the PREVIOUS
// master key (if configured). Backward-compatible: with no previous key set,
// this is identical to the original single-key decrypt (rethrows the current
// error). A deliberate ENCRYPTION_MASTER_KEY rotation therefore no longer
// instantly 500s every secret read - old secrets decrypt under the previous
// key during the migration window.
export function decrypt(encoded: string): string {
  const b = parseBlob(encoded)
  const current = getMasterKey()
  try {
    return decryptWith(current, b)
  } catch (errCurrent) {
    const previous = getPreviousMasterKey()
    if (previous) {
      try {
        return decryptWith(previous, b)
      } catch {
        // previous didn't work either → genuine failure, rethrow current error
      }
    }
    throw errCurrent
  }
}

// Like decrypt(), but reports whether the value needed the PREVIOUS key. When it
// did, `reencrypted` is a fresh blob under the CURRENT key for the caller to
// persist (re-encrypt-on-read migration). `reencrypted` is null when the value
// already decrypts under the current key (no migration needed). Throws only on a
// genuine failure (neither key works, or no previous key configured to fall back to).
export function decryptWithMigration(encoded: string): { plaintext: string; reencrypted: string | null } {
  const b = parseBlob(encoded)
  const current = getMasterKey()
  try {
    return { plaintext: decryptWith(current, b), reencrypted: null }
  } catch (errCurrent) {
    const previous = getPreviousMasterKey()
    if (!previous) throw errCurrent
    const plaintext = decryptWith(previous, b) // throws if previous also fails → genuine failure
    return { plaintext, reencrypted: encrypt(plaintext) }
  }
}

// Decrypt + (if the value was under the previous key) re-encrypt under the
// current key via the caller-supplied `persist` (which owns the DB row). The
// re-encrypt write is best-effort: a failure is swallowed so the read path is
// NEVER broken - the decrypted value is always returned. Callers should log
// inside `persist`.
export async function decryptAndMaybeReencrypt(
  encoded: string,
  persist: (newBlob: string) => Promise<void>,
): Promise<string> {
  const { plaintext, reencrypted } = decryptWithMigration(encoded)
  if (reencrypted) {
    try {
      await persist(reencrypted)
    } catch {
      // read path must not break on a migration write failure
    }
  }
  return plaintext
}

// Pass/fail health probe over sample blobs. Uses decrypt() (so it passes during
// a proper rotation where the previous key is configured). NEVER returns or logs
// plaintext - only counts.
export function assessDecryptHealth(blobs: string[]): { checked: number; failed: number; ok: boolean } {
  let failed = 0
  for (const b of blobs) {
    try {
      decrypt(b)
    } catch {
      failed++
    }
  }
  return { checked: blobs.length, failed, ok: failed === 0 }
}

export function generateKeyHint(apiKey: string): string {
  if (apiKey.length <= 11) return "***"
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`
}
