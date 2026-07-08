import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface TextLinkProps {
  href?: string
  onClick?: () => void
  direction: "back" | "forward"
  children: ReactNode
  className?: string
  target?: string
  rel?: string
}

export function TextLink({ href, onClick, direction, children, className, target, rel }: TextLinkProps) {
  const content = (
    <>
      {direction === "back" && "← "}
      {children}
      {direction === "forward" && " →"}
    </>
  )
  const classes = cn("text-[11px] text-[var(--tx2)] cursor-pointer hover:text-[var(--tx)] transition-colors", className)

  if (href) {
    return <Link href={href} target={target} rel={rel} className={classes}>{content}</Link>
  }

  return <button type="button" onClick={onClick} className={cn(classes, "border-none bg-transparent p-0")}>{content}</button>
}
