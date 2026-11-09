import { prisma } from "@/lib/db"
import { isSelfHost } from "@/lib/profile"

let ownerKnown = false

export function resetOwnerGateCache(): void {
  ownerKnown = false
}

/** True when this process is self-host and the database still has no user. */
export async function selfHostNeedsOwner(): Promise<boolean> {
  if (!isSelfHost()) return false
  if (ownerKnown) return false
  const count = await prisma.user.count()
  if (count > 0) {
    ownerKnown = true
    return false
  }
  return true
}
