import { cn } from "@/lib/utils";
import { TextareaHTMLAttributes, forwardRef } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
}

const variantClasses = {
  default: "py-2 px-2.5 rounded-[6px] text-xs w-full",
  compact: "py-[5px] px-2 rounded-[6px] text-[10px] font-mono h-[58px]",
} as const;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ variant = "default", className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] placeholder:text-[var(--tx3)] focus:outline-none focus:border-[var(--tx)] resize-none transition-colors",
          variantClasses[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
