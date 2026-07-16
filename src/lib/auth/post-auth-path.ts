/**
 * Batch B: post-auth destination.
 * Shown-once: User.onboardingCompleted (Boolean @default false).
 * JWT also treats existing workspaces as completed (returning users).
 */
export function resolvePostAuthPath(
  onboardingCompleted: boolean | undefined,
  callbackUrl?: string | null,
): string {
  if (onboardingCompleted !== true) {
    return "/onboarding"
  }
  if (
    callbackUrl &&
    callbackUrl.startsWith("/") &&
    !callbackUrl.startsWith("//") &&
    !callbackUrl.startsWith("/auth/")
  ) {
    return callbackUrl
  }
  return "/my-claws"
}

/** Paths allowed while onboarding is incomplete (API keys CTA). */
export function isAllowedDuringOnboarding(pathname: string): boolean {
  return (
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/") ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/api/")
  )
}
