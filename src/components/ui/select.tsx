import { cn } from "@/lib/utils";
import { SelectHTMLAttributes, forwardRef } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  variant?: "default" | "compact";
}

const variantClasses = {
  default: "py-2 px-2.5 rounded-[6px] text-xs w-full",
  compact: "py-[5px] px-2 rounded-[6px] text-[10px]",
} as const;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ variant = "default", className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)] cursor-pointer transition-colors",
          variantClasses[variant],
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";
