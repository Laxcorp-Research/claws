import { prisma } from "@/lib/db"

export type OnboardingGate =
  | { redirectTo: "/auth/signin" }
  | { redirectTo: "/my-claws" }
  | { redirectTo: null; hasApiKey: boolean }

/**
 * Server-side onboarding gate. Reads the DB flag (not the JWT) so a
 * stale-false cookie cannot imprison a DB-complete user on /onboarding.
 */
export async function loadOnboardingGate(userId: string | undefined): Promise<OnboardingGate> {
  if (!userId) return { redirectTo: "/auth/signin" }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      onboardingCompleted: true,
      _count: { select: { apiKeys: true } },
    },
  })

  if (!user) return { redirectTo: "/auth/signin" }

  // MUTATION: drop this branch → stale-cookie fixture test fails.
  if (user.onboardingCompleted === true) {
    return { redirectTo: "/my-claws" }
  }

  return { redirectTo: null, hasApiKey: user._count.apiKeys > 0 }
}
