/** Display-name helpers. Closed pickers must never render a raw model slug. */

export function looksLikeModelSlug(text: string): boolean {
  return text.includes("/")
}

/**
 * Last path segment → title case. `anthropic/claude-sonnet-4-6` → "Claude Sonnet 4.6".
 * Never returns a string containing `/`.
 */
export function humanizeModelId(modelId: string): string {
  const trimmed = modelId.trim()
  if (!trimmed) return "Unknown model"
  const parts = trimmed.split("/").filter(Boolean)
  const slug = parts[parts.length - 1] ?? trimmed
  const spaced = slug.replace(/(\d)-(\d)(?!\d)/g, "$1.$2").replace(/[_-]+/g, " ").trim()
  if (!spaced) return "Unknown model"
  return spaced
    .split(/\s+/)
    .map((word) => {
      if (/^\d/.test(word)) return word
      if (/^gpt$/i.test(word)) return "GPT"
      const lower = word.toLowerCase()
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(" ")
}

/** Prefer a human catalog name; fall back when missing, blank, or itself a slug. */
export function resolveCatalogDisplayName(
  modelId: string,
  displayName: string | null | undefined,
): string {
  const name = displayName?.trim() ?? ""
  if (!name || looksLikeModelSlug(name) || name === modelId) {
    return humanizeModelId(modelId)
  }
  return name
}
