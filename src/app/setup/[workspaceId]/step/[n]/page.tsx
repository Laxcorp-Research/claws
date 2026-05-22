"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { WizardProgressBar } from "@/components/setup/wizard-progress-bar"
import { ModelSelectionTable } from "@/components/setup/model-selection-table"
import { ToolConnectionList } from "@/components/setup/tool-connection-list"
import { ToolRow } from "@/components/setup/tool-row"
import { CredentialsModal } from "@/components/setup/credentials-modal"
import { ToolSwapModal } from "@/components/setup/tool-swap-modal"
import { BrowseToolsModal } from "@/components/setup/browse-tools-modal"
import { CustomApiModal } from "@/components/setup/custom-api-modal"

import { DeployProgress } from "@/components/setup/deploy-progress"
import { ChannelList } from "@/components/setup/channel-list"
import { ChannelRow } from "@/components/setup/channel-row"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { useOAuthConnection } from "@/lib/oauth/use-oauth-connection"
import { disconnectOauthTool } from "@/lib/oauth/disconnect-oauth-tool"
import { getToolBySlug, getToolsByCategory, type ToolDefinition } from "@/data/tool-catalog"
import {
  type ToolState,
  type ServerConnectionSummary,
  type BYOKModalState,
  connectionUiState,
  buildExtraToolsFromConnections,
  mergeRefreshedTools,
  resolveByokModalProps,
} from "@/components/setup/tools-state"
import {
  UNSUPPORTED_TOOLKITS,
  UNSUPPORTED_TOOLKIT_TOOLTIP,
} from "@/lib/composio/cheap-ops"
import { DEFAULT_MODEL } from "@/lib/models"
import { CheckCircle, XCircle, AlertTriangle, Sparkles, Bot, ClipboardList, MessageSquare, BarChart3, Wrench, Hash, Smartphone, Send, Building2, Gamepad2, Globe, Loader2 } from "lucide-react"
import { isCreditUser } from "@/lib/credits/api-key-source"
import type { ApiKeySource } from "@/generated/prisma/client"

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
  const [creditMode, setCreditMode] = useState(false)

  const fetchKeyStatus = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`)
    const data = await res.json()
    if (data.success) setKeyStatus(data.data || [])
  }, [workspaceId])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const [agentsRes, creditRes] = await Promise.all([
          fetch(`/api/agents/${workspaceId}`),
          fetch("/api/credits/balance"),
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
        const creditData = await creditRes.json()
        if (creditData.success && creditData.data?.hasCredits && creditData.data?.status === "ACTIVE") {
          setCreditMode(true)
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
      router.push(`/setup/${workspaceId}/step/2`)
    } catch (e) {
      console.error("Failed to save models:", e)
    } finally {
      setIsSavingModels(false)
    }
  }, [agents, workspaceId, router])

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
        {creditMode
          ? "Your agents are powered by Claws Starter Credits. Choose which models each agent should use below."
          : "Your agents need API keys to think. Configure keys for each provider your agents use."}
      </p>

      {creditMode && (
        <div className="bg-[var(--bg2)] border border-[var(--bd)] rounded-xl p-3.5 mb-3.5 flex items-start gap-2.5">
          <CheckCircle className="w-4 h-4 text-[var(--ok)] flex-shrink-0 mt-[1px]" />
          <div>
            <p className="text-[13px] font-medium mb-0.5">AI models powered by Claws Starter Credits</p>
            <p className="text-[11px] text-[var(--tx2)]">You have $25.00 in free credits — no API key needed.</p>
          </div>
        </div>
      )}

      {!creditMode && (
      <>
      <div className="border border-[var(--bd)] rounded-xl mb-3.5 overflow-hidden">
        {requiredProviders.map((provider) => {
          const status = keyStatus.find(k => k.provider === provider)
          const providerName = PROVIDER_NAMES[provider] || provider
          const usingAgents = agents.filter(a => {
            const m = a.model || ""
            return m.startsWith(`${provider.toLowerCase()}/`)
          })

          return (
            <div key={provider} className="flex items-start justify-between gap-[24px] px-3.5 py-[10px] border-b border-[var(--bd)] last:border-b-0">
              <div className="min-w-0 max-w-[60%]">
                <div className="text-[13px] font-medium text-[var(--tx)]">{providerName}</div>
                {usingAgents.length > 0 && (
                  <div className="text-[11px] text-[var(--tx3)] mt-[2px]">
                    Used by: {usingAgents.map(a => a.name).join(", ")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-[8px] flex-shrink-0 whitespace-nowrap">
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
      </>
      )}

      {/* Model Selection Table */}
      {agents.length > 0 && <ModelSelectionTable agents={agents} onModelChange={handleModelChange} creditMode={creditMode} />}

      {creditMode && (
        <p className="text-[11px] text-[var(--tx3)] mb-3.5">
          Starter credits work with Claude models. To use GPT or Gemini, add your own API key in Settings.
        </p>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        {isFromBuilder ? (
          <Button variant="outline" onClick={() => router.push(`/builder/${workspaceId}`)}>← Back to Builder</Button>
        ) : (
          <div />
        )}
        <Button variant="primary" onClick={handleNext} disabled={(!creditMode && !allProvidersConfigured) || isSavingModels}>
          {isSavingModels ? "Saving..." : "Next: Connect tools →"}
        </Button>
      </div>

      {/* AI Provider Override Modal — uses CredentialsModal with a
          synthesized 1-field descriptor. The backend endpoint for AI
          provider keys is /api/workspaces/[id]/api-keys, which is a
          different path than the tool-connection endpoint and still
          expects { provider, apiKey } in the body. We extract the
          single field from the credentials record before posting. */}
      {overrideModal && (
        <CredentialsModal
          open={true}
          onClose={() => setOverrideModal(null)}
          toolName={overrideModal.providerName}
          helpUrl={PROVIDER_HELP[overrideModal.provider]}
          credentialFields={[
            {
              envVar: `${overrideModal.provider}_API_KEY`,
              label: "API Key",
              required: true,
              primary: true,
              placeholder: PROVIDER_PLACEHOLDER[overrideModal.provider],
            },
          ]}
          onSave={async (credentials) => {
            const apiKey = Object.values(credentials)[0] ?? ""
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
// ToolState, ServerConnectionSummary, and connectionUiState moved to
// src/components/setup/tools-state.ts in Commit 9 so the non-template
// merge logic added below is unit-testable.

function Step2({ workspaceId, isManageMode = false }: { workspaceId: string; isManageMode?: boolean }) {
  const router = useRouter()
  const [tools, setTools] = useState<ToolState[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [composioOAuthAvailable, setComposioOAuthAvailable] = useState(false)
  const [apiKeyModal, setApiKeyModal] = useState<{ open: boolean; tool: ToolState | null }>({ open: false, tool: null })
  // PR2.9: BYOK modal state. Distinct from `apiKeyModal` because:
  //   - apiKeyModal is for direct API_KEY tools (our DB stores the key,
  //     POST to /api/tools/[wsId] with credentials).
  //   - byokModal is for OAUTH_COMPOSIO toolkits that accept user-supplied
  //     API keys (Composio stores the key, POST to /byok/submit).
  // Sharing one state for both would conflate connectionType + endpoint.
  const [byokModal, setByokModal] = useState<BYOKModalState>({
    open: false,
    tool: null,
    apiKeyForm: null,
  })
  const [swapModal, setSwapModal] = useState<{ open: boolean; tool: ToolState | null }>({ open: false, tool: null })
  const [browseModal, setBrowseModal] = useState(false)
  const [customApiModal, setCustomApiModal] = useState(false)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const wsRes = await fetch(`/api/workspaces/${workspaceId}`)
        const wsData = await wsRes.json()

        // PR2.8a Task 7: switched from name-based (`getToolByName(t.name)`)
        // to slug-based (`getToolBySlug(t.slug)`) template-tool resolution.
        // The API route at /api/templates/{slug} already returns both fields
        // in each entry of `tools.required` / `tools.recommended`; pre-PR2.8a
        // the wizard read only `.name` and substring-matched it back to the
        // catalog (see the pre-PR2.7 Deploy-blocker for the "Claude API" vs
        // "Anthropic (Claude)" miss that TOOL_NAME_ALIASES papered over).
        //
        // Each entry has shape:
        //   { slug: string, name: string, category, connectionType, required,
        //     alternatives?: string[] }
        // `alternatives` is typed as a "oneOf" — the user can connect any one
        // of `[slug, ...alternatives]` to satisfy the entry. Pre-PR2.8a this
        // field was decorative (only the marketplace store page rendered it as
        // a visual hint); now it's load-bearing in the resolver's default-pick
        // logic. PR2.8b adds explicit picker UI.
        interface TemplateToolEntry {
          slug: string
          name: string
          category: string
          connectionType: "API_KEY" | "OAUTH_COMPOSIO"
          required: boolean
          alternatives?: string[]
        }

        let requiredEntries: TemplateToolEntry[] = []
        let recommendedEntries: TemplateToolEntry[] = []

        if (wsData.success && wsData.data?.clawTemplate?.slug) {
          try {
            const tplRes = await fetch(`/api/templates/${wsData.data.clawTemplate.slug}`)
            const tplData = await tplRes.json()
            if (tplData.success) {
              requiredEntries = (tplData.data.tools?.required ?? []) as TemplateToolEntry[]
              recommendedEntries = (tplData.data.tools?.recommended ?? []) as TemplateToolEntry[]
            }
          } catch { /* fall through to defaults */ }
        }

        const toolsRes = await fetch(`/api/tools/${workspaceId}`)
        const toolsData = await toolsRes.json()
        if (toolsData.success) {
          setComposioOAuthAvailable(Boolean(toolsData.data.composioOAuthAvailable))
        }
        const existingConnections: Array<{ toolSlug: string; status: string; id: string; displayName: string; connectionType: string; lastError?: string | null; createdAt?: string | null }> = toolsData.success ? toolsData.data.connections : []

        // Given a `{ slug, alternatives? }` pair, pick the slug the wizard
        // should render today. Priority:
        //   1. Any slug in the oneOf set with an already-connected
        //      ToolConnection row (preserves user's prior choice).
        //   2. The first non-`comingSoon` catalog entry in the oneOf set.
        //   3. The primary slug (even if `comingSoon`) — caller then decides
        //      whether to drop the row via comingSoon filtering.
        // Returns the catalog ToolDefinition for the chosen slug, or undefined
        // if the primary slug itself isn't in the catalog (shouldn't happen
        // post-PR2.8a Task 5 — every seed slug is catalog-resident).
        const resolveOneOfSlug = (entry: TemplateToolEntry): { slug: string; def: ToolDefinition | undefined } => {
          const candidates = [entry.slug, ...(entry.alternatives ?? [])]
          // 1. Already-connected?
          for (const s of candidates) {
            if (existingConnections.some((c) => c.toolSlug === s)) {
              return { slug: s, def: getToolBySlug(s) }
            }
          }
          // 2. First non-comingSoon catalog entry?
          for (const s of candidates) {
            const d = getToolBySlug(s)
            if (d && !d.comingSoon) return { slug: s, def: d }
          }
          // 3. Primary fallback (may be comingSoon or missing from catalog).
          return { slug: entry.slug, def: getToolBySlug(entry.slug) }
        }

        // Turn one TemplateToolEntry into a ToolState row, or null if the
        // entry resolves entirely to `comingSoon: true` catalog entries and
        // should be filtered from render today. PR2.8b replaces the null
        // return with proper "Coming Soon" badge rendering.
        const resolveToolEntry = (entry: TemplateToolEntry, required: boolean): ToolState | null => {
          const { slug: chosenSlug, def } = resolveOneOfSlug(entry)

          if (!def) {
            // Primary slug + alternatives all missing from catalog. PR2.8a
            // Task 5 reconciliation + template-tool-references.test.ts
            // guarantee this can't happen; fail loud if it ever does so a
            // regression is caught at runtime rather than silently rendered
            // as an "Enter all 0 required fields" modal.
            throw new Error(
              `[setup-wizard] template references slug "${entry.slug}" (+ alternatives ${JSON.stringify(entry.alternatives ?? [])}) but none resolve in ALL_TOOLS. Update the catalog or the template.`,
            )
          }

          if (def.comingSoon) {
            // Every slug in the oneOf set is `comingSoon: true` — the
            // integration isn't shippable yet. Skip from render; PR2.8b
            // replaces this with a "Coming Soon" badge.
            console.info(
              `[setup-wizard] filtering ${required ? "required" : "recommended"} tool entry "${entry.slug}" — all candidates are comingSoon (${def.comingSoonReason ?? "no reason given"}).`,
            )
            return null
          }

          const directMatch = existingConnections.find((c) => c.toolSlug === chosenSlug)
          if (directMatch) {
            const ui = connectionUiState(directMatch)
            return {
              slug: chosenSlug,
              name: def.name,
              connectionType: def.connectionType,
              category: def.category,
              status: ui.status,
              errorMessage: ui.errorMessage,
              warningMessage: ui.warningMessage,
              connectionId: directMatch.id,
              connectedAt: directMatch.createdAt ?? null,
              helpUrl: def.helpUrl,
              keyPlaceholder: def.keyPlaceholder,
              required,
            }
          }

          // Existing category-level swap-match preserved — user may have
          // connected a different tool in the same category via Browse Tools;
          // surface that connection in this row. Pre-PR2.8a behavior.
          const swapMatch = existingConnections.find((c) => {
            const connDef = getToolBySlug(c.toolSlug)
            return connDef && connDef.category === def.category && c.toolSlug !== chosenSlug
          })
          if (swapMatch) {
            const swapDef = getToolBySlug(swapMatch.toolSlug)
            const ui = connectionUiState(swapMatch)
            return {
              slug: swapMatch.toolSlug,
              name: swapDef?.name || swapMatch.displayName || def.name,
              connectionType: (swapDef?.connectionType || swapMatch.connectionType || "API_KEY") as "API_KEY" | "OAUTH_COMPOSIO",
              category: def.category,
              status: ui.status,
              errorMessage: ui.errorMessage,
              warningMessage: ui.warningMessage,
              connectionId: swapMatch.id,
              connectedAt: swapMatch.createdAt ?? null,
              helpUrl: swapDef?.helpUrl,
              keyPlaceholder: swapDef?.keyPlaceholder,
              required,
            }
          }

          return {
            slug: chosenSlug,
            name: def.name,
            connectionType: def.connectionType,
            category: def.category,
            status: "disconnected" as const,
            helpUrl: def.helpUrl,
            keyPlaceholder: def.keyPlaceholder,
            required,
          }
        }

        const resolvedRequired = requiredEntries
          .map((e) => resolveToolEntry(e, true))
          .filter((t): t is ToolState => t !== null)
        const resolvedRecommended = recommendedEntries
          .map((e) => resolveToolEntry(e, false))
          .filter((t): t is ToolState => t !== null)

        const allTools = [...resolvedRequired, ...resolvedRecommended]
          .filter(t => {
            const def = getToolBySlug(t.slug)
            return !def?.isAIProvider
          })

        // PR #4 Commit 9: any ToolConnection row the user created via the
        // Browse Tools modal for a tool NOT in this workspace's template
        // still needs to surface in the wizard UI, otherwise the modal
        // keeps showing "Connect OAuth" for an already-connected tool
        // (see GH #39, moved into PR #4 scope and fixed here).
        const extraTools = buildExtraToolsFromConnections(allTools, existingConnections)

        setTools([...allTools, ...extraTools])
      } catch (e) {
        console.error("Failed to load tools:", e)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [workspaceId])

  // PR #4 Commit 9: split the `tools` state into three disjoint buckets.
  // `extra` rows come from non-template ToolConnection rows (added via
  // the Browse Tools modal) and render in their own section with no
  // Swap button and no "required" affordance. Without this split the
  // non-template rows would leak into the "Recommended" block alongside
  // the template's own recommended alternatives, which is misleading.
  const requiredTools = useMemo(() => tools.filter((t) => t.required && !t.extra), [tools])
  const recommendedTools = useMemo(() => tools.filter((t) => !t.required && !t.extra), [tools])
  const extraTools = useMemo(() => tools.filter((t) => t.extra), [tools])
  const connectedSlugs = useMemo(() => tools.filter((t) => t.status === "connected").map((t) => t.slug), [tools])
  const allRequiredConnected = requiredTools.every((t) => t.status === "connected")

  // PR #5: OAuth Test button support is toolkit-specific. For toolkits in
  // UNSUPPORTED_TOOLKITS (Asana — GH #41), ToolRow renders Test disabled
  // with a tooltip. API_KEY rows are unaffected. Helper lives here (not
  // in tools-state.ts) because it's UI wiring, not state derivation.
  const getTestDisabledReason = useCallback((tool: ToolState): string | undefined => {
    if (tool.connectionType !== "OAUTH_COMPOSIO") return undefined
    const def = getToolBySlug(tool.slug)
    const toolkitSlug = def?.composioToolkitId ?? tool.slug
    return UNSUPPORTED_TOOLKITS.includes(toolkitSlug) ? UNSUPPORTED_TOOLKIT_TOOLTIP : undefined
  }, [])

  const refreshTools = useCallback(async () => {
    const res = await fetch(`/api/tools/${workspaceId}`)
    const data = await res.json()
    if (!data.success) return
    setComposioOAuthAvailable(Boolean(data.data.composioOAuthAvailable))
    const existing: ServerConnectionSummary[] = data.data.connections
    // PR2.9-fix3: server response is authoritative. `mergeRefreshedTools`
    // handles all four cases (server-present-template, server-present-
    // extra-new, server-absent-template-reset, server-absent-extra-drop).
    // Before this PR the merge was insert-only and disconnect/revoke left
    // stale `status: "connected"` on rows until a manual page reload.
    setTools((prev) => mergeRefreshedTools(prev, existing))
  }, [workspaceId])

  // PR #4 Commit 7: Revoke flow state. When a user clicks the Revoke button
  // on an OAUTH_COMPOSIO CONNECTED row, we open a ConfirmDialog (danger
  // variant) so the destructive action gets an explicit confirmation. On
  // confirm we POST to /oauth/disconnect; on success refreshTools picks up
  // the deletion; on failure we surface the error inline in the dialog and
  // keep it open so the user can retry or cancel.
  const [revokeState, setRevokeState] = useState<{
    tool: ToolState | null
    loading: boolean
    error: string | null
  }>({ tool: null, loading: false, error: null })

  const handleOauthRevoke = useCallback((tool: ToolState) => {
    setRevokeState({ tool, loading: false, error: null })
  }, [])

  const handleOauthRevokeConfirm = useCallback(async () => {
    const tool = revokeState.tool
    if (!tool) return
    setRevokeState((s) => ({ ...s, loading: true, error: null }))
    try {
      await disconnectOauthTool(workspaceId, tool.slug)
      // Refetch to sync row state with the DB delete. After PR2.9-fix3
      // `mergeRefreshedTools` makes the server response authoritative:
      // template rows (required/recommended) reset to "disconnected" so
      // the user can re-connect; extra rows (Browse-added non-template
      // tools) are dropped entirely. No optimistic local patch needed
      // here — the primitive handles it.
      await refreshTools()
      setRevokeState({ tool: null, loading: false, error: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to disconnect"
      setRevokeState((s) => ({ ...s, loading: false, error: msg }))
    }
  }, [workspaceId, revokeState.tool, refreshTools])

  const handleOauthRevokeCancel = useCallback(() => {
    // Don't dismiss while the request is in flight; user might mistake
    // the dialog close for a completed action.
    setRevokeState((s) => {
      if (s.loading) return s
      return { tool: null, loading: false, error: null }
    })
  }, [])

  // PR #4 Commit 7: OAuth connect / reconnect are driven by a shared hook
  // (src/lib/oauth/use-oauth-connection.ts) so the consent-popup + status-
  // polling flow lives in one place. handleOAuthConnect (initial-connect
  // UX) and handleOauthReconnect (EXPIRED/REVOKED row UX) both delegate
  // here; the callbacks drive per-row state transitions.
  const oauth = useOAuthConnection({
    workspaceId,
    callbacks: {
      onInitiated: (toolSlug) => {
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug ? { ...t, status: "connecting" as const, errorMessage: undefined } : t,
          ),
        )
      },
      onSuccess: async (toolSlug) => {
        // Refetch first so connectedAt/status come from the server (not a
        // stale client-side guess). Then also apply an optimistic
        // transition for the rare race where refetch response is in flight.
        await refreshTools()
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug ? { ...t, status: "connected" as const, errorMessage: undefined } : t,
          ),
        )
      },
      onFailure: (toolSlug, errorMsg) => {
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug ? { ...t, status: "error" as const, errorMessage: errorMsg } : t,
          ),
        )
      },
      onTimeout: (toolSlug) => {
        setTools((prev) =>
          prev.map((t) => {
            if (t.slug !== toolSlug) return t
            if (t.status === "connecting") {
              return { ...t, status: "error" as const, errorMessage: "Connection timed out. Try again." }
            }
            return t
          }),
        )
      },
      onInitiateError: (toolSlug, error) => {
        // PR2.8a-fix1 Task 4: COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH is the
        // 422 the route returns when a toolkit has no Composio-managed auth
        // scheme (RED-state — operator must register a custom OAuth/API_KEY
        // config in the Composio dashboard). Rendering this as a red error
        // misrepresents user-fixable failure; surface it as a yellow
        // "in-progress" warning on the row instead, leaving status
        // disconnected so the row stays in the wizard but the user knows
        // not to retry. Comingsoon-filtering covers the common path; this
        // branch covers Browse-modal direct connects + race conditions.
        if (error.code === "COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH") {
          setTools((prev) =>
            prev.map((t) =>
              t.slug === toolSlug
                ? {
                    ...t,
                    status: "disconnected" as const,
                    warningMessage:
                      "Setup in progress. Available within a few days.",
                    errorMessage: undefined,
                  }
                : t,
            ),
          )
          return
        }
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug
              ? { ...t, status: "error" as const, errorMessage: error.message }
              : t,
          ),
        )
      },
      onApiKeyFormRequired: (toolSlug, apiKeyForm) => {
        // PR2.9: initiate route returned BYOK mode. Open the credentials
        // modal pre-populated with the apiKeyForm fields. The hook has
        // bowed out; submission goes through handleByokSubmit below.
        //
        // Roll back the "connecting" state we set in onInitiated so the
        // row doesn't show a stuck spinner while the modal is open. The
        // BYOK modal IS the user's path to completion.
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug
              ? { ...t, status: "disconnected" as const, errorMessage: undefined, warningMessage: undefined }
              : t,
          ),
        )
        const tool = toolsRef.current.find((t) => t.slug === toolSlug) ?? null
        setByokModal({ open: true, tool, apiKeyForm })
      },
    },
  })

  // Keep `tools` reachable from the BYOK callback without recreating the
  // hook callbacks every render. The hook caches callbacks via a ref
  // already (line 126-129 of use-oauth-connection.ts); using a separate
  // ref here keeps the wiring clean.
  const toolsRef = useRef<ToolState[]>(tools)
  useEffect(() => { toolsRef.current = tools }, [tools])

  // PR #4 Commit 7: Reconnect is the same POST /oauth/initiate + poll flow
  // as a fresh connect — the user re-authorizes through Composio's consent
  // screen and the existing oauth/status poll flips the DB row back to
  // CONNECTED on ACTIVE. No dialog (D5 spec: "Reconnect is non-destructive;
  // re-authorizing through Composio IS the confirmation surface").
  const handleOauthReconnect = useCallback((tool: ToolState) => {
    if (tool.connectionType !== "OAUTH_COMPOSIO") return
    if (!composioOAuthAvailable) {
      setTools((prev) =>
        prev.map((t) =>
          t.slug === tool.slug
            ? { ...t, status: "error" as const, errorMessage: "OAuth is not configured in this environment." }
            : t,
        ),
      )
      return
    }
    // PR2.9 Task 7b: same immediate "connecting" flip as handleOAuthConnect
    // so the Reconnect button doesn't look dead during the initiate fetch.
    setTools((prev) =>
      prev.map((t) =>
        t.slug === tool.slug
          ? { ...t, status: "connecting" as const, errorMessage: undefined, warningMessage: undefined }
          : t,
      ),
    )
    oauth.connect(tool.slug)
  }, [oauth, composioOAuthAvailable])

  const handleCredentialsSave = useCallback(async (credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> => {
    if (!apiKeyModal.tool) return { success: false, error: "No tool selected" }
    try {
      const res = await fetch(`/api/tools/${workspaceId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolSlug: apiKeyModal.tool.slug,
          displayName: apiKeyModal.tool.name,
          connectionType: "API_KEY",
          credentials,
        }),
      })
      const data = await res.json()
      if (data.success) { await refreshTools(); return { success: true } }
      return { success: false, error: data.error?.message }
    } catch { return { success: false, error: "Network error" } }
  }, [apiKeyModal.tool, workspaceId, refreshTools])

  // PR2.9 BYOK submit handler. Distinct from handleCredentialsSave above
  // because the body shape, endpoint, and post-submit state-transition
  // semantics are all different:
  //   - Endpoint: /api/tools/[wsId]/byok/submit (synchronous create)
  //   - Body: { toolSlug, apiKey } — single key, not a Record
  //   - Status: row goes CONNECTED immediately (no PENDING polling)
  //
  // Reduces the multi-field credentials Record from the existing
  // CredentialsModal contract to the single primary-field's value (which
  // is all the BYOK route accepts — Composio takes one api_key).
  const handleByokSubmit = useCallback(async (credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> => {
    // PR2.9-fix1 (Bug 1B): toolSlug is sourced from apiKeyForm (server-
    // canonical), not from byokModal.tool which may be null for non-
    // template tools clicked via the Browse modal. byokModal.tool is
    // optional state used only for the optimistic UI update below.
    if (!byokModal.apiKeyForm) {
      return { success: false, error: "No tool selected" }
    }
    const primaryField = byokModal.apiKeyForm.fields.find((f) => f.primary) ?? byokModal.apiKeyForm.fields[0]
    if (!primaryField) return { success: false, error: "No API key field declared for this tool" }
    const apiKey = credentials[primaryField.envVar]
    if (!apiKey || !apiKey.trim()) {
      return { success: false, error: "API key is required" }
    }
    const toolSlug = byokModal.apiKeyForm.toolSlug

    try {
      const res = await fetch(`/api/tools/${workspaceId}/byok/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolSlug, apiKey }),
      })
      const data = await res.json()
      if (data.success) {
        // BYOK is synchronous-CONNECTED. Refetch so the row picks up the
        // server's status + createdAt. After PR2.9-fix1, refreshTools is
        // the authoritative path for non-template tools — it pulls the
        // new ToolConnection from DB and adds it as an "extra" row via
        // buildExtraToolsFromConnections (same code path the OAuth-from-
        // Browse-modal flow has always used).
        await refreshTools()
        // Optimistic update covers the rare race where refetch hasn't
        // landed when the user closes the modal AND the tool was already
        // in `tools` state (template-row click). For Browse-clicked non-
        // template tools, prev.map is a no-op — refreshTools handles it.
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug
              ? { ...t, status: "connected" as const, errorMessage: undefined, warningMessage: undefined }
              : t,
          ),
        )
        return { success: true }
      }
      return { success: false, error: data.error?.message }
    } catch {
      return { success: false, error: "Network error" }
    }
  }, [byokModal.apiKeyForm, workspaceId, refreshTools])

  // PR #4 Commit 7: initial "Connect with OAuth" flow delegates to the
  // shared useOAuthConnection hook (defined at the top of the component).
  // Pre-refactor this was ~120 LOC of inline fetch/popup/poll/cleanup that
  // would have had to be duplicated for the Reconnect flow; now both call
  // sites run the same code.
  const handleOAuthConnect = useCallback(
    (tool: Pick<ToolState, "slug" | "connectionType">) => {
      if (tool.connectionType !== "OAUTH_COMPOSIO") return
      if (!composioOAuthAvailable) {
        setTools((prev) =>
          prev.map((t) =>
            t.slug === tool.slug
              ? { ...t, status: "error" as const, errorMessage: "OAuth is not configured in this environment." }
              : t,
          ),
        )
        return
      }
      // PR2.9 Task 7b: flip row to "connecting" SYNCHRONOUSLY on click,
      // before the initiate fetch starts. Previously the row stayed
      // "disconnected" for 2-4s until `onInitiated` fired post-fetch,
      // making the Connect button look dead. The hook's onInitiated
      // re-applies "connecting" once initiate succeeds; the BYOK
      // onApiKeyFormRequired path rolls back to "disconnected" when the
      // form modal opens (so the row doesn't show a stuck spinner
      // alongside the open modal).
      //
      // PR2.9-fix1 (Bug 1B, option b): this setTools is a NO-OP when the
      // clicked tool isn't in `tools` state (e.g., Browse-modal click on
      // a non-template BYOK toolkit). That's intentional. The Browse
      // modal stays open, the BYOK credentials modal stacks on top, and
      // the user's path-to-completion runs through the modal. After
      // submit, refreshTools() pulls the new connection from DB and adds
      // it as an "extra" row via buildExtraToolsFromConnections —
      // standard mechanism. Synthesizing a phantom `tools` entry here
      // would leave a stuck row if the user cancelled out of the modal.
      setTools((prev) =>
        prev.map((t) =>
          t.slug === tool.slug
            ? { ...t, status: "connecting" as const, errorMessage: undefined, warningMessage: undefined }
            : t,
        ),
      )
      oauth.connect(tool.slug)
    },
    [oauth, composioOAuthAvailable],
  )

  const handleSwapSelect = useCallback(async (newTool: ToolDefinition) => {
    if (!swapModal.tool) return
    const oldTool = swapModal.tool

    if (oldTool.connectionId && !oldTool.connectionId.startsWith("apikey-")) {
      await fetch(`/api/tools/${workspaceId}/${oldTool.connectionId}`, { method: "DELETE" }).catch(() => {})
    }

    const res = await fetch(`/api/tools/${workspaceId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolSlug: newTool.slug, displayName: newTool.name, connectionType: newTool.connectionType }),
    })
    const json = await res.json()
    const newConnectionId = json.data?.id

    setTools((prev) => prev.map((t) => (t.slug === oldTool.slug ? {
      ...t,
      slug: newTool.slug,
      name: newTool.name,
      connectionType: newTool.connectionType,
      category: newTool.category || oldTool.category,
      helpUrl: newTool.helpUrl,
      keyPlaceholder: newTool.keyPlaceholder,
      status: "disconnected" as const,
      connectionId: newConnectionId || undefined,
    } : t)))
  }, [swapModal.tool, workspaceId])

  const handleBrowseConnect = useCallback(async () => {
    await refreshTools()
  }, [refreshTools])

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
    // PR2.9-fix3: `refreshTools` is now authoritative via
    // `mergeRefreshedTools` — the deleted row's local UI state is reset
    // to "disconnected" (template) or removed (extra). No optimistic
    // local patch needed.
    await refreshTools()
  }, [workspaceId, refreshTools])

  const handleTest = useCallback(async (tool: ToolState) => {
    if (!tool.connectionId) return

    // PR #5: OAuth tools have their own Test endpoint (/test-oauth) that
    // probes the real token via composio.tools.execute. API-key tools
    // stay on /test. Branching here (not server-side) keeps the two
    // routes' responses shape-distinct and avoids cross-type leakage.
    const isOAuth = tool.connectionType === "OAUTH_COMPOSIO"
    const endpoint = isOAuth ? "test-oauth" : "test"

    setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "testing" as const, errorMessage: undefined, warningMessage: undefined } : t)))
    try {
      const res = await fetch(`/api/tools/${workspaceId}/${tool.connectionId}/${endpoint}`, {
        method: "POST",
      })
      const body = await res.json()

      if (!body.success) {
        const msg = body.error?.message || "Test failed"
        setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: msg, warningMessage: undefined } : t)))
        return
      }

      if (isOAuth) {
        // OAuth response shape: { ok, state: "working" | "expired" | "error", message? }
        const oauthResult: { ok: boolean; state: "working" | "expired" | "error"; message?: string } = body.data
        if (oauthResult.state === "working") {
          setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "connected" as const, errorMessage: undefined, warningMessage: undefined } : t)))
          return
        }
        if (oauthResult.state === "expired") {
          // Server wrote DB to EXPIRED. Refetch to pull that state + let
          // the ToolRow render "Reconnect" instead of Test + Revoke.
          await refreshTools()
          return
        }
        // state === "error": transient/unclassified. DB unchanged. Surface
        // the probe's sanitized message inline so the user gets a Retry
        // button rather than a hard failure copy.
        setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: oauthResult.message || "Test failed", warningMessage: undefined } : t)))
        return
      }

      // API_KEY response shape: { valid, error?, warning?, unverified?, message? }
      const result: { valid: boolean; error?: string; warning?: string; unverified?: boolean; message?: string } = body.data

      if (!result.valid) {
        setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: result.error || "Test failed", warningMessage: undefined } : t)))
        return
      }

      if (result.unverified || result.warning) {
        const note = result.message ?? result.warning ?? ""
        setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "connected" as const, errorMessage: undefined, warningMessage: note } : t)))
        return
      }

      setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "connected" as const, errorMessage: undefined, warningMessage: undefined } : t)))
    } catch {
      setTools((prev) => prev.map((t) => (t.slug === tool.slug ? { ...t, status: "error" as const, errorMessage: "Couldn't reach the server. Check your connection and try again.", warningMessage: undefined } : t)))
    }
  }, [workspaceId, refreshTools])

  if (isLoading) {
    return <div className="space-y-3"><LoadingSkeleton variant="line" /><LoadingSkeleton variant="card" /><LoadingSkeleton variant="card" /></div>
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">{isManageMode ? "Manage Tools" : "Connect your tools"}</h2>
      <p className="text-xs text-[var(--tx2)] mb-3.5">
        {isManageMode
          ? "Connect the services your agents need. API keys are encrypted with AES-256-GCM."
          : "Connect the services your agents need to do their job."}
      </p>

      {(requiredTools.length > 0 || recommendedTools.length > 0) && (
        <div className="bg-[var(--bg2)] rounded-[8px] p-[10px] mb-[10px]">
          <p className="text-[12px] text-[var(--tx2)] leading-[1.5]">
            Tools are external services your agents connect to - APIs, CRMs, email providers, and more.
            Each connection gives your agents the ability to interact with that service on your behalf.
            API keys are encrypted with AES-256-GCM and never stored in plaintext.
          </p>
        </div>
      )}

      {requiredTools.length === 0 && recommendedTools.length === 0 && (
        <div className="text-center py-[30px] border border-dashed border-[var(--bd)] rounded-[12px] mb-3.5">
          <Wrench className="w-[24px] h-[24px] text-[var(--tx3)] mx-auto mb-[8px]" />
          <p className="text-[13px] font-medium text-[var(--tx)] mb-[4px]">No tools configured yet</p>
          <p className="text-[12px] text-[var(--tx3)] max-w-[300px] mx-auto">
            Your custom Claw doesn&apos;t have pre-configured tools. Browse the catalog to add tools your agents can use.
          </p>
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
              // PR2.9-fix1 (Bug 1A): catalog-sourced authMode drives the
              // connect-button label. ToolState doesn't carry authMode (it
              // only mirrors connectionType for the connection-flow state
              // machine), so we look it up via the catalog. Slug-drift
              // tests enforce presence for every OAUTH_COMPOSIO entry.
              authMode={getToolBySlug(tool.slug)?.authMode}
              composioOAuthAvailable={composioOAuthAvailable}
              errorMessage={tool.errorMessage}
              warningMessage={tool.warningMessage}
              connectedAt={tool.connectedAt}
              onConnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
              onReconnect={
                // PR #4 Commit 6: for OAuth EXPIRED/REVOKED rows this
                // will ultimately re-initiate the OAuth flow (Commit 7
                // wires the actual mutation). For the immediate
                // re-key-entry case on API_KEY errors the behavior is
                // unchanged — re-open the credentials modal.
                tool.connectionType === "API_KEY"
                  ? () => setApiKeyModal({ open: true, tool })
                  : tool.status === "expired" || tool.status === "revoked"
                    ? () => handleOauthReconnect(tool)
                    : () => handleOAuthConnect(tool)
              }
              onTest={tool.status === "connected" || tool.status === "testing" ? () => handleTest(tool) : undefined}
              testDisabledReason={getTestDisabledReason(tool)}
              onDisconnect={() => handleDisconnect(tool)}
              onRevoke={tool.connectionType === "OAUTH_COMPOSIO" ? () => handleOauthRevoke(tool) : undefined}
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
              authMode={getToolBySlug(tool.slug)?.authMode}
              composioOAuthAvailable={composioOAuthAvailable}
              errorMessage={tool.errorMessage}
              warningMessage={tool.warningMessage}
              connectedAt={tool.connectedAt}
              swappable
              onConnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
              onReconnect={
                tool.connectionType === "API_KEY"
                  ? () => setApiKeyModal({ open: true, tool })
                  : tool.status === "expired" || tool.status === "revoked"
                    ? () => handleOauthReconnect(tool)
                    : () => handleOAuthConnect(tool)
              }
              onSwap={() => setSwapModal({ open: true, tool })}
              onTest={tool.status === "connected" || tool.status === "testing" ? () => handleTest(tool) : undefined}
              testDisabledReason={getTestDisabledReason(tool)}
              onDisconnect={() => handleDisconnect(tool)}
              onRevoke={tool.connectionType === "OAUTH_COMPOSIO" ? () => handleOauthRevoke(tool) : undefined}
            />
          ))}
        </ToolConnectionList>
      )}

      {/* PR #4 Commit 9: Additional tools = ToolConnection rows not in this
          workspace's template required/recommended list (added via Browse
          Tools modal). Same row affordances as recommended except for the
          Swap button, which has no meaningful target set here. */}
      {extraTools.length > 0 && (
        <ToolConnectionList title="Additional tools" subtitle="Connections you've added outside this Claw's default setup.">
          {extraTools.map((tool) => (
            <ToolRow
              key={tool.slug}
              name={tool.name}
              description={tool.category}
              connectionStatus={tool.status}
              connectionType={tool.connectionType}
              authMode={getToolBySlug(tool.slug)?.authMode}
              composioOAuthAvailable={composioOAuthAvailable}
              errorMessage={tool.errorMessage}
              warningMessage={tool.warningMessage}
              connectedAt={tool.connectedAt}
              onConnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
              onReconnect={
                tool.connectionType === "API_KEY"
                  ? () => setApiKeyModal({ open: true, tool })
                  : tool.status === "expired" || tool.status === "revoked"
                    ? () => handleOauthReconnect(tool)
                    : () => handleOAuthConnect(tool)
              }
              onTest={tool.status === "connected" || tool.status === "testing" ? () => handleTest(tool) : undefined}
              testDisabledReason={getTestDisabledReason(tool)}
              onDisconnect={() => handleDisconnect(tool)}
              onRevoke={tool.connectionType === "OAUTH_COMPOSIO" ? () => handleOauthRevoke(tool) : undefined}
            />
          ))}
        </ToolConnectionList>
      )}

      <div className="flex gap-2.5 mb-3.5">
        <Button variant="outline" className="flex-1 text-[11px] py-2" onClick={() => setBrowseModal(true)}>+ Browse available tools</Button>
        <Button variant="outline" className="flex-1 text-[11px] py-2" onClick={() => setCustomApiModal(true)}>+ Connect custom API</Button>
      </div>

      {isManageMode ? (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/builder/${workspaceId}`)}>← Back to Builder</Button>
          <Button variant="primary" onClick={() => router.push(`/builder/${workspaceId}`)}>Done</Button>
        </div>
      ) : (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/1`)}>← Back</Button>
          <Button variant="primary" disabled={!allRequiredConnected} onClick={() => router.push(`/setup/${workspaceId}/step/3`)}>Next: Deploy →</Button>
        </div>
      )}


      {/* Modals */}
      <CredentialsModal
        open={apiKeyModal.open}
        onClose={() => setApiKeyModal({ open: false, tool: null })}
        toolName={apiKeyModal.tool?.name || ""}
        helpUrl={apiKeyModal.tool?.helpUrl}
        credentialFields={
          apiKeyModal.tool ? getToolBySlug(apiKeyModal.tool.slug)?.credentialFields ?? [] : []
        }
        onSave={handleCredentialsSave}
      />
      {/* PR2.9: BYOK credentials modal — same CredentialsModal component
          as the direct API_KEY tools above, different endpoint + payload
          shape (POSTs to /byok/submit, not /api/tools/[wsId]).
          PR2.9-fix1 (Bug 1B): conditional + display-name resolution
          extracted to `resolveByokModalProps` for unit-test coverage of
          the null-tool path (Browse-modal click on a non-template tool).
          See tools-state.ts. */}
      {(() => {
        const byokProps = resolveByokModalProps(byokModal)
        if (!byokProps) return null
        return (
          <CredentialsModal
            open={true}
            onClose={() => setByokModal({ open: false, tool: null, apiKeyForm: null })}
            toolName={byokProps.toolName}
            helpUrl={byokProps.helpUrl}
            credentialFields={byokProps.credentialFields}
            description="Enter your API key. The key is held by Composio (not Claws) and never appears in logs."
            onSave={handleByokSubmit}
          />
        )
      })()}
      <ToolSwapModal
        open={swapModal.open}
        onClose={() => setSwapModal({ open: false, tool: null })}
        category={swapModal.tool?.category || ""}
        currentTool={swapModal.tool?.name || ""}
        alternatives={swapModal.tool ? getToolsByCategory(swapModal.tool.category).filter((t) => t.slug !== swapModal.tool!.slug) : []}
        onSelect={handleSwapSelect}
      />
      <BrowseToolsModal
        open={browseModal}
        onClose={() => setBrowseModal(false)}
        connectedSlugs={connectedSlugs}
        onConnect={handleBrowseConnect}
        composioOAuthAvailable={composioOAuthAvailable}
        onOAuthConnect={(def) =>
          handleOAuthConnect({
            slug: def.slug,
            connectionType: "OAUTH_COMPOSIO",
          })
        }
        // PR2.9: parallel prop wired to the same handler. The OAuth-vs-BYOK
        // discrimination happens server-side in oauth/initiate; the hook's
        // onApiKeyFormRequired callback opens the BYOK form modal when
        // the response carries mode:"byok". See BrowseToolsModal prop
        // docstring + PR2.9 decision-3 in the prompt.
        onByokConnect={(def) =>
          handleOAuthConnect({
            slug: def.slug,
            connectionType: "OAUTH_COMPOSIO",
          })
        }
        workspaceId={workspaceId}
      />
      <CustomApiModal open={customApiModal} onClose={() => setCustomApiModal(false)} onSave={handleCustomSave} />
      {/*
        PR #4 Commit 7 Revoke confirmation dialog. Opened by clicking the
        Revoke button on an OAUTH_COMPOSIO CONNECTED row. Dismissable only
        when not loading (prevents the "did my disconnect actually happen?"
        UX bug where a user closes the dialog mid-fetch).
       */}
      <ConfirmDialog
        open={revokeState.tool !== null}
        onClose={handleOauthRevokeCancel}
        onConfirm={handleOauthRevokeConfirm}
        title={`Disconnect ${revokeState.tool?.name ?? "this tool"}?`}
        description={
          revokeState.tool
            ? `This will disconnect your ${revokeState.tool.name} account from this workspace. Agents that use ${revokeState.tool.name} will lose access until you reconnect. This cannot be undone without re-authorizing.`
            : ""
        }
        warningText={revokeState.error ?? undefined}
        confirmLabel="Disconnect"
        variant="danger"
        loading={revokeState.loading}
      />
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
  GENERATING: "Failed to generate workspace configuration. This is unusual - please try again.",
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

function Step3({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(true)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deploymentStatus, setDeploymentStatus] = useState<string | null>(null)
  const [deploymentError, setDeploymentError] = useState<string | null>(null)
  const [eligibility, setEligibility] = useState<DeployEligibility | null>(null)
  const [subscribing, setSubscribing] = useState(false)
  const [waitingForActivation, setWaitingForActivation] = useState(false)
  const [apiKeySource, setApiKeySource] = useState<ApiKeySource | null>(null)
  const creditUser = isCreditUser(apiKeySource)

  const checkBillingAndUpdateEligibility = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/user/billing")
      const json = await res.json()
      if (!json.success) return false
      const d = json.data
      const now = new Date()
      if (!d.trialUsed) {
        setEligibility({ canDeploy: true, reason: "first_deploy_trial", needsSubscription: false, isFirstDeploy: true })
        return true
      }
      if (d.trialEndsAt && new Date(d.trialEndsAt) > now) {
        setEligibility({ canDeploy: true, reason: "trial_active", needsSubscription: false, isFirstDeploy: false })
        return true
      }
      if (d.hasActiveSubscription) {
        setEligibility({ canDeploy: true, reason: "subscribed", needsSubscription: false, isFirstDeploy: false })
        return true
      }
      setEligibility({ canDeploy: false, reason: "subscription_required", needsSubscription: true, isFirstDeploy: false })
      return false
    } catch { return false }
  }, [])

  useEffect(() => {
    async function init() {
      try {
        const [, statusRes] = await Promise.all([
          checkBillingAndUpdateEligibility(),
          fetch(`/api/deploy/${workspaceId}/status`),
        ])

        const statusJson = await statusRes.json()
        if (statusJson.success) {
          if (statusJson.data.apiKeySource) {
            setApiKeySource(statusJson.data.apiKeySource as ApiKeySource)
          }
          if (statusJson.data.deployment) {
            const dep = statusJson.data.deployment
            setDeploymentStatus(dep.status)
            if (dep.errorMessage) setDeploymentError(dep.errorMessage)
            if (!["COMPLETED", "FAILED"].includes(dep.status)) {
              setIsDeploying(true)
            }
          }
        }
      } catch (err) {
        console.error("Failed to load setup data:", err)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [workspaceId, checkBillingAndUpdateEligibility])

  useEffect(() => {
    const onFocus = () => { checkBillingAndUpdateEligibility() }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [checkBillingAndUpdateEligibility])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === "dodo-checkout-complete") {
        setWaitingForActivation(true)
        let attempts = 0
        const poll = async () => {
          while (attempts < 10) {
            attempts++
            const activated = await checkBillingAndUpdateEligibility()
            if (activated) { setWaitingForActivation(false); return }
            await new Promise((r) => setTimeout(r, 2000))
          }
          setWaitingForActivation(false)
        }
        poll()
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [checkBillingAndUpdateEligibility])

  useEffect(() => {
    const status = searchParams.get("status")
    if (!status || status !== "active") return

    setWaitingForActivation(true)
    let cancelled = false
    let attempts = 0
    const maxAttempts = 8

    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
        attempts++
        const activated = await checkBillingAndUpdateEligibility()
        if (activated) { setWaitingForActivation(false); return }
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (!cancelled) setWaitingForActivation(false)
    }
    poll()
    return () => { cancelled = true }
  }, [searchParams, checkBillingAndUpdateEligibility])

  const handleDeploy = useCallback(async () => {
    setIsDeploying(true)
    setDeploymentStatus("PENDING")
    setDeploymentError(null)

    try {
      const res = await fetch(`/api/deploy/${workspaceId}/cloud`, { method: "POST" })
      const json = await res.json()

      if (!json.success) {
        if (json.error?.code === "SUBSCRIPTION_REQUIRED") {
          setEligibility({ canDeploy: false, reason: "subscription_required", needsSubscription: true, isFirstDeploy: false })
        }
        setDeploymentError(json.error?.message || "Failed to start deployment")
        setDeploymentStatus("FAILED")
        setIsDeploying(false)
        return
      }

      const deploymentId = json.data?.deployment?.id

      const stages = ["GENERATING", "PROVISIONING", "CONFIGURING", "STARTING", "HEALTH_CHECK", "WAITING_CHANNELS", "COMPLETED"]
      for (let i = 0; i < stages.length; i++) {
        setDeploymentStatus(stages[i])
        if (stages[i] !== "COMPLETED") {
          await new Promise(r => setTimeout(r, 1200 + Math.random() * 800))
        }
      }

      if (deploymentId) {
        await fetch(`/api/deploy/${workspaceId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deploymentId }),
        })
      }

      setIsDeploying(false)
    } catch {
      setDeploymentError("Network error")
      setDeploymentStatus("FAILED")
      setIsDeploying(false)
    }
  }, [workspaceId])

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
        window.open(json.data.checkoutUrl, "_blank")
      } else if (json.data?.mockMode) {
        setEligibility({ canDeploy: true, reason: "subscribed", needsSubscription: false, isFirstDeploy: false })
      }
    } catch (err) {
      console.error("Failed to start subscription checkout:", err)
    }
    setSubscribing(false)
  }, [workspaceId])

  const canProceed = deploymentStatus === "COMPLETED"
  const needsSub = eligibility?.needsSubscription === true

  if (isLoading) {
    return <div className="space-y-3"><LoadingSkeleton variant="line" /><LoadingSkeleton variant="card" /></div>
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">Deploy your Claw</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-1">Your Claw will be deployed to a managed cloud container.</p>
      {creditUser ? (
        <p className="text-[10px] text-[var(--ac)] font-medium mb-3.5">Powered by Claws Starter Credits — no payment needed.</p>
      ) : eligibility?.isFirstDeploy ? (
        <p className="text-[10px] text-[var(--ac)] font-medium mb-3.5">3-day free trial - no payment required. $79/mo after trial.</p>
      ) : (
        <p className="text-[10px] text-[var(--tx3)] mb-3.5">$79/mo platform fee per running Claw</p>
      )}

      {!creditUser && needsSub && !deploymentStatus && !waitingForActivation && (
        <AlertBanner variant="warning">
          <p className="font-medium">Your 3-day trial has ended</p>
          <p className="mt-0.5 opacity-80">Subscribe to the Claw Platform ($79/mo) to deploy and run your Claws.</p>
        </AlertBanner>
      )}

      {!creditUser && waitingForActivation && !deploymentStatus && (
        <AlertBanner variant="info" icon={<Loader2 className="w-4 h-4 animate-spin" />}>
          <p className="font-medium">Payment received — activating your subscription</p>
          <p className="mt-0.5 opacity-80">This usually takes a few seconds. If it doesn&apos;t update, try refreshing the page.</p>
        </AlertBanner>
      )}

      {!deploymentStatus && !waitingForActivation && (
        creditUser ? (
          <Button variant="primary" size="default" onClick={handleDeploy} disabled={isDeploying}>
            Deploy Claw
          </Button>
        ) : needsSub ? (
          <Button variant="primary" size="default" onClick={handleSubscribe} loading={subscribing}>
            Subscribe to Deploy - $79/mo
          </Button>
        ) : (
          <Button variant="primary" size="default" onClick={handleDeploy} disabled={isDeploying || !eligibility}>
            {eligibility?.isFirstDeploy ? "Deploy - 3-day free trial" : "Deploy"}
          </Button>
        )
      )}

      {deploymentStatus && (
        <div className="mb-4">
          <DeployProgress
            steps={mapDeployStatus(deploymentStatus)}
            failureDetail={deploymentStatus === "FAILED" ? getFailureMessage(null, deploymentError) : undefined}
          />
        </div>
      )}

      {deploymentStatus === "FAILED" && (
        <AlertBanner variant="error" actions={
          <div className="flex gap-1.5">
            <Button variant="primary" size="sm" onClick={() => { setDeploymentStatus(null); handleDeploy() }}>Retry deployment</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>Check tool connections</Button>
          </div>
        }>
          <p className="font-medium">Deployment failed</p>
          <p className="mt-0.5 opacity-80">{deploymentError || "Please check your tool connections and API keys, then try again."}</p>
        </AlertBanner>
      )}

      {deploymentStatus === "COMPLETED" && (
        <AlertBanner variant="info" icon={<CheckCircle className="w-4 h-4" />}>
          <p><strong>Deployment successful.</strong> Your Claw is running in the cloud.</p>
        </AlertBanner>
      )}

      <div className="flex justify-between mt-4">
        <Button variant="outline" disabled={isDeploying} className={isDeploying ? "opacity-50" : ""} onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>← Back</Button>
        <Button variant="primary" disabled={!canProceed} onClick={() => router.push(`/setup/${workspaceId}/step/4`)}>Next: Channels →</Button>
      </div>
    </>
  )
}

// ─── Step 4: Connect Channels ───────────────────────────────

const ICON_CLASS = "w-4 h-4"

const CHANNELS = [
  { id: "web-chat", name: "Web chat", description: "Built-in - always available", icon: <Globe className={ICON_CLASS} />, alwaysConnected: true },
  { id: "whatsapp", name: "WhatsApp", description: "Scan QR code to connect", icon: <Smartphone className={ICON_CLASS} />, alwaysConnected: false },
  { id: "slack", name: "Slack", description: "Connect via OAuth", icon: <Hash className={ICON_CLASS} />, alwaysConnected: false },
  { id: "telegram", name: "Telegram", description: "Enter bot token from @BotFather", icon: <Send className={ICON_CLASS} />, alwaysConnected: false },
  { id: "microsoft-teams", name: "Microsoft Teams", description: "Azure Bot Service setup required", icon: <Building2 className={ICON_CLASS} />, alwaysConnected: false },
  { id: "discord", name: "Discord", description: "Enter bot token from Developer Portal", icon: <Gamepad2 className={ICON_CLASS} />, alwaysConnected: false },
]

function Step4({ workspaceId }: { workspaceId: string }) {
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
        <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/3`)}>← Back</Button>
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
      } catch (err) {
        console.error("Failed to activate workspace:", err)
      }
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
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaceId = params.workspaceId as string
  const stepNum = parseInt(params.n as string, 10)
  const isManageMode = searchParams.get("mode") === "manage"

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}`).then((res) => {
      if (res.status === 401) router.push("/auth/signin")
      else if (res.status === 403 || res.status === 404) router.replace("/my-claws")
    }).catch(() => {})
  }, [workspaceId, router])

  // PR2.9-fix1 (Bug 2): `isFromBuilder` was previously computed during
  // render with a `typeof window !== "undefined"` ternary, which read
  // sessionStorage on the client but not on the server. If sessionStorage
  // had "builder" (from a prior visit via /builder/...) but the URL
  // didn't carry `?from=builder`, server render produced
  // `isFromBuilder=false` and client re-rendered with `isFromBuilder=true`
  // — different rendered text in the back-button (line ~1652) →
  // React error #418 (hydration mismatch).
  //
  // Fix: first render uses ONLY searchParams (deterministic across
  // server + client). The sessionStorage augmentation runs in useEffect
  // after mount, updating state. Second render incorporates sessionStorage
  // safely because hydration is already complete.
  //
  // Trade-off: on slow client mounts, the back-button briefly says
  // "← Back to My Claws" then flips to "← Back to Builder". Acceptable
  // — much better than #418 noise in console. The mounted-flag gate is
  // tracked at GH#78 as a follow-up UX polish.
  const fromQuery = searchParams.get("from") === "builder"
  const [isFromBuilder, setIsFromBuilder] = useState(fromQuery)
  useEffect(() => {
    const from = searchParams.get("from")
    if (from) {
      sessionStorage.setItem(`wizard-context-${workspaceId}`, from)
    }
    // After mount, augment with sessionStorage. Safe because this
    // useEffect runs after hydration completes.
    const stored = sessionStorage.getItem(`wizard-context-${workspaceId}`) === "builder"
    setIsFromBuilder(fromQuery || stored)
  }, [workspaceId, fromQuery, searchParams])

  const exitWizard = useCallback(() => {
    if (typeof window !== "undefined") sessionStorage.removeItem(`wizard-context-${workspaceId}`)
    router.push(isFromBuilder ? `/builder/${workspaceId}` : "/my-claws")
  }, [workspaceId, isFromBuilder, router])

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

  const showWizardChrome = !(stepNum === 2 && isManageMode)

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <div className="flex items-center mb-[24px]">
          <button
            onClick={exitWizard}
            className="text-[11px] text-[var(--tx2)] hover:text-[var(--tx)] cursor-pointer bg-transparent border-none flex-shrink-0 transition-colors mr-[16px] leading-none"
          >
            {isFromBuilder ? "← Back to Builder" : "← Back to My Claws"}
          </button>
          {showWizardChrome && (
            <>
              <div className="flex-1 flex justify-center items-center">
                <WizardProgressBar steps={progressSteps} />
              </div>
              <div className="w-[116px] flex-shrink-0" />
            </>
          )}
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 pb-4">
        {stepNum === 1 ? <Step1 workspaceId={workspaceId} isFromBuilder={isFromBuilder} />
          : stepNum === 2 ? <Step2 workspaceId={workspaceId} isManageMode={isManageMode} />
          : stepNum === 3 ? <Step3 workspaceId={workspaceId} />
          : stepNum === 4 ? <Step4 workspaceId={workspaceId} />
          : stepNum === 5 ? <Step5 workspaceId={workspaceId} />
          : <StepPlaceholder step={stepNum} workspaceId={workspaceId} />}
      </div>
    </>
  )
}
