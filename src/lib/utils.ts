import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type BadgeStatus = "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped" | "hibernated" | "waking";

const STATUS_MAP: Record<string, BadgeStatus> = {
  RUNNING: "running",
  PAUSED: "paused",
  ERROR: "error",
  DRAFT: "draft",
  SETUP_INCOMPLETE: "setup",
  DEPLOYING: "deploying",
  STOPPED: "stopped",
  HIBERNATED: "hibernated",
  WAKING: "waking",
};

export function mapWorkspaceStatus(dbStatus: string): BadgeStatus {
  return STATUS_MAP[dbStatus] ?? "draft";
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
