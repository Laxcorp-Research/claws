import { Loader2 } from "lucide-react";

export default function BuilderLoading() {
  return (
    <div className="flex flex-col h-screen bg-[var(--bg)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bd)]">
        <div className="h-5 w-[200px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded" />
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-7 w-[70px] bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer rounded-lg" />
          ))}
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center bg-[var(--bg2)]">
        <Loader2 className="w-6 h-6 text-[var(--tx3)] animate-spin" role="status" aria-label="Loading" />
      </div>
    </div>
  );
}
