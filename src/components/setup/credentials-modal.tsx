"use client"

import { useEffect, useMemo, useState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Check, Loader2 } from "lucide-react"
import type { ToolCredentialField } from "@/data/tool-catalog"

export interface CredentialsModalProps {
  open: boolean
  onClose: () => void
  /** Modal heading — e.g. "Connect Binance" or "Complete HubSpot credentials". */
  toolName: string
  /** Credential fields to render. 1 field = single-cred tool; 2–3 fields = multi-cred. */
  credentialFields: readonly ToolCredentialField[]
  /** Fallback help URL when a field has no per-field helpUrl. */
  helpUrl?: string
  /**
   * Initial values for known fields. Used by the NEEDS_CREDENTIALS
   * "Complete" flow so a user re-opening the modal doesn't have to retype
   * the primary key they already provided. Missing keys start empty.
   */
  prefilledCredentials?: Record<string, string>
  /** Subtitle shown under the modal title. Defaults to the encryption line. */
  description?: string
  /**
   * Save handler. Receives a record keyed by envVar. The modal only
   * submits after all `required: true` fields are non-empty.
   */
  onSave: (credentials: Record<string, string>) => Promise<{ success: boolean; error?: string }>
}

/**
 * Renders 1–3 labeled text inputs (stacked, 480px/md modal) for the tool's
 * credential fields. The Validate button is disabled until every required
 * field is non-empty. Validation state (success/error) applies to the
 * entire record, not per-field — matching the backend's all-or-nothing
 * validator contract.
 *
 * Used by:
 *   - Setup wizard Step 2: connect a tool (credentialFields from catalog)
 *   - Setup wizard Step 1: AI provider override (synthesized 1-field
 *     descriptor, routes to /api/workspaces/[id]/api-keys instead of
 *     /api/tools)
 *   - Settings > tool management: same as Step 2
 */
export function CredentialsModal({
  open,
  onClose,
  toolName,
  credentialFields,
  helpUrl,
  prefilledCredentials,
  description,
  onSave,
}: CredentialsModalProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<"idle" | "validating" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  // Reset/prefill whenever the modal opens, including when it reopens
  // for a different tool.
  useEffect(() => {
    if (!open) return
    const initial: Record<string, string> = {}
    for (const f of credentialFields) {
      initial[f.envVar] = prefilledCredentials?.[f.envVar] ?? ""
    }
    setValues(initial)
    setStatus("idle")
    setErrorMsg("")
  }, [open, credentialFields, prefilledCredentials])

  const allRequiredFilled = useMemo(() => {
    return credentialFields.every(
      (f) => !f.required || (values[f.envVar] ?? "").trim().length > 0,
    )
  }, [credentialFields, values])

  async function handleSave() {
    if (!allRequiredFilled) return
    setStatus("validating")
    setErrorMsg("")
    const trimmed: Record<string, string> = {}
    for (const [k, v] of Object.entries(values)) {
      if (v.trim().length > 0) trimmed[k] = v.trim()
    }
    const result = await onSave(trimmed)
    if (result.success) {
      setStatus("success")
      setTimeout(() => {
        setValues({})
        setStatus("idle")
        onClose()
      }, 800)
    } else {
      setStatus("error")
      setErrorMsg(result.error || "Invalid credentials.")
    }
  }

  function handleClose() {
    setValues({})
    setStatus("idle")
    setErrorMsg("")
    onClose()
  }

  const effectiveDescription =
    description ??
    (credentialFields.length === 1
      ? "Enter your API key. Encrypted with AES-256-GCM."
      : `Enter all ${credentialFields.length} required fields. Encrypted with AES-256-GCM.`)

  const buttonLabel =
    credentialFields.length === 1 ? "Validate & save" : "Validate all & save"

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Connect ${toolName}`}
      description={effectiveDescription}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!allRequiredFilled || status === "validating"}
          >
            {status === "validating" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" aria-hidden="true" /> Validating...
              </>
            ) : (
              buttonLabel
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {credentialFields.map((field, idx) => (
          <div key={field.envVar}>
            <label className="block text-[11px] font-medium mb-[3px]">
              {field.label}
              {!field.required && <span className="text-[var(--tx3)] ml-1">(optional)</span>}
            </label>
            <Input
              value={values[field.envVar] ?? ""}
              onChange={(e) => {
                setValues((v) => ({ ...v, [field.envVar]: e.target.value }))
                setStatus("idle")
                setErrorMsg("")
              }}
              placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}...`}
              className="font-mono"
              error={status === "error"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && allRequiredFilled && status !== "validating") {
                  handleSave()
                }
              }}
              autoFocus={idx === 0}
            />
            {field.helpUrl && (
              <p className="text-[11px] text-[var(--tx3)] mt-0.5">
                <a
                  href={field.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--ac)] hover:text-[var(--tx)] hover:underline transition-colors"
                >
                  Where do I find this? →
                </a>
              </p>
            )}
          </div>
        ))}

        {status === "success" && (
          <p className="text-[11px] text-[var(--ok)] inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> Credentials validated and saved
          </p>
        )}
        {status === "error" && (
          <div className="rounded-lg border border-[var(--err)] bg-[var(--errbg)] p-2.5">
            <p className="text-[11px] font-semibold text-[#991b1b] mb-0.5">Validation failed</p>
            <p className="text-[11px] text-[#991b1b]">{errorMsg}</p>
          </div>
        )}
        {helpUrl && !credentialFields.some((f) => f.helpUrl) && (
          <p className="text-[11px] text-[var(--tx3)]">
            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--ac)] hover:text-[var(--tx)] hover:underline transition-colors"
            >
              Where do I find these? →
            </a>
          </p>
        )}
      </div>
    </Modal>
  )
}
