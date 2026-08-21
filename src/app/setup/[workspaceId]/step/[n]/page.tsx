"use client"

import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { WizardProgressBar } from "@/components/setup/wizard-progress-bar"
import { ModelSelectionTable } from "@/components/setup/model-selection-table"
import { ToolConnectionList } from "@/components/setup/tool-connection-list"
import { ToolRow } from "@/components/setup/tool-row"
import { CredentialsModal } from "@/components/setup/credentials-modal"
import { BrowseToolsModal } from "@/components/setup/browse-tools-modal"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { CustomApiModal } from "@/components/setup/custom-api-modal"

import { DeployProgress } from "@/components/setup/deploy-progress"
import { ChannelList } from "@/components/setup/channel-list"
import { ChannelRow } from "@/components/setup/channel-row"
import { AlertBanner } from "@/components/ui/alert-banner"
import { queuedUserMessage } from "@/lib/railway/governor-budget"
import { DriftBanner, formatChangedAreas } from "@/components/shared/drift-banner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { TextLink } from "@/components/ui/text-link"
import { Input } from "@/components/ui/input"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { Modal } from "@/components/ui/modal"
import { StatusDot } from "@/components/ui/status-dot"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { RedeployProgressModal } from "@/components/dashboard/redeploy-progress-modal"
import { useWorkspaceRedeploy } from "@/components/dashboard/use-workspace-redeploy"
import { useOAuthConnection } from "@/lib/oauth/use-oauth-connection"
import { disconnectOauthTool } from "@/lib/oauth/disconnect-oauth-tool"
import { getComplianceNotice } from "@/lib/compliance-notices"
import { getToolBySlug, type ToolDefinition } from "@/data/tool-catalog"
import { StarterCreditBanner } from "@/components/setup/starter-credit-banner"
import { ProviderAuthCards } from "@/components/setup/provider-auth-cards"
import { isCreditAuthPath, isModelSelectable, validConfiguredProviders } from "@/lib/models/provider-auth"
import {
  filterNonAiProviderRequiredEntries,
  isAiProviderSlug,
  missingRequiredToolsBannerTitle,
  MISSING_REQUIRED_TOOLS_BANNER_BODY,
  REQUIRED_TOOLS_SECTION_SUBTITLE,
  requiredToolsSatisfied,
  unverifiedToolsInfoLine,
  type RequiredToolConnection,
  type RequiredToolsSatisfaction,
} from "@/lib/tools/required-tools"
import {
  type ToolState,
  type ServerConnectionSummary,
  type BYOKModalState,
  type RequirementToolEntry,
  buildWorkspaceToolStates,
  mergeRefreshedTools,
  resolveByokModalProps,
} from "@/components/setup/tools-state"
import {
  UNSUPPORTED_TOOLKITS,
  UNSUPPORTED_TOOLKIT_TOOLTIP,
} from "@/lib/composio/cheap-ops"
import { DEFAULT_MODEL } from "@/lib/models"
import { CheckCircle, Sparkles, Bot, ClipboardList, MessageSquare, BarChart3, Wrench, Hash, Smartphone, Send, Building2, Gamepad2, Globe, Loader2 } from "lucide-react"
import { isCreditUser } from "@/lib/credits/api-key-source"
import type { ApiKeySource } from "@/generated/prisma/client"
import type { ChannelId, ChannelStatusMap, LaunchChannelId, MaskedChannelConfigMap } from "@/lib/openclaw/channel-config"
import {
  CHANNEL_BETA_LABEL,
  isBetaChannel,
} from "@/lib/ui/beta-labels"

interface AgentRow {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  model: string
}

function defaultModel(role: string): string {
  return DEFAULT_MODEL[role] || DEFAULT_MODEL.WORKER
}

const STEP_LABELS = ["AI model", "Tools", "Channels", "Deploy", "Go live"]

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

interface CustomApiConnectionSummary {
  id: string
  slug: string
  name: string
  baseUrl: string
  authType: "API_KEY_HEADER" | "BEARER_TOKEN" | "BASIC_AUTH" | "QUERY_PARAM"
  description?: string | null
  createdAt?: string | null
}

const CUSTOM_AUTH_LABELS: Record<CustomApiConnectionSummary["authType"], string> = {
  API_KEY_HEADER: "API key header",
  BEARER_TOKEN: "Bearer token",
  BASIC_AUTH: "Basic auth",
  QUERY_PARAM: "Query parameter",
}

function customApiHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function CustomApiRow({
  api,
  statusCopy,
  onDelete,
}: {
  api: CustomApiConnectionSummary
  statusCopy: string
  onDelete: () => void
}) {
  const purpose = api.description?.trim() || "No purpose provided."
  return (
    <div className="px-3.5 py-3 border-b border-[var(--bd)] last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status="connected" />
          <div className="min-w-0">
            <div className="min-w-0 text-xs font-semibold">
              <TruncatedText>{api.name}</TruncatedText>
            </div>
            <div className="min-w-0 text-[10px] text-[var(--tx2)]">
              <TruncatedText>
                {`${customApiHost(api.baseUrl)} · ${CUSTOM_AUTH_LABELS[api.authType]}`}
              </TruncatedText>
            </div>
            <div className="min-w-0 text-[10px] text-[var(--tx3)]">
              <TruncatedText>{purpose}</TruncatedText>
            </div>
            <div className="text-[10px] text-[var(--ok)] mt-0.5">{statusCopy}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-[10px] px-2.5 py-[3px] text-[var(--tx3)] hover:text-[var(--err)] transition-colors shrink-0"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

interface ConfigDriftInfo {
  isStale: boolean
  changedAreas: string[]
}

interface ChannelSummary {
  channels: ChannelStatusMap
  configuredChannelIds: ChannelId[]
  hasConfiguredChannels: boolean
}

interface WizardDriftInfo extends ConfigDriftInfo {
  workspaceStatus: string | null
}

const EMERGENCY_CHANNEL_TEMPLATE_SLUGS = new Set([
  "law-firm-intake-os",
  "home-services-dispatcher",
  "medical-practice-manager",
])

function needsRedeployToApply(drift: WizardDriftInfo | null): boolean {
  return (drift?.workspaceStatus === "RUNNING" || drift?.workspaceStatus === "PAUSED") && drift.isStale
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
  OPENROUTER: "sk-or-v1-...",
}

function Step1({ workspaceId, isFromBuilder = false }: { workspaceId: string; isFromBuilder?: boolean }) {
  const router = useRouter()
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [keyStatus, setKeyStatus] = useState<ProviderStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingModels, setIsSavingModels] = useState(false)
  const [overrideModal, setOverrideModal] = useState<{ provider: string; providerName: string } | null>(null)
  const [creditMode, setCreditMode] = useState(false)
  /** null until balance loads; when creditMode, live balanceCents from /api/credits/balance. */
  const [creditBalanceCents, setCreditBalanceCents] = useState<number | null>(null)

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
        if (creditData.success && isCreditAuthPath(creditData.data)) {
          setCreditMode(true)
          setCreditBalanceCents(
            typeof creditData.data.balanceCents === "number" ? creditData.data.balanceCents : null,
          )
        } else if (creditData.success && creditData.data?.hasCredits === false) {
          setCreditBalanceCents(null)
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
      const results = await Promise.all(
        agents.map((agent) =>
          fetch(`/api/agents/${workspaceId}/${agent.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: agent.model }),
          })
        )
      )
      if (!results.every((res) => res.ok)) {
        throw new Error("Failed to save models")
      }
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

  const configuredProviders = useMemo(() => validConfiguredProviders(keyStatus), [keyStatus])

  const allAgentsHaveAuth = agents.every((a) =>
    isModelSelectable(a.model, { creditMode, configuredProviders }),
  )

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
          : "Your agents need API keys to think. We support Anthropic, OpenAI, Google, and OpenRouter. Configure keys for each provider your agents use. OpenRouter is BYOK-only."}
      </p>

      {creditMode && <StarterCreditBanner balanceCents={creditBalanceCents} />}

      <ProviderAuthCards
        agents={agents}
        keyStatus={keyStatus}
        creditMode={creditMode}
        configuredProviders={configuredProviders}
        onEnterKey={(provider, providerName) => setOverrideModal({ provider, providerName })}
        onChangeKey={(provider, providerName) => setOverrideModal({ provider, providerName })}
        onUseGlobal={(provider) => {
          void handleRemoveOverride(provider)
        }}
      />

      <div className="bg-[var(--bg2)] rounded-[8px] p-[10px] mb-3.5">
        <p className="text-[12px] text-[var(--tx2)] leading-[1.5]">
          Keys from Settings are used by default for all Claws.
          You can override with a different key for this specific Claw to track usage separately.
          All keys are encrypted with AES-256-GCM and never stored in plaintext.
        </p>
      </div>

      {/* Model Selection Table */}
      {agents.length > 0 && (
        <ModelSelectionTable
          agents={agents}
          onModelChange={handleModelChange}
          creditMode={creditMode}
          configuredProviders={configuredProviders}
        />
      )}

      {creditMode && (
        <p className="text-[11px] text-[var(--tx3)] mb-3.5">
          Starter credits work with Claude models. To use GPT or Gemini, add your own API key in Settings.
        </p>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        {isFromBuilder ? (
          <TextLink direction="back" onClick={() => router.push(`/builder/${workspaceId}`)}>Back to Builder</TextLink>
        ) : (
          <div />
        )}
        <Button variant="primary" onClick={handleNext} disabled={!allAgentsHaveAuth || isSavingModels}>
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
  const snackbar = useSnackbarOptional()
  const showSnackbar = useCallback(
    (options: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
      snackbar?.show(options)
    },
    [snackbar],
  )
  const [tools, setTools] = useState<ToolState[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [toolsLoadError, setToolsLoadError] = useState<string | null>(null)
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
  const [customApis, setCustomApis] = useState<CustomApiConnectionSummary[]>([])
  /** Swap uses BrowseToolsModal's filtered library. */
  const [swapModal, setSwapModal] = useState<{ open: boolean; tool: ToolState | null }>({ open: false, tool: null })
  const [browseModal, setBrowseModal] = useState(false)
  /** Template tools dropped from the workspace set — Restore via `restore` op. */
  const [removedFromTemplate, setRemovedFromTemplate] = useState<
    Array<{ slug: string; name: string }>
  >([])
  const [removedExpanded, setRemovedExpanded] = useState(false)
  const [customApiModal, setCustomApiModal] = useState(false)
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null)
  const [workspaceTemplateSlug, setWorkspaceTemplateSlug] = useState<string | null>(null)
  const [driftAfterTools, setDriftAfterTools] = useState<ConfigDriftInfo | null>(null)
  const [applyChangesOpen, setApplyChangesOpen] = useState(false)
  const [pendingOAuthSlug, setPendingOAuthSlug] = useState<string | null>(null)
  const [oauthErrors, setOauthErrors] = useState<Record<string, string | undefined>>({})
  /** Bump to re-run Step-2 tool load after requirement-set mutations. */
  const [toolsReloadToken, setToolsReloadToken] = useState(0)
  const redeployFlow = useWorkspaceRedeploy({
    workspaceId,
    onCompleted: () => {
      router.push(`/dashboard/${workspaceId}?redeployed=changes-applied`)
    },
  })

  const refreshDriftState = useCallback(async () => {
    try {
      const statusRes = await fetch(`/api/deploy/${workspaceId}/status?drift=1`)
      const statusData = await statusRes.json()
      if (statusData.success && statusData.data?.drift) {
        setWorkspaceStatus(statusData.data.workspaceStatus ?? null)
        setDriftAfterTools({
          isStale: Boolean(statusData.data.drift.isStale),
          changedAreas: Array.isArray(statusData.data.drift.changedAreas) ? statusData.data.drift.changedAreas : [],
        })
      }
    } catch { /* drift prompt is advisory; dashboard banner remains the backstop */ }
  }, [workspaceId])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setToolsLoadError(null)
      try {
        const wsRes = await fetch(`/api/workspaces/${workspaceId}`)
        const wsData = await wsRes.json()
        if (wsData.success) {
          setWorkspaceStatus(wsData.data?.status ?? null)
          setWorkspaceTemplateSlug(wsData.data?.clawTemplate?.slug ?? null)
        }

        // PR2.8a Task 7: switched from name-based (`getToolByName(t.name)`)
        // to slug-based (`getToolBySlug(t.slug)`) template-tool resolution.
        // Workspace tool-requirements already returns both fields in each
        // `required` / `recommended` entry; pre-PR2.8a the wizard read only
        // `.name` and substring-matched it back to the catalog (see the
        // pre-PR2.7 Deploy-blocker for the "Claude API" vs "Anthropic
        // (Claude)" miss that TOOL_NAME_ALIASES papered over).
        //
        // Tool customization: workspace-owned set via dual-read resolver.
        // Requirement entry = row of record; ToolConnection only decorates
        // (PR-5: no category-wide steal that orphans a second row).
        let requiredEntries: RequirementToolEntry[] = []
        let recommendedEntries: RequirementToolEntry[] = []

        try {
          const reqRes = await fetch(`/api/workspaces/${workspaceId}/tool-requirements`)
          const reqData = await reqRes.json()
          if (reqData.success) {
            requiredEntries = (reqData.data.required ?? []) as RequirementToolEntry[]
            recommendedEntries = (reqData.data.recommended ?? []) as RequirementToolEntry[]
            const removed = (reqData.data.removedFromTemplate ?? []) as Array<{
              slug: string
              name: string
            }>
            setRemovedFromTemplate(
              removed.map((r) => ({ slug: r.slug, name: r.name })),
            )
          }
        } catch { /* fall through to defaults */ }

        const toolsRes = await fetch(`/api/tools/${workspaceId}`)
        const toolsData = await toolsRes.json()
        if (!toolsRes.ok || !toolsData.success) {
          setToolsLoadError("Failed to load tools")
          return
        }
        if (toolsData.success) {
          setComposioOAuthAvailable(Boolean(toolsData.data.composioOAuthAvailable))
        }
        await refreshDriftState()
        const existingConnections: ServerConnectionSummary[] = toolsData.success
          ? toolsData.data.connections
          : []
        const existingCustomApis: CustomApiConnectionSummary[] = toolsData.success
          ? (toolsData.data.customConnections ?? [])
          : []
        setCustomApis(existingCustomApis)

        setTools(
          buildWorkspaceToolStates(
            requiredEntries,
            recommendedEntries,
            existingConnections,
            isAiProviderSlug,
          ),
        )
      } catch (e) {
        console.error("Failed to load tools:", e)
        setToolsLoadError("Failed to load tools")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [workspaceId, refreshDriftState, toolsReloadToken])

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
  const customApiStatusCopy = workspaceStatus === "RUNNING"
    ? "Saved — redeploy to apply"
    : "Saved — deploys with next redeploy"
  const showToolsDrift = driftAfterTools?.isStale === true && (workspaceStatus === "RUNNING" || workspaceStatus === "PAUSED")
  const setupComplianceNotice = workspaceTemplateSlug === "medical-practice-manager"
    ? getComplianceNotice(workspaceTemplateSlug)
    : null

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

  const refreshTools = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`/api/tools/${workspaceId}`)
    const data = await res.json()
    if (!data.success) return false
    setComposioOAuthAvailable(Boolean(data.data.composioOAuthAvailable))
    const existing: ServerConnectionSummary[] = data.data.connections
    setCustomApis(data.data.customConnections ?? [])
    // PR2.9-fix3: server response is authoritative. `mergeRefreshedTools`
    // handles all four cases (server-present-template, server-present-
    // extra-new, server-absent-template-reset, server-absent-extra-drop).
    // Before this PR the merge was insert-only and disconnect/revoke left
    // stale `status: "connected"` on rows until a manual page reload.
    setTools((prev) => mergeRefreshedTools(prev, existing))
    await refreshDriftState()
    return true
  }, [workspaceId, refreshDriftState])

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

  /**
   * PR-5: one reconcile pattern — apply server tool-requirements payload
   * (+ live connections) after every customization op. No optimistic local
   * requirement edits.
   */
  const applyToolRequirementsPayload = useCallback(
    async (data: {
      required?: RequirementToolEntry[]
      recommended?: RequirementToolEntry[]
      removedFromTemplate?: Array<{ slug: string; name: string }>
    }) => {
      if (Array.isArray(data.removedFromTemplate)) {
        setRemovedFromTemplate(
          data.removedFromTemplate.map((r) => ({ slug: r.slug, name: r.name })),
        )
      }
      const toolsRes = await fetch(`/api/tools/${workspaceId}`)
      const toolsData = await toolsRes.json()
      const connections: ServerConnectionSummary[] = toolsData.success
        ? toolsData.data.connections
        : []
      if (toolsData.success) {
        setComposioOAuthAvailable(Boolean(toolsData.data.composioOAuthAvailable))
        setCustomApis(toolsData.data.customConnections ?? [])
      }
      setTools(
        buildWorkspaceToolStates(
          (data.required ?? []) as RequirementToolEntry[],
          (data.recommended ?? []) as RequirementToolEntry[],
          connections,
          isAiProviderSlug,
        ),
      )
      await refreshDriftState()
    },
    [workspaceId, refreshDriftState],
  )

  const patchToolRequirement = useCallback(
    async (
      op: "demote" | "restore" | "dismiss" | "undismiss" | "remove" | "swap",
      slug: string,
      replaceWith?: string,
    ) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/tool-requirements`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op,
          slug,
          ...(op === "swap" && replaceWith ? { replaceWith } : {}),
        }),
      })
      const json = await res.json()
      if (!json.success) {
        throw new Error(json.error?.message || `Failed to ${op} tool`)
      }
      // Server response is authoritative — reconcile immediately (not optimistic).
      await applyToolRequirementsPayload(json.data)
    },
    [workspaceId, applyToolRequirementsPayload],
  )

  const handleDemote = useCallback(
    async (tool: ToolState) => {
      try {
        await mutateWithFeedback(
          () => patchToolRequirement("demote", tool.slug),
          {
            message: `${tool.name} is now optional`,
            undo: async () => {
              await mutateWithFeedback(
                () => patchToolRequirement("restore", tool.slug),
                { message: "Restored to Required tools" },
                showSnackbar,
              )
            },
          },
          showSnackbar,
        )
      } catch (err) {
        console.error(err)
      }
    },
    [patchToolRequirement, showSnackbar],
  )

  const handleRestore = useCallback(
    async (tool: { slug: string; name: string }) => {
      try {
        await mutateWithFeedback(
          () => patchToolRequirement("restore", tool.slug),
          { message: "Restored to Required tools" },
          showSnackbar,
        )
      } catch (err) {
        console.error(err)
      }
    },
    [patchToolRequirement, showSnackbar],
  )

  const handleDismiss = useCallback(
    async (tool: ToolState) => {
      try {
        await mutateWithFeedback(
          () => patchToolRequirement("dismiss", tool.slug),
          {
            message: `${tool.name} removed from recommendations`,
            undo: async () => {
              await mutateWithFeedback(
                () => patchToolRequirement("undismiss", tool.slug),
                { message: `${tool.name} restored to recommendations` },
                showSnackbar,
              )
            },
          },
          showSnackbar,
        )
      } catch (err) {
        console.error(err)
      }
    },
    [patchToolRequirement, showSnackbar],
  )

  // Tool customization PR-2: REMOVE warning — requirement-set drop + optional disconnect.
  const [removeState, setRemoveState] = useState<{
    tool: ToolState | null
    loading: boolean
    error: string | null
    alsoDisconnect: boolean
    labels: string[]
    honestLimitCopy: string
  }>({
    tool: null,
    loading: false,
    error: null,
    alsoDisconnect: true,
    labels: [],
    honestLimitCopy: "",
  })

  const handleRemoveOpen = useCallback(
    async (tool: ToolState) => {
      setRemoveState({
        tool,
        loading: true,
        error: null,
        alsoDisconnect: true,
        labels: [],
        honestLimitCopy: "",
      })
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/tool-requirements/dependents?slug=${encodeURIComponent(tool.slug)}`,
        )
        const json = await res.json()
        if (!json.success) {
          setRemoveState((s) => ({
            ...s,
            loading: false,
            error: json.error?.message || "Could not load dependents",
          }))
          return
        }
        setRemoveState((s) => ({
          ...s,
          loading: false,
          labels: (json.data.labels as string[]) ?? [],
          honestLimitCopy: (json.data.honestLimitCopy as string) ?? "",
        }))
      } catch {
        setRemoveState((s) => ({
          ...s,
          loading: false,
          error: "Could not load dependents",
        }))
      }
    },
    [workspaceId],
  )

  const handleRemoveConfirm = useCallback(async () => {
    const tool = removeState.tool
    if (!tool) return
    setRemoveState((s) => ({ ...s, loading: true, error: null }))
    try {
      const alsoDisconnect = removeState.alsoDisconnect
      await mutateWithFeedback(
        async () => {
          await patchToolRequirement("remove", tool.slug)
          if (alsoDisconnect) {
            if (tool.connectionType === "OAUTH_COMPOSIO") {
              await disconnectOauthTool(workspaceId, tool.slug)
            } else if (tool.connectionId) {
              await fetch(`/api/tools/${workspaceId}/${tool.connectionId}`, {
                method: "DELETE",
              })
            }
            await refreshTools()
          }
        },
        {
          message: `${tool.name} removed from this Claw`,
          undo: async () => {
            await mutateWithFeedback(
              () => patchToolRequirement("restore", tool.slug),
              {
                message: tool.required
                  ? "Restored to Required tools"
                  : "Restored to Recommended tools",
              },
              showSnackbar,
            )
          },
        },
        showSnackbar,
      )
      setRemoveState({
        tool: null,
        loading: false,
        error: null,
        alsoDisconnect: true,
        labels: [],
        honestLimitCopy: "",
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove tool"
      setRemoveState((s) => ({ ...s, loading: false, error: msg }))
    }
  }, [
    removeState.tool,
    removeState.alsoDisconnect,
    patchToolRequirement,
    workspaceId,
    refreshTools,
    showSnackbar,
  ])

  const handleRemoveCancel = useCallback(() => {
    if (removeState.loading) return
    setRemoveState({
      tool: null,
      loading: false,
      error: null,
      alsoDisconnect: true,
      labels: [],
      honestLimitCopy: "",
    })
  }, [removeState.loading])

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
      onStart: (toolSlug) => {
        setPendingOAuthSlug(toolSlug)
        setOauthErrors((prev) => ({ ...prev, [toolSlug]: undefined }))
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug ? { ...t, status: "connecting" as const, errorMessage: undefined } : t,
          ),
        )
      },
      onPopupOpened: (toolSlug) => {
        setPendingOAuthSlug((current) => current === toolSlug ? null : current)
      },
      onInitiated: (toolSlug) => {
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug ? { ...t, status: "connecting" as const, errorMessage: undefined } : t,
          ),
        )
      },
      onSuccess: async (toolSlug) => {
        setPendingOAuthSlug((current) => current === toolSlug ? null : current)
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
        setPendingOAuthSlug((current) => current === toolSlug ? null : current)
        setTools((prev) =>
          prev.map((t) =>
            t.slug === toolSlug ? { ...t, status: "error" as const, errorMessage: errorMsg } : t,
          ),
        )
      },
      onTimeout: (toolSlug) => {
        setPendingOAuthSlug((current) => current === toolSlug ? null : current)
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
        setPendingOAuthSlug((current) => current === toolSlug ? null : current)
        setOauthErrors((prev) => ({ ...prev, [toolSlug]: error.message }))
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
        setPendingOAuthSlug((current) => current === toolSlug ? null : current)
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
          body: JSON.stringify({ toolSlug, apiKey, credentials }),
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

  const handleSwapSelect = useCallback(
    async (newTool: ToolDefinition) => {
      if (!swapModal.tool) return
      const oldTool = swapModal.tool
      try {
        await mutateWithFeedback(
          async () => {
            // Requirement-set replace (carries required-ness) — not plain-add.
            await patchToolRequirement("swap", oldTool.slug, newTool.slug)
            if (oldTool.connectionId && !oldTool.connectionId.startsWith("apikey-")) {
              await fetch(`/api/tools/${workspaceId}/${oldTool.connectionId}`, {
                method: "DELETE",
              }).catch(() => {})
            }
          },
          {
            message: `Swapped ${oldTool.name} → ${newTool.name}`,
            undo: async () => {
              await patchToolRequirement("swap", newTool.slug, oldTool.slug)
              showSnackbar({ message: "Tool restored — reconnect required", variant: "success" })
            },
          },
          showSnackbar,
        )
        setSwapModal({ open: false, tool: null })
      } catch (err) {
        console.error(err)
      }
    },
    [swapModal.tool, workspaceId, patchToolRequirement, showSnackbar],
  )

  const handleBrowseConnect = useCallback(
    async (tool: ToolDefinition) => {
      try {
        await mutateWithFeedback(
          async () => {
            const ok = await refreshTools()
            if (!ok) throw new Error("Could not connect tool")
          },
          {
            message: `${tool.name} connected`,
            errorMessage: "Could not connect tool",
          },
          showSnackbar,
        )
      } catch {
        /* error snackbar already shown */
      }
    },
    [refreshTools, showSnackbar],
  )

  const handleCustomSave = useCallback(async (data: { name: string; baseUrl: string; authType: string; credential: string; description: string }): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/tools/${workspaceId}/custom`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      })
      const result = await res.json()
      if (result.success) {
        await refreshTools()
        return { success: true }
      }
      return { success: false, error: result.error?.message }
    } catch { return { success: false, error: "Network error" } }
  }, [workspaceId, refreshTools])

  const handleCustomDelete = useCallback(
    async (api: CustomApiConnectionSummary) => {
      try {
        await mutateWithFeedback(
          async () => {
            const res = await fetch(`/api/tools/${workspaceId}/custom/${api.id}`, {
              method: "DELETE",
            })
            if (!res.ok) throw new Error("Could not delete custom API")
            await refreshTools()
          },
          { message: "Custom API deleted", errorMessage: "Could not delete custom API" },
          showSnackbar,
        )
      } catch {
        /* error snackbar already shown */
      }
    },
    [workspaceId, refreshTools, showSnackbar],
  )

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

  const handleManageDone = useCallback(() => {
    if (workspaceStatus === "RUNNING" && driftAfterTools?.isStale) {
      setApplyChangesOpen(true)
      return
    }
    router.push(`/builder/${workspaceId}`)
  }, [workspaceStatus, driftAfterTools, router, workspaceId])

  const handleApplyChangesNow = useCallback(async () => {
    setApplyChangesOpen(false)
    await redeployFlow.startRedeploy()
  }, [redeployFlow])

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

      {setupComplianceNotice && (
        <AlertBanner variant="warning">
          {setupComplianceNotice}
        </AlertBanner>
      )}

      {showToolsDrift && driftAfterTools && (
        <DriftBanner
          changedAreas={driftAfterTools.changedAreas}
          actions={
            isManageMode ? (
              <Button variant="outline" size="xs" onClick={() => void redeployFlow.startRedeploy()} loading={redeployFlow.redeploying}>
                Redeploy
              </Button>
            ) : (
              <Button variant="outline" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/4`)}>
                Go to deploy
              </Button>
            )
          }
        />
      )}

      {(requiredTools.length > 0 || recommendedTools.length > 0) && (
        <div className="bg-[var(--bg2)] rounded-[8px] p-[10px] mb-[10px]">
          <p className="text-[12px] text-[var(--tx2)] leading-[1.5]">
            Tools are external services your agents connect to - APIs, CRMs, email providers, and more.
            Each connection gives your agents the ability to interact with that service on your behalf.
            API keys are encrypted with AES-256-GCM and never stored in plaintext.
          </p>
        </div>
      )}

      {toolsLoadError && (
        <AlertBanner variant="error">
          <p className="font-medium">{toolsLoadError}</p>
          <p className="text-[11px] mt-0.5 opacity-80">Something went wrong loading your tools. Please refresh the page.</p>
        </AlertBanner>
      )}

      {requiredTools.length === 0 && recommendedTools.length === 0 && !toolsLoadError && (
        <div className="text-center py-[30px] border border-dashed border-[var(--bd)] rounded-[12px] mb-3.5">
          <Wrench className="w-[24px] h-[24px] text-[var(--tx3)] mx-auto mb-[8px]" />
          <p className="text-[13px] font-medium text-[var(--tx)] mb-[4px]">No tools configured yet</p>
          <p className="text-[12px] text-[var(--tx3)] max-w-[300px] mx-auto">
            Your custom Claw doesn&apos;t have pre-configured tools. Browse the catalog to add tools your agents can use.
          </p>
        </div>
      )}

      {requiredTools.length > 0 && (
        <ToolConnectionList title="Required tools" subtitle={REQUIRED_TOOLS_SECTION_SUBTITLE}>
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
              onDemote={() => handleDemote(tool)}
              onRestore={tool.customized ? () => handleRestore(tool) : undefined}
              onRemove={() => handleRemoveOpen(tool)}
            />
          ))}
        </ToolConnectionList>
      )}

      {recommendedTools.length > 0 && (
        <ToolConnectionList
          title="Recommended tools"
          subtitle="Pre-selected. Connect, swap, or dismiss. Demoted required tools land here — Restore to put them back."
        >
          {recommendedTools.map((tool) => {
            // PR-3 affordances: unconnected recommended → × only; Remove on
            // demoted (customized) or connected rows. Warning dialog unchanged.
            const isConnectedRow =
              tool.status === "connected" ||
              tool.status === "testing" ||
              tool.status === "needs-credentials" ||
              tool.status === "expired" ||
              tool.status === "revoked" ||
              tool.status === "error"
            const showRemove = Boolean(tool.customized) || isConnectedRow
            const showDismiss = !tool.customized && !isConnectedRow
            return (
              <ToolRow
                key={tool.slug}
                name={tool.name}
                description={
                  tool.customized
                    ? `${tool.category} · Was required`
                    : tool.category
                }
                connectionStatus={tool.status}
                connectionType={tool.connectionType}
                authMode={getToolBySlug(tool.slug)?.authMode}
                composioOAuthAvailable={composioOAuthAvailable}
                errorMessage={tool.errorMessage}
                warningMessage={tool.warningMessage}
                connectedAt={tool.connectedAt}
                swappable={!tool.customized}
                onConnect={() => tool.connectionType === "API_KEY" ? setApiKeyModal({ open: true, tool }) : handleOAuthConnect(tool)}
                onReconnect={
                  tool.connectionType === "API_KEY"
                    ? () => setApiKeyModal({ open: true, tool })
                    : tool.status === "expired" || tool.status === "revoked"
                      ? () => handleOauthReconnect(tool)
                      : () => handleOAuthConnect(tool)
                }
                onSwap={tool.customized ? undefined : () => setSwapModal({ open: true, tool })}
                onTest={tool.status === "connected" || tool.status === "testing" ? () => handleTest(tool) : undefined}
                testDisabledReason={getTestDisabledReason(tool)}
                onDisconnect={() => handleDisconnect(tool)}
                onRevoke={tool.connectionType === "OAUTH_COMPOSIO" ? () => handleOauthRevoke(tool) : undefined}
                onRestore={tool.customized ? () => handleRestore(tool) : undefined}
                onDismiss={showDismiss ? () => handleDismiss(tool) : undefined}
                onRemove={showRemove ? () => handleRemoveOpen(tool) : undefined}
              />
            )
          })}
        </ToolConnectionList>
      )}

      {removedFromTemplate.length > 0 && (
        <div className="mb-3.5 rounded-[8px] border border-[var(--bd)] bg-[var(--bg)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[11px] font-medium text-[var(--tx2)] hover:text-[var(--tx)]"
            onClick={() => setRemovedExpanded((v) => !v)}
            data-testid="removed-from-claw"
            aria-expanded={removedExpanded}
          >
            <span>
              Removed from this Claw ({removedFromTemplate.length}) — Restore
            </span>
            <span className="text-[var(--tx3)]">{removedExpanded ? "▾" : "▸"}</span>
          </button>
          {removedExpanded && (
            <div className="border-t border-[var(--bd)]">
              {removedFromTemplate.map((tool) => (
                <div
                  key={tool.slug}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-[var(--bd)] last:border-b-0"
                >
                  <span className="text-xs font-semibold text-[var(--tx)]">{tool.name}</span>
                  <button
                    type="button"
                    className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx2)] hover:border-[var(--bd2)] transition-colors"
                    onClick={() => void handleRestore(tool)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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

      {customApis.length > 0 && (
        <ToolConnectionList title="Custom APIs" subtitle="User-provided APIs saved for this Claw. Credentials are injected on next deploy.">
          {customApis.map((api) => (
            <CustomApiRow
              key={api.slug}
              api={api}
              statusCopy={customApiStatusCopy}
              onDelete={() => handleCustomDelete(api)}
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
          <TextLink direction="back" onClick={() => router.push(`/builder/${workspaceId}`)}>Back to Builder</TextLink>
          <Button variant="primary" onClick={handleManageDone}>Back to Builder</Button>
        </div>
      ) : (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/1`)}>← Back</Button>
          <Button variant="primary" onClick={() => router.push(`/setup/${workspaceId}/step/3`)}>Next: Channels →</Button>
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
            description="Enter your API key. The key is stored securely by our connection broker and never appears in logs."
            onSave={handleByokSubmit}
          />
        )
      })()}
      <BrowseToolsModal
        open={swapModal.open}
        onClose={() => setSwapModal({ open: false, tool: null })}
        mode="swap"
        initialCategory={swapModal.tool?.category}
        suggestedSlugs={swapModal.tool?.alternatives ?? []}
        excludeSlug={swapModal.tool?.slug}
        swapCurrentName={swapModal.tool?.name}
        onSwapSelect={(tool) => void handleSwapSelect(tool)}
        connectedSlugs={connectedSlugs}
        onConnect={handleBrowseConnect}
        composioOAuthAvailable={composioOAuthAvailable}
        onOAuthConnect={() => {}}
        workspaceId={workspaceId}
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
        pendingOAuthSlug={pendingOAuthSlug}
        oauthErrors={oauthErrors}
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
      <ConfirmDialog
        open={removeState.tool !== null}
        onClose={handleRemoveCancel}
        onConfirm={handleRemoveConfirm}
        title={`Remove ${removeState.tool?.name ?? "this tool"} from this Claw?`}
        description={
          removeState.tool
            ? `This drops ${removeState.tool.name} from this workspace's requirement set. The template stays intact for the next buyer.`
            : ""
        }
        warningText={removeState.error ?? undefined}
        confirmLabel="Remove"
        variant="danger"
        loading={removeState.loading}
      >
        {removeState.labels.length > 0 ? (
          <div className="mb-3">
            <p className="text-[11px] font-medium text-[var(--tx)] mb-1">Affects:</p>
            <ul className="text-[11px] text-[var(--tx2)] list-disc pl-4 space-y-0.5">
              {removeState.labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        ) : (
          removeState.tool && !removeState.loading && (
            <p className="text-[11px] text-[var(--tx2)] mb-3">No labeled agent dependents found.</p>
          )
        )}
        {removeState.honestLimitCopy && (
          <p className="text-[10px] text-[var(--tx3)] mb-3 leading-[1.4]">{removeState.honestLimitCopy}</p>
        )}
        <label className="flex items-start gap-2 text-[11px] text-[var(--tx)] cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={removeState.alsoDisconnect}
            disabled={removeState.loading}
            onChange={(e) =>
              setRemoveState((s) => ({ ...s, alsoDisconnect: e.target.checked }))
            }
          />
          <span>Also disconnect and delete saved credentials</span>
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={applyChangesOpen}
        onClose={() => {
          setApplyChangesOpen(false)
          router.push(`/builder/${workspaceId}`)
        }}
        onConfirm={handleApplyChangesNow}
        title="Apply changes now?"
        description={`Your Claw is running an older configuration. Redeploy to apply changes to ${formatChangedAreas(driftAfterTools?.changedAreas ?? [])}.`}
        confirmLabel="Redeploy"
        cancelLabel="Not now"
        variant="warning"
        loading={redeployFlow.redeploying}
      />
      <RedeployProgressModal
        open={redeployFlow.modalOpen}
        redeploying={redeployFlow.redeploying}
        status={redeployFlow.status}
        lastStage={redeployFlow.lastStage}
        error={redeployFlow.error}
        onClose={redeployFlow.closeModal}
        onRetry={redeployFlow.retry}
      />
    </>
  )
}

// ─── Placeholder Steps (3-5) ────────────────────────────────

// ─── Step 3: Deploy ─────────────────────────────────────────

interface DeployStepItem { label: string; status: "complete" | "running" | "pending" | "failed" }

const BASE_DEPLOY_STAGES = [
  { label: "Generating workspace files", key: "GENERATING" },
  { label: "Provisioning container", key: "PROVISIONING" },
  { label: "Configuring workspace", key: "CONFIGURING" },
  { label: "Starting runtime", key: "STARTING" },
  { label: "Health check", key: "HEALTH_CHECK" },
  { label: "Complete", key: "COMPLETED" },
]

const CHANNEL_DEPLOY_STAGE = { label: "Applying channel config", key: "WAITING_CHANNELS" }

function getDeployStages(hasConfiguredChannels: boolean) {
  return hasConfiguredChannels
    ? [...BASE_DEPLOY_STAGES.slice(0, -1), CHANNEL_DEPLOY_STAGE, BASE_DEPLOY_STAGES[BASE_DEPLOY_STAGES.length - 1]]
    : BASE_DEPLOY_STAGES
}

const FAILURE_REASONS: Record<string, string> = {
  GENERATING: "Failed to generate workspace configuration. This is unusual - please try again.",
  PROVISIONING: "Could not provision a container. The hosting service may be temporarily unavailable.",
  CONFIGURING: "Failed to configure agents and tools in the container. Check that all required tools are connected.",
  STARTING: "Container failed to start. Check your API keys are valid.",
  HEALTH_CHECK: "Agents are not responding after startup. An API key may be invalid or a tool connection expired.",
  WAITING_CHANNELS: "Failed to apply channel configuration. You can retry or skip and connect channels later.",
}

export function mapDeployStatus(status: string | null, failedStage?: string | null, hasConfiguredChannels = false): DeployStepItem[] {
  const stages = getDeployStages(hasConfiguredChannels)
  const order = stages.map((s) => s.key)
  if (!status || status === "PENDING") return stages.map((s, i) => ({ label: s.label, status: i === 0 ? "running" as const : "pending" as const }))

  if (status === "FAILED") {
    const failIdx = failedStage ? order.indexOf(failedStage) : -1
    return stages.map((s) => {
      const si = order.indexOf(s.key)
      if (failIdx >= 0) {
        if (si < failIdx) return { label: s.label, status: "complete" as const }
        if (si === failIdx) return { label: s.label, status: "failed" as const }
      }
      return { label: s.label, status: "pending" as const }
    })
  }

  const effectiveStatus = status === "WAITING_CHANNELS" && !hasConfiguredChannels ? "HEALTH_CHECK" : status
  const idx = order.indexOf(effectiveStatus)
  return stages.map((s) => {
    const si = order.indexOf(s.key)
    if (si < idx) return { label: s.label, status: "complete" as const }
    if (si === idx) return { label: s.label, status: effectiveStatus === "COMPLETED" ? "complete" as const : "running" as const }
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

const EMPTY_TOOL_PREREQS: RequiredToolsSatisfaction = {
  satisfied: true,
  missingSlugs: [],
  missingLabels: [],
  unverifiedCount: 0,
}

async function loadDeployToolPrerequisites(workspaceId: string): Promise<RequiredToolsSatisfaction> {
  try {
    const [reqRes, toolsRes] = await Promise.all([
      // Tool customization PR-1: workspace set via resolver — never template JSON.
      fetch(`/api/workspaces/${workspaceId}/tool-requirements`),
      fetch(`/api/tools/${workspaceId}`),
    ])
    const [reqJson, toolsJson] = await Promise.all([reqRes.json(), toolsRes.json()])
    if (!reqJson.success) {
      return { satisfied: false, missingSlugs: [], missingLabels: [], unverifiedCount: 0 }
    }

    const requiredEntries = (reqJson.data.required ?? []) as Array<{
      slug: string
      name?: string
      alternatives?: string[]
    }>
    // Finding F: exclude isAIProvider (anthropic_api etc.) — Step 1 domain.
    const gatedRequired = filterNonAiProviderRequiredEntries(requiredEntries)
    if (gatedRequired.length === 0) return EMPTY_TOOL_PREREQS

    const connections = (toolsJson.success
      ? (toolsJson.data.connections ?? [])
      : []) as RequiredToolConnection[]
    return requiredToolsSatisfied(gatedRequired, connections)
  } catch {
    return { satisfied: false, missingSlugs: [], missingLabels: [], unverifiedCount: 0 }
  }
}

export function Step3({ workspaceId }: { workspaceId: string }) {
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
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null)
  const [configDrift, setConfigDrift] = useState<ConfigDriftInfo | null>(null)
  const [hasConfiguredChannels, setHasConfiguredChannels] = useState(false)
  const [applyDeployOpen, setApplyDeployOpen] = useState(false)
  const [recommendedAlwaysOn, setRecommendedAlwaysOn] = useState(false)
  const [queueMessage, setQueueMessage] = useState<string | null>(null)
  const [toolPrereqs, setToolPrereqs] = useState<RequiredToolsSatisfaction>(EMPTY_TOOL_PREREQS)
  const toolPrereqsReady = toolPrereqs.satisfied
  const unverifiedInfo = unverifiedToolsInfoLine(toolPrereqs.unverifiedCount)
  const creditUser = isCreditUser(apiKeySource)
  const redeployFlow = useWorkspaceRedeploy({
    workspaceId,
    onCompleted: () => router.push(`/setup/${workspaceId}/step/5`),
  })

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
        const [, statusRes, channelsRes, workspaceRes, toolsReady] = await Promise.all([
          checkBillingAndUpdateEligibility(),
          fetch(`/api/deploy/${workspaceId}/status?drift=1`),
          fetch(`/api/channels/${workspaceId}`),
          fetch(`/api/workspaces/${workspaceId}`),
          loadDeployToolPrerequisites(workspaceId),
        ])

        const statusJson = await statusRes.json()
        if (statusJson.success) {
          setWorkspaceStatus(statusJson.data.workspaceStatus ?? null)
          if (statusJson.data.apiKeySource) {
            setApiKeySource(statusJson.data.apiKeySource as ApiKeySource)
          }
          if (statusJson.data.drift) {
            setConfigDrift({
              isStale: Boolean(statusJson.data.drift.isStale),
              changedAreas: Array.isArray(statusJson.data.drift.changedAreas) ? statusJson.data.drift.changedAreas : [],
            })
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
        const channelsJson = await channelsRes.json()
        if (channelsJson.success) {
          setHasConfiguredChannels(Boolean(channelsJson.data?.hasConfiguredChannels))
        }
        const workspaceJson = await workspaceRes.json()
        if (workspaceJson.success) {
          setRecommendedAlwaysOn(
            Boolean(workspaceJson.data?.clawTemplate?.recommendedAlwaysOn),
          )
          if (workspaceJson.data?.status === "PROVISIONING_QUEUED") {
            setDeploymentStatus("QUEUED")
            const etaAt = workspaceJson.data?.provisioningQueue?.etaAt
            setQueueMessage(
              etaAt
                ? queuedUserMessage(new Date(etaAt))
                : "High demand — your claw is queued to provision. We'll notify you.",
            )
          }
        }
        setToolPrereqs(toolsReady)
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

      if (json.data?.queued || res.status === 202) {
        setQueueMessage(
          typeof json.data?.message === "string"
            ? json.data.message
            : "High demand — your claw is queued to provision. We'll notify you.",
        )
        setDeploymentStatus("QUEUED")
        setIsDeploying(false)
        return
      }

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

      const stages = getDeployStages(hasConfiguredChannels).map((stage) => stage.key)
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
  }, [workspaceId, hasConfiguredChannels])

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

  const canProceed = deploymentStatus === "COMPLETED" || deploymentStatus === "QUEUED"
  const needsSub = eligibility?.needsSubscription === true
  const showStaleRunningConfig =
    (workspaceStatus === "RUNNING" || workspaceStatus === "PAUSED") &&
    configDrift?.isStale === true &&
    deploymentStatus === "COMPLETED"

  function handleNextFromDeploy() {
    if (showStaleRunningConfig) {
      setApplyDeployOpen(true)
      return
    }
    router.push(`/setup/${workspaceId}/step/5`)
  }

  function handleApplyDeployNow() {
    setApplyDeployOpen(false)
    void redeployFlow.startRedeploy()
  }

  if (isLoading) {
    return <div className="space-y-3"><LoadingSkeleton variant="line" /><LoadingSkeleton variant="card" /></div>
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">Deploy your Claw</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-1">Your Claw will be deployed to a managed cloud container.</p>
      {creditUser && (
        <p className="text-[10px] text-[var(--ac-text)] font-medium mb-1">
          Powered by Claws Starter Credits — no payment needed.
        </p>
      )}
      {(eligibility?.isFirstDeploy || eligibility?.reason === "trial_active") && (
        <p className="text-[10px] text-[var(--ac-text)] font-medium mb-3.5">
          Includes your 3-day platform trial — $79/mo after, cancel anytime
        </p>
      )}
      {!creditUser &&
        !eligibility?.isFirstDeploy &&
        eligibility?.reason !== "trial_active" && (
          <p className="text-[10px] text-[var(--tx3)] mb-3.5">$79/mo platform fee per running Claw</p>
        )}

      {recommendedAlwaysOn && !deploymentStatus && (
        <div className="mb-3.5">
          <AlertBanner variant="info">
            <p className="font-medium">This template recommends Always on</p>
            <p className="mt-0.5 opacity-80">
              Market-hour schedules can miss beats if the Claw hibernates. After deploy, enable Always on in the dashboard (higher hosting cost).
            </p>
          </AlertBanner>
        </div>
      )}

      {needsSub && !deploymentStatus && !waitingForActivation && (
        <AlertBanner variant="warning">
          <p className="font-medium">Your 3-day trial has ended</p>
          <p className="mt-0.5 opacity-80">Subscribe to the Claw Platform ($79/mo) to deploy and run your Claws.</p>
        </AlertBanner>
      )}

      {waitingForActivation && !deploymentStatus && (
        <AlertBanner variant="info" icon={<Loader2 className="w-4 h-4 animate-spin" />}>
          <p className="font-medium">Payment received — activating your subscription</p>
          <p className="mt-0.5 opacity-80">This usually takes a few seconds. If it doesn&apos;t update, try refreshing the page.</p>
        </AlertBanner>
      )}

      {!deploymentStatus && !waitingForActivation && (
        needsSub ? (
          <Button variant="primary" size="default" onClick={handleSubscribe} loading={subscribing}>
            Subscribe to Deploy - $79/mo
          </Button>
        ) : creditUser ? (
          <Button variant="primary" size="default" onClick={handleDeploy} disabled={isDeploying || !toolPrereqsReady}>
            Deploy Claw
          </Button>
        ) : (
          <Button variant="primary" size="default" onClick={handleDeploy} disabled={isDeploying || !eligibility || !toolPrereqsReady}>
            {eligibility?.isFirstDeploy ? "Deploy — 3-day trial" : "Deploy"}
          </Button>
        )
      )}

      {!toolPrereqsReady && !deploymentStatus && (
        <div className="mt-3.5">
          <AlertBanner variant="warning">
            <p className="font-medium">{missingRequiredToolsBannerTitle(toolPrereqs.missingLabels)}</p>
            <p className="mt-0.5 opacity-80">{MISSING_REQUIRED_TOOLS_BANNER_BODY}</p>
          </AlertBanner>
        </div>
      )}

      {toolPrereqsReady && unverifiedInfo && !deploymentStatus && (
        <div className="mt-3.5">
          <AlertBanner variant="info">
            <p className="font-medium">{unverifiedInfo}</p>
          </AlertBanner>
        </div>
      )}

      {deploymentStatus && deploymentStatus !== "QUEUED" && !showStaleRunningConfig && (
        <div className="mb-4">
          <DeployProgress
            steps={mapDeployStatus(deploymentStatus, null, hasConfiguredChannels)}
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

      {deploymentStatus === "QUEUED" && (
        <AlertBanner variant="info">
          <p className="font-medium">High demand</p>
          <p className="mt-0.5 opacity-80">
            {queueMessage ?? "High demand — your claw is queued to provision. We'll notify you."}
          </p>
        </AlertBanner>
      )}

      {deploymentStatus === "COMPLETED" && !showStaleRunningConfig && (
        <AlertBanner variant="info" icon={<CheckCircle className="w-4 h-4" />}>
          <p><strong>Deployment successful.</strong> Your Claw is running in the cloud.</p>
        </AlertBanner>
      )}

      {showStaleRunningConfig && (
        <DriftBanner
          changedAreas={configDrift.changedAreas}
          actions={
            <Button variant="primary" size="sm" onClick={() => setApplyDeployOpen(true)} loading={redeployFlow.redeploying}>
              Redeploy
            </Button>
          }
        />
      )}

      <div className="flex justify-between mt-4">
        <Button variant="outline" disabled={isDeploying} className={isDeploying ? "opacity-50" : ""} onClick={() => router.push(`/setup/${workspaceId}/step/3`)}>← Back</Button>
        <Button variant="primary" disabled={!canProceed} onClick={handleNextFromDeploy}>Next: Go live →</Button>
      </div>
      <ConfirmDialog
        open={applyDeployOpen}
        onClose={() => {
          setApplyDeployOpen(false)
          router.push(`/setup/${workspaceId}/step/5`)
        }}
        onConfirm={handleApplyDeployNow}
        title="Apply changes now?"
        description={`Your Claw is running an older configuration. Redeploy to apply changes to ${formatChangedAreas(configDrift?.changedAreas ?? [])}.`}
        confirmLabel="Redeploy"
        cancelLabel="Not now"
        variant="warning"
        loading={redeployFlow.redeploying}
      />
      <RedeployProgressModal
        open={redeployFlow.modalOpen}
        redeploying={redeployFlow.redeploying}
        status={redeployFlow.status}
        lastStage={redeployFlow.lastStage}
        error={redeployFlow.error}
        onClose={redeployFlow.closeModal}
        onRetry={redeployFlow.retry}
      />
    </>
  )
}

// ─── Step 4: Connect Channels ───────────────────────────────

const ICON_CLASS = "w-4 h-4"

type ChannelField = {
  key: string
  label: string
  placeholder: string
  required?: boolean
  helper?: string
}

type ChannelDefinition = {
  id: "web-chat" | ChannelId
  channelId?: ChannelId
  name: string
  description: string
  icon: ReactNode
  alwaysConnected?: boolean
  launch?: boolean
  staged?: boolean
  /** Honesty badge label (e.g. "beta"); rendered via DS Badge. */
  badgeLabel?: string
  fields?: ChannelField[]
  helpUrl?: string
  setupSteps?: string[]
}

const CHANNELS: ChannelDefinition[] = [
  { id: "web-chat", name: "Web chat", description: "Built-in - always available", icon: <Globe className={ICON_CLASS} />, alwaysConnected: true },
  {
    id: "telegram",
    channelId: "telegram",
    name: "Telegram",
    description: "Proven default — enter bot token from @BotFather",
    icon: <Send className={ICON_CLASS} />,
    launch: true,
    fields: [
      { key: "botToken", label: "Bot token", placeholder: "123456789:AA...", required: true },
      {
        key: "allowFrom",
        label: "Your Telegram user ID",
        placeholder: "123456789",
        helper: "Message @userinfobot on Telegram to get your ID. Only listed IDs can talk to your Claw; leave empty to add senders later.",
      },
    ],
    helpUrl: "https://core.telegram.org/bots#botfather",
    setupSteps: [
      "Open Telegram and message @BotFather",
      "Send /newbot and follow the prompts",
      "Copy the token it gives you and paste it below.",
    ],
  },
  {
    id: "discord",
    channelId: "discord",
    name: "Discord",
    description: "Enter bot token from Developer Portal",
    icon: <Gamepad2 className={ICON_CLASS} />,
    launch: true,
    badgeLabel: CHANNEL_BETA_LABEL,
    fields: [
      { key: "token", label: "Bot token", placeholder: "Paste your Discord bot token", required: true },
      {
        key: "allowFrom",
        label: "Your Discord user ID",
        placeholder: "123456789012345678",
        helper: "Copy your Discord user ID from Developer Mode. Only listed IDs can talk to your Claw; leave empty to add senders later.",
      },
    ],
    helpUrl: "https://discord.com/developers/applications",
    setupSteps: [
      "Discord Developer Portal → New Application",
      "Bot tab → Reset Token → copy",
      "Enable 'Message Content Intent' under Privileged Gateway Intents",
      "Invite the bot to your server (OAuth2 URL Generator, bot scope).",
    ],
  },
  {
    id: "slack",
    channelId: "slack",
    name: "Slack",
    description: "Socket Mode with bot and app tokens",
    icon: <Hash className={ICON_CLASS} />,
    launch: true,
    badgeLabel: CHANNEL_BETA_LABEL,
    fields: [
      { key: "appToken", label: "App token (xapp-…)", placeholder: "xapp-…", required: true },
      { key: "botToken", label: "Bot token (xoxb-…)", placeholder: "xoxb-…", required: true },
    ],
    helpUrl: "https://api.slack.com/apis/socket-mode",
    setupSteps: [
      "Create an app at api.slack.com/apps",
      "Enable Socket Mode → copy the App token (xapp-…)",
      "OAuth & Permissions → install → copy the Bot token (xoxb-…)",
      "Paste both.",
    ],
  },
  { id: "whatsapp", channelId: "whatsapp", name: "WhatsApp", description: "QR pairing — coming soon", icon: <Smartphone className={ICON_CLASS} />, staged: true },
  { id: "msteams", channelId: "msteams", name: "Microsoft Teams", description: "Requires Azure Bot Service setup — coming soon", icon: <Building2 className={ICON_CLASS} />, staged: true },
]

function isLaunchChannel(channelId: ChannelId): channelId is LaunchChannelId {
  return channelId === "telegram" || channelId === "discord" || channelId === "slack"
}

function buildChannelPayload(channel: LaunchChannelId, values: Record<string, string>) {
  const allowFrom = values.allowFrom?.trim() ? [values.allowFrom.trim()] : undefined
  if (channel === "telegram") return { channel, config: { botToken: values.botToken, ...(allowFrom && { allowFrom }) } }
  if (channel === "discord") return { channel, config: { token: values.token, ...(allowFrom && { allowFrom }) } }
  return { channel, config: { mode: "socket" as const, botToken: values.botToken, appToken: values.appToken } }
}

function channelDescription(channel: ChannelDefinition, summary: ChannelSummary | null, drift: WizardDriftInfo | null): string {
  if (!channel.channelId) return channel.description
  const state = summary?.channels[channel.channelId]
  if (!state?.configured) return channel.description
  if (state.live === "connected") return "Verified by the runtime"
  if (state.live === "error") return state.detail ? `${state.detail}. Check token and redeploy.` : "Runtime reported an error. Check token and redeploy."
  if (state.live === "connecting") return "Checking this channel"
  if (drift?.workspaceStatus !== "RUNNING" && drift?.workspaceStatus !== "PAUSED") return "Will connect when you deploy"
  return "Configured — deploys with next redeploy"
}

export function Step4({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [summary, setSummary] = useState<ChannelSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeChannel, setActiveChannel] = useState<ChannelDefinition | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [savingChannel, setSavingChannel] = useState<ChannelId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [workspaceTemplateSlug, setWorkspaceTemplateSlug] = useState<string | null>(null)
  const [channelDrift, setChannelDrift] = useState<WizardDriftInfo | null>(null)
  const [accessChannel, setAccessChannel] = useState<ChannelDefinition | null>(null)
  const [accessIds, setAccessIds] = useState<string[]>([])
  const [accessInput, setAccessInput] = useState("")
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessSaving, setAccessSaving] = useState(false)

  const refreshDrift = useCallback(async (): Promise<WizardDriftInfo | null> => {
    try {
      const res = await fetch(`/api/deploy/${workspaceId}/status?drift=1`)
      const json = await res.json()
      if (!json.success) return null
      const next: WizardDriftInfo = {
        isStale: Boolean(json.data?.drift?.isStale),
        changedAreas: Array.isArray(json.data?.drift?.changedAreas) ? json.data.drift.changedAreas : [],
        workspaceStatus: typeof json.data?.workspaceStatus === "string" ? json.data.workspaceStatus : null,
      }
      setChannelDrift(next)
      return next
    } catch {
      return null
    }
  }, [workspaceId])

  const loadChannels = useCallback(async () => {
    try {
      const [statusRes, workspaceRes] = await Promise.all([
        fetch(`/api/channels/${workspaceId}/status`),
        fetch(`/api/workspaces/${workspaceId}`),
      ])
      const json = await statusRes.json()
      if (json.success) setSummary(json.data as ChannelSummary)
      const workspaceJson = await workspaceRes.json()
      if (workspaceJson.success) {
        setWorkspaceTemplateSlug(workspaceJson.data?.clawTemplate?.slug ?? null)
      }
    } catch {
      setError("Failed to load channel settings.")
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    loadChannels()
    void refreshDrift()
  }, [loadChannels, refreshDrift])

  function openConnectModal(channel: ChannelDefinition) {
    setActiveChannel(channel)
    setFormValues({})
    setError(null)
  }

  async function openManageAccess(channel: ChannelDefinition) {
    if (!channel.channelId) return
    setAccessChannel(channel)
    setAccessIds([])
    setAccessInput("")
    setAccessError(null)
    try {
      const res = await fetch(`/api/channels/${workspaceId}`)
      const json = await res.json()
      if (!json.success) {
        setAccessError(json.error?.message || "Could not load access list.")
        return
      }
      const channels = json.data?.channels as MaskedChannelConfigMap | undefined
      setAccessIds(channels?.[channel.channelId]?.allowedIds ?? [])
    } catch {
      setAccessError("Network error while loading access list.")
    }
  }

  async function saveChannel() {
    if (!activeChannel?.channelId || !isLaunchChannel(activeChannel.channelId)) return
    setSavingChannel(activeChannel.channelId)
    setError(null)
    try {
      const res = await fetch(`/api/channels/${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildChannelPayload(activeChannel.channelId, formValues)),
      })
      const json = await res.json()
      if (!json.success) {
        setError(json.error?.message || "Could not save channel.")
        return
      }
      await loadChannels()
      await refreshDrift()
      setActiveChannel(null)
      setFormValues({})
    } catch {
      setError("Network error while saving channel.")
    } finally {
      setSavingChannel(null)
    }
  }

  async function disconnectChannel(channelId: ChannelId) {
    setSavingChannel(channelId)
    setError(null)
    try {
      const res = await fetch(`/api/channels/${workspaceId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelId }),
      })
      const json = await res.json()
      if (!json.success) {
        setError(json.error?.message || "Could not disconnect channel.")
        return
      }
      await loadChannels()
      await refreshDrift()
    } catch {
      setError("Network error while disconnecting channel.")
    } finally {
      setSavingChannel(null)
    }
  }

  const activeFields = activeChannel?.fields ?? []
  const allRequiredFilled = activeFields.every((field) => !field.required || (formValues[field.key] ?? "").trim().length > 0)
  const showEmergencyChannelWarning =
    workspaceTemplateSlug !== null &&
    EMERGENCY_CHANNEL_TEMPLATE_SLUGS.has(workspaceTemplateSlug) &&
    summary?.hasConfiguredChannels === false
  const showChannelDriftWarning = needsRedeployToApply(channelDrift)

  function addAccessId() {
    const value = accessInput.trim()
    if (!value || accessIds.includes(value)) return
    setAccessIds((prev) => [...prev, value])
    setAccessInput("")
  }

  async function saveAccessIds() {
    if (!accessChannel?.channelId) return
    setAccessSaving(true)
    setAccessError(null)
    try {
      const res = await fetch(`/api/channels/${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: accessChannel.channelId, config: { allowFrom: accessIds } }),
      })
      const json = await res.json()
      if (!json.success) {
        setAccessError(json.error?.message || "Could not save access list.")
        return
      }
      await loadChannels()
      await refreshDrift()
      setAccessChannel(null)
      setAccessIds([])
      setAccessInput("")
    } catch {
      setAccessError("Network error while saving access list.")
    } finally {
      setAccessSaving(false)
    }
  }

  return (
    <>
      <h2 className="text-[15px] font-semibold mb-0.5">How should your Claw talk to you?</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-1.5">Web chat is always available. Connect additional channels for real-time communication.</p>
      <p className="text-[11px] text-[var(--tx2)] mb-3.5">No channel? Your Claw is fully usable from the dashboard.</p>

      {error && (
        <div className="mb-3.5">
          <AlertBanner variant="error">{error}</AlertBanner>
        </div>
      )}

      {showEmergencyChannelWarning && (
        <div className="mb-3.5">
          <AlertBanner variant="warning">
            <p className="font-medium">This Claw&apos;s emergency alerts require a connected channel</p>
            <p className="mt-0.5 opacity-80">Without one, urgent alerts appear only on this dashboard.</p>
          </AlertBanner>
        </div>
      )}

      {showChannelDriftWarning && (
        <div className="mb-3.5">
          <DriftBanner
            changedAreas={channelDrift?.changedAreas ?? []}
            actions={
              <Button variant="outline" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/4`)}>
                Go to deploy
              </Button>
            }
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-label="Loading channel status">
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
        </div>
      ) : (
        <ChannelList>
          {CHANNELS.map((channel) => (
            <ChannelRow
              key={channel.id}
              name={channel.name}
              description={channelDescription(channel, summary, channelDrift)}
              icon={channel.icon}
              badge={
                channel.badgeLabel
                  ? <Badge variant="warning">{channel.badgeLabel}</Badge>
                  : channel.channelId && isBetaChannel(channel.channelId)
                    ? <Badge variant="warning">{CHANNEL_BETA_LABEL}</Badge>
                    : undefined
              }
              status={
                channel.alwaysConnected || (channel.channelId && summary?.channels[channel.channelId]?.live === "connected")
                  ? "connected"
                  : channel.channelId && summary?.channels[channel.channelId]?.live === "error"
                    ? "error"
                    : channel.channelId && summary?.channels[channel.channelId]?.live === "connecting"
                      ? "connecting"
                  : "disconnected"
              }
              errorMessage={channel.channelId && summary?.channels[channel.channelId]?.live === "error"
                ? "Check token and redeploy."
                : undefined}
              alwaysConnected={channel.alwaysConnected}
              onConnect={() => channel.launch && openConnectModal(channel)}
              onDisconnect={() => channel.channelId && disconnectChannel(channel.channelId)}
              action={
                channel.staged ? (
                  <Badge variant="neutral">Coming soon</Badge>
                ) : channel.channelId && summary?.channels[channel.channelId]?.configured ? (
                  <div className="flex items-center gap-1.5">
                    {summary.channels[channel.channelId].live === "connected" && (
                      <span className="text-[10px] text-[var(--ok)] font-medium">Connected</span>
                    )}
                    {summary.channels[channel.channelId].live === "unknown" && (
                      <Badge variant="info">Configured</Badge>
                    )}
                    {summary.channels[channel.channelId].live === "connecting" && (
                      <Badge variant="info">Checking</Badge>
                    )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openManageAccess(channel)}
                    disabled={savingChannel === channel.channelId}
                  >
                    Manage
                  </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => disconnectChannel(channel.channelId!)}
                      disabled={savingChannel === channel.channelId}
                    >
                      {savingChannel === channel.channelId ? "Disconnecting..." : "Disconnect"}
                    </Button>
                  </div>
                ) : channel.launch ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => openConnectModal(channel)}
                    disabled={channel.channelId ? savingChannel === channel.channelId : false}
                  >
                    Connect
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ChannelList>
      )}

      <Modal
        open={activeChannel !== null}
        onClose={() => {
          setActiveChannel(null)
          setFormValues({})
          setError(null)
        }}
        title={
          <span className="text-[16px] font-semibold">
            Connect <span className="text-[var(--ac)]">{activeChannel?.name}</span>
          </span>
        }
        description="Credentials are encrypted with AES-256-GCM and applied on the next redeploy."
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setActiveChannel(null)
                setFormValues({})
                setError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={saveChannel}
              disabled={!allRequiredFilled || (activeChannel?.channelId ? savingChannel === activeChannel.channelId : false)}
            >
              {activeChannel?.channelId && savingChannel === activeChannel.channelId ? "Saving..." : "Save channel"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {activeChannel?.setupSteps && (
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-[var(--tx2)] leading-[1.5]">
              {activeChannel.setupSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          {activeFields.map((field, index) => (
            <div key={field.key}>
              <label className="block text-[11px] font-medium mb-[3px]">{field.label}</label>
              <Input
                type={field.key === "allowFrom" ? "text" : "password"}
                value={formValues[field.key] ?? ""}
                onChange={(event) => setFormValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                placeholder={field.placeholder}
                className="font-mono"
                autoFocus={index === 0}
              />
              {field.helper && <p className="text-[11px] text-[var(--tx3)] mt-0.5">{field.helper}</p>}
            </div>
          ))}
          {activeChannel?.helpUrl && (
            <p className="text-[11px] text-[var(--tx3)]">
              <TextLink href={activeChannel.helpUrl} direction="forward" target="_blank" rel="noopener noreferrer">Setup guide</TextLink>
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={accessChannel !== null}
        onClose={() => {
          setAccessChannel(null)
          setAccessIds([])
          setAccessInput("")
          setAccessError(null)
        }}
        title={
          <span className="text-[16px] font-semibold">
            Manage <span className="text-[var(--ac)]">{accessChannel?.name}</span> access
          </span>
        }
        description="If someone messages your bot and gets an 'access not configured' reply, add the user ID from that reply here, then redeploy."
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setAccessChannel(null)
                setAccessIds([])
                setAccessInput("")
                setAccessError(null)
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={saveAccessIds} loading={accessSaving}>
              Save access
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium mb-[3px]">Allowed sender ID</label>
            <div className="flex gap-1.5">
              <Input
                value={accessInput}
                onChange={(event) => setAccessInput(event.target.value)}
                placeholder="Paste sender ID"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    addAccessId()
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={addAccessId} disabled={!accessInput.trim()}>
                Add
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--bd)] p-2.5">
            {accessIds.length === 0 ? (
              <p className="text-[11px] text-[var(--tx3)]">No sender IDs added yet.</p>
            ) : (
              <div className="space-y-1.5">
                {accessIds.map((id) => (
                  <div key={id} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-[var(--tx)]">{id}</span>
                    <Button variant="outline" size="xs" onClick={() => setAccessIds((prev) => prev.filter((value) => value !== id))}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {accessError && (
            <AlertBanner variant="error">
              {accessError}
            </AlertBanner>
          )}
        </div>
      </Modal>

      <div className="flex justify-between mt-3.5">
        <Button variant="outline" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>← Back</Button>
        <Button variant="primary" onClick={() => router.push(`/setup/${workspaceId}/step/4`)}>Next: Deploy →</Button>
      </div>
    </>
  )
}

// ─── Step 5: Go Live ────────────────────────────────────────

export function Step5({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [wsName, setWsName] = useState("Your Claw")
  const [goLiveDrift, setGoLiveDrift] = useState<WizardDriftInfo | null>(null)

  const refreshGoLiveDrift = useCallback(async () => {
    try {
      const res = await fetch(`/api/deploy/${workspaceId}/status?drift=1`)
      const json = await res.json()
      if (!json.success) return
      setGoLiveDrift({
        isStale: Boolean(json.data?.drift?.isStale),
        changedAreas: Array.isArray(json.data?.drift?.changedAreas) ? json.data.drift.changedAreas : [],
        workspaceStatus: typeof json.data?.workspaceStatus === "string" ? json.data.workspaceStatus : null,
      })
    } catch {
      // Step 5 remains usable if drift status cannot be fetched.
    }
  }, [workspaceId])

  const redeployFlow = useWorkspaceRedeploy({
    workspaceId,
    onCompleted: () => { void refreshGoLiveDrift() },
  })

  // PR-2b #3: this useEffect previously also fired a PATCH to set
  // workspace.status='RUNNING' unconditionally. That was wrong on two
  // counts: (1) the PATCH happens on mount with no guard, so just
  // navigating to /setup/<id>/step/5 (including via a stale bookmark)
  // would flip the status without any deploy actually running, leaving
  // workspaces in a "claims to be RUNNING but containerId=null and
  // ActivityLog empty" state we hit during PR-2 staging validation; and
  // (2) the legit RUNNING transition is already handled by
  // /api/deploy/[id]/complete/route.ts:33-37 which runs at the end of
  // the actual deploy. Step5 is the celebration page — it READS state,
  // never writes it.
  useEffect(() => {
    async function loadName() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}`)
        const json = await res.json()
        if (json.success) setWsName(json.data.name || "Your Claw")
      } catch (err) {
        console.error("Failed to load workspace name:", err)
      }
    }
    loadName()
    // Intentional mount-time server sync; mirrors the setup data loaders above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshGoLiveDrift()
  }, [workspaceId, refreshGoLiveDrift])

  const showGoLiveDrift = needsRedeployToApply(goLiveDrift)

  return (
    <div className="text-center py-[30px] px-5">
      <div className="flex items-center justify-center w-10 h-10 text-[var(--ok)] mx-auto mb-3">
        <Sparkles className="w-10 h-10" />
      </div>
      <h2 className="text-xl font-semibold mb-1.5">Your {wsName} is live!</h2>
      <p className="text-sm text-[var(--tx2)] mb-1">Your agents are starting up now.</p>

      {showGoLiveDrift ? (
        <div className="text-left max-w-lg mx-auto mt-4">
          <DriftBanner
            changedAreas={goLiveDrift?.changedAreas ?? []}
            actions={
              <Button variant="outline" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/4`)}>
                Go to deploy
              </Button>
            }
          />
        </div>
      ) : (
        <div className="text-left max-w-lg mx-auto bg-[var(--bg2)] rounded-lg p-3.5 mt-4 text-xs text-[var(--tx2)] leading-[1.8]">
          <p className="font-semibold text-[var(--tx)] mb-1">What happens next:</p>
          <p className="flex items-start gap-1.5"><Bot className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span><strong>Next few minutes:</strong> Your Orchestrator introduces itself and confirms all agents are operational.</span></p>
          <p className="flex items-start gap-1.5"><ClipboardList className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span><strong>Tomorrow morning:</strong> Your first daily briefing arrives with status updates and action items.</span></p>
          <p className="mt-2 font-semibold text-[var(--tx)] mb-1">Quick tips:</p>
          <p className="flex items-start gap-1.5"><MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span>Message your Orchestrator anytime through the connected channels.</span></p>
          <p className="flex items-start gap-1.5"><BarChart3 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span>Check the Dashboard for real-time agent activity and approvals.</span></p>
          <p className="flex items-start gap-1.5"><Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--tx3)]" /> <span>Open the Builder to customize agent behavior, skills, and workflows.</span></p>
        </div>
      )}

      <div className="flex gap-2 justify-center mt-4">
        <Button variant="primary" size="lg" onClick={() => router.push(`/dashboard/${workspaceId}`)}>Open Dashboard</Button>
        <Button variant="outline" size="lg" onClick={() => router.push(`/builder/${workspaceId}`)}>Customize in Builder</Button>
      </div>
      <RedeployProgressModal
        open={redeployFlow.modalOpen}
        redeploying={redeployFlow.redeploying}
        status={redeployFlow.status}
        lastStage={redeployFlow.lastStage}
        error={redeployFlow.error}
        onClose={redeployFlow.closeModal}
        onRetry={redeployFlow.retry}
      />
    </div>
  )
}

// ─── Placeholder (safety fallback) ──────────────────────────

function StepPlaceholder({ step, workspaceId }: { step: number; workspaceId: string }) {
  const router = useRouter()
  const labels = ["", "AI model", "Connect tools", "Connect channels", "Deploy", "Go live"]
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
    queueMicrotask(() => setIsFromBuilder(fromQuery || stored))
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
        { label: "Channels", status: "complete" as const },
        { label: "Deploy", status: "complete" as const },
        { label: "Live!", status: "complete" as const },
      ]
    : getProgressSteps(stepNum)

  const showWizardChrome = !(stepNum === 2 && isManageMode)

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <div className="flex items-center mb-[24px]">
          <TextLink
            direction="back"
            onClick={exitWizard}
            className="flex-shrink-0 mr-[16px] leading-none"
          >
            {isFromBuilder ? "Back to Builder" : "Back to My Claws"}
          </TextLink>
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
          : stepNum === 3 ? <Step4 workspaceId={workspaceId} />
          : stepNum === 4 ? <Step3 workspaceId={workspaceId} />
          : stepNum === 5 ? <Step5 workspaceId={workspaceId} />
          : <StepPlaceholder step={stepNum} workspaceId={workspaceId} />}
      </div>
    </>
  )
}
