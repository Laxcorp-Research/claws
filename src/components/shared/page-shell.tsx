import { TopBar } from "./top-bar"

interface PageShellProps {
  background?: "primary" | "secondary"
  children: React.ReactNode
}

export function PageShell({ background = "primary", children }: PageShellProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--bg)] focus:border focus:border-[var(--bd)] focus:rounded-lg focus:px-3 focus:py-2 focus:text-[12px] focus:text-[var(--tx)]"
      >
        Skip to main content
      </a>
      <TopBar />
      <main id="main-content" tabIndex={-1} className={`flex-1 ${background === "secondary" ? "bg-[var(--bg2)]" : "bg-[var(--bg)]"}`}>
        {children}
      </main>
    </div>
  )
}
