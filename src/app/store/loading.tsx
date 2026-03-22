import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

export default function StoreLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <div className="text-center pt-5 pb-4">
        <div className="h-6 w-[300px] mx-auto mb-2 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
        <div className="h-4 w-[420px] mx-auto mb-3 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
        <div className="h-9 w-[280px] mx-auto mb-2.5 bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-[8px]" />
        <div className="flex gap-1.5 justify-center">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 w-[80px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-[8px]" />
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        <LoadingSkeleton variant="card" count={4} />
      </div>
    </div>
  );
}
