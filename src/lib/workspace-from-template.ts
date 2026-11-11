import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { completeOnboardingAfterFirstWorkspace } from "@/lib/auth/complete-onboarding"
import { cloneToolsForWorkspaceSeed } from "@/lib/tools/workspace-tool-requirements"
import { cloneSeedFilesForWorkspace } from "@/lib/workspace-seed-files"
import { log } from "@/lib/logger"
import { encryptedSyncSecret } from "@/lib/openclaw/sync-secret"

interface SnapshotSkill {
  slug?: string
  skillSlug?: string
  name?: string
  configOverrides?: string | null
}

interface SnapshotAgent {
  agentSlug: string
  name: string
  role: string
  model: string
  soulMd: string
  agentsMd: string
  heartbeatMd?: string
  heartbeatFrequency?: string | null
  heartbeatTime?: string | null
  color?: string
  qualityThreshold?: number
  positionX?: number
  positionY?: number
  reportsTo?: string
  /** Publish: { slug, name, configOverrides }. Seed (pre-normalize): string slugs. */
  skills?: Array<SnapshotSkill | string>
}

interface SnapshotConnection {
  sourceSlug: string
  targetSlug: string
  condition: string
}

interface WorkspaceSnapshot {
  agents: SnapshotAgent[]
  connections?: SnapshotConnection[]
  tools?: unknown
  files?: unknown
  maxRevisionRounds?: number
  deliveryMode?: "APPROVAL_REQUIRED" | "AUTO_PROCEED"
}

interface CreateWorkspaceOptions {
  userId: string
  templateId: string
}

interface WorkspaceResult {
  workspaceId: string
  workspaceName: string
  /** Same transaction signal as onboardingCompleted (count === 1). */
  isFirstWorkspace: boolean
}

type AgentRole = "ORCHESTRATOR" | "WORKER" | "CRITIC"

function snapshotSkillSlug(entry: SnapshotSkill | string): string | null {
  if (typeof entry === "string") {
    const slug = entry.trim()
    return slug.length > 0 ? slug : null
  }
  if (typeof entry.slug === "string" && entry.slug.trim()) return entry.slug.trim()
  if (typeof entry.skillSlug === "string" && entry.skillSlug.trim()) {
    return entry.skillSlug.trim()
  }
  return null
}

/**
 * Creates a Workspace + Agents + AgentConnections from a ClawTemplate snapshot.
 * Also creates a TemplateInstall record and increments ClawTemplate.installCount.
 * Copies snapshot.tools → workspace.toolRequirements (template JSON untouched).
 * Copies snapshot.files → workspace.seedFiles (birth stubs; template JSON untouched).
 * Materializes agents[].skills → AgentSkill rows (D-AS; stale slugs skipped with WARN).
 *
 * Used by: checkout route (mock mode + free templates), webhook (paid templates).
 */
export async function createWorkspaceFromTemplate(
  options: CreateWorkspaceOptions,
): Promise<WorkspaceResult> {
  const { userId, templateId } = options

  const template = await prisma.clawTemplate.findUniqueOrThrow({
    where: { id: templateId },
  })

  const raw = template.workspaceSnapshot
  const snapshot: WorkspaceSnapshot =
    typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as WorkspaceSnapshot)

  // Verbatim copy of snapshot.tools into the workspace-owned set. Dismissed
  // defaults absent/false. Template workspaceSnapshot is never written back.
  const toolRequirements = cloneToolsForWorkspaceSeed(snapshot.tools)
  const seedFiles = cloneSeedFilesForWorkspace(snapshot.files)

  return prisma.$transaction(async (tx) => {
    const existingCount = await tx.workspace.count({
      where: { userId, clawTemplateId: template.id },
    })
    const name = existingCount > 0
      ? `${template.name} (${existingCount + 1})`
      : template.name

    const workspace = await tx.workspace.create({
      data: {
        userId,
        name,
        slug: `${template.slug}-${Date.now()}`,
        description: template.description,
        status: "SETUP_INCOMPLETE",
        clawTemplateId: template.id,
        syncSecretEncrypted: encryptedSyncSecret(),
        toolRequirements: toolRequirements as unknown as Prisma.InputJsonValue,
        seedFiles:
          seedFiles.length > 0 ? (seedFiles as unknown as Prisma.InputJsonValue) : undefined,
        maxRevisionRounds:
          typeof snapshot.maxRevisionRounds === "number" ? snapshot.maxRevisionRounds : 3,
        deliveryMode:
          snapshot.deliveryMode === "AUTO_PROCEED" ? "AUTO_PROCEED" : "APPROVAL_REQUIRED",
      },
    })

    const slugToId: Record<string, string> = {}

    for (const a of snapshot.agents) {
      const agent = await tx.agent.create({
        data: {
          workspaceId: workspace.id,
          agentSlug: a.agentSlug,
          name: a.name,
          role: a.role as AgentRole,
          model: a.model,
          soulMd: a.soulMd,
          agentsMd: a.agentsMd,
          heartbeatMd: a.heartbeatMd ?? null,
          heartbeatFrequency: a.heartbeatFrequency ?? null,
          heartbeatTime: a.heartbeatTime ?? null,
          color: a.color ?? "#5BA1F5",
          qualityThreshold: a.qualityThreshold ?? 8.0,
          positionX: a.positionX ?? 0,
          positionY: a.positionY ?? 0,
        },
      })
      slugToId[a.agentSlug] = agent.id

      // D-AS: APPLY snapshot skills into AgentSkill inside this transaction.
      // MUTATION: drop this loop → skill-match install test fails.
      for (const skillEntry of a.skills ?? []) {
        const skillSlug = snapshotSkillSlug(skillEntry)
        if (!skillSlug) continue
        const skill = await tx.skill.findUnique({
          where: { slug: skillSlug },
          select: { id: true },
        })
        if (!skill) {
          log.warn("createWorkspaceFromTemplate: skipping stale skill slug", {
            slug: skillSlug,
            agentSlug: a.agentSlug,
            templateId: template.id,
            workspaceId: workspace.id,
          })
          continue
        }
        await tx.agentSkill.create({
          data: {
            agentId: agent.id,
            skillId: skill.id,
            configOverrides:
              typeof skillEntry === "string"
                ? null
                : typeof skillEntry.configOverrides === "string"
                  ? skillEntry.configOverrides
                  : skillEntry.configOverrides ?? null,
          },
        })
      }
    }

    // WIRE-FULL: reportsTo writers removed - derive from edges at read time.

    for (const c of snapshot.connections ?? []) {
      const src = slugToId[c.sourceSlug]
      const tgt = slugToId[c.targetSlug]
      if (src && tgt) {
        await tx.agentConnection.create({
          data: {
            workspaceId: workspace.id,
            sourceAgentId: src,
            targetAgentId: tgt,
            // X2: coerce uniformly; generator ignores condition.
            condition: "ON_COMPLETE",
            contextNote:
              "contextNote" in c && typeof (c as { contextNote?: unknown }).contextNote === "string"
                ? String((c as { contextNote: string }).contextNote).slice(0, 140)
                : null,
          },
        })
      }
    }

    await tx.templateInstall.upsert({
      where: { templateId_userId: { templateId: template.id, userId } },
      create: { templateId: template.id, userId },
      update: {},
    })

    await tx.clawTemplate.update({
      where: { id: template.id },
      data: { installCount: { increment: 1 } },
    })

    // MUTATION: remove this call → first template install leaves flag false.
    // isFirstWorkspace is the same count===1 signal (no second definition).
    const isFirstWorkspace = await completeOnboardingAfterFirstWorkspace(tx, userId)

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      isFirstWorkspace,
    }
  })
}

/** D-vi: first install → tracker; later installs → builder. */
export function installLandingPath(
  workspaceId: string,
  isFirstWorkspace: boolean,
): string {
  return isFirstWorkspace ? "/onboarding" : `/builder/${workspaceId}`
}
