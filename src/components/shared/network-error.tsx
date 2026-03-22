import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NetworkErrorProps {
  message?: string;
  onRetry?: () => void;
}

export function NetworkError({
  message = "Something went wrong. Please check your connection and try again.",
  onRetry,
}: NetworkErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <WifiOff className="w-10 h-10 text-[var(--tx3)] mb-3" aria-hidden="true" />
      <h3 className="text-[15px] font-semibold text-[var(--tx)] mb-1">Unable to load</h3>
      <p className="text-[12px] text-[var(--tx2)] text-center max-w-[300px] mb-3.5">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
