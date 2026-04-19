import { cn } from "@/lib/utils";

export type StatusDotStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "connecting"
  // `expired` is visually identical to `error` (same red fill) but kept as
  // a distinct variant so OAUTH_COMPOSIO ToolConnection.status=EXPIRED or
  // REVOKED flows through the rendering pipeline with its semantic name
  // intact (rather than collapsing into a generic error at the render
  // boundary). See PR #4 Commit 6 + docs/COMPOSIO_RUNTIME_CONTRACT.md
  // for the end-to-end un-collapse rationale.
  | "expired";

interface StatusDotProps {
  status: StatusDotStatus;
  /**
   * Override the default a11y label. Default is `aria-hidden="true"` (the
   * dot is decorative when adjacent to a text label, as in ToolRow). Pass
   * a non-empty label to switch to role="img" with that label, for
   * standalone use where no adjacent text conveys the status.
   */
  ariaLabel?: string;
}

const dotClasses = {
  connected: "bg-[var(--ok)]",
  disconnected: "border-2 border-[var(--bd)] bg-transparent",
  error: "bg-[var(--err)]",
  connecting: "border-2 border-[var(--ac)] border-t-transparent animate-spin",
  expired: "bg-[var(--err)]",
} as const;

export function StatusDot({ status, ariaLabel }: StatusDotProps) {
  const a11y = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": "true" as const };
  return (
    <span
      className={cn("w-[9px] h-[9px] rounded-full flex-shrink-0 inline-block", dotClasses[status])}
      {...a11y}
    />
  );
}
