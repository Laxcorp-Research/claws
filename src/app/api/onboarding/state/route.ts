import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { loadOnboardingStateSteps } from "@/lib/onboarding/load-tracker"

/** Cheap EXISTS + balance read for top-bar Getting started visibility. */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const steps = await loadOnboardingStateSteps(user.id)
  if (!steps) return ERRORS.NOT_FOUND("User")

  return apiSuccess(steps)
}
