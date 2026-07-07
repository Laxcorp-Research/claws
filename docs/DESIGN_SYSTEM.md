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

## 4. API Key Modal

- Title: `"Connect " + <span tool name>`.
- Title font: `16px`, weight `600`.
- Tool-name span color: `var(--ac)`, same font-size and weight as the title.
- This is a deliberate extension of `--ac` beyond links, scoped to connect-modal tool names only.
