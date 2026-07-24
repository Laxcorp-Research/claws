# Design System

## 1. Cockpit Dashboard Components

### Tooltip

- Purpose: accessible hover/focus disclosure for clipped or contextual text.
- Trigger: wraps focusable or text content, `aria-describedby` points at the tooltip while open.
- Behavior: opens on hover or focus after `300ms`; closes on mouse leave, blur, or `Escape`.
- Tooltip body: `bg-[var(--tx)]`, white text, `text-[10px]`, `leading-[1.4]`, `px-[8px]`, `py-[5px]`, `rounded-[4px]`, `shadow-modal`, max width `300px`.

### TruncatedText

- Purpose: single-line ellipsis with Tooltip only when text is actually truncated.
- Element: inline/block span with `overflow-hidden`, `text-overflow: ellipsis`, `white-space: nowrap`, `min-w-0`.
- Detection: attach tooltip only when `scrollWidth > clientWidth`; recheck on resize via `ResizeObserver` and window resize fallback.
- Tooltip content: exact full text. Do not show tooltip for non-truncated text.

### Select

- Purpose: platform-styled listbox replacement for native browser dropdowns.
- Trigger: `h-[30px]`, `px-[8px]`, `rounded-[8px]`, `border border-[var(--bd)]`, `bg-[var(--bg)]`, text `11px`, focus ring `outline-none ring-2 ring-[var(--ac)]/30`.
- Popover: absolute listbox, `z-50`, `rounded-[8px]`, `border border-[var(--bd)]`, `bg-[var(--bg)]`, `shadow-modal`, `max-h-[220px]`, scrollable.
- Option: `px-[10px]`, `py-[6px]`, text `11px`; selected option uses `bg-[var(--bg2)]`, `font-medium`; active option uses `bg-[var(--acbg)]`.
- Keyboard: ArrowUp/ArrowDown moves active option, Enter/Space selects, Escape closes, type-ahead jumps by label prefix. Uses `role="listbox"` / `role="option"`.

### Tabs

- Purpose: dashboard-level navigation without long scrolling.
- Container: horizontal scroll, `border-b border-[var(--bd)]`, gap `0`.
- Tab: `px-[14px]`, `py-[8px]`, text `12px`, border-bottom `2px`; active uses `var(--tx)`, inactive `var(--tx2)`.
- Keyboard: ArrowLeft/ArrowRight moves between tabs; Enter/Space activates. Dashboard tabs sync to `?tab=`.

### TextLink

- Purpose: arrow-style text navigation link used for back/forward inline navigation.
- Variants: back renders `← Label`; forward renders `Label →`.
- Typography: `11px`, color `var(--tx2)`, hover color `var(--tx)`, underline only when the surrounding surface already uses underlined links.
- Spacing: inline-block; callers own margin. Same visual treatment as the dashboard breadcrumb.

### AlertStack

- Purpose: compact top-zone alert surface for the dashboard cockpit.
- Data shape: `alerts[{ id, priority, variant, message, sub?, cta? }]`.
- Implementation: wraps existing `AlertBanner`; do not duplicate banner visual styling.
- Priority order: container-down > silence > near-cap > sync-stale > connection-expired > session-dead > drift > version-update.
- Behavior: highest-priority alert renders inline. When more alerts exist, show a `N more alerts` toggle immediately below the first alert; expanding renders every remaining alert as a full `AlertBanner` with its own CTA intact.
- Spacing: stack container `mb-[14px]`; toggle margin `mt-[-6px] mb-[10px]`.
- Toggle type: `11px`, weight `500`, color `var(--ac-text)`, hover underline.

### StatChip

- Purpose: compact Command Strip metric with label and value.
- Container: inline-flex, `min-h-[28px]`, `px-[9px]`, `py-[5px]`, `gap-[6px]`, `rounded-[999px]`, `border border-[var(--bd)]`, `bg-[var(--bg)]`.
- Label: `10px`, weight `500`, color `var(--tx3)`.
- Value: `11px`, weight `600`, color `var(--tx)`.
- Optional status dot: `7px` square, `rounded-full`, margin before text via the container gap. Dot colors use `var(--ok)`, `var(--warn)`, `var(--err)`, or `var(--tx3)`.
- Unknown/empty values render `—`, never fabricated values.

### FilterBar

- Purpose: Mission Log controls that drive server-side activity filtering.
- Composition: existing `FilterPills`, `Input` search, and native compact select styling.
- Container: `rounded-[12px]`, `border border-[var(--bd)]`, `bg-[var(--bg)]`, `p-[10px]`, `mb-[10px]`.
- Layout: flex wrap with `gap-[8px]`; search grows to fill remaining width with `min-w-[180px]`.
- Labels: `10px`, weight `600`, uppercase, `tracking-[0.04em]`, color `var(--tx3)`.
- Agent pills: role color dot `7px`, label `11px`, pill height `28px`.
- Type pills: All, Tasks, Messages, Errors; Routine is a separate client-side toggle because heartbeat classification is derived from row content, not a DB column.
- Channel select: `height 30px`, text `11px`, border `var(--bd)`, radius `8px`; options are Webchat plus configured providers.
- Time select: Today / 7d / All; maps to `since` server param.
- Search input: `height 30px`, text `11px`; debounce is optional, but empty search must remove the `q` param.

### RunCard

- Purpose: Mission Log card grouping ActivityLog rows by `runId`.
- Container: `rounded-[10px]`, `border border-[var(--bd)]`, `bg-[var(--bg)]`, `px-[12px]`, `py-[10px]`; routine runs add `bg-[var(--bg2)]` and muted text.
- Header layout: flex row, `gap-[10px]`, align start; left status icon box `20px` square.
- Status icons: success `✓` in `var(--ok)`, failure `✗` in `var(--err)`, open spinner `16px` current color with `border-t-transparent`.
- Title: `13px`, weight `600`, color `var(--tx)`; routine title color `var(--tx2)`.
- Meta row: `10px`, color `var(--tx3)`, `gap-[8px]`; include agent, duration, time, event count, and provider badge when known.
- Expand affordance: chevron `10px`; expanded sequence reuses `ActivityLogEntry` rows inside `mt-[8px]`, `border-t border-[var(--bd)]`, `pt-[6px]`.
- Page-boundary note: `10px`, color `var(--tx3)`, text `Earlier events may be on the previous page.` rendered when a run has terminal/non-start events but no `TASK_START` on this page.

### AgentLiveTile

- Purpose: Live Ops tile for a single agent's current state.
- Container: `rounded-[12px]`, `border border-[var(--bd)]`, `bg-[var(--bg)]`, `px-[12px]`, `py-[10px]`, `min-h-[96px]`; Orchestrator tile spans `1.5x` by using `md:col-span-2` in the grid.
- Grid: parent uses `grid`, `gap-[8px]`, `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; Orchestrator tile may span two columns.
- Header: role color dot `8px`, agent name `13px`/`600`/`var(--tx)`, role label `10px`/`var(--tx3)`.
- Model tag: `10px`, `px-[6px]`, `py-[2px]`, `rounded-[6px]`, `bg-[var(--bg2)]`, `color var(--tx2)`.
- State line: `12px`, `600`; WORKING uses `var(--ac-text)`, IDLE `var(--tx2)`, PAUSED `var(--warn)`, PAUSE-PENDING `var(--warn)`, ERROR `var(--err)`.
- Detail line: `11px`, `color var(--tx3)`, `mt-[3px]`; task names line-clamp to 2 lines.
- Routine variant: add `bg-[var(--bg2)]` and `color var(--tx3)` to the detail; label text starts with `Routine`.
- Controls: only Worker tiles render Pause/Resume. Button is existing `Button size="xs"`; Orchestrator/Critic render no control slot.
- Pending pause copy: `Pause pending — redeploy to apply`; never render `Paused` unless deployed config agrees with DB pause truth.

### RunChain

- Purpose: compact active-run path showing which agents have participated.
- Container: `rounded-[12px]`, `border border-[var(--bd)]`, `bg-[var(--bg)]`, `px-[12px]`, `py-[9px]`, `mb-[10px]`.
- Header: `10px`, uppercase, `font-semibold`, `tracking-[0.04em]`, `color var(--tx3)`, `mb-[6px]`.
- AgentPill: inline-flex, `h-[26px]`, `px-[9px]`, `gap-[6px]`, `rounded-[999px]`, `border border-[var(--bd)]`, text `11px`/`600`.
- Active hop: `border-color var(--ac)`, `background var(--acbg)`, text `var(--ac-text)`.
- Connector: `12px` arrow `→`, `color var(--tx3)`, horizontal gap `6px`.
- Empty state: do not render when no active non-routine run exists.

## 4. API Key Modal

- Title: `"Connect " + <span tool name>`.
- Title font: `16px`, weight `600`.
- Tool-name span color: `var(--ac)`, same font-size and weight as the title.
- This is a deliberate extension of `--ac` beyond links, scoped to connect-modal tool names only.

## Snackbar (platform feedback)

**File:** `src/components/shared/snackbar.tsx` · Provider wired in `src/components/providers.tsx`.

**Platform rule:** any mutation that applies instantly without navigation, dialog, or inline state change MUST fire a Snackbar.

### Anatomy

- Single-slot host: fixed bottom center (`bottom-[20px]`, `-translate-x-1/2`), `z-[100]`.
- Container: `max-w-[420px]`, `rounded-[8px]`, `border border-[var(--bd)]`, `bg-[var(--tx)]`, white text, `px-[14px]`, `py-[10px]`, `gap-[10px]`, `text-[12px]` / `font-medium`, `shadow-modal`.
- Message: flex-1, `leading-[1.4]`.
- Undo (optional): `text-[11px]`, `font-semibold`, uppercase, `tracking-[0.04em]`, `color var(--ac)`.
- Dismiss ×: `text-[14px]`, white/70 → white on hover.
- Auto-dismiss: **8000ms** default; new show replaces the current slot (no stack).

### Variants

| Variant | When |
|---------|------|
| `success` | Instant mutation succeeded (default without Undo) |
| `info` | Neutral notice |
| `undo-action` | Instant mutation with reversible Undo (default when `onUndo` set) |
| `error` | Instant mutation failed (non-2xx / thrown); no Undo; state must not be updated as success |

Use `mutateWithFeedback` (`src/lib/ui/mutate-with-feedback.ts`) so tool-customization ops cannot skip feedback.

### AI Gradient Accent

- Purpose: onboarding affordance ONLY — the top-bar "Getting started" nav label while the tracker is incomplete.
- Tokens (CSS variables on `:root` / `.dark`):
  - `--ai-grad-1: #3B82F6` (deeper blue, near `--ac-text`)
  - `--ai-grad-2: #5BA1F5` (brand `--ac`)
  - `--ai-grad-3: #93C5FD` (light sky, harmonious with `--acbg`)
- Application: `background-image: linear-gradient(90deg, var(--ai-grad-1), var(--ai-grad-2), var(--ai-grad-3), var(--ai-grad-2), var(--ai-grad-1))`; `background-size: 200% 100%`; `-webkit-background-clip: text` / `background-clip: text`; `-webkit-text-fill-color: transparent`; color fallback `var(--ac-text)`.
- Motion: slow shimmer — `background-position` animates over **~6s** `ease-in-out` `infinite` `alternate`. Class: `ai-gradient-accent`.
- `prefers-reduced-motion: reduce`: static gradient (no animation).
- Explicit carve-out from the "blue = text links only" color law, restricted to this single affordance. Do not reuse on buttons, body copy, or other nav items.
