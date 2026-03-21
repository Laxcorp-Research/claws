import { cn } from "@/lib/utils";

interface StatusDotProps {
  status: "connected" | "disconnected" | "error" | "connecting";
}

const dotClasses = {
  connected: "bg-[var(--ok)]",
  disconnected: "border-2 border-[var(--bd)] bg-transparent",
  error: "bg-[var(--err)]",
  connecting: "border-2 border-[var(--ac)] border-t-transparent animate-spin",
} as const;

export function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className={cn("w-[9px] h-[9px] rounded-full flex-shrink-0 inline-block", dotClasses[status])}
      aria-hidden="true"
    />
  );
}
