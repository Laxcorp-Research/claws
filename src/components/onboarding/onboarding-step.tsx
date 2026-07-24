import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { ReactNode } from "react"

interface OnboardingStepProps {
  number: number
  title: string
  description: string
  actions?: ReactNode
  completed?: boolean
  disabled?: boolean
  /** Brief DS emphasis (ring) — used when step 3 needs step 2 attention. */
  emphasized?: boolean
  children?: ReactNode
}

export function OnboardingStep({
  number,
  title,
  description,
  actions,
  completed,
  disabled,
  emphasized,
  children,
}: OnboardingStepProps) {
  return (
    <div
      data-emphasized={emphasized ? "true" : undefined}
      className={cn(
        "border border-[var(--bd)] rounded-xl p-4 text-left transition-[box-shadow,border-color] duration-300",
        disabled && "opacity-50",
        emphasized && "border-[var(--ac)] ring-2 ring-[var(--ac)]/30",
      )}
    >
      <div className="flex gap-2.5 items-center mb-2">
        <div
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0",
            completed
              ? "bg-[var(--ok)] text-white"
              : disabled
                ? "border border-[var(--bd)] text-[var(--tx3)]"
                : "bg-[var(--tx)] text-white",
          )}
        >
          {completed ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : number}
        </div>
        <div>
          <h3 className={cn("text-sm font-semibold", disabled && "text-[var(--tx3)]")}>{title}</h3>
          <p className={cn("text-[11px]", disabled ? "text-[var(--tx3)]" : "text-[var(--tx2)]")}>
            {description}
          </p>
        </div>
      </div>
      {actions && !disabled && (
        <div className="flex flex-wrap gap-1.5 mt-2 ml-[38px] items-center">{actions}</div>
      )}
      {children && !disabled && <div className="mt-2 ml-[38px]">{children}</div>}
    </div>
  )
}
