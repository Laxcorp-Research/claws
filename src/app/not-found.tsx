import { HelpCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <EmptyState
        icon={<HelpCircle className="w-10 h-10 text-[var(--tx3)]" />}
        title="Page not found"
        description="This page doesn't exist or has been moved."
        actions={
          <Link href="/store">
            <Button variant="primary">Go to Store</Button>
          </Link>
        }
      />
    </div>
  )
}
