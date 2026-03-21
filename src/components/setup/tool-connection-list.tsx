import { ReactNode } from "react"

interface ToolConnectionListProps {
  title: string
  subtitle: string
  children: ReactNode
}

export function ToolConnectionList({ title, subtitle, children }: ToolConnectionListProps) {
  return (
    <div className="mb-3.5">
      <h3 className="text-sm font-semibold mb-0.5">{title}</h3>
      <p className="text-[11px] text-[var(--tx2)] mb-2.5">{subtitle}</p>
      <div className="border border-[var(--bd)] rounded-xl overflow-hidden">
        {children}
      </div>
    </div>
  )
}
