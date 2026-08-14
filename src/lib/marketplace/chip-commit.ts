/**
 * Commit pending chip-input draft into the token list.
 * Used so typed-but-not-Added bins/env/tags are not dropped on blur/Next.
 */
export function commitChipDraft(
  draft: string,
  items: string[],
  max: number,
  isValid: (token: string) => boolean = () => true,
): { items: string[]; draft: string } {
  const t = draft.trim()
  if (!t) return { items, draft: "" }
  if (items.includes(t)) return { items, draft: "" }
  if (items.length >= max || !isValid(t)) return { items, draft }
  return { items: [...items, t], draft: "" }
}

export function isEnvChipToken(token: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(token)
}
