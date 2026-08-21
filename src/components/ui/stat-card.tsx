import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  // PR-4: "warn" (amber) added for DEGRADED - distinct from "down" (red/error)
  // and "up" (green/ok). DEGRADED is "alive but partially broken", which must
  // not read the same as a hard failure.
  trendType?: "up" | "down" | "warn";
  alert?: boolean;
}

const trendColor: Record<NonNullable<StatCardProps["trendType"]>, string> = {
  up: "text-[var(--ok)]",
  down: "text-[var(--err)]",
  warn: "text-[var(--warn)]",
};

export function StatCard({ label, value, trend, trendType, alert }: StatCardProps) {
  return (
    <div className="bg-[var(--bg2)] rounded-lg p-3">
      <div className="text-[10px] text-[var(--tx2)]">{label}</div>
      <div className={cn("text-lg font-semibold mt-0.5", alert && "text-[var(--warn)]")}>
        {value}
      </div>
      {trend && (
        <div className={cn("text-[10px] mt-[1px]", trendColor[trendType ?? "up"])}>
          {trend}
        </div>
      )}
    </div>
  );
}
