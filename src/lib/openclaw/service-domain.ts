/**
 * One Railway service domain per claw. Live `environment.config` stores
 * serviceDomains as a hostname -> {} map, so `domains?.[0]` always misses
 * and create-per-deploy grows the count to the per-service cap.
 */

export type ServiceDomainRecord = {
  id: string
  domain: string
  createdAt: string
}

export type ServiceDomainCapPlan = {
  keep: ServiceDomainRecord | null
  prune: ServiceDomainRecord[]
  create: boolean
}

export const RAILWAY_DOMAIN_CAP_PUBLIC =
  "This Claw hit a Railway domain cap. Extra domains were pruned. Retry the deploy."

const CAP_NEEDLES = [
  /domain limit/i,
  /per-service domain/i,
  /too many domains/i,
  /maximum number of (service )?domains/i,
  /reached the.*domain/i,
  /domain cap/i,
  /hit the.*domain/i,
]

export class RailwayDomainCapError extends Error {
  constructor(message: string = RAILWAY_DOMAIN_CAP_PUBLIC) {
    super(message)
    this.name = "RailwayDomainCapError"
    Object.setPrototypeOf(this, RailwayDomainCapError.prototype)
  }
}

export function isRailwayDomainCapError(err: unknown): boolean {
  if (err instanceof RailwayDomainCapError) return true
  if (err instanceof Error && err.name === "RailwayDomainCapError") return true
  const msg = err instanceof Error ? err.message : String(err)
  return CAP_NEEDLES.some((re) => re.test(msg))
}

export function publicDeployErrorMessage(err: unknown): string {
  if (isRailwayDomainCapError(err)) return RAILWAY_DOMAIN_CAP_PUBLIC
  return err instanceof Error ? err.message : "Unknown deployment error"
}

function createdAtMs(row: ServiceDomainRecord): number {
  const ms = Date.parse(row.createdAt)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Keep the domain matching containerHost; else the oldest. Create only
 * when zero exist. MUTATION: create-per-deploy (create while existing
 * length > 0) grows the count and fails the contract test.
 */
export function planServiceDomainCap(args: {
  existing: ServiceDomainRecord[]
  preferredHost?: string | null
}): ServiceDomainCapPlan {
  const existing = args.existing.filter((row) => row.id && row.domain)
  if (existing.length === 0) {
    return { keep: null, prune: [], create: true }
  }

  const preferred = args.preferredHost?.trim() ?? ""
  const preferredMatch = preferred
    ? existing.find((row) => row.domain === preferred)
    : undefined

  const keep =
    preferredMatch ??
    [...existing].sort((a, b) => {
      const byTime = createdAtMs(a) - createdAtMs(b)
      if (byTime !== 0) return byTime
      return a.domain.localeCompare(b.domain)
    })[0]

  return {
    keep,
    prune: existing.filter((row) => row.id !== keep.id),
    create: false,
  }
}
