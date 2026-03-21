import Link from "next/link"
import { ReactNode } from "react"

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  breadcrumb?: string
  breadcrumbHref?: string
}

export function PageHeader({ title, description, actions, breadcrumb, breadcrumbHref }: PageHeaderProps) {
  return (
    <div>
      {breadcrumb && (
        <Link href={breadcrumbHref || "#"} className="text-[11px] text-[var(--tx2)] cursor-pointer hover:text-[var(--tx)] mb-3 inline-block">
          {breadcrumb}
        </Link>
      )}
      <div className="flex items-center justify-between mb-3.5">
        <div>
          <h1 className="text-[16px] font-semibold">{title}</h1>
          {description && <p className="text-[13px] text-[var(--tx2)] mt-1">{description}</p>}
        </div>
        {actions && <div className="flex gap-1.5">{actions}</div>}
      </div>
    </div>
  )
}
