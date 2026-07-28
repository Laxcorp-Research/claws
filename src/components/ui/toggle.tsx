import { cn } from "@/lib/utils"
import { ButtonHTMLAttributes, forwardRef } from "react"

interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * Minimal on/off pill switch. No dedicated spec exists in DESIGN_SYSTEM.md
 * (Section 2 has no Toggle entry) — sized/colored to match the rest of the
 * settings surface (Button/Badge use var(--tx)/var(--bd)/var(--bg2)).
 */
export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ checked, onCheckedChange, disabled, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border-none transition-colors cursor-pointer",
          checked ? "bg-[var(--tx)]" : "bg-[var(--bg2)]",
          disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "inline-block h-[14px] w-[14px] rounded-full bg-white transition-transform",
            checked ? "translate-x-[16px]" : "translate-x-[2px]",
          )}
        />
      </button>
    )
  },
)
Toggle.displayName = "Toggle"
