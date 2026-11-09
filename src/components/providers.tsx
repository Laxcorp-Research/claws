"use client"

import type { Session } from "next-auth"
import { SessionProvider } from "next-auth/react"
import { SnackbarProvider } from "@/components/shared/snackbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SelfHostProvider } from "@/lib/profile-client"

/**
 * Pass server session so first paint is authenticated|unauthenticated, not a
 * client fetch race (admin hard-load Sign-in flash after #389).
 * `null` is intentional for logged-out - !== undefined so next-auth skips loading.
 */
export function Providers({
  children,
  session,
  selfHost = false,
}: {
  children: React.ReactNode
  session: Session | null
  selfHost?: boolean
}) {
  return (
    <SelfHostProvider selfHost={selfHost}>
      <SessionProvider session={session}>
        <TooltipProvider delayDuration={300}>
          <SnackbarProvider>{children}</SnackbarProvider>
        </TooltipProvider>
      </SessionProvider>
    </SelfHostProvider>
  )
}
