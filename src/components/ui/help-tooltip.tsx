import { HelpCircle } from "lucide-react"
import { Tooltip } from "./tooltip"

interface HelpTooltipProps {
  text: string
  iconSize?: number
}

export function HelpTooltip({ text, iconSize = 12 }: HelpTooltipProps) {
  return (
    <Tooltip content={text} align="center" triggerClassName="inline-flex w-auto">
      <span className="text-[var(--tx3)] hover:text-[var(--tx2)] transition-colors cursor-help">
        <HelpCircle style={{ width: iconSize, height: iconSize }} />
      </span>
    </Tooltip>
  )
}
