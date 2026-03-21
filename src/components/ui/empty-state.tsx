import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
  bordered?: boolean;
}

export function EmptyState({ icon, title, description, actions, bordered }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "text-center py-10 px-5 text-[var(--tx2)]",
        bordered && "border border-dashed border-[var(--bd)] rounded-xl py-5"
      )}
    >
      {icon && (
        <div className="flex items-center justify-center w-10 h-10 text-[var(--tx3)] mx-auto mb-3">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[var(--tx)] mb-1.5">{title}</h3>
      <p className="text-[13px] mb-3.5">{description}</p>
      {actions && <div className="flex gap-1.5 justify-center">{actions}</div>}
    </div>
  );
}
