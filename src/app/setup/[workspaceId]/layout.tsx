import type { Metadata } from "next"
import { PageShell } from "@/components/shared/page-shell"

export const metadata: Metadata = { title: "Setup" }

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <PageShell>{children}</PageShell>
}
