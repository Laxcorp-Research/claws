import { cn } from "@/lib/utils";

interface LoadingSkeletonProps {
  variant: "card" | "line" | "short";
  count?: number;
}

const variantClasses = {
  card: "h-[100px] rounded-xl mb-2.5",
  line: "h-3.5 rounded-lg mb-2 w-[80%]",
  short: "h-3.5 rounded-lg mb-2 w-[40%]",
} as const;

export function LoadingSkeleton({ variant, count = 1 }: LoadingSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn(
            "bg-gradient-to-r from-[var(--bg3)] via-[var(--bd)] to-[var(--bg3)] bg-[length:200%_100%] animate-shimmer",
            variantClasses[variant]
          )}
        />
      ))}
    </>
  );
}
