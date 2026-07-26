import { prisma } from "@/lib/db"

export type OnboardingGate =
  | { redirectTo: "/auth/signin" }
  | { redirectTo: null; mode: "gate" | "revisit" }

/**
 * Auth + mode only. Live S1/S2/S3 truth is loaded via loadGettingStartedTracker.
 *
 * Completed users no longer redirect away — they get revisit mode on /onboarding.
 * Stale-false JWT escape: proxy already allowlists /onboarding; the page renders
 * from DB truth and silently refreshes the JWT cookie (OnboardingJwtRefresh).
 */
export async function loadOnboardingGate(userId: string | undefined): Promise<OnboardingGate> {
  if (!userId) return { redirectTo: "/auth/signin" }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingCompleted: true },
  })

  if (!user) return { redirectTo: "/auth/signin" }

  return {
    redirectTo: null,
    mode: user.onboardingCompleted === true ? "revisit" : "gate",
  }
}
