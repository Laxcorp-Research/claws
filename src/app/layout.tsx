import type { Metadata } from "next"
import { Providers } from "@/components/providers"
import { WebVitals } from "@/lib/axiom/client"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    template: "%s - Claws",
    default: "Claws - Build, Deploy & Manage AI Agent Teams",
  },
  description: "The visual platform for building, deploying, and managing autonomous AI agent teams. By Laxcorp Research.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <WebVitals />
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
