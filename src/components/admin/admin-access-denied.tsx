"use client"

import { useRouter } from "next/navigation"
import { ShieldAlert } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

/**
 * Shown when a non-admin reaches an /admin surface. Distinct from a page's
 * "empty" state: it makes "you're not authorized" unmistakable instead of
 * looking like "there's no data here" (GH #127). The real access control is
 * the API's requireAdmin 403 (and, separately, server-side middleware - see
 * the middleware authorization-gap issue, GH #133); this is the honest client
 * surface, not the access control itself.
 */
export function AdminAccessDenied() {
  const router = useRouter()
  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <EmptyState
        icon={<ShieldAlert className="w-5 h-5" />}
        title="You don't have admin access"
        description="This area is restricted to administrators. If you think this is a mistake, make sure you're signed in with an admin account."
        actions={
          <Button variant="primary" size="sm" onClick={() => router.push("/my-claws")}>
            Back to my Claws
          </Button>
        }
      />
    </div>
  )
}
