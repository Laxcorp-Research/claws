import { cn } from "@/lib/utils";

export type AgentRole = "ORCHESTRATOR" | "WORKER" | "CRITIC";

interface AgentPillProps {
  name: string;
  color: string;
  role?: AgentRole;
}

export function AgentPill({ name, color, role }: AgentPillProps) {
  return (
    <span
      className={cn(
        "text-[10px] py-[3px] px-2.5 rounded-[16px] border border-[var(--bd)] text-[var(--tx2)] bg-[var(--bg2)] inline-flex items-center gap-1",
        role === "CRITIC" && "border-[#8b5cf6] text-[#5b21b6]"
      )}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {name}
    </span>
  );
}
