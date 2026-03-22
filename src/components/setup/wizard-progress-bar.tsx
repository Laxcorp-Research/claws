"use client"

import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

interface WizardStep {
  label: string
  status: "complete" | "current" | "upcoming"
}

interface WizardProgressBarProps {
  steps: WizardStep[]
}

export function WizardProgressBar({ steps }: WizardProgressBarProps) {
  return (
    <div className="flex items-center justify-center mb-5 flex-wrap">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div
            className={cn(
              "w-[26px] h-[26px] rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
              step.status === "complete" && "bg-[var(--ok)] text-white",
              step.status === "current" && "bg-[var(--tx)] text-white",
              step.status === "upcoming" && "border border-[var(--bd)] text-[var(--tx3)]"
            )}
          >
            {step.status === "complete" ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : i + 1}
          </div>
          <span
            className={cn(
              "text-[10px] ml-1 mr-2",
              step.status === "current" ? "text-[var(--tx)] font-medium" : "text-[var(--tx3)]"
            )}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "w-[30px] h-px mx-[3px]",
                step.status === "complete" ? "bg-[var(--ok)]" : "bg-[var(--bd)]"
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}
