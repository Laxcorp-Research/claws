import { createHash } from 'crypto';
import { prisma } from '@/lib/db';

export const CONFIG_FINGERPRINT_VERSION = 4;
export const CONFIG_FINGERPRINT_MIN_VERSION = 1;

export interface WorkspaceConfigFingerprint {
  version: number;
  hash: string;
  areas: {
    tools: string;
    agents: string;
    connections: string;
    channels: string;
    keys: string;
    workspace: string;
  };
  versionFingerprints: Partial<Record<number, VersionedWorkspaceConfigFingerprint>>;
  introducedAreas: Partial<Record<number, Partial<Record<FingerprintArea, boolean>>>>;
}

type FingerprintArea = keyof WorkspaceConfigFingerprint['areas'];
export type VersionedWorkspaceConfigFingerprint = Pick<WorkspaceConfigFingerprint, 'hash' | 'areas'>;
type GeneratorSkillProjection = {
  slug: string;
  name: string;
  description: string;
  emoji?: string | null;
  requiredBins?: string[] | null;
  compatibleTools?: string[] | null;
  skillMd?: string | null;
};
type GeneratorWorkspaceProjection = {
  userContext?: string | null;
};
type WorkspaceFingerprintInput = {
  toolConnections: Array<{
    toolSlug: string;
    displayName: string | null;
    connectionType: string;
    status: string;
    composioConnectionId: string | null;
    encryptedCredentials: string | null;
  }>;
  customToolConnections: Array<{
    id: string;
    name: string;
    baseUrl: string;
    authType: string;
    encryptedCredentials: string | null;
    description?: string | null;
  }>;
  agents: Array<{
    id: string;
    name: string;
    role: string;
    description?: string | null;
    model: string;
    soulMd?: string | null;
    agentsMd?: string | null;
    heartbeatMd?: string | null;
    heartbeatFrequency?: string | null;
    heartbeatTime?: string | null;
    isPaused?: boolean | null;
    qualityThreshold?: number | null;
    reportsTo?: string | null;
    skills: Array<{
      skillId: string;
      skill: GeneratorSkillProjection;
    }>;
  }>;
  connections: Array<{
    sourceAgentId: string;
    targetAgentId: string;
    condition: string;
    contextNote?: string | null;
  }>;
  user: {
    name: string | null;
    apiKeys: Array<{ provider: string; encryptedKey: string }>;
  };
  workspace: {
    timezone?: string | null;
    userContext?: string | null;
    clawTemplateId?: string | null;
    name: string;
    channelConfigEncrypted?: string | null;
    maxRevisionRounds?: number | null;
    deliveryMode?: string | null;
  };
  agentNameById: Map<string, string>;
};
type ProjectionInputByArea = Record<FingerprintArea, unknown>;
type FingerprintProjection = (input: WorkspaceFingerprintInput) => ProjectionInputByArea;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function hashJson(value: unknown): string {
  return sha256(stableStringify(value));
}

function fingerprintSecretBlob(blob: string | null | undefined): string | null {
  // Deliberately hash the encrypted blob instead of decrypting on the drift path.
  // Master-key re-encryption can create a rare false positive; accepted because
  // this helper must be side-effect-free and never handle plaintext secrets.
  return blob ? sha256(blob) : null;
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function projectToolConnections(input: WorkspaceFingerprintInput) {
  return input.toolConnections
    .map((tool) => ({
      slug: tool.toolSlug,
      displayName: tool.displayName,
      type: tool.connectionType,
      status: tool.status,
      composioConnectionId: tool.composioConnectionId,
      credentialFingerprint: fingerprintSecretBlob(tool.encryptedCredentials),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function projectCustomApis(input: WorkspaceFingerprintInput) {
  return input.customToolConnections
    .map((customApi) => ({
      id: customApi.id,
      name: customApi.name,
      baseUrl: customApi.baseUrl,
      authType: customApi.authType,
      credentialFingerprint: fingerprintSecretBlob(customApi.encryptedCredentials),
      description: customApi.description ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function projectAgents(input: WorkspaceFingerprintInput) {
  return projectAgentsWithOptions(input, { includePauseState: false });
}

function projectAgentsWithOptions(input: WorkspaceFingerprintInput, options: { includePauseState: boolean }) {
  return input.agents
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      model: agent.model,
      soulMd: agent.soulMd,
      agentsMd: agent.agentsMd,
      heartbeatMd: agent.heartbeatMd,
      heartbeatFrequency: agent.heartbeatFrequency,
      heartbeatTime: agent.heartbeatTime,
      ...(options.includePauseState ? { isPaused: Boolean(agent.isPaused) } : {}),
      qualityThreshold: agent.qualityThreshold,
      reportsTo: agent.reportsTo,
      skillIds: sortStrings(agent.skills.map((agentSkill) => agentSkill.skillId)),
      skillRows: agent.skills
        .map((agentSkill) => {
          const skill = agentSkill.skill as GeneratorSkillProjection;
          return {
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
            emoji: skill.emoji ?? null,
            requiredBins: sortStrings(skill.requiredBins ?? []),
            compatibleTools: sortStrings(skill.compatibleTools ?? []),
            skillMd: skill.skillMd ?? null,
          };
        })
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    }))
    .sort((a, b) => {
      const roleOrder = { ORCHESTRATOR: 0, WORKER: 1, CRITIC: 2 } as const;
      const roleDiff =
        (roleOrder[a.role as keyof typeof roleOrder] ?? 99) -
        (roleOrder[b.role as keyof typeof roleOrder] ?? 99);
      return roleDiff || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}

function projectConnections(input: WorkspaceFingerprintInput) {
  return projectConnectionsWithOptions(input, { includeContextNote: false });
}

function projectConnectionsWithOptions(
  input: WorkspaceFingerprintInput,
  options: { includeContextNote: boolean },
) {
  return input.connections
    .map((connection) => ({
      from: input.agentNameById.get(connection.sourceAgentId) ?? connection.sourceAgentId,
      to: input.agentNameById.get(connection.targetAgentId) ?? connection.targetAgentId,
      condition: connection.condition,
      ...(options.includeContextNote
        ? { contextNote: connection.contextNote ?? null }
        : {}),
    }))
    .sort((a, b) => (
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.condition.localeCompare(b.condition) ||
      (("contextNote" in a ? String(a.contextNote ?? "") : "").localeCompare(
        "contextNote" in b ? String(b.contextNote ?? "") : "",
      ))
    ));
}

function projectKeys(input: WorkspaceFingerprintInput) {
  return {
    userName: input.user.name,
    apiKeys: input.user.apiKeys
      .map((key) => ({
        provider: key.provider,
        credentialFingerprint: fingerprintSecretBlob(key.encryptedKey),
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
  };
}

function projectWorkspace(input: WorkspaceFingerprintInput) {
  return projectWorkspaceWithOptions(input, { includeChoreographyKnobs: false });
}

function projectWorkspaceWithOptions(
  input: WorkspaceFingerprintInput,
  options: { includeChoreographyKnobs: boolean },
) {
  return {
    timezone: input.workspace.timezone,
    userContext: input.workspace.userContext ?? null,
    clawTemplateId: input.workspace.clawTemplateId,
    // The generator's fallback files use workspace.name only when there is no
    // template name available for the Claw name.
    fallbackWorkspaceName: input.workspace.clawTemplateId ? null : input.workspace.name,
    ...(options.includeChoreographyKnobs
      ? {
          maxRevisionRounds: input.workspace.maxRevisionRounds ?? 3,
          deliveryMode: input.workspace.deliveryMode ?? "APPROVAL_REQUIRED",
        }
      : {}),
  };
}

const FINGERPRINT_PROJECTIONS: Record<number, FingerprintProjection> = {
  1: (input) => ({
    tools: projectToolConnections(input),
    agents: projectAgents(input),
    connections: projectConnections(input),
    channels: { channelConfigEncrypted: fingerprintSecretBlob(input.workspace.channelConfigEncrypted) },
    keys: projectKeys(input),
    workspace: projectWorkspace(input),
  }),
  2: (input) => ({
    tools: {
      connections: projectToolConnections(input),
      customApis: projectCustomApis(input),
    },
    agents: projectAgents(input),
    connections: projectConnections(input),
    channels: { channelConfigEncrypted: fingerprintSecretBlob(input.workspace.channelConfigEncrypted) },
    keys: projectKeys(input),
    workspace: projectWorkspace(input),
  }),
  3: (input) => ({
    tools: {
      connections: projectToolConnections(input),
      customApis: projectCustomApis(input),
    },
    agents: projectAgentsWithOptions(input, { includePauseState: true }),
    connections: projectConnections(input),
    channels: { channelConfigEncrypted: fingerprintSecretBlob(input.workspace.channelConfigEncrypted) },
    keys: projectKeys(input),
    workspace: projectWorkspace(input),
  }),
  // WIRE-FULL: choreography knobs + per-edge contextNote.
  4: (input) => ({
    tools: {
      connections: projectToolConnections(input),
      customApis: projectCustomApis(input),
    },
    agents: projectAgentsWithOptions(input, { includePauseState: true }),
    connections: projectConnectionsWithOptions(input, { includeContextNote: true }),
    channels: { channelConfigEncrypted: fingerprintSecretBlob(input.workspace.channelConfigEncrypted) },
    keys: projectKeys(input),
    workspace: projectWorkspaceWithOptions(input, { includeChoreographyKnobs: true }),
  }),
};

export const FINGERPRINT_TRANSITIONS: Record<number, Partial<Record<FingerprintArea, string>>> = {
  2: {
    tools: 'custom APIs',
  },
  // FP1.1 limitation: v3 modifies the existing agents projection by adding
  // isPaused, not a new area. Workspaces deployed with v2 fingerprints compare
  // against the v2 projection, so a pause-only change does not banner until the
  // workspace is redeployed/re-baselined on v3.
  3: {},
  // v4 extends connections + workspace projections (contextNote, knobs).
  4: {
    connections: 'edge context notes',
    workspace: 'choreography knobs',
  },
};

export function isKnownFingerprintVersion(version: number): boolean {
  return Object.prototype.hasOwnProperty.call(FINGERPRINT_PROJECTIONS, version);
}

function hashProjection(projection: ProjectionInputByArea): VersionedWorkspaceConfigFingerprint {
  const areas = Object.fromEntries(
    (Object.keys(projection) as FingerprintArea[]).map((area) => [area, hashJson(projection[area])]),
  ) as WorkspaceConfigFingerprint['areas'];
  return {
    hash: hashJson(areas),
    areas,
  };
}

function introducedAreasForInput(input: WorkspaceFingerprintInput): WorkspaceConfigFingerprint['introducedAreas'] {
  return {
    2: {
      tools: input.customToolConnections.length > 0,
    },
  };
}

function buildInput(workspace: {
  name: string;
  timezone?: string | null;
  userContext?: string | null;
  clawTemplateId?: string | null;
  channelConfigEncrypted?: string | null;
  maxRevisionRounds?: number | null;
  deliveryMode?: string | null;
  agents?: WorkspaceFingerprintInput['agents'];
  connections?: WorkspaceFingerprintInput['connections'];
  toolConnections?: WorkspaceFingerprintInput['toolConnections'];
  customToolConnections?: WorkspaceFingerprintInput['customToolConnections'];
  user?: WorkspaceFingerprintInput['user'];
}): WorkspaceFingerprintInput {
  const agentsInput = workspace.agents ?? [];
  return {
    toolConnections: workspace.toolConnections ?? [],
    customToolConnections: workspace.customToolConnections ?? [],
    agents: agentsInput,
    connections: workspace.connections ?? [],
    user: workspace.user ?? { name: null, apiKeys: [] },
    workspace: {
      name: workspace.name,
      timezone: workspace.timezone,
      userContext: (workspace as GeneratorWorkspaceProjection).userContext ?? null,
      clawTemplateId: workspace.clawTemplateId,
      channelConfigEncrypted: workspace.channelConfigEncrypted,
      maxRevisionRounds: workspace.maxRevisionRounds ?? 3,
      deliveryMode: workspace.deliveryMode ?? "APPROVAL_REQUIRED",
    },
    agentNameById: new Map(agentsInput.map((agent) => [agent.id, agent.name])),
  };
}

export async function buildWorkspaceConfigFingerprint(workspaceId: string): Promise<WorkspaceConfigFingerprint> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      agents: {
        include: {
          skills: { include: { skill: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      connections: true,
      toolConnections: true,
      customToolConnections: true,
      clawTemplate: { select: { id: true } },
      user: {
        include: {
          apiKeys: true,
        },
      },
    },
  });

  const input = buildInput(workspace);
  const versionFingerprints = Object.fromEntries(
    Object.entries(FINGERPRINT_PROJECTIONS).map(([version, project]) => [
      Number(version),
      hashProjection(project(input)),
    ]),
  ) as WorkspaceConfigFingerprint['versionFingerprints'];
  const current = versionFingerprints[CONFIG_FINGERPRINT_VERSION];
  if (!current) throw new Error(`Missing config fingerprint projection v${CONFIG_FINGERPRINT_VERSION}`);

  return {
    version: CONFIG_FINGERPRINT_VERSION,
    hash: current.hash,
    areas: current.areas,
    versionFingerprints,
    introducedAreas: introducedAreasForInput(input),
  };
}
