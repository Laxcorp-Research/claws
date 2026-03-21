import { TopBar } from "./top-bar"

interface PageShellProps {
  background?: "primary" | "secondary"
  children: React.ReactNode
}

export function PageShell({ background = "primary", children }: PageShellProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className={`flex-1 ${background === "secondary" ? "bg-[var(--bg2)]" : "bg-[var(--bg)]"}`}>
        {children}
      </main>
    </div>
  )
}
