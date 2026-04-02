"use client"

import { useState, useCallback } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CustomSelect } from "@/components/ui/custom-select"

interface CustomApiModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: { name: string; baseUrl: string; authType: string; credential: string; description: string }) => Promise<{ success: boolean; error?: string }>
}

const AUTH_TYPE_OPTIONS = [
  { value: "API_KEY_HEADER", label: "API Key (header)" },
  { value: "BEARER_TOKEN", label: "Bearer Token" },
  { value: "BASIC_AUTH", label: "Basic Auth" },
  { value: "QUERY_PARAM", label: "Query Parameter" },
]

export function CustomApiModal({ open, onClose, onSave }: CustomApiModalProps) {
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [authType, setAuthType] = useState("API_KEY_HEADER")
  const [credential, setCredential] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  const handleSave = useCallback(async () => {
    if (!name.trim() || !baseUrl.trim() || !credential.trim()) return
    setStatus("saving"); setErrorMsg("")
    const result = await onSave({ name: name.trim(), baseUrl: baseUrl.trim(), authType, credential: credential.trim(), description: description.trim() })
    if (result.success) {
      setName(""); setBaseUrl(""); setAuthType("API_KEY_HEADER"); setCredential(""); setDescription(""); setStatus("idle"); onClose()
    } else {
      setStatus("error"); setErrorMsg(result.error || "Failed to save.")
    }
  }, [name, baseUrl, authType, credential, description, onSave, onClose])

  const handleClose = useCallback(() => {
    setName(""); setBaseUrl(""); setAuthType("API_KEY_HEADER"); setCredential(""); setDescription(""); setStatus("idle"); setErrorMsg(""); onClose()
  }, [onClose])

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Connect a custom API"
      description="Add any API your agents should be able to call. Credentials are encrypted."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!name.trim() || !baseUrl.trim() || !credential.trim() || status === "saving"}>
            {status === "saving" ? "Saving..." : "Test & save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-[3px]">Tool name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Our Internal CRM" />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-[3px]">Base URL</label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="font-mono" />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-[3px]">Auth type</label>
          <CustomSelect
            value={authType}
            onChange={(value) => setAuthType(value)}
            options={AUTH_TYPE_OPTIONS}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-[3px]">Credential</label>
          <Input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Your API key or token" className="font-mono" />
        </div>
        <div>
          <label className="block text-[11px] font-medium mb-[3px]">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what this API does..." className="w-full px-2.5 py-2 border border-[var(--bd)] rounded-md text-xs bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)] resize-none min-h-[60px]" />
        </div>
        {status === "error" && <p className="text-[11px] text-[var(--err)]">{errorMsg}</p>}
      </div>
    </Modal>
  )
}
