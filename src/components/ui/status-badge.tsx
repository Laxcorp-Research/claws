import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped";
}

const config = {
  running:   { bg: "bg-[#dcfce7]", text: "text-[#10b981]", icon: "●",       label: "Running" },
  paused:    { bg: "bg-[var(--warnbg)]", text: "text-[var(--warn)]", icon: "⏸",       label: "Paused" },
  error:     { bg: "bg-[#fee2e2]", text: "text-[#ef4444]", icon: "⚠",       label: "Error" },
  draft:     { bg: "bg-[var(--bg3)]", text: "text-[var(--tx3)]", icon: "○",       label: "Draft" },
  setup:     { bg: "bg-[var(--acbg)]", text: "text-[var(--ac)]", icon: "◐",       label: "Setup" },
  deploying: { bg: "bg-[var(--acbg)]", text: "text-[var(--ac)]", icon: "spinner", label: "Deploying" },
  stopped:   { bg: "bg-[#fee2e2]", text: "text-[#ef4444]", icon: "⏹",       label: "Stopped" },
} as const;

export function StatusBadge({ status }: StatusBadgeProps) {
  const c = config[status];
  return (
    <span
      className={cn("text-[10px] py-[2px] px-2 rounded-xl font-medium inline-flex items-center gap-1", c.bg, c.text)}
      role="status"
    >
      {c.icon === "spinner" ? (
        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{c.icon}</span>
      )}
      <span>{c.label}</span>
    </span>
  );
}
