"use client"

import { useState } from "react"
import { Star } from "lucide-react"

interface ReviewStarsProps {
  value: number
  onChange: (rating: number) => void
}

export function ReviewStars({ value, onChange }: ReviewStarsProps) {
  const [hovered, setHovered] = useState(0)

  return (
    <div
      className="flex gap-[2px]"
      role="radiogroup"
      aria-label="Rating"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= (hovered || value)
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            onMouseEnter={() => setHovered(i)}
            className="p-0 border-0 bg-transparent cursor-pointer"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
          >
            <Star
              size={20}
              fill={filled ? "#FFDC6E" : "transparent"}
              stroke={filled ? "#FFDC6E" : "var(--bd)"}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </div>
  )
}
