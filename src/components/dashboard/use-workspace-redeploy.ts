"use client"

import { useCallback, useRef, useState } from "react"
import { getRedeployApiErrorMessage } from "@/components/dashboard/redeploy-error"

export interface UseWorkspaceRedeployOptions {
  workspaceId: string
  onCompleted?: () => void
}

export function useWorkspaceRedeploy({ workspaceId, onCompleted }: UseWorkspaceRedeployOptions) {
  const [modalOpen, setModalOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [lastStage, setLastStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
  }, [])

  const startRedeploy = useCallback(async () => {
    setModalOpen(true)
    setStatus("PENDING")
    setLastStage(null)
    setError(null)

    const es = new EventSource(`/api/deploy/${workspaceId}/stream`)
    eventSourceRef.current = es

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data) as { status: string; error?: string }
      if (data.status !== "FAILED" && data.status !== "COMPLETED") {
        setLastStage(data.status)
      }
      setStatus(data.status)
      if (data.error) setError(data.error)
      if (data.status === "COMPLETED" || data.status === "FAILED") {
        es.close()
        eventSourceRef.current = null
      }
    })

    es.onerror = () => {
      es.close()
      eventSourceRef.current = null
    }

    try {
      const res = await fetch(`/api/deploy/${workspaceId}/redeploy`, { method: "POST" })
      const json = await res.json()
      closeStream()
      if (!res.ok) {
        setStatus("FAILED")
        setError(getRedeployApiErrorMessage(json))
      } else {
        setStatus((prev) => prev === "COMPLETED" ? prev : "COMPLETED")
      }
    } catch {
      closeStream()
      setStatus("FAILED")
      setError("Network error — could not reach the server")
    }
  }, [workspaceId, closeStream])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    closeStream()
    if (status === "COMPLETED") {
      onCompleted?.()
    }
    setStatus(null)
    setLastStage(null)
    setError(null)
  }, [status, onCompleted, closeStream])

  const retry = useCallback(() => {
    void startRedeploy()
  }, [startRedeploy])

  return {
    modalOpen,
    status,
    lastStage,
    error,
    redeploying: modalOpen && status !== "COMPLETED" && status !== "FAILED",
    startRedeploy,
    closeModal,
    retry,
  }
}
