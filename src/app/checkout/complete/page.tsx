"use client"

import { useEffect } from "react"

export default function CheckoutCompletePage() {
  useEffect(() => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "dodo-checkout-complete" }, window.location.origin)
      }
    } catch {
      // cross-origin or opener unavailable
    }
    window.close()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <p className="text-[13px] text-[var(--tx2)]">Payment complete. You can close this tab.</p>
    </div>
  )
}
