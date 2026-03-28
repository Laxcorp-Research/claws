"use client"

import { Star } from "lucide-react"

interface ReviewCardProps {
  review: {
    userName: string
    rating: number
    title?: string | null
    body?: string | null
    verifiedInstall: boolean
    createdAt: string
  }
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 5) return `${diffWeeks}w ago`
  return `${diffMonths}mo ago`
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-[1px] mt-[2px]" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={12}
          fill={i <= rating ? "#FFDC6E" : "transparent"}
          stroke={i <= rating ? "#FFDC6E" : "var(--bd)"}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

export function ReviewCard({ review }: ReviewCardProps) {
  return (
    <div className="py-3 border-b border-[var(--bd)] last:border-b-0">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-[6px]">
          <span className="text-[12px] font-semibold text-[var(--tx)]">
            {review.userName}
          </span>
          {review.verifiedInstall && (
            <span className="text-[10px] text-[var(--ok)]">Verified install</span>
          )}
        </div>
        <span className="text-[10px] text-[var(--tx3)]">
          {formatRelativeTime(review.createdAt)}
        </span>
      </div>

      <StarRating rating={review.rating} />

      {review.title && (
        <p className="text-[13px] font-semibold text-[var(--tx)] mt-[6px]">
          {review.title}
        </p>
      )}

      {review.body && (
        <p className="text-[12px] text-[var(--tx2)] leading-[1.5] mt-1">
          {review.body}
        </p>
      )}
    </div>
  )
}
