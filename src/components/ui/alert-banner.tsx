import { cn } from "@/lib/utils";

interface AlertBannerProps {
  variant: "error" | "warning" | "info";
  icon?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

const variantClasses = {
  error: "bg-[var(--errbg)] border-[var(--err)] text-[#991b1b]",
  warning: "bg-[var(--warnbg)] border-[var(--warn)] text-[#92400e]",
  info: "bg-[var(--acbg)] border-[var(--ac)] text-[var(--ac)]",
} as const;

const iconColors = {
  error: "text-[var(--err)]",
  warning: "text-[var(--warn)]",
  info: "text-[var(--ac)]",
} as const;

export function AlertBanner({ variant, icon, children, actions }: AlertBannerProps) {
  return (
    <div
      className={cn("rounded-lg py-3 px-3.5 mb-3.5 flex items-center justify-center border", variantClasses[variant])}
      role="alert"
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      <div className="inline-flex items-center gap-2">
        {icon && <span className={cn("text-base flex-shrink-0 leading-none", iconColors[variant])} aria-hidden="true">{icon}</span>}
        <div className="text-xs">
          {children}
          {actions && <div className="flex gap-1.5 mt-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
