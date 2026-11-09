import { isSelfHost } from "@/lib/profile"

export interface SignInMethods {
  github: boolean
  google: boolean
  magicLink: boolean
  password: boolean
}

/** A compose placeholder is not a configured client. */
export function envConfigured(value: string | undefined): boolean {
  const trimmed = value?.trim()
  return Boolean(trimmed) && trimmed !== "unused"
}

export function smtpConfigured(env: NodeJS.ProcessEnv): boolean {
  return Object.entries(env).some(
    ([key, value]) => key.startsWith("SMTP_") && envConfigured(value),
  )
}

/**
 * Hosted keeps the existing GitHub, Google, and magic-link page.
 * Self-host shows a provider only when its secret is actually set.
 */
export function signInMethods(env: NodeJS.ProcessEnv = process.env): SignInMethods {
  if (!isSelfHost(env.CLAWS_PROFILE)) {
    return { github: true, google: true, magicLink: true, password: false }
  }
  return {
    github: envConfigured(env.GITHUB_CLIENT_ID) && envConfigured(env.GITHUB_CLIENT_SECRET),
    google: envConfigured(env.GOOGLE_CLIENT_ID) && envConfigured(env.GOOGLE_CLIENT_SECRET),
    magicLink: envConfigured(env.RESEND_API_KEY) || smtpConfigured(env),
    password: true,
  }
}
