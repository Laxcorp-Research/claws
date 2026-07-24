import { prisma } from "@/lib/db"

export type OnboardingGate =
  | { redirectTo: "/auth/signin" }
  | { redirectTo: "/my-claws" }
  | {
      redirectTo: null
      hasApiKey: boolean
      /** True when user has a non-Anthropic key but no Anthropic key (template honesty). */
      showAnthropicTemplateHint: boolean
    }

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
      apiKeys: { select: { provider: true } },
    },
  })

  if (!user) return { redirectTo: "/auth/signin" }

  // MUTATION: drop this branch → stale-cookie fixture test fails.
  if (user.onboardingCompleted === true) {
    return { redirectTo: "/my-claws" }
  }

  const providers = user.apiKeys.map((k) => k.provider)
  const hasApiKey = providers.length > 0
  const hasAnthropic = providers.includes("ANTHROPIC")
  const showAnthropicTemplateHint = hasApiKey && !hasAnthropic

  return { redirectTo: null, hasApiKey, showAnthropicTemplateHint }
}
