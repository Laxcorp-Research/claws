"use client"

import { useState, useCallback } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Check, Loader2 } from "lucide-react"

interface ApiKeyModalProps {
  open: boolean
  onClose: () => void
  toolName: string
  helpUrl?: string
  keyPlaceholder?: string
  onSave: (apiKey: string) => Promise<{ success: boolean; error?: string }>
}

export function ApiKeyModal({ open, onClose, toolName, helpUrl, keyPlaceholder = "Enter API key...", onSave }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState("")
  const [status, setStatus] = useState<"idle" | "validating" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return
    setStatus("validating")
    setErrorMsg("")
    const result = await onSave(apiKey.trim())
    if (result.success) {
      setStatus("success")
      setTimeout(() => { setApiKey(""); setStatus("idle"); onClose() }, 800)
    } else {
      setStatus("error")
      setErrorMsg(result.error || "Invalid API key.")
    }
  }, [apiKey, onSave, onClose])

  const handleClose = useCallback(() => {
    setApiKey(""); setStatus("idle"); setErrorMsg(""); onClose()
  }, [onClose])

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Connect ${toolName}`}
      description="Enter your API key. Encrypted with AES-256-GCM."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!apiKey.trim() || status === "validating"}>
            {status === "validating" ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" aria-hidden="true" /> Validating...</> : "Validate & save"}
          </Button>
        </>
      }
    >
      <div>
        <label className="block text-[11px] font-medium mb-[3px]">API Key</label>
        <Input value={apiKey} onChange={(e) => { setApiKey(e.target.value); setStatus("idle"); setErrorMsg("") }} placeholder={keyPlaceholder} className="font-mono" error={status === "error"} onKeyDown={(e) => e.key === "Enter" && handleSave()} />
        {status === "success" && <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Key validated and saved</p>}
        {status === "error" && (
          <div className="mt-2 rounded-lg border border-[var(--err)] bg-[var(--errbg)] p-2.5">
            <p className="text-[11px] font-semibold text-[#991b1b] mb-0.5">Validation failed</p>
            <p className="text-[11px] text-[#991b1b]">{errorMsg}</p>
          </div>
        )}
        {helpUrl && (
          <p className="text-[11px] text-[var(--tx3)] mt-1">
            <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--ac)] hover:text-[var(--tx)] hover:underline transition-colors">Where do I find this? →</a>
          </p>
        )}
      </div>
    </Modal>
  )
}
