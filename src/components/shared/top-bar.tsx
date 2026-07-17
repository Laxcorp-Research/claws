"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import { useState, useRef, useEffect, useCallback } from "react"
import { User, Key, CreditCard, Lock, Store, Upload, Wrench, Shield, LogOut, type LucideIcon } from "lucide-react"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"

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
  const dropdownRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<HTMLElement[]>([])

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

  const closeDropdown = useCallback(() => setDropdownOpen(false), [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [closeDropdown])

  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      closeDropdown()
      return
    }

    const items = menuItemsRef.current.filter(Boolean)
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)

    if (e.key === "ArrowDown") {
      e.preventDefault()
      const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
      items[next]?.focus()
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
      items[prev]?.focus()
    }
  }

  let menuIdx = 0
  const nextMenuRef = () => {
    const idx = menuIdx++
    return (el: HTMLAnchorElement | HTMLButtonElement | null) => {
      if (el) menuItemsRef.current[idx] = el
    }
  }

  function DropdownLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
    return (
      <Link
        ref={nextMenuRef()}
        href={href}
        role="menuitem"
        className="flex items-center gap-[8px] px-3 py-1.5 text-[12px] text-[var(--tx2)] hover:bg-[var(--bg2)] transition-colors"
        onClick={closeDropdown}
      >
        <Icon className="w-[14px] h-[14px] flex-shrink-0" />
        {label}
      </Link>
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
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => { setDropdownOpen(!dropdownOpen); menuIdx = 0 }}
            className="w-7 h-7 rounded-full bg-[var(--tx)] text-white text-[11px] font-semibold flex items-center justify-center"
            aria-label="User menu"
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
          >
            {session.user?.name?.[0]?.toUpperCase() || session.user?.email?.[0]?.toUpperCase() || "U"}
          </button>
          {dropdownOpen && (
            <div
              className="absolute right-0 top-full mt-1.5 w-52 bg-[var(--bg)] border border-[var(--bd)] rounded-lg shadow-modal py-1 z-50"
              role="menu"
              aria-label="User options"
              onKeyDown={handleDropdownKeyDown}
            >
              <div className="px-3 py-2 border-b border-[var(--bd)]">
                <TruncateWithTooltip className="text-[12px] font-medium" as="p">{session.user?.name || "User"}</TruncateWithTooltip>
                <TruncateWithTooltip className="text-[10px] text-[var(--tx2)] mt-0.5" as="p">{session.user?.email || ""}</TruncateWithTooltip>
              </div>

              <div className="py-1">
                <DropdownLink href="/settings?tab=account" icon={User} label="Account" />
                <DropdownLink href="/settings?tab=api-keys" icon={Key} label="API Keys" />
                <DropdownLink href="/settings?tab=billing" icon={CreditCard} label="Billing" />
                <DropdownLink href="/settings?tab=security" icon={Lock} label="Security" />
              </div>

              <div className="border-t border-[var(--bd)] my-[4px]" />
              <div className="py-[2px]">
                <DropdownLink href="/settings?tab=creator" icon={Store} label="Creator Dashboard" />
                <DropdownLink href="/publish/template" icon={Upload} label="Publish Template" />
                <DropdownLink href="/publish/skill" icon={Wrench} label="Publish Skill" />
              </div>

              {isAdmin && (
                <>
                  <div className="border-t border-[var(--bd)] my-[4px]" />
                  <div className="py-[2px]">
                    <DropdownLink href="/admin/reviews" icon={Shield} label="Admin" />
                  </div>
                </>
              )}

              <div className="border-t border-[var(--bd)] pt-1">
                <button
                  ref={nextMenuRef()}
                  onClick={() => signOut()}
                  role="menuitem"
                  className="w-full text-left flex items-center gap-[8px] px-3 py-1.5 text-[12px] text-[var(--err)] hover:bg-[var(--bg2)] transition-colors"
                >
                  <LogOut className="w-[14px] h-[14px] flex-shrink-0" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Link href="/auth/signin">
          <button className="text-[13px] font-medium px-4 py-1.5 rounded-lg bg-[var(--tx)] text-white hover:opacity-90 transition-colors">
            Sign in
          </button>
        </Link>
      )}
    </header>
  )
}
