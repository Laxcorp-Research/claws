import { cn } from "@/lib/utils";
import { Circle, Pause, AlertTriangle, Settings, Square, Moon, Clock } from "lucide-react";
import type { ReactNode } from "react";

interface StatusBadgeProps {
  status: "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped" | "hibernated" | "waking" | "queued";
}

const ICON_CLASS = "w-2.5 h-2.5 shrink-0";

const config: Record<StatusBadgeProps["status"], { bg: string; text: string; icon: ReactNode; label: string }> = {
  running:    { bg: "bg-[#dcfce7]", text: "text-[#10b981]", icon: <Circle className={cn(ICON_CLASS, "fill-current")} />, label: "Running" },
  paused:     { bg: "bg-[var(--warnbg)]", text: "text-[var(--warn)]", icon: <Pause className={ICON_CLASS} />, label: "Paused" },
  error:      { bg: "bg-[#fee2e2]", text: "text-[#ef4444]", icon: <AlertTriangle className={ICON_CLASS} />, label: "Error" },
  draft:      { bg: "bg-[var(--bg3)]", text: "text-[var(--tx3)]", icon: <Circle className={ICON_CLASS} />, label: "Draft" },
  setup:      { bg: "bg-[var(--acbg)]", text: "text-[var(--ac-text)]", icon: <Settings className={ICON_CLASS} />, label: "Setup" },
  deploying:  { bg: "bg-[var(--acbg)]", text: "text-[var(--ac-text)]", icon: "spinner" as unknown as ReactNode, label: "Deploying" },
  stopped:    { bg: "bg-[#fee2e2]", text: "text-[#ef4444]", icon: <Square className={ICON_CLASS} />, label: "Stopped" },
  hibernated: { bg: "bg-[var(--bg3)]", text: "text-[var(--tx3)]", icon: <Moon className={ICON_CLASS} />, label: "Sleeping" },
  waking:     { bg: "bg-[var(--acbg)]", text: "text-[var(--ac-text)]", icon: "spinner" as unknown as ReactNode, label: "Waking..." },
  queued:     { bg: "bg-[var(--acbg)]", text: "text-[var(--ac-text)]", icon: <Clock className={ICON_CLASS} />, label: "Queued" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const c = config[status];
  return (
    <span
      className={cn("text-[10px] py-[2px] px-2 rounded-xl font-medium inline-flex items-center gap-1", c.bg, c.text)}
      role="status"
    >
      {(status === "deploying" || status === "waking") ? (
        <span className="w-2.5 h-2.5 border-[1.5px] border-current border-t-transparent rounded-full animate-spin flex-shrink-0" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="flex items-center">{c.icon}</span>
      )}
      <span>{c.label}</span>
    </span>
  );
}
