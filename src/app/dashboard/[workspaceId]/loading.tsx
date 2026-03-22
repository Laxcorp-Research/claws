import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

export default function DashboardLoading() {
  return (
    <div className="max-w-5xl mx-auto px-5 py-6">
      <div className="h-6 w-48 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg mb-4" />
      <div className="grid grid-cols-4 gap-2 mb-3.5">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
      </div>
      <div className="grid grid-cols-[1fr_300px] gap-3.5">
        <div className="border border-[var(--bd)] rounded-lg p-3 space-y-2">
          <LoadingSkeleton variant="short" />
          <LoadingSkeleton variant="line" count={5} />
        </div>
        <div className="border border-[var(--bd)] rounded-xl p-3.5 space-y-2">
          <LoadingSkeleton variant="short" />
          <LoadingSkeleton variant="line" count={4} />
        </div>
      </div>
    </div>
  );
}
