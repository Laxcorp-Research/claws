import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

export default function SettingsLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-4">
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-[80px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
        ))}
      </div>
      <div className="space-y-3">
        <LoadingSkeleton variant="short" />
        <LoadingSkeleton variant="line" count={4} />
      </div>
    </div>
  );
}
