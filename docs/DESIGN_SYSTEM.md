# Design System

## 1. Cockpit Dashboard Components

### AlertStack

- Purpose: compact top-zone alert surface for the dashboard cockpit.
- Data shape: `alerts[{ id, priority, variant, message, sub?, cta? }]`.
- Implementation: wraps existing `AlertBanner`; do not duplicate banner visual styling.
- Priority order: container-down > silence > sync-stale > connection-expired > session-dead > drift > version-update.
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

## 4. API Key Modal

- Title: `"Connect " + <span tool name>`.
- Title font: `16px`, weight `600`.
- Tool-name span color: `var(--ac)`, same font-size and weight as the title.
- This is a deliberate extension of `--ac` beyond links, scoped to connect-modal tool names only.
