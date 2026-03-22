import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

export default function MyClawsLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <div className="flex justify-between items-center mb-4">
        <div className="h-6 w-[120px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
        <div className="flex gap-1.5">
          <div className="h-8 w-[100px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
          <div className="h-8 w-[140px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
      </div>
    </div>
  );
}
