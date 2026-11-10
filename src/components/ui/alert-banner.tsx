import { cn } from "@/lib/utils";
import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";

interface AlertBannerProps {
  variant: "error" | "warning" | "info";
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  id?: string;
}

const variantClasses = {
  error: "bg-[var(--errbg)] border-[var(--err)] text-[#991b1b]",
  warning: "bg-[var(--warnbg)] border-[var(--warn)] text-[#92400e]",
  info: "bg-[var(--acbg)] border-[var(--ac)] text-[var(--ac-text)]",
} as const;

const iconColors = {
  error: "text-[var(--err)]",
  warning: "text-[var(--warn)]",
  info: "text-[var(--ac-text)]",
} as const;

const defaultIcons: Record<string, ReactNode> = {
  error: <AlertTriangle className="w-4 h-4" />,
  warning: <AlertTriangle className="w-4 h-4" />,
  info: <Info className="w-4 h-4" />,
};

export function AlertBanner({ variant, icon, children, actions, id }: AlertBannerProps) {
  const resolvedIcon = icon ?? defaultIcons[variant];

  return (
    <div
      id={id}
      className={cn("rounded-lg py-3 px-3.5 mb-3.5 flex items-start gap-[10px] border", variantClasses[variant])}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      {resolvedIcon && (
        <span className={cn("flex-shrink-0 leading-none mt-[2px]", iconColors[variant])} aria-hidden="true">
          {resolvedIcon}
        </span>
      )}
      <div className="text-xs flex-1 min-w-0">
        {children}
      </div>
      {actions && <div className="flex gap-1.5 flex-shrink-0">{actions}</div>}
    </div>
  );
}
