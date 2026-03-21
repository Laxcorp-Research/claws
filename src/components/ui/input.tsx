import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "search" | "compact" | "auth";
  error?: boolean;
}

const variantClasses = {
  default: "py-2 px-2.5 rounded-[6px] text-xs w-full",
  search: "py-2 px-3.5 rounded-lg text-xs",
  compact: "py-[5px] px-2 rounded-[6px] text-[11px]",
  auth: "py-2.5 px-3 rounded-lg text-[13px] mb-2 w-full",
} as const;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = "default", error, className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] placeholder:text-[var(--tx3)] focus:outline-none focus:border-[var(--tx)] transition-colors",
          variantClasses[variant],
          error && "border-[var(--err)]",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
