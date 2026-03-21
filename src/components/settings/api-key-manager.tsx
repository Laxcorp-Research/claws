"use client"

import { useState, useEffect, useCallback } from "react"
import { ApiKeyRow } from "./api-key-row"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"

interface ApiKey {
  id: string
  provider: string
  keyHint: string
  isValid: boolean
  lastUsedAt: string | null
  createdAt: string
}

const PROVIDERS = [
  { key: "ANTHROPIC", name: "Anthropic (Claude)", placeholder: "sk-ant-api03-..." },
  { key: "OPENAI", name: "OpenAI (GPT)", placeholder: "sk-proj-..." },
  { key: "GOOGLE", name: "Google (Gemini)", placeholder: "AIza..." },
] as const

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [addProvider, setAddProvider] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState("")
  const [validationState, setValidationState] = useState<"idle" | "validating" | "success" | "error">("idle")
  const [validationError, setValidationError] = useState("")
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/api-keys")
      const json = await res.json()
      if (json.success) setKeys(json.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const handleAdd = async () => {
    if (!addProvider || !keyInput.trim()) return
    setValidationState("validating")
    setValidationError("")
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: addProvider, apiKey: keyInput.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message ?? "Failed to save key")
      }
      setValidationState("success")
      setTimeout(() => {
        setAddProvider(null)
        setKeyInput("")
        setValidationState("idle")
        fetchKeys()
      }, 1000)
    } catch (err) {
      setValidationState("error")
      setValidationError(err instanceof Error ? err.message : "Invalid API key")
    }
  }

  const handleTest = async (provider: string) => {
    setTestingProvider(provider)
    try {
      const res = await fetch("/api/api-keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      await res.json()
      fetchKeys()
    } finally {
      setTestingProvider(null)
    }
  }

  const handleRemove = async () => {
    if (!removeId) return
    setRemoving(true)
    try {
      await fetch(`/api/api-keys/${removeId}`, { method: "DELETE" })
      fetchKeys()
    } finally {
      setRemoving(false)
      setRemoveId(null)
    }
  }

  const providerInfo = (key: string) => PROVIDERS.find((p) => p.key === key)

  if (loading) {
    return (
      <div>
        <div className="h-4 bg-[var(--bg2)] rounded w-40 mb-2" />
        <LoadingSkeleton variant="card" count={1} />
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-[14px] font-semibold mb-[2px]">AI model API keys</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-3">
        These keys are encrypted with AES-256-GCM and stored securely. They power the AI models in all your Claws.
      </p>

      <div className="border border-[var(--bd)] rounded-xl overflow-hidden">
        {PROVIDERS.map((provider) => {
          const key = keys.find((k) => k.provider === provider.key)
          return (
            <ApiKeyRow
              key={provider.key}
              provider={provider.key}
              displayName={provider.name}
              isConnected={!!key}
              keyHint={key?.keyHint}
              addedDate={key ? new Date(key.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : undefined}
              isValid={key?.isValid ?? false}
              isTesting={testingProvider === provider.key}
              onTest={key ? () => handleTest(provider.key) : undefined}
              onRemove={key ? () => setRemoveId(key.id) : undefined}
              onAdd={!key ? () => { setAddProvider(provider.key); setKeyInput(""); setValidationState("idle") } : undefined}
            />
          )
        })}
      </div>

      <Modal
        open={!!addProvider}
        onClose={() => { setAddProvider(null); setKeyInput(""); setValidationState("idle") }}
        title={`Connect ${providerInfo(addProvider ?? "")?.name ?? "Provider"}`}
        description="Your API key is encrypted with AES-256-GCM before storage. We never store keys in plaintext."
        footer={
          <>
            <Button variant="outline" onClick={() => { setAddProvider(null); setKeyInput(""); setValidationState("idle") }}>Cancel</Button>
            <Button variant="primary" onClick={handleAdd} loading={validationState === "validating"} disabled={!keyInput.trim()}>Validate & save</Button>
          </>
        }
      >
        <div>
          <label className="text-[11px] font-medium block mb-[3px]">API key</label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setValidationState("idle") }}
            placeholder={providerInfo(addProvider ?? "")?.placeholder ?? "Enter API key..."}
            className="w-full px-2.5 py-2 border border-[var(--bd)] rounded-[6px] text-[12px] font-mono bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          />
          {validationState === "validating" && (
            <p className="text-[11px] text-[var(--warn)] mt-1.5 flex items-center gap-1">
              <span className="w-3 h-3 border-2 border-[var(--warn)] border-t-transparent rounded-full animate-spin" />
              Testing connection...
            </p>
          )}
          {validationState === "success" && (
            <p className="text-[11px] text-[var(--ok)] mt-1.5">API key validated. Connection active.</p>
          )}
          {validationState === "error" && (
            <p className="text-[11px] text-[var(--err)] mt-1.5">{validationError || "Invalid API key. Please check and try again."}</p>
          )}
          <p className="text-[11px] text-[var(--tx3)] mt-2">
            <a href={
              addProvider === "ANTHROPIC" ? "https://console.anthropic.com/settings/keys" :
              addProvider === "OPENAI" ? "https://platform.openai.com/api-keys" :
              "https://aistudio.google.com/app/apikey"
            } target="_blank" rel="noopener noreferrer" className="text-[var(--ac)] hover:text-[var(--tx)] hover:underline transition-colors">
              Where do I find my API key? →
            </a>
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        onConfirm={handleRemove}
        title="Remove API key?"
        description="This will disconnect the provider. Claws using this model will stop working until you add a new key."
        warningText="Any running Claws that depend on this provider will immediately lose access."
        confirmLabel="Remove key"
        variant="danger"
        loading={removing}
      />
    </div>
  )
}
