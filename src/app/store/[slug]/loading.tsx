import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

export default function StoreDetailLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <div className="h-4 w-[100px] mb-3 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
      <div className="flex justify-between items-start mb-3.5">
        <div className="flex-1">
          <div className="h-5 w-[80px] mb-2 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded" />
          <div className="h-7 w-[260px] mb-2 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
          <div className="h-4 w-[400px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded" />
        </div>
        <div className="text-right ml-6">
          <div className="h-8 w-[90px] ml-auto mb-1 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
          <div className="h-10 w-[140px] ml-auto mt-3 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
        </div>
      </div>
      <LoadingSkeleton variant="card" />
      <div className="grid grid-cols-2 gap-2.5 mt-2.5">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
      </div>
    </div>
  );
}
