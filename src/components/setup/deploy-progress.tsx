"use client"

import { Check, X, Circle, Loader2 } from "lucide-react"

interface DeployStep {
  label: string
  status: "complete" | "running" | "pending" | "failed"
}

interface DeployProgressProps {
  steps: DeployStep[]
  failureDetail?: string
}

export function DeployProgress({ steps, failureDetail }: DeployProgressProps) {
  const failedStep = steps.find((s) => s.status === "failed")

  return (
    <div className="border border-[var(--bd)] rounded-xl p-3.5" aria-live="polite">
      <h3 className="text-[13px] font-semibold mb-2">Deployment progress</h3>
      <div className="space-y-1" role="list">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 py-1 text-xs" role="listitem">
            <span className="w-[18px] flex items-center justify-center" aria-hidden="true">
              {step.status === "complete" && <Check className="w-3.5 h-3.5 text-[var(--ok)]" />}
              {step.status === "running" && <Loader2 className="w-3.5 h-3.5 text-[var(--tx)] animate-spin" />}
              {step.status === "pending" && <Circle className="w-3 h-3 text-[var(--tx3)]" />}
              {step.status === "failed" && <X className="w-3.5 h-3.5 text-[var(--err)]" />}
            </span>
            <span className={step.status === "failed" ? "font-semibold text-[var(--err)]" : step.status === "running" ? "text-[var(--tx)]" : step.status === "complete" ? "text-[var(--tx2)]" : "text-[var(--tx3)]"}>
              {step.label}{step.status === "running" ? " (in progress)" : step.status === "failed" ? " (failed)" : step.status === "complete" ? " (done)" : ""}
            </span>
          </div>
        ))}
      </div>
      {failedStep && failureDetail && (
        <p className="text-[11px] text-[var(--err)] mt-2 ml-[26px]">
          {failureDetail.length > 300 ? `${failureDetail.substring(0, 300)}…` : failureDetail}
        </p>
      )}
    </div>
  )
}
