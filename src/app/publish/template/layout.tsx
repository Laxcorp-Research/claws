import type { Metadata } from "next"
import { isMarketplacePublishEnabled } from "@/lib/marketplace/feature-flags"
import { MarketplaceComingSoonPanel } from "@/components/marketplace/coming-soon-panel"

export const metadata: Metadata = {
  title: "Publish Template",
}

export default function PublishTemplateLayout({ children }: { children: React.ReactNode }) {
  if (!isMarketplacePublishEnabled()) {
    return (
      <MarketplaceComingSoonPanel
        fullPage
        title="Template publishing coming soon"
        description="Community template publishing opens when the publish arc ships. Official store templates stay available."
      />
    )
  }
  return children
}
