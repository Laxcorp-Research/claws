/**
 * Human-owned live-write allowlist. shared/** text only.
 * Never dotfiles, never .., never host-absolute, never openclaw.json/.env/cron.
 * Sidecars use `<name>.status.json` (no leading-dot segment).
 * Must stay in sync with container/claws-activity-reporter/workspace-files.mjs
 */
export const WORKSPACE_FILE_PREFIX = "shared/"
export const WORKSPACE_FILE_MAX_BYTES = 256 * 1024
export const WORKSPACE_FILE_TEXT_EXT = [".md", ".txt", ".json"] as const

const EXT_SET = new Set<string>(WORKSPACE_FILE_TEXT_EXT)
const BANNED_SEGMENTS = new Set(["openclaw.json", ".env", "cron"])

export function isSharedWritePath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false
  if (relativePath.includes("\0")) return false
  const normalized = relativePath.replace(/\\/g, "/")
  if (normalized.startsWith("/") || normalized.includes("://")) return false
  const parts = normalized.split("/")
  if (parts.some((p) => p === ".." || p === "." || p === "" || p.startsWith("."))) {
    return false
  }
  if (
    parts.some(
      (p) => BANNED_SEGMENTS.has(p.toLowerCase()) || p.toLowerCase().startsWith(".env"),
    )
  ) {
    return false
  }
  if (!normalized.startsWith(WORKSPACE_FILE_PREFIX)) return false
  if (normalized === WORKSPACE_FILE_PREFIX.slice(0, -1)) return false
  const base = parts[parts.length - 1] ?? ""
  const dot = base.lastIndexOf(".")
  if (dot < 1) return false
  return EXT_SET.has(base.slice(dot).toLowerCase())
}
