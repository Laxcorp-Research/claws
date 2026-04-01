"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { WizardProgressBar } from "@/components/setup/wizard-progress-bar"
import { ModelSelectionTable } from "@/components/setup/model-selection-table"
import { ToolConnectionList } from "@/components/setup/tool-connection-list"
import { ToolRow, type ToolRowStatus } from "@/components/setup/tool-row"
import { ApiKeyModal } from "@/components/setup/api-key-modal"
import { ToolSwapModal } from "@/components/setup/tool-swap-modal"
import { BrowseToolsModal } from "@/components/setup/browse-tools-modal"
import { CustomApiModal } from "@/components/setup/custom-api-modal"

import { DeployProgress } from "@/components/setup/deploy-progress"
import { ChannelList } from "@/components/setup/channel-list"
import { ChannelRow } from "@/components/setup/channel-row"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Button } from "@/components/ui/button"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { ALL_TOOLS, getToolByName, getToolsByCategory, type ToolDefinition } from "@/data/tool-catalog"
import { DEFAULT_MODEL } from "@/lib/models"
import { Check, CheckCircle, XCircle, AlertTriangle, Package, Sparkles, Bot, ClipboardList, MessageSquare, BarChart3, Wrench, Hash, Smartphone, Send, Building2, Gamepad2, Globe, Loader2, ArrowLeft } from "lucide-react"

interface AgentRow {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  model: string
}

function defaultModel(role: string): string {
  return DEFAULT_MODEL[role] || DEFAULT_MODEL.WORKER
}

const STEP_LABELS = ["AI model", "Tools", "Deploy", "Channels", "Go live"]

function getProgressSteps(current: number) {
  return STEP_LABELS.map((label, i) => ({
    label,
    status: i + 1 < current ? "complete" as const : i + 1 === current ? "current" as const : "upcoming" as const,
  }))
}

interface ProviderStatus {
  provider: string
  hasGlobalKey: boolean
  globalKeyHint: string | null
  globalKeyValid: boolean
  hasOverride: boolean
  overrideKeyHint: string | null
  overrideKeyValid: boolean
  hasKey: boolean
  effectiveSource: "override" | "global" | "none"
}

const PROVIDER_NAMES: Record<string, string> = {
  ANTHROPIC: "Anthropic (Claude)",
  OPENAI: "OpenAI (GPT)",
  GOOGLE: "Google (Gemini)",
  OPENROUTER: "OpenRouter",
  OLLAMA: "Ollama (Local)",
}

const PROVIDER_HELP: Record<string, string> = {
  ANTHROPIC: "https://console.anthropic.com/settings/keys",
  OPENAI: "https://platform.openai.com/api-keys",
  GOOGLE: "https://aistudio.google.com/apikey",
  OPENROUTER: "https://openrouter.ai/keys",
}

const PROVIDER_PLACEHOLDER: Record<string, string> = {
  ANTHROPIC: "sk-ant-api03-...",
  OPENAI: "sk-...",
  GOOGLE: "AIza...",
  OPENROUTER: "sk-or-...",
}

function getRequiredProviders(agents: AgentRow[]): string[] {
  const providers = new Set<string>()
  for (const a of agents) {
    const m = a.model || "anthropic/claude-sonnet-4-6"
    if (m.startsWith("anthropic/")) providers.add("ANTHROPIC")
    else if (m.startsWith("openai/")) providers.add("OPENAI")
    else if (m.startsWith("google/")) providers.add("GOOGLE")
    else if (m.startsWith("openrouter/")) providers.add("OPENROUTER")
  }
  if (providers.size === 0) providers.add("ANTHROPIC")
  return Array.from(providers)
}

function Step1({ workspaceId, isFromBuilder = false }: { workspaceId: string; isFromBuilder?: boolean }) {
  const router = useRouter()
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [keyStatus, setKeyStatus] = useState<ProviderStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingModels, setIsSavingModels] = useState(false)
  const [overrideModal, setOverrideModal] = useState<{ provider: string; providerName: string } | null>(null)

  const fetchKeyStatus = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`)
    const data = await res.json()
    if (data.success) setKeyStatus(data.data || [])
  }, [workspaceId])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const [agentsRes] = await Promise.all([
          fetch(`/api/agents/${workspaceId}`),
          fetchKeyStatus(),
        ])
        const agentsData = await agentsRes.json()
        if (agentsData.success) {
          setAgents(
            agentsData.data.map((a: { id: string; name: string; role: string; model: string | null }) => ({
              id: a.id, name: a.name, role: a.role as AgentRow["role"], model: a.model || defaultModel(a.role),
            }))
          )
        }
      } catch (e) {
        console.error("Failed to load setup data:", e)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [workspaceId, fetchKeyStatus])

  const handleModelChange = useCallback((agentId: string, model: string) => {
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, model } : a)))
  }, [])

  const handleNext = useCallback(async () => {
    setIsSavingModels(true)
    try {
      await Promise.all(
        agents.map((agent) =>
          fetch(`/api/agents/${workspaceId}/${agent.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: agent.model }),
          })
        )
      )
      const fromParam = isFromBuilder ? "?from=builder" : ""
      router.push(`/setup/${workspaceId}/step/2${fromParam}`)
    } catch (e) {
      console.error("Failed to save models:", e)
    } finally {
      setIsSavingModels(false)
    }
  }, [agents, workspaceId, router, isFromBuilder])

  const handleRemoveOverride = useCallback(async (provider: string) => {
    await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    })
    await fetchKeyStatus()
  }, [workspaceId, fetchKeyStatus])

  const requiredProviders = useMemo(() => getRequiredProviders(agents), [agents])

  const allProvidersConfigured = requiredProviders.every(p => {
    const s = keyStatus.find(k => k.provider === p)
    if (!s?.hasKey) return false
    if (s.effectiveSource === "override") return s.overrideKeyValid
    return s.globalKeyValid
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <LoadingSkeleton variant="line" />
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
      </div>
    )
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">Choose AI models for your agents</h2>
      <p className="text-xs text-[var(--tx2)] mb-3.5">
        Your agents need API keys to think. Configure keys for each provider your agents use.
      </p>

      {/* Provider Key Cards */}
      <div className="border border-[var(--bd)] rounded-xl mb-3.5 overflow-hidden">
        {requiredProviders.map((provider) => {
          const status = keyStatus.find(k => k.provider === provider)
          const providerName = PROVIDER_NAMES[provider] || provider
          const usingAgents = agents.filter(a => {
            const m = a.model || ""
            return m.startsWith(`${provider.toLowerCase()}/`)
          })

          return (
            <div key={provider} className="flex items-center justify-between px-3.5 py-[10px] border-b border-[var(--bd)] last:border-b-0">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--tx)]">{providerName}</div>
                {usingAgents.length > 0 && (
                  <div className="text-[11px] text-[var(--tx3)] mt-[2px] truncate">
                    Used by: {usingAgents.map(a => a.name).join(", ")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-[8px] flex-shrink-0 ml-[10px]">
                {status?.hasKey ? (
                  <>
                    {(status.effectiveSource === "override" ? status.overrideKeyValid : status.globalKeyValid) ? (
                      <div className="flex items-center gap-[4px]">
                        <CheckCircle className="w-[14px] h-[14px] text-[var(--ok)]" />
                        <span className="text-[11px] text-[var(--ok)]">
                          {status.effectiveSource === "override"
                            ? `Custom key (${status.overrideKeyHint})`
                            : `Global key (${status.globalKeyHint})`
                          }
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-[4px]">
                        <AlertTriangle className="w-[14px] h-[14px] text-[var(--warn)]" />
                        <span className="text-[11px] text-[var(--warn)]">
                          {status.effectiveSource === "override"
                            ? `Custom key invalid (${status.overrideKeyHint})`
                            : `Global key invalid (${status.globalKeyHint})`
                          }
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => setOverrideModal({ provider, providerName })}
                      className="text-[11px] text-[var(--ac)] hover:underline cursor-pointer bg-transparent border-none"
                    >
                      {status.hasOverride ? "Change key" : "Use different key"}
                    </button>
                    {status.hasOverride && (
                      <button
                        onClick={() => handleRemoveOverride(provider)}
                        className="text-[11px] text-[var(--tx3)] hover:text-[var(--err)] cursor-pointer bg-transparent border-none"
                      >
                        Use global
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-[4px]">
                      <XCircle className="w-[14px] h-[14px] text-[var(--err)]" />
                      <span className="text-[11px] text-[var(--err)]">No key</span>
                    </div>
                    <button
                      onClick={() => setOverrideModal({ provider, providerName })}
                      className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity cursor-pointer border-none"
                    >
                      Enter API key
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-[var(--bg2)] rounded-[8px] p-[10px] mb-3.5">
        <p className="text-[12px] text-[var(--tx2)] leading-[1.5]">
          Keys from Settings are used by default for all Claws.
          You can override with a different key for this specific Claw to track usage separately.
          All keys are encrypted with AES-256-GCM and never stored in plaintext.
        </p>
      </div>

      {/* Model Selection Table */}
      {agents.length > 0 && <ModelSelectionTable agents={agents} onModelChange={handleModelChange} />}

      {/* Recommendations */}
      <div className="bg-[var(--bg2)] rounded-lg p-2.5 text-xs text-[var(--tx2)] mb-3.5 leading-relaxed">
        <strong className="text-[var(--tx)]">Recommended:</strong> Haiku 4.5 for routing (Orchestrator),
        Sonnet 4.6 for tasks (Workers), Opus 4.6 for judgment (Critic). Pre-filled above — override only if needed.
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        {isFromBuilder ? (
          <Button variant="outline" onClick={() => router.push(`/builder/${workspaceId}`)}>← Back to Builder</Button>
        ) : (
          <div />
        )}
        <Button variant="primary" onClick={handleNext} disabled={!allProvidersConfigured || isSavingModels}>
          {isSavingModels ? "Saving..." : "Next: Connect tools →"}
        </Button>
      </div>

      {/* Override Modal */}
      {overrideModal && (
        <ApiKeyModal
          open={true}
          onClose={() => setOverrideModal(null)}
          toolName={overrideModal.providerName}
          helpUrl={PROVIDER_HELP[overrideModal.provider]}
          keyPlaceholder={PROVIDER_PLACEHOLDER[overrideModal.provider]}
          onSave={async (apiKey) => {
            const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: overrideModal.provider, apiKey }),
            })
            const data = await res.json()
            if (res.ok && data.success) {
              await fetchKeyStatus()
              return { success: true }
            }
            return { success: false, error: data.error?.message || "Invalid API key" }
          }}
        />
      )}
    </>
  )
}

// ─── Step 2: Connect Tools ──────────────────────────────────

interface ToolState {
  slug: string
  name: string
  connectionType: "API_KEY" | "OAUTH_COMPOSIO"
  category: string
  status: ToolRowStatus
  errorMessage?: string
  connectionId?: string
  helpUrl?: string
  keyPlaceholder?: string
  required: boolean
}

function Step2({ workspaceId, isFromBuilder = false }: { workspaceId: string; isFromBuilder?: boolean }) {
  const router = useRouter()
  const [tools, setTools] = useState<ToolState[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [apiKeyModal, setApiKeyModal] = useState<{ open: boolean; tool: ToolState | null }>({ open: false, tool: null })
  const [swapModal, setSwapModal] = useState<{ open: boolean; tool: ToolState | null }>({ open: false, tool: null })
  const [browseModal, setBrowseModal] = useState(false)
  const [customApiModal, setCustomApiModal] = useState(false)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const wsRes = await fetch(`/api/workspaces/${workspaceId}`)
        const wsData = await wsRes.json()

        let requiredNames: string[] = ["Claude API"]
        let recommendedNames: string[] = ["Tavily", "Gmail", "Calendar"]

        if (wsData.success && wsData.data?.clawTemplate?.slug) {
          try {
            const tplRes = await fetch(`/api/templates/${wsData.data.clawTemplate.slug}`)
            const tplData = await tplRes.json()
            if (tplData.success) {
              requiredNames = (tplData.data.tools?.required ?? []).map((t: { name: string }) => t.name)
              recommendedNames = (tplData.data.tools?.recommended ?? []).map((t: { name: string }) => t.name)
            }
          } catch { /* fall through to defaults */ }
        }

        const toolsRes = await fetch(`/api/tools/${workspaceId}`)
        const toolsData = await toolsRes.json()
        const existingConnections: Array<{ toolSlug: string; status: string; id: string }> = toolsData.success ? toolsData.data.connections : []

        const buildToolState = (names: string[], required: boolean): ToolState[] =>
          names.map((name) => {
            const def = getToolByName(name)
            const slug = def?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "_")
            const existing = existingConnections.find((c) => c.toolSlug === slug)
            return {
              slug,
              name: def?.name || name,
              connectionType: def?.connectionType || "API_KEY",
              category: def?.category || "CORE",
              status: existing?.status === "CONNECTED" ? "connected" as const : "disconnected" as const,
              connectionId: existing?.id,
              helpUrl: def?.helpUrl,
              keyPlaceholder: def?.keyPlaceholder,
              required,
            }
          })

        setTools([...buildToolState(requiredNames, true), ...buildToolState(recommendedNames, false)])
      } catch (e) {
        console.error("Failed to load tools:", e)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [workspaceId])

  const requiredTools = useMemo(() => tools.filter((t) => t.required), [tools])
  const recommendedTools = useMemo(() => tools.filter((t) => !t.required), [tools])
  const connectedSlugs = useMemo(() => tools.filter((t) => t.status === "connected").map((t) => t.slug), [tools])
  const allRequiredConnected = requiredTools.every((t) => t.status === "connected")

  const refreshTools = useCallback(async () => {
    const res = await fetch(`/api/tools/${workspaceId}`)
    const data = await res.json()
    if (!data.success) return
    const existing: Array<{ toolSlug: string; status: string; id: string }> = data.data.connections
    setTools((prev) =>
      prev.map((t) => {
        const conn = existing.find((c) => c.toolSlug === t.slug)
        return conn ? { ...t, status: conn.status === "CONNECTED" ? "connected" as const : "disconnected" as const, connectionId: conn.id } : t
      })
    )
  }, [workspaceId])

  const handleApiKeySave = useCallback(async (apiKey: string): Promise<{ success: boolean; error?: string }> => {
    if (!apiKeyModal.tool) return { success: false, error: "No tool selected" }
    try {
      const res = await fetch(`/api/tools/${workspaceId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolSlug: apiKeyModal.tool.slug, displayName: apiKeyModal.tool.name, connectionType: "API_KEY", apiKey }),
      })
      const data = await res.json()
      if (data.success) { await refreshTools(); return { success: true } }
      return { success: false, error: data.error?.message }
    } catch { return { success: false, error: "Network error" } }
  }, [apiKeyModal.tool, workspaceId, refreshTools])

  const handleOAuthConnect = useCallback(async (tool: ToolState) => {
    setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "connecting" as const, errorMessage: undefined } : t)))
    console.log(`[Placeholder] OAuth flow for ${tool.name} — would open Composio popup in production`)
    setTimeout(async () => {
      try {
        const res = await fetch(`/api/tools/${workspaceId}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolSlug: tool.slug, displayName: tool.name, connectionType: "OAUTH_COMPOSIO", composioConnectionId: `demo-${tool.slug}` }),
        })
        const data = await res.json()
        if (data.success) {
          await refreshTools()
        } else {
          setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: "OAuth authorization failed. Please try again or use an API key instead." } : t)))
        }
      } catch {
        setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: "OAuth authorization failed. Please try again or use an API key instead." } : t)))
      }
    }, 2000)
  }, [workspaceId, refreshTools])

  const handleSwapSelect = useCallback((newTool: ToolDefinition) => {
    if (!swapModal.tool) return
    setTools((prev) => prev.map((t) => (t.slug === swapModal.tool!.slug ? { ...t, slug: newTool.slug, name: newTool.name, connectionType: newTool.connectionType, category: newTool.category, helpUrl: newTool.helpUrl, keyPlaceholder: newTool.keyPlaceholder, status: "disconnected" as const, connectionId: undefined } : t)))
  }, [swapModal.tool])

  const handleBrowseConnect = useCallback((tool: ToolDefinition) => {
    if (tool.connectionType === "API_KEY") {
      setBrowseModal(false)
      const toolState: ToolState = { slug: tool.slug, name: tool.name, connectionType: tool.connectionType, category: tool.category, status: "disconnected", helpUrl: tool.helpUrl, keyPlaceholder: tool.keyPlaceholder, required: false }
      setApiKeyModal({ open: true, tool: toolState })
    } else {
      setBrowseModal(false)
      const toolState: ToolState = { slug: tool.slug, name: tool.name, connectionType: tool.connectionType, category: tool.category, status: "disconnected", required: false }
      handleOAuthConnect(toolState)
    }
  }, [handleOAuthConnect])

  const handleCustomSave = useCallback(async (data: { name: string; baseUrl: string; authType: string; credential: string; description: string }): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/tools/${workspaceId}/custom`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      })
      const result = await res.json()
      return result.success ? { success: true } : { success: false, error: result.error?.message }
    } catch { return { success: false, error: "Network error" } }
  }, [workspaceId])

  const handleDisconnect = useCallback(async (tool: ToolState) => {
    if (!tool.connectionId) return
    await fetch(`/api/tools/${workspaceId}/${tool.connectionId}`, { method: "DELETE" })
    await refreshTools()
  }, [workspaceId, refreshTools])

  const handleTest = useCallback(async (tool: ToolState) => {
    if (!tool.connectionId) return
    setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "testing" as const, errorMessage: undefined } : t)))
    try {
      const res = await fetch(`/api/tools/${workspaceId}/${tool.connectionId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastTestedAt: new Date().toISOString(), status: "CONNECTED" }),
      })
      const data = await res.json()
      if (data.success) {
        setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "connected" as const, errorMessage: undefined } : t)))
      } else {
        setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: "Could not reach the API. The key may have expired or been revoked." } : t)))
      }
    } catch {
      setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: "Could not reach the API. The key may have expired or been revoked." } : t)))
    }
  }, [workspaceId])

  if (isLoading) {
    return <div className="space-y-3"><LoadingSkeleton variant="line" /><LoadingSkeleton variant="card" /><LoadingSkeleton variant="card" /></div>
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">{isFromBuilder ? "Manage Tools" : "Connect your tools"}</h2>
      <p className="text-xs text-[var(--tx2)] mb-3.5">
        {isFromBuilder
          ? "Connect the services your agents need. API keys are encrypted with AES-256-GCM."
          : "Connect the services your agents need to do their job."}
      </p>

      {(requiredTools.length > 0 || recommendedTools.length > 0) && (
        <div className="bg-[var(--bg2)] rounded-[8px] p-[10px] mb-[10px]">
          <p className="text-[12px] text-[var(--tx2)] leading-[1.5]">
            Tools are external services your agents connect to — APIs, CRMs, email providers, and more.
            Each connection gives your agents the ability to interact with that service on your behalf.
            API keys are encrypted with AES-256-GCM and never stored in plaintext.
          </p>
        </div>
      )}

      {requiredTools.length === 0 && recommendedTools.length === 0 && (
        <div className="text-center py-[30px] border border-dashed border-[var(--bd)] rounded-[12px] mb-3.5">
          <Wrench className="w-[24px] h-[24px] text-[var(--tx3)] mx-auto mb-[8px]" />
          <h3 className="text-[14px] font-semibold text-[var(--tx)] mb-[4px]">No tools configured yet</h3>
          <p className="text-[12px] text-[var(--tx2)] mb-[10px] max-w-[300px] mx-auto">
            Your custom Claw doesn&apos;t have pre-configured tools. Browse the catalog to add tools your agents can use.
          </p>
          <Button variant="outline" onClick={() => setBrowseModal(true)}>
            Browse available tools
          </Button>
        </div>
      )}

      {requiredTools.length > 0 && (
        <ToolConnectionList title="Required tools" subtitle="Must be connected before deployment">
          {requiredTools.map((tool) => (
            <ToolRow
              key={tool.slug}
              name={tool.name}
              description={tool.category}
              connectionStatus={tool.status}
              connectionType={tool.connectionType}
              errorMessage={tool.errorMessage}
              onConnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
              onReconnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
              onTest={tool.status === "connected" || tool.status === "testing" ? () => handleTest(tool) : undefined}
              onDisconnect={() => handleDisconnect(tool)}
            />
          ))}
        </ToolConnectionList>
      )}

      {recommendedTools.length > 0 && (
        <ToolConnectionList title="Recommended tools" subtitle="Pre-selected. Connect or swap for an alternative.">
          {recommendedTools.map((tool) => (
            <ToolRow
              key={tool.slug}
              name={tool.name}
              description={tool.category}
              connectionStatus={tool.status}
              connectionType={tool.connectionType}
              errorMessage={tool.errorMessage}
              swappable
              onConnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
              onReconnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
              onSwap={() => setSwapModal({ open: true, tool })}
              onTest={tool.status === "connected" || tool.status === "testing" ? () => handleTest(tool) : undefined}
              onDisconnect={() => handleDisconnect(tool)}
            />
          ))}
        </ToolConnectionList>
      )}

      <div className="flex gap-2.5 mb-3.5">
        <Button variant="outline" className="flex-1 text-[11px] py-2" onClick={() => setBrowseModal(true)}>+ Browse available tools</Button>
        <Button variant="outline" className="flex-1 text-[11px] py-2" onClick={() => setCustomApiModal(true)}>+ Connect custom API</Button>
      </div>

      {isFromBuilder ? (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/builder/${workspaceId}`)}>← Back to Builder</Button>
          <Button variant="primary" onClick={() => router.push(`/builder/${workspaceId}`)}>Done</Button>
        </div>
      ) : (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/1`)}>← Back</Button>
          <div className="flex gap-1.5">
            <Button variant="outline" disabled={!allRequiredConnected} onClick={() => router.push(`/setup/${workspaceId}/step/3`)}>Skip optional</Button>
            <Button variant="primary" disabled={!allRequiredConnected} onClick={() => router.push(`/setup/${workspaceId}/step/3`)}>Next: Deploy →</Button>
          </div>
        </div>
      )}


      {/* Modals */}
      <ApiKeyModal
        open={apiKeyModal.open}
        onClose={() => setApiKeyModal({ open: false, tool: null })}
        toolName={apiKeyModal.tool?.name || ""}
        helpUrl={apiKeyModal.tool?.helpUrl}
        keyPlaceholder={apiKeyModal.tool?.keyPlaceholder}
        onSave={handleApiKeySave}
      />
      <ToolSwapModal
        open={swapModal.open}
        onClose={() => setSwapModal({ open: false, tool: null })}
        category={swapModal.tool?.category || ""}
        currentTool={swapModal.tool?.name || ""}
        alternatives={swapModal.tool ? getToolsByCategory(swapModal.tool.category).filter((t) => t.slug !== swapModal.tool!.slug) : []}
        onSelect={handleSwapSelect}
      />
      <BrowseToolsModal open={browseModal} onClose={() => setBrowseModal(false)} connectedSlugs={connectedSlugs} onConnect={handleBrowseConnect} />
      <CustomApiModal open={customApiModal} onClose={() => setCustomApiModal(false)} onSave={handleCustomSave} />
    </>
  )
}

// ─── Placeholder Steps (3-5) ────────────────────────────────

// ─── Step 3: Deploy ─────────────────────────────────────────

interface DeployStepItem { label: string; status: "complete" | "running" | "pending" | "failed" }

const DEPLOY_STAGES = [
  { label: "Generating workspace files", key: "GENERATING" },
  { label: "Provisioning container", key: "PROVISIONING" },
  { label: "Configuring workspace", key: "CONFIGURING" },
  { label: "Starting gateway", key: "STARTING" },
  { label: "Health check", key: "HEALTH_CHECK" },
  { label: "Connecting channels", key: "WAITING_CHANNELS" },
  { label: "Complete", key: "COMPLETED" },
]

const DEPLOY_ORDER = DEPLOY_STAGES.map((s) => s.key)

const FAILURE_REASONS: Record<string, string> = {
  GENERATING: "Failed to generate workspace configuration. This is unusual — please try again.",
  PROVISIONING: "Could not provision a container. The hosting service may be temporarily unavailable.",
  CONFIGURING: "Failed to configure agents and tools in the container. Check that all required tools are connected.",
  STARTING: "Container failed to start. Check your API keys are valid.",
  HEALTH_CHECK: "Agents are not responding after startup. An API key may be invalid or a tool connection expired.",
  WAITING_CHANNELS: "Failed to connect communication channels. You can retry or skip and connect them later.",
}

function mapDeployStatus(status: string | null, failedStage?: string | null): DeployStepItem[] {
  if (!status || status === "PENDING") return DEPLOY_STAGES.map((s, i) => ({ label: s.label, status: i === 0 ? "running" as const : "pending" as const }))

  if (status === "FAILED") {
    const failIdx = failedStage ? DEPLOY_ORDER.indexOf(failedStage) : -1
    return DEPLOY_STAGES.map((s) => {
      const si = DEPLOY_ORDER.indexOf(s.key)
      if (failIdx >= 0) {
        if (si < failIdx) return { label: s.label, status: "complete" as const }
        if (si === failIdx) return { label: s.label, status: "failed" as const }
      }
      return { label: s.label, status: "pending" as const }
    })
  }

  const idx = DEPLOY_ORDER.indexOf(status)
  return DEPLOY_STAGES.map((s) => {
    const si = DEPLOY_ORDER.indexOf(s.key)
    if (si < idx) return { label: s.label, status: "complete" as const }
    if (si === idx) return { label: s.label, status: status === "COMPLETED" ? "complete" as const : "running" as const }
    return { label: s.label, status: "pending" as const }
  })
}

function getFailureMessage(failedStage?: string | null, serverError?: string | null): string {
  if (failedStage && FAILURE_REASONS[failedStage]) return FAILURE_REASONS[failedStage]
  if (serverError) return serverError
  return "Deployment failed. Please check your tool connections and API keys, then try again."
}

interface DeployEligibility {
  canDeploy: boolean
  reason: string
  needsSubscription: boolean
  isFirstDeploy: boolean
}

function Step3({ workspaceId, isFromBuilder = false }: { workspaceId: string; isFromBuilder?: boolean }) {
  const router = useRouter()
  const [isDeploying, setIsDeploying] = useState(false)
  const [deploymentStatus, setDeploymentStatus] = useState<string | null>(null)
  const [deploymentError, setDeploymentError] = useState<string | null>(null)
  const [failedStage, setFailedStage] = useState<string | null>(null)
  const [eligibility, setEligibility] = useState<DeployEligibility | null>(null)
  const [subscribing, setSubscribing] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function fetchEligibility() {
      try {
        const res = await fetch("/api/user/billing")
        const json = await res.json()
        if (!json.success) return
        const d = json.data
        const now = new Date()
        if (!d.trialUsed) {
          setEligibility({ canDeploy: true, reason: "first_deploy_trial", needsSubscription: false, isFirstDeploy: true })
        } else if (d.trialEndsAt && new Date(d.trialEndsAt) > now) {
          setEligibility({ canDeploy: true, reason: "trial_active", needsSubscription: false, isFirstDeploy: false })
        } else if (d.hasActiveSubscription) {
          setEligibility({ canDeploy: true, reason: "subscribed", needsSubscription: false, isFirstDeploy: false })
        } else {
          setEligibility({ canDeploy: false, reason: "subscription_required", needsSubscription: true, isFirstDeploy: false })
        }
      } catch {}
    }
    fetchEligibility()
  }, [])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/deploy/${workspaceId}/status`)
        const json = await res.json()
        if (json.success && json.data.deployment) {
          const dep = json.data.deployment
          setDeploymentStatus(dep.status)
          if (dep.errorMessage) setDeploymentError(dep.errorMessage)
          if (dep.failedStage) setFailedStage(dep.failedStage)
          if (dep.status === "COMPLETED" || dep.status === "FAILED") {
            stopPolling()
            setIsDeploying(false)
          }
        }
      } catch { /* retry next poll */ }
    }, 1500)
  }, [workspaceId, stopPolling])

  useEffect(() => { return () => stopPolling() }, [stopPolling])

  useEffect(() => {
    async function checkExisting() {
      try {
        const res = await fetch(`/api/deploy/${workspaceId}/status`)
        const json = await res.json()
        if (json.success && json.data.deployment) {
          const dep = json.data.deployment
          setDeploymentStatus(dep.status)
          if (dep.errorMessage) setDeploymentError(dep.errorMessage)
          if (dep.failedStage) setFailedStage(dep.failedStage)
          if (!["COMPLETED", "FAILED"].includes(dep.status)) { setIsDeploying(true); startPolling() }
        }
      } catch {}
    }
    checkExisting()
  }, [workspaceId, startPolling])

  const handleDeploy = useCallback(async () => {
    setIsDeploying(true); setDeploymentStatus("PENDING"); setDeploymentError(null); setFailedStage(null)
    try {
      const res = await fetch(`/api/deploy/${workspaceId}/cloud`, { method: "POST" })
      const json = await res.json()
      if (json.success) { startPolling() }
      else {
        if (json.error?.code === "SUBSCRIPTION_REQUIRED") {
          setEligibility({ canDeploy: false, reason: "subscription_required", needsSubscription: true, isFirstDeploy: false })
        }
        setDeploymentError(json.error?.message || "Failed to start deployment")
        setIsDeploying(false)
      }
    } catch { setDeploymentError("Network error"); setIsDeploying(false) }
  }, [workspaceId, startPolling])

  const handleSubscribe = useCallback(async () => {
    setSubscribing(true)
    try {
      const res = await fetch("/api/dodo-payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "claw_platform", workspaceId }),
      })
      const json = await res.json()
      if (json.data?.checkoutUrl) {
        window.location.href = json.data.checkoutUrl
      } else if (json.data?.mockMode) {
        setEligibility({ canDeploy: true, reason: "subscribed", needsSubscription: false, isFirstDeploy: false })
      }
    } catch {}
    setSubscribing(false)
  }, [workspaceId])

  const canProceed = deploymentStatus === "COMPLETED"
  const needsSub = eligibility?.needsSubscription === true

  function getDeployButtonLabel() {
    if (isDeploying) return "Deploying..."
    if (eligibility?.isFirstDeploy) return "Deploy — 3-day free trial"
    return "Deploy"
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">Deploy your Claw</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-1">Your Claw will be deployed to a managed cloud container.</p>
      {eligibility?.isFirstDeploy ? (
        <p className="text-[10px] text-[var(--ac)] font-medium mb-3.5">3-day free trial — no payment required. $79/mo after trial.</p>
      ) : (
        <p className="text-[10px] text-[var(--tx3)] mb-3.5">$79/mo platform fee per running Claw</p>
      )}

      {needsSub && !deploymentStatus && (
        <AlertBanner variant="warning">
          <p className="font-medium">Your 3-day trial has ended</p>
          <p className="mt-0.5 opacity-80">Subscribe to the Claw Platform ($79/mo) to deploy and run your Claws.</p>
        </AlertBanner>
      )}

      {!deploymentStatus && (
        needsSub ? (
          <Button variant="primary" size="default" onClick={handleSubscribe} loading={subscribing}>
            Subscribe to Deploy — $79/mo
          </Button>
        ) : (
          <Button variant="primary" size="default" onClick={handleDeploy} disabled={isDeploying || !eligibility}>
            {getDeployButtonLabel()}
          </Button>
        )
      )}

      {deploymentStatus && (
        <div className="mb-4">
          <DeployProgress
            steps={mapDeployStatus(deploymentStatus, failedStage)}
            failureDetail={deploymentStatus === "FAILED" ? getFailureMessage(failedStage, deploymentError) : undefined}
          />
        </div>
      )}

      {deploymentStatus === "FAILED" && (
        <AlertBanner variant="error" actions={
          <div className="flex gap-1.5">
            <Button variant="primary" size="sm" onClick={handleDeploy}>Retry deployment</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(`/setup/${workspaceId}/step/2${isFromBuilder ? "?from=builder" : ""}`)}>Check tool connections</Button>
          </div>
        }>
          <p className="font-medium">Deployment failed</p>
          <p className="mt-0.5 opacity-80">{getFailureMessage(failedStage, deploymentError)}</p>
        </AlertBanner>
      )}

      {deploymentStatus === "COMPLETED" && (
        <AlertBanner variant="info" icon={<CheckCircle className="w-4 h-4" />}>
          <p><strong>Deployment successful.</strong> Your Claw is running in the cloud.</p>
        </AlertBanner>
      )}

      <div className="flex justify-between mt-4">
        <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/2${isFromBuilder ? "?from=builder" : ""}`)}>← Back</Button>
        <Button variant="primary" disabled={!canProceed} onClick={() => router.push(`/setup/${workspaceId}/step/4${isFromBuilder ? "?from=builder" : ""}`)}>Next: Channels →</Button>
      </div>
    </>
  )
}

// ─── Step 4: Connect Channels ───────────────────────────────

const ICON_CLASS = "w-4 h-4"

const CHANNELS = [
  { id: "web-chat", name: "Web chat", description: "Built-in — always available", icon: <Globe className={ICON_CLASS} />, alwaysConnected: true },
  { id: "whatsapp", name: "WhatsApp", description: "Scan QR code to connect", icon: <Smartphone className={ICON_CLASS} />, alwaysConnected: false },
  { id: "slack", name: "Slack", description: "Connect via OAuth", icon: <Hash className={ICON_CLASS} />, alwaysConnected: false },
  { id: "telegram", name: "Telegram", description: "Enter bot token from @BotFather", icon: <Send className={ICON_CLASS} />, alwaysConnected: false },
  { id: "microsoft-teams", name: "Microsoft Teams", description: "Azure Bot Service setup required", icon: <Building2 className={ICON_CLASS} />, alwaysConnected: false },
  { id: "discord", name: "Discord", description: "Enter bot token from Developer Portal", icon: <Gamepad2 className={ICON_CLASS} />, alwaysConnected: false },
]

function Step4({ workspaceId, isFromBuilder = false }: { workspaceId: string; isFromBuilder?: boolean }) {
  const router = useRouter()
  const [channelStatuses, setChannelStatuses] = useState<Record<string, "connected" | "disconnected" | "connecting" | "error">>({
    "web-chat": "connected",
    "whatsapp": "disconnected",
    "slack": "disconnected",
    "telegram": "disconnected",
    "microsoft-teams": "disconnected",
    "discord": "disconnected",
  })
  const [channelErrors, setChannelErrors] = useState<Record<string, string>>({})

  const handleConnect = useCallback(async (channelId: string) => {
    setChannelStatuses((prev) => ({ ...prev, [channelId]: "connecting" }))
    setChannelErrors((prev) => { const next = { ...prev }; delete next[channelId]; return next })
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      setChannelStatuses((prev) => ({ ...prev, [channelId]: "connected" }))
    } catch {
      setChannelStatuses((prev) => ({ ...prev, [channelId]: "error" }))
      setChannelErrors((prev) => ({ ...prev, [channelId]: "Connection failed. Please try again." }))
    }
  }, [])

  const handleDisconnect = useCallback((channelId: string) => {
    setChannelStatuses((prev) => ({ ...prev, [channelId]: "disconnected" }))
    setChannelErrors((prev) => { const next = { ...prev }; delete next[channelId]; return next })
  }, [])

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">How should your Claw talk to you?</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-3.5">Web chat is always available. Connect additional channels for real-time communication.</p>

      <ChannelList>
        {CHANNELS.map((channel) => (
          <ChannelRow
            key={channel.id}
            name={channel.name}
            description={channel.description}
            icon={channel.icon}
            status={channelStatuses[channel.id] || "disconnected"}
            errorMessage={channelErrors[channel.id]}
            alwaysConnected={channel.alwaysConnected}
            onConnect={() => handleConnect(channel.id)}
            onDisconnect={() => handleDisconnect(channel.id)}
          />
        ))}
      </ChannelList>

      <div className="flex justify-between mt-3.5">
        <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/3${isFromBuilder ? "?from=builder" : ""}`)}>← Back</Button>
        <Button variant="primary" onClick={() => router.push(`/setup/${workspaceId}/step/5`)}>Next: Go live →</Button>
      </div>
    </>
  )
}

// ─── Step 5: Go Live ────────────────────────────────────────

function Step5({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [wsName, setWsName] = useState("Your Claw")
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    async function activate() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}`)
        const json = await res.json()
        if (json.success) setWsName(json.data.name || "Your Claw")

        if (!activated) {
          await fetch(`/api/workspaces/${workspaceId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "RUNNING" }),
          })
          setActivated(true)
        }
      } catch {}
    }
    activate()
  }, [workspaceId, activated])

  return (
    <div className="text-center py-[30px] px-5">
      <div className="flex items-center justify-center w-10 h-10 text-[var(--ok)] mx-auto mb-3">
        <Sparkles className="w-10 h-10" />
      </div>
      <h2 className="text-xl font-semibold mb-1.5">Your {wsName} is live!</h2>
      <p className="text-sm text-[var(--tx2)] mb-1">Your agents are starting up now.</p>

      <div className="text-left max-w-lg mx-auto bg-[var(--bg2)] rounded-lg p-3.5 mt-4 text-xs text-[var(--tx2)] leading-[1.8]">
        <p className="font-semibold text-[var(--tx)] mb-1">What happens next:</p>
        <p className="flex items-start gap-1.5"><Bot className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span><strong>Next few minutes:</strong> Your Orchestrator introduces itself and confirms all agents are operational.</span></p>
        <p className="flex items-start gap-1.5"><ClipboardList className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span><strong>Tomorrow morning:</strong> Your first daily briefing arrives with status updates and action items.</span></p>
        <p className="mt-2 font-semibold text-[var(--tx)] mb-1">Quick tips:</p>
        <p className="flex items-start gap-1.5"><MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span>Message your Orchestrator anytime through the connected channels.</span></p>
        <p className="flex items-start gap-1.5"><BarChart3 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span>Check the Dashboard for real-time agent activity and approvals.</span></p>
        <p className="flex items-start gap-1.5"><Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span>Open the Builder to customize agent behavior, skills, and workflows.</span></p>
      </div>

      <div className="flex gap-2 justify-center mt-4">
        <Button variant="primary" size="lg" onClick={() => router.push(`/dashboard/${workspaceId}`)}>Open Dashboard</Button>
        <Button variant="outline" size="lg" onClick={() => router.push(`/builder/${workspaceId}`)}>Customize in Builder</Button>
      </div>
    </div>
  )
}

// ─── Placeholder (safety fallback) ──────────────────────────

function StepPlaceholder({ step, workspaceId }: { step: number; workspaceId: string }) {
  const router = useRouter()
  const labels = ["", "AI model", "Connect tools", "Deploy", "Connect channels", "Go live"]
  return (
    <>
      <h2 className="text-[15px] font-semibold mb-2">{labels[step]}</h2>
      <p className="text-xs text-[var(--tx2)] mb-4">This step will be built in a future prompt.</p>
      <div className="flex justify-between">
        {step > 1 && (
          <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/${step - 1}`)}>
            ← Back
          </Button>
        )}
        <div className="ml-auto">
          {step < 5 && (
            <Button variant="primary" onClick={() => router.push(`/setup/${workspaceId}/step/${step + 1}`)}>
              Next →
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

export default function SetupStepPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const workspaceId = params.workspaceId as string
  const stepNum = parseInt(params.n as string, 10)
  const isFromBuilder = searchParams.get("from") === "builder"

  if (isNaN(stepNum) || stepNum < 1 || stepNum > 5) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-4 text-center py-10">
        <p className="text-sm text-[var(--tx2)]">Invalid step. Please go back to your workspace.</p>
      </div>
    )
  }

  const progressSteps = stepNum === 5
    ? [
        { label: "AI model", status: "complete" as const },
        { label: "Tools", status: "complete" as const },
        { label: "Deploy", status: "complete" as const },
        { label: "Channels", status: "complete" as const },
        { label: "Live!", status: "complete" as const },
      ]
    : getProgressSteps(stepNum)

  const showWizardChrome = !(stepNum === 2 && isFromBuilder)

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <Link
        href={isFromBuilder ? `/builder/${workspaceId}` : "/my-claws"}
        className="text-[11px] text-[var(--ac)] hover:text-[var(--tx)] mb-[10px] inline-flex items-center gap-1"
      >
        <ArrowLeft size={12} aria-hidden="true" />
        {isFromBuilder ? "Back to Builder" : "Back to My Claws"}
      </Link>
      {showWizardChrome && (
        <div className="mb-[14px]">
          <WizardProgressBar steps={progressSteps} />
        </div>
      )}
      {stepNum === 1 ? <Step1 workspaceId={workspaceId} isFromBuilder={isFromBuilder} />
        : stepNum === 2 ? <Step2 workspaceId={workspaceId} isFromBuilder={isFromBuilder} />
        : stepNum === 3 ? <Step3 workspaceId={workspaceId} isFromBuilder={isFromBuilder} />
        : stepNum === 4 ? <Step4 workspaceId={workspaceId} isFromBuilder={isFromBuilder} />
        : stepNum === 5 ? <Step5 workspaceId={workspaceId} />
        : <StepPlaceholder step={stepNum} workspaceId={workspaceId} />}
    </div>
  )
}
