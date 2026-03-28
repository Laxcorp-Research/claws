import { FolderOpen } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function DashboardNotFound() {
  return (
    <div className="max-w-5xl mx-auto px-5 py-16">
      <EmptyState
        icon={<FolderOpen className="w-10 h-10 text-[var(--tx3)]" />}
        title="Workspace not found"
        description="This workspace doesn't exist or you don't have access to it."
        actions={
          <Link href="/my-claws">
            <Button variant="primary">Go to My Claws</Button>
          </Link>
        }
      />
    </div>
  )
}
