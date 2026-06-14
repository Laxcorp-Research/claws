"use client"

import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"
import { PageShell } from "@/components/shared/page-shell"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { AdminAccessDenied } from "@/components/admin/admin-access-denied"

const adminLinks = [
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/versions", label: "Versions" },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // null = check still in flight. We never optimistically render children OR
  // the access-denied state until the check resolves (GH #127). A failed check
  // is treated as NOT admin — fail-closed for an admin surface.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/check")
      .then((res) => {
        if (!res.ok) throw new Error("admin check failed")
        return res.json()
      })
      .then((json) => {
        if (!cancelled) setIsAdmin(!!json.data?.isAdmin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PageShell>
      {isAdmin === null ? (
        <div className="max-w-5xl mx-auto px-4 py-4">
          <LoadingSkeleton variant="line" count={6} />
        </div>
      ) : !isAdmin ? (
        <AdminAccessDenied />
      ) : (
        <>
          <div className="border-b border-[var(--bd)]">
            <div className="max-w-5xl mx-auto px-4">
              <nav className="flex gap-0">
                {adminLinks.map((link) => {
                  const isActive = pathname === link.href
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`px-[14px] py-[6px] text-[12px] border-b-2 transition-colors ${
                        isActive
                          ? "text-[var(--tx)] border-[var(--tx)] font-medium"
                          : "text-[var(--tx2)] border-transparent hover:text-[var(--tx)]"
                      }`}
                    >
                      {link.label}
                    </Link>
                  )
                })}
              </nav>
            </div>
          </div>
          {children}
        </>
      )}
    </PageShell>
  )
}
