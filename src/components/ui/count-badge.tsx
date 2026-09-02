/**
 * Compact pending-count pill. Background is --warn (text token inverted onto
 * --bg) so light amber and dark yellow both keep readable contrast.
 */
export function CountBadge({
  count,
  label,
}: {
  count: number
  label: string
}) {
  if (count <= 0) return null
  return (
    <span
      data-pending-count={count}
      aria-label={`${count} ${label}`}
      className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--warn)] px-[4px] text-[10px] font-semibold text-[var(--bg)]"
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}
