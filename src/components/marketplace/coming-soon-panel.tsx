"use client"

import { Package } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { PageShell } from "@/components/shared/page-shell"

interface MarketplaceComingSoonPanelProps {
  title: string
  description: string
  /** When true, wrap in PageShell for full-page publish routes. */
  fullPage?: boolean
}

export function MarketplaceComingSoonPanel({
  title,
  description,
  fullPage = false,
}: MarketplaceComingSoonPanelProps) {
  const body = (
    <div className="max-w-md mx-auto border border-[var(--bd)] rounded-[12px]">
      <EmptyState
        icon={<Package size={24} aria-hidden="true" />}
        title={title}
        description={description}
        actions={<Badge variant="neutral">Coming soon</Badge>}
      />
    </div>
  )

  if (!fullPage) return body

  return (
    <PageShell>
      <div className="max-w-2xl mx-auto px-4 py-10">{body}</div>
    </PageShell>
  )
}
