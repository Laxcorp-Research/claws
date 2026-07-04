"use client"

import { AlertBanner } from "@/components/ui/alert-banner"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { DeployProgress } from "@/components/setup/deploy-progress"

const REDEPLOY_STAGES = [
  { label: "Generating workspace files", key: "GENERATING" },
  { label: "Provisioning container", key: "PROVISIONING" },
  { label: "Configuring workspace", key: "CONFIGURING" },
  { label: "Starting gateway", key: "STARTING" },
  { label: "Health check", key: "HEALTH_CHECK" },
  { label: "Connecting channels", key: "WAITING_CHANNELS" },
  { label: "Complete", key: "COMPLETED" },
]

const REDEPLOY_ORDER = REDEPLOY_STAGES.map((s) => s.key)

function mapRedeployStatus(status: string | null, failedAtStage?: string | null): { label: string; status: "complete" | "running" | "pending" | "failed" }[] {
  if (!status || status === "PENDING") return REDEPLOY_STAGES.map((s, i) => ({ label: s.label, status: i === 0 ? "running" as const : "pending" as const }))

  if (status === "FAILED") {
    const failIdx = failedAtStage ? REDEPLOY_ORDER.indexOf(failedAtStage) : -1
    return REDEPLOY_STAGES.map((s) => {
      const si = REDEPLOY_ORDER.indexOf(s.key)
      if (failIdx >= 0) {
        if (si < failIdx) return { label: s.label, status: "complete" as const }
        if (si === failIdx) return { label: s.label, status: "failed" as const }
      }
      return { label: s.label, status: "pending" as const }
    })
  }

  const idx = REDEPLOY_ORDER.indexOf(status)
  return REDEPLOY_STAGES.map((s) => {
    const si = REDEPLOY_ORDER.indexOf(s.key)
    if (si < idx) return { label: s.label, status: "complete" as const }
    if (si === idx) return { label: s.label, status: status === "COMPLETED" ? "complete" as const : "running" as const }
    return { label: s.label, status: "pending" as const }
  })
}

interface RedeployProgressModalProps {
  open: boolean
  redeploying: boolean
  status: string | null
  lastStage: string | null
  error: string | null
  onClose: () => void
  onRetry: () => void
}

export function RedeployProgressModal({
  open,
  redeploying,
  status,
  lastStage,
  error,
  onClose,
  onRetry,
}: RedeployProgressModalProps) {
  return (
    <Modal
      open={open}
      onClose={redeploying ? () => {} : onClose}
      title="Redeploying Claw"
      description={
        status === "COMPLETED"
          ? "Your Claw has been redeployed with the latest configuration."
          : status === "FAILED"
            ? "Redeployment encountered an error."
            : "Updating configuration and redeploying your Claw…"
      }
      size="sm"
      footer={
        (status === "COMPLETED" || status === "FAILED") ? (
          <>
            {status === "FAILED" && (
              <Button variant="outline" onClick={onRetry}>Retry</Button>
            )}
            <Button variant="primary" onClick={onClose}>
              {status === "COMPLETED" ? "Done" : "Close"}
            </Button>
          </>
        ) : undefined
      }
    >
      {status === "FAILED" && error && (
        <AlertBanner variant="error">
          <p className="font-medium">Redeploy failed</p>
          <p className="mt-0.5 opacity-80">{error}</p>
        </AlertBanner>
      )}
      <DeployProgress
        steps={mapRedeployStatus(status, lastStage)}
        failureDetail={status === "FAILED" ? error ?? "Deployment failed" : undefined}
      />
    </Modal>
  )
}
