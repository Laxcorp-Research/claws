import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { Providers } from "@/components/providers"
import { LegalFooter } from "@/components/shared/legal-footer"
import { authOptions } from "@/lib/auth"
import { WebVitals } from "@/lib/axiom/client"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    template: "%s - Claws",
    default: "Claws - Build, Deploy & Manage AI Agent Teams",
  },
  description: "The visual platform for building, deploying, and managing autonomous AI agent teams. By Laxcorp Research.",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  return (
    <html lang="en">
      <WebVitals />
      <body>
        <Providers session={session}>{children}</Providers>
        <LegalFooter />
      </body>
    </html>
  )
}
