"use client"

import { SessionProvider } from "next-auth/react"
import { SnackbarProvider } from "@/components/shared/snackbar"
import { TooltipProvider } from "@/components/ui/tooltip"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TooltipProvider delayDuration={300}>
        <SnackbarProvider>{children}</SnackbarProvider>
      </TooltipProvider>
    </SessionProvider>
  )
}
