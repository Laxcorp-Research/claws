"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { PageShell } from "@/components/shared/page-shell"

const adminLinks = [
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/versions", label: "Versions" },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <PageShell>
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
    </PageShell>
  )
}
