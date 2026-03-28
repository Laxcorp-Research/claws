"use client"

import { useState, useEffect } from "react"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { Check } from "lucide-react"

interface OAuthProvider {
  provider: string
  connectedAt: string
}

interface SecurityData {
  providers: OAuthProvider[]
  sessions: Array<{ id: string; lastActive: string; isCurrent: boolean }>
}

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "github") {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
      </svg>
    )
  }
  if (provider === "google") {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    )
  }
  return (
    <div className="w-4 h-4 rounded-full bg-[var(--bg2)] flex items-center justify-center text-[8px] font-bold text-[var(--tx2)]">
      {provider[0]?.toUpperCase() ?? "?"}
    </div>
  )
}

function providerLabel(provider: string): string {
  if (provider === "github") return "GitHub"
  if (provider === "google") return "Google"
  if (provider === "email") return "Email (magic link)"
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

export function SecuritySettings() {
  const [data, setData] = useState<SecurityData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/user/security")
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div>
        <div className="h-4 bg-[var(--bg2)] rounded w-40 mb-2" />
        <LoadingSkeleton variant="card" count={1} />
      </div>
    )
  }

  if (!data) return null

  return (
    <div>
      <h2 className="text-[14px] font-semibold mb-[2px]">Security</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-[12px]">Manage your sign-in methods and security settings.</p>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-[14px]">
        <h3 className="text-[13px] font-semibold mb-[8px]">Sign-in methods</h3>
        {data.providers.length === 0 ? (
          <p className="text-[11px] text-[var(--tx3)]">No connected providers. You may be signed in via email magic link.</p>
        ) : (
          data.providers.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-[6px] border-b border-[var(--bd)] last:border-0"
            >
              <div className="flex items-center gap-[8px]">
                <ProviderIcon provider={p.provider} />
                <div>
                  <p className="text-[12px] font-semibold">{providerLabel(p.provider)}</p>
                  <p className="text-[10px] text-[var(--tx2)]">Connected</p>
                </div>
              </div>
              <span className="text-[10px] text-[var(--ok)] inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> Connected</span>
            </div>
          ))
        )}
      </div>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-[14px]">
        <h3 className="text-[13px] font-semibold mb-[8px]">Active sessions</h3>
        <p className="text-[11px] text-[var(--tx2)] mb-[8px]">Your current active sessions across devices.</p>
        {/* TODO: List all sessions from Session model when multi-device tracking is implemented */}
        <div className="flex items-center justify-between py-[6px]">
          <div className="flex items-center gap-[8px]">
            <div className="w-[8px] h-[8px] rounded-full bg-[var(--ok)]" />
            <div>
              <p className="text-[12px] font-semibold">Current session</p>
              <p className="text-[10px] text-[var(--tx2)]">This device · Active now</p>
            </div>
          </div>
          <span className="text-[10px] text-[var(--ok)]">Active</span>
        </div>
      </div>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px] opacity-60">
        <h3 className="text-[13px] font-semibold mb-[4px]">Coming soon</h3>
        <ul className="text-[11px] text-[var(--tx2)] space-y-[4px]">
          <li>Two-factor authentication (2FA)</li>
          <li>Download my data (GDPR export)</li>
          <li>API access tokens</li>
        </ul>
      </div>
    </div>
  )
}
