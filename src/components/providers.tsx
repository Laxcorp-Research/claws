"use client"

import { SessionProvider } from "next-auth/react"
import { SnackbarProvider } from "@/components/shared/snackbar"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SnackbarProvider>{children}</SnackbarProvider>
    </SessionProvider>
  )
}
