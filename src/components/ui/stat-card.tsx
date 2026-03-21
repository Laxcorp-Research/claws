import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendType?: "up" | "down";
  alert?: boolean;
}

export function StatCard({ label, value, trend, trendType, alert }: StatCardProps) {
  return (
    <div className="bg-[var(--bg2)] rounded-lg p-3">
      <div className="text-[10px] text-[var(--tx2)]">{label}</div>
      <div className={cn("text-lg font-semibold mt-0.5", alert && "text-[var(--warn)]")}>
        {value}
      </div>
      {trend && (
        <div className={cn("text-[10px] mt-[1px]", trendType === "down" ? "text-[var(--err)]" : "text-[var(--ok)]")}>
          {trend}
        </div>
      )}
    </div>
  );
}
