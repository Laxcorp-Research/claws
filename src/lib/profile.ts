/**
 * Hosted vs self-host. Unset CLAWS_PROFILE is the hosted product.
 * These modules assume Laxcorp accounts (README "What stays hosted-only").
 * Reaching one under CLAWS_PROFILE=self-host throws or returns 404.
 */
export const HOSTED_ONLY_MODULES = [
  "dodo-payments",
  "credit-pool",
  "metering",
  "credit-proxy",
  "railway-governor",
  "service-pool",
  "fly",
  "vercel-cron",
  "ghcr-promote",
  "composio",
  "resend",
  "sentry",
  "axiom",
  "upstash",
] as const

export type HostedOnlyModule = (typeof HOSTED_ONLY_MODULES)[number]

export class HostedOnlyUnavailableError extends Error {
  readonly moduleName: HostedOnlyModule

  constructor(moduleName: HostedOnlyModule) {
    super(`${moduleName} is hosted-only and is not available when CLAWS_PROFILE=self-host`)
    this.name = "HostedOnlyUnavailableError"
    this.moduleName = moduleName
  }
}

export function isSelfHost(raw = process.env.CLAWS_PROFILE): boolean {
  return raw === "self-host"
}

export function assertHostedModule(moduleName: HostedOnlyModule): void {
  if (isSelfHost()) throw new HostedOnlyUnavailableError(moduleName)
}

const HOSTED_ONLY_PREFIXES: Array<{ prefix: string; moduleName: HostedOnlyModule }> = [
  { prefix: "/api/dodo-payments", moduleName: "dodo-payments" },
  { prefix: "/api/user/billing", moduleName: "credit-pool" },
  { prefix: "/api/credits", moduleName: "credit-pool" },
  { prefix: "/api/internal/metering", moduleName: "metering" },
  { prefix: "/api/cron/service-pool", moduleName: "service-pool" },
  { prefix: "/api/cron", moduleName: "vercel-cron" },
  { prefix: "/api/internal/versions/register", moduleName: "ghcr-promote" },
  { prefix: "/api/internal/state/finalize", moduleName: "credit-proxy" },
  { prefix: "/api/internal/state/upload", moduleName: "credit-proxy" },
  { prefix: "/api/internal/state/blob-token", moduleName: "credit-proxy" },
  { prefix: "/api/axiom", moduleName: "axiom" },
]

/**
 * Composio broker routes. API-key tool connects stay available so a
 * self-host install can store a fixture credential without the broker.
 */
function composioPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/tools/")) return false
  return pathname.includes("/oauth") || pathname.includes("/byok")
}

export function hostedOnlyModuleForPath(pathname: string): HostedOnlyModule | null {
  if (!isSelfHost()) return null
  if (composioPath(pathname)) return "composio"
  const match = HOSTED_ONLY_PREFIXES.find(
    (rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`),
  )
  return match?.moduleName ?? null
}

export function denyHostedOnly(pathname: string): { moduleName: HostedOnlyModule } | null {
  const moduleName = hostedOnlyModuleForPath(pathname)
  if (!moduleName) return null
  return { moduleName }
}
