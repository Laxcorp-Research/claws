import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
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
      {icon && <div className="text-[32px] mb-2">{icon}</div>}
      <h3 className="text-base font-semibold text-[var(--tx)] mb-1.5">{title}</h3>
      <p className="text-[13px] mb-3.5">{description}</p>
      {actions && <div className="flex gap-1.5 justify-center">{actions}</div>}
    </div>
  );
}
