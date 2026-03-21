import { PageShell } from "@/components/shared/page-shell"

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell>
      <div className="max-w-2xl mx-auto px-4 py-4">
        {children}
      </div>
    </PageShell>
  )
}
