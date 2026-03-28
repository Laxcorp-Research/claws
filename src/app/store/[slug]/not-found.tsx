import { PackageX } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function StoreDetailNotFound() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <EmptyState
        icon={<PackageX className="w-10 h-10 text-[var(--tx3)]" />}
        title="Template not found"
        description="This template may have been removed or the URL is incorrect."
        actions={
          <Link href="/store">
            <Button variant="primary">Browse templates</Button>
          </Link>
        }
      />
    </div>
  )
}
