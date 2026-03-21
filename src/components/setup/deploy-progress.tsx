"use client"

interface DeployStep {
  label: string
  status: "complete" | "running" | "pending" | "failed"
}

interface DeployProgressProps {
  steps: DeployStep[]
}

export function DeployProgress({ steps }: DeployProgressProps) {
  return (
    <div className="border border-[var(--bd)] rounded-xl p-3.5">
      <h3 className="text-[13px] font-semibold mb-2">Deployment progress</h3>
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 py-1 text-xs">
            <span className="w-[18px] text-center">
              {step.status === "complete" && <span className="text-[var(--ok)]">✓</span>}
              {step.status === "running" && <span className="text-[var(--tx)]">●</span>}
              {step.status === "pending" && <span className="text-[var(--tx3)]">○</span>}
              {step.status === "failed" && <span className="text-[var(--err)] font-semibold">✗</span>}
            </span>
            <span className={step.status === "failed" ? "font-semibold text-[var(--err)]" : step.status === "running" ? "text-[var(--tx)]" : step.status === "complete" ? "text-[var(--tx2)]" : "text-[var(--tx3)]"}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
