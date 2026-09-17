/**
 * Server side of the consent wiring (see ./consent.ts for constants -
 * that module stays client-safe / prisma-free because the signin page
 * imports it).
 *
 * Capture points:
 *  - NextAuth signIn callback: BLOCKS new-user creation when the signup
 *    consent cookie is absent; lazily records consent for existing users
 *    who ticked the box (version upgrades, grandfathered accounts).
 *  - NextAuth createUser event: writes the signup TOS_PRIVACY row.
 *  - Deploy route: FINANCIAL_AUTONOMY_S8 gate for financial templates.
 *  - Workspace PATCH (knob write): AUTONOMOUS_MODE_S8 on every
 *    APPROVAL_REQUIRED -> AUTO_PROCEED flip.
 */

import { cookies } from "next/headers"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import {
  parseConsentCookieVersion,
  TOS_CONSENT_COOKIE,
  TOS_VERSION,
} from "@/lib/legal/consent"

export type ConsentKindValue =
  | "TOS_PRIVACY"
  | "FINANCIAL_AUTONOMY_S8"
  | "AUTONOMOUS_MODE_S8"

/**
 * Consent-cookie version from the current request, or null when absent /
 * malformed / outside a request scope (NextAuth callbacks always run inside
 * one; the try/catch is a safety net, not a code path we expect).
 */
export async function readTosConsentCookieVersion(): Promise<string | null> {
  try {
    const jar = await cookies()
    return parseConsentCookieVersion(jar.get(TOS_CONSENT_COOKIE)?.value)
  } catch {
    return null
  }
}

/** Append a consent row. Consent writes are evidence, not control flow -
 * a DB hiccup must never break sign-in/deploy, so this never throws. */
export async function recordConsent(args: {
  userId: string
  kind: ConsentKindValue
  version?: string | null
  workspaceId?: string | null
  source: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.consentRecord.create({
      data: {
        userId: args.userId,
        kind: args.kind,
        version: args.version ?? TOS_VERSION,
        workspaceId: args.workspaceId ?? null,
        source: args.source,
        metadata: args.metadata ? JSON.stringify(args.metadata) : null,
      },
    })
  } catch (err) {
    log.error("consent: failed to record", {
      userId: args.userId,
      kind: args.kind,
      source: args.source,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function hasConsent(args: {
  userId: string
  kind: ConsentKindValue
  version?: string
  workspaceId?: string
}): Promise<boolean> {
  const row = await prisma.consentRecord.findFirst({
    where: {
      userId: args.userId,
      kind: args.kind,
      ...(args.version ? { version: args.version } : {}),
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    },
    select: { id: true },
  })
  return row !== null
}

/** Existing users who tick the box again (or after a version bump): record
 * once per version, silently. */
export async function recordTosConsentIfMissing(args: {
  userId: string
  version: string
  source: string
}): Promise<void> {
  const already = await hasConsent({
    userId: args.userId,
    kind: "TOS_PRIVACY",
    version: args.version,
  })
  if (already) return
  await recordConsent({
    userId: args.userId,
    kind: "TOS_PRIVACY",
    version: args.version,
    source: args.source,
  })
}
