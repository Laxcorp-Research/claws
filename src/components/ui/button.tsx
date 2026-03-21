import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "danger" | "ghost";
  size?: "default" | "sm" | "xs" | "lg" | "full";
  loading?: boolean;
}

const variantClasses = {
  primary: "bg-[var(--tx)] text-white hover:bg-[var(--tx)]/90",
  outline: "bg-transparent border border-[var(--bd)] text-[var(--tx2)] hover:bg-[var(--bg2)]",
  danger: "bg-[var(--err)] text-white hover:brightness-110",
  ghost: "bg-transparent text-[var(--tx2)] hover:bg-[var(--bg2)]",
} as const;

const sizeClasses = {
  default: "text-[11px] py-[5px] px-3.5 rounded-lg",
  sm: "text-[10px] py-[3px] px-2.5 rounded-lg",
  xs: "text-[9px] py-[2px] px-1.5 rounded-md",
  lg: "text-[13px] py-2.5 px-6 rounded-lg",
  full: "text-[13px] py-2.5 px-6 rounded-lg w-full",
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "default", loading, disabled, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors border-none cursor-pointer",
          variantClasses[variant],
          sizeClasses[size],
          (disabled || loading) && "opacity-50 cursor-not-allowed",
          loading && "pointer-events-none",
          className
        )}
        {...props}
      >
        {loading && (
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5 flex-shrink-0" />
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
