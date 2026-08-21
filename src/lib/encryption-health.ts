import { prisma } from "@/lib/db"
import { assessDecryptHealth } from "@/lib/encryption"
import { log } from "@/lib/logger"

// Runs the decrypt health probe over the given blobs and LOUDLY logs a
// structured error if any fail to decrypt - so an ENCRYPTION_MASTER_KEY mismatch
// screams at deploy time instead of silently 500ing every secret operation.
// Never logs plaintext (only counts). The loud log on failure is the contract:
// swallowing it (mutation) breaks the canary test.
export function canaryAndLog(blobs: string[]): { ok: boolean; checked: number; failed: number } {
  const result = assessDecryptHealth(blobs)
  if (!result.ok) {
    log.error(
      "ENCRYPTION_MASTER_KEY cannot decrypt existing secrets - possible key mismatch, secrets unreadable",
      { checked: result.checked, failed: result.failed },
    )
  }
  return result
}

// Samples the oldest few real encrypted secrets and runs the canary. Sampling
// (DB) errors do NOT flip the result to fail - the /api/health database check
// owns DB availability; this probe only reports a genuine "secrets won't
// decrypt" condition. No secret material is read out (decrypt results discarded).
export async function runDecryptCanary(): Promise<{ ok: boolean; checked: number; failed: number }> {
  try {
    const [wss, uaks] = await Promise.all([
      prisma.workspace.findMany({
        where: { gatewayToken: { not: null } },
        select: { gatewayToken: true },
        orderBy: { createdAt: "asc" },
        take: 3,
      }),
      prisma.userApiKey.findMany({
        select: { encryptedKey: true },
        orderBy: { createdAt: "asc" },
        take: 2,
      }),
    ])
    const blobs = [
      ...wss.map((w) => w.gatewayToken).filter((s): s is string => typeof s === "string" && s.length > 0),
      ...uaks.map((k) => k.encryptedKey),
    ]
    if (blobs.length === 0) return { ok: true, checked: 0, failed: 0 }
    return canaryAndLog(blobs)
  } catch (e) {
    // Couldn't sample (DB issue) - don't false-alarm; DB health check covers it.
    log.warn("decrypt canary could not sample secrets", {
      error: e instanceof Error ? e.message : String(e),
    })
    return { ok: true, checked: 0, failed: 0 }
  }
}
