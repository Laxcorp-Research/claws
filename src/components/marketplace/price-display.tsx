"use client"

interface PriceDisplayProps {
  price: number | null
  isFree?: boolean
  showPlatformFee?: boolean
}

export function PriceDisplay({ price, isFree, showPlatformFee = true }: PriceDisplayProps) {
  if (isFree || price === null || price === 0) {
    return (
      <div>
        <div className="text-[18px] font-bold text-[var(--ok)]">Free</div>
        {showPlatformFee && (
          <p className="text-[11px] text-[var(--tx3)] mt-1">+ $79/mo to run</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="text-[26px] font-bold text-[var(--tx)]">${price}</div>
      <p className="text-[11px] text-[var(--tx2)] mt-[2px]">one-time</p>
      {showPlatformFee && (
        <p className="text-[11px] text-[var(--tx3)] mt-1">+ $79/mo to run</p>
      )}
    </div>
  )
}
