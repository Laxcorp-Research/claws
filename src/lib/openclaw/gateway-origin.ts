/**
 * One app-to-gateway Origin for both the generated allowlist and the
 * chat client. Self-host is the compose service name plus the app port
 * (docker-compose.yml service `app`, NEXT_PUBLIC_APP_URL port 3000).
 * Hosted stays the gateway host, which Railway already allowlists.
 */
export const COMPOSE_APP_SERVICE = "app"
export const COMPOSE_APP_PORT = 3000
export const SELF_HOST_APP_ORIGIN = `http://${COMPOSE_APP_SERVICE}:${COMPOSE_APP_PORT}`

/** Anthropic base URL the runtime calls when the stored key is a fixture. */
export const FIXTURE_MODEL_BASE_URL = `${SELF_HOST_APP_ORIGIN}/api/internal/fixture-model`

/** CI listens on 3001. Compose listens on 3000. The origin header stays the compose value. */
export function fixtureModelBaseUrl(raw = process.env.CLAWS_FIXTURE_MODEL_BASE_URL): string {
  const override = raw?.trim()
  if (override) return override.replace(/\/$/, "")
  return FIXTURE_MODEL_BASE_URL
}
export const FIXTURE_MODEL_REPLY = "fixture-reply"
export const FIXTURE_MODEL_USAGE = { input: 12, output: 4 } as const

export type GatewayProfile = "self-host" | "hosted"

export function gatewayProfileFromEnv(raw = process.env.CLAWS_PROFILE): GatewayProfile {
  return raw === "self-host" ? "self-host" : "hosted"
}

export function gatewayOriginForProfile(profile: GatewayProfile, gatewayHost: string): string {
  if (profile === "self-host") return SELF_HOST_APP_ORIGIN
  return `https://${gatewayHost}`
}
