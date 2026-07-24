"use client"

import { useState, useEffect, useCallback } from "react"
import { ApiKeyRow } from "./api-key-row"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { CreditBalanceCard } from "@/components/credits/credit-balance-card"
import { useCreditBalance } from "@/hooks/use-credit-balance"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

interface ApiKey {
  id: string
  provider: string
  keyHint: string
  isValid: boolean
  lastUsedAt: string | null
  lastError: string | null
  createdAt: string
}

const PROVIDERS = [
  { key: "ANTHROPIC", name: "Anthropic (Claude)", shortName: "Anthropic", placeholder: "sk-ant-api03-...", helpUrl: "https://console.anthropic.com/settings/keys" },
  { key: "OPENAI", name: "OpenAI (GPT)", shortName: "OpenAI", placeholder: "sk-proj-...", helpUrl: "https://platform.openai.com/api-keys" },
  { key: "GOOGLE", name: "Google (Gemini)", shortName: "Google", placeholder: "AIza...", helpUrl: "https://aistudio.google.com/apikey" },
] as const

export function ApiKeyManager() {
  const snackbar = useSnackbarOptional()
  const showSnackbar = useCallback(
    (options: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
      snackbar?.show(options)
    },
    [snackbar],
  )
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [addProvider, setAddProvider] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState("")
  const [validationState, setValidationState] = useState<"idle" | "validating" | "success" | "error">("idle")
  const [validationError, setValidationError] = useState("")
  const [testingId, setTestingId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  const credit = useCreditBalance()
  const onCredits = credit.hasCredits && (credit.status === "ACTIVE" || credit.status === "EXHAUSTED")
  const hasValidAnthropicKey = keys.some((k) => k.provider === "ANTHROPIC" && k.isValid)

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
      await mutateWithFeedback(
        async () => {
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
        },
        {
          message: "API key saved",
          errorMessage: "Could not save API key",
        },
        showSnackbar,
      )
    } catch (err) {
      setValidationState("error")
      setValidationError(err instanceof Error ? err.message : "Invalid API key")
    }
  }

  const handleTest = async (keyId: string) => {
    setTestingId(keyId)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/api-keys/${keyId}/validate`, { method: "POST" })
          if (!res.ok) throw new Error("Could not validate API key")
          await fetchKeys()
        },
        { message: "API key validated", errorMessage: "Could not validate API key" },
        showSnackbar,
      )
    } catch {
      /* error snackbar already shown */
    } finally {
      setTestingId(null)
    }
  }

  const handleRemove = async () => {
    if (!removeId) return
    setRemoving(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/api-keys/${removeId}`, { method: "DELETE" })
          if (!res.ok) throw new Error("Could not delete API key")
          await fetchKeys()
        },
        { message: "API key deleted", errorMessage: "Could not delete API key" },
        showSnackbar,
      )
    } catch {
      /* error snackbar already shown */
    } finally {
      setRemoving(false)
      setRemoveId(null)
    }
  }

  const openAddModal = (providerKey: string) => {
    setAddProvider(providerKey)
    setKeyInput("")
    setValidationState("idle")
    setValidationError("")
  }

  const closeAddModal = () => {
    setAddProvider(null)
    setKeyInput("")
    setValidationState("idle")
  }

  const handleSwitchSource = async () => {
    setSwitching(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch("/api/api-keys/switch-source", { method: "POST" })
          if (!res.ok) throw new Error("Could not switch to your key")
          credit.refetch()
          await fetchKeys()
        },
        {
          message: "Switched to your API key",
          errorMessage: "Could not switch to your key",
        },
        showSnackbar,
      )
    } catch {
      /* error snackbar already shown */
    } finally {
      setSwitching(false)
      setSwitchConfirmOpen(false)
    }
  }

  const providerInfo = PROVIDERS.find((p) => p.key === addProvider)

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
      {onCredits && !credit.loading && (
        <>
          <CreditBalanceCard
            variant="full"
            balanceCents={credit.balanceCents}
            totalConsumedCents={credit.totalConsumedCents}
            initialGrantCents={credit.initialGrantCents}
            status={credit.status}
          />

          {(credit.status === "ACTIVE" || credit.status === "EXHAUSTED") &&
            hasValidAnthropicKey && (
            <div className="mb-3.5">
              <Button variant="outline" size="sm" className="text-[11px]" onClick={() => setSwitchConfirmOpen(true)}>
                Switch to my key
              </Button>
            </div>
          )}
        </>
      )}

      <h2 className="text-[14px] font-semibold mb-[2px]">
        {onCredits && credit.status === "EXHAUSTED"
          ? "Add your API key to resume your agents"
          : onCredits && credit.status === "ACTIVE"
            ? "Add your own key (optional)"
            : "AI model API keys"}
      </h2>
      <p className="text-[11px] text-[var(--tx2)] mb-[4px]">
        We support Anthropic, OpenAI, and Google. These power all your Claws. Each Claw&apos;s agents can use a different model - configure that in the builder or during setup.
      </p>
      <p className="text-[11px] text-[var(--tx3)] mb-[12px]">
        Individual Claws can override with different keys in their setup wizard if you want to track usage separately.
      </p>

      <div className="border border-[var(--bd)] rounded-[12px] overflow-hidden">
        {PROVIDERS.map((provider) => {
          const key = keys.find((k) => k.provider === provider.key)
          const status: "connected" | "disconnected" | "invalid" = key
            ? (key.isValid ? "connected" : "invalid")
            : "disconnected"

          return (
            <ApiKeyRow
              key={provider.key}
              provider={provider.key}
              name={provider.name}
              status={status}
              keyHint={key?.keyHint}
              lastUsedAt={
                key?.lastUsedAt
                  ? `Last used: ${new Date(key.lastUsedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : key
                    ? `Added ${new Date(key.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : undefined
              }
              lastError={key?.lastError ?? undefined}
              onAdd={() => openAddModal(provider.key)}
              onTest={key ? () => handleTest(key.id) : () => {}}
              onRemove={key ? () => setRemoveId(key.id) : () => {}}
              onUpdate={() => openAddModal(provider.key)}
              isTestLoading={testingId === key?.id}
            />
          )
        })}
      </div>

      <Modal
        open={!!addProvider}
        onClose={closeAddModal}
        title={`Connect ${providerInfo?.name ?? "Provider"}`}
        description="Enter your API key. We encrypt it with AES-256-GCM before storing."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={closeAddModal}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleAdd}
              loading={validationState === "validating"}
              disabled={!keyInput.trim()}
            >
              Validate &amp; save
            </Button>
          </>
        }
      >
        <div>
          <label className="text-[11px] font-medium block mb-[4px]">API key</label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); if (validationState === "error") setValidationState("idle") }}
            placeholder={providerInfo?.placeholder ?? "Enter API key..."}
            className="w-full px-2.5 py-2 border border-[var(--bd)] rounded-[6px] text-[12px] font-mono bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          />
          {validationState === "validating" && (
            <p className="text-[11px] text-[var(--warn)] mt-1.5 flex items-center gap-1">
              <span className="w-3 h-3 border-2 border-[var(--warn)] border-t-transparent rounded-full animate-spin" />
              Testing connection...
            </p>
          )}
          {validationState === "success" && (
            <p className="text-[11px] text-[var(--ok)] mt-1.5">Connected successfully</p>
          )}
          {validationState === "error" && (
            <p className="text-[11px] text-[var(--err)] mt-1.5">
              {validationError || "Invalid API key. Please check and try again."}
            </p>
          )}
          {providerInfo?.helpUrl && (
            <p className="text-[11px] text-[var(--tx3)] mt-2">
              <a
                href={providerInfo.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--ac-text)] hover:underline"
              >
                Where do I find my {providerInfo.shortName} API key? →
              </a>
            </p>
          )}
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

      <ConfirmDialog
        open={switchConfirmOpen}
        onClose={() => setSwitchConfirmOpen(false)}
        onConfirm={handleSwitchSource}
        title="Switch to your own API key"
        description="Your agents will restart to use your key instead of Claws credits. This takes about 30 seconds. Remaining credits will not be used."
        confirmLabel="Switch to my key"
        variant="warning"
        loading={switching}
      />
    </div>
  )
}
