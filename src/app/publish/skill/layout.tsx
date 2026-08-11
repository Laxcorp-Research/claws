import type { Metadata } from "next"
import { isMarketplacePublishEnabled } from "@/lib/marketplace/feature-flags"
import { MarketplaceComingSoonPanel } from "@/components/marketplace/coming-soon-panel"

export const metadata: Metadata = {
  title: "Publish Skill",
}

export default function PublishSkillLayout({ children }: { children: React.ReactNode }) {
  if (!isMarketplacePublishEnabled()) {
    return (
      <MarketplaceComingSoonPanel
        fullPage
        title="Skill publishing coming soon"
        description="Community skill publishing opens when the publish arc ships. Official skills stay available in the store."
      />
    )
  }
  return children
}
