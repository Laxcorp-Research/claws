"use client"

import { Check, X, Circle, Loader2 } from "lucide-react"

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
            <span className="w-[18px] flex items-center justify-center">
              {step.status === "complete" && <Check className="w-3.5 h-3.5 text-[var(--ok)]" />}
              {step.status === "running" && <Loader2 className="w-3.5 h-3.5 text-[var(--tx)] animate-spin" />}
              {step.status === "pending" && <Circle className="w-3 h-3 text-[var(--tx3)]" />}
              {step.status === "failed" && <X className="w-3.5 h-3.5 text-[var(--err)]" />}
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
