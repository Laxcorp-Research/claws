"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"
import { User, Key, CreditCard, Lock, Store, Upload, Wrench, Shield, LogOut, type LucideIcon } from "lucide-react"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface NavItem {
  label: string
  href: string
  external?: boolean
}

const publicNavItems: NavItem[] = [
  { label: "Store", href: "/store" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "https://docs.buildclaws.ai", external: true },
]

const authNavItems: NavItem[] = [
  { label: "Store", href: "/store" },
  { label: "My Claws", href: "/my-claws" },
  { label: "Docs", href: "https://docs.buildclaws.ai", external: true },
]

export function TopBar() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!session) return
    let cancelled = false
    fetch("/api/admin/check")
      .then(res => res.json())
      .then(json => {
        if (!cancelled && json.data?.isAdmin) setIsAdmin(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session])

  const baseNavItems = session ? authNavItems : publicNavItems
  const navItems = isAdmin
    ? [...baseNavItems, { label: "Admin", href: "/admin/reviews" }]
    : baseNavItems

  function MenuLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
    return (
      <DropdownMenuItem asChild>
        <Link
          href={href}
          className="flex items-center gap-[8px] px-3 py-1.5 text-[12px] text-[var(--tx2)] cursor-pointer"
          onClick={() => setDropdownOpen(false)}
        >
          <Icon className="w-[14px] h-[14px] flex-shrink-0" />
          {label}
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <header className="flex items-center justify-between h-[52px] px-8 border-b border-[var(--bd)] bg-[var(--bg)]">
      <div className="flex items-center gap-8">
        <Link href="/store" className="flex items-center">
          <img src="/logo-full.svg" alt="Claws home" height={18} className="h-[18px] w-auto" />
        </Link>

        <nav aria-label="Main navigation" className="flex items-center gap-8">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + "/")
            const classes = cn(
              "text-[13px] font-medium transition-colors",
              isActive
                ? "text-[var(--tx)]"
                : "text-[var(--tx3)] hover:text-[var(--tx)]"
            )

            if (item.external) {
              return (
                <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={classes}>
                  {item.label}
                </a>
              )
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={classes}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {session ? (
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-7 h-7 rounded-full bg-[var(--tx)] text-white text-[11px] font-semibold flex items-center justify-center"
              aria-label="User menu"
            >
              {session.user?.name?.[0]?.toUpperCase() || session.user?.email?.[0]?.toUpperCase() || "U"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            sideOffset={6}
            collisionPadding={8}
            className="w-52 py-1"
            aria-label="User options"
          >
            <div className="px-3 py-2 border-b border-[var(--bd)]">
              <TruncateWithTooltip className="text-[12px] font-medium" as="p">{session.user?.name || "User"}</TruncateWithTooltip>
              <TruncateWithTooltip className="text-[10px] text-[var(--tx2)] mt-0.5" as="p">{session.user?.email || ""}</TruncateWithTooltip>
            </div>

            <div className="py-1">
              <MenuLink href="/settings?tab=account" icon={User} label="Account" />
              <MenuLink href="/settings?tab=api-keys" icon={Key} label="API Keys" />
              <MenuLink href="/settings?tab=billing" icon={CreditCard} label="Billing" />
              <MenuLink href="/settings?tab=security" icon={Lock} label="Security" />
            </div>

            <DropdownMenuSeparator />
            <div className="py-[2px]">
              <MenuLink href="/settings?tab=creator" icon={Store} label="Creator Dashboard" />
              <MenuLink href="/publish/template" icon={Upload} label="Publish Template" />
              <MenuLink href="/publish/skill" icon={Wrench} label="Publish Skill" />
            </div>

            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <div className="py-[2px]">
                  <MenuLink href="/admin/reviews" icon={Shield} label="Admin" />
                </div>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              danger
              onSelect={() => {
                void signOut()
              }}
              className="gap-[8px]"
            >
              <LogOut className="w-[14px] h-[14px] flex-shrink-0" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Link href="/auth/signin">
          <button type="button" className="text-[13px] font-medium px-4 py-1.5 rounded-lg bg-[var(--tx)] text-white hover:opacity-90 transition-colors">
            Sign in
          </button>
        </Link>
      )}
    </header>
  )
}
