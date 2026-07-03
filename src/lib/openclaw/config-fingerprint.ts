import { createHash } from 'crypto';
import { prisma } from '@/lib/db';

export interface WorkspaceConfigFingerprint {
  hash: string;
  areas: {
    tools: string;
    agents: string;
    connections: string;
    channels: string;
    keys: string;
    workspace: string;
  };
}

type FingerprintArea = keyof WorkspaceConfigFingerprint['areas'];
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
      clawTemplate: { select: { id: true } },
      user: {
        include: {
          apiKeys: true,
        },
      },
    },
  });

  const toolConnections = workspace.toolConnections ?? [];
  const agentsInput = workspace.agents ?? [];
  const connectionsInput = workspace.connections ?? [];
  const userInput = workspace.user ?? { name: null, apiKeys: [] };

  const tools = toolConnections
    .map((tool) => ({
      slug: tool.toolSlug,
      displayName: tool.displayName,
      type: tool.connectionType,
      status: tool.status,
      composioConnectionId: tool.composioConnectionId,
      credentialFingerprint: fingerprintSecretBlob(tool.encryptedCredentials),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const agents = agentsInput
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
      const roleDiff = roleOrder[a.role] - roleOrder[b.role];
      return roleDiff || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });

  const agentNameById = new Map(agentsInput.map((agent) => [agent.id, agent.name]));
  const connections = connectionsInput
    .map((connection) => ({
      from: agentNameById.get(connection.sourceAgentId) ?? connection.sourceAgentId,
      to: agentNameById.get(connection.targetAgentId) ?? connection.targetAgentId,
      condition: connection.condition,
    }))
    .sort((a, b) => (
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.condition.localeCompare(b.condition)
    ));

  const keys = {
    userName: userInput.name,
    apiKeys: userInput.apiKeys
      .map((key) => ({
        provider: key.provider,
        credentialFingerprint: fingerprintSecretBlob(key.encryptedKey),
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
  };

  const workspaceArea = {
    timezone: workspace.timezone,
    userContext: (workspace as GeneratorWorkspaceProjection).userContext ?? null,
    clawTemplateId: workspace.clawTemplateId,
    // The generator's fallback files use workspace.name only when there is no
    // template name available for the Claw name.
    fallbackWorkspaceName: workspace.clawTemplateId ? null : workspace.name,
  };

  const areas: Record<FingerprintArea, string> = {
    tools: hashJson(tools),
    agents: hashJson(agents),
    connections: hashJson(connections),
    channels: hashJson({ channelConfigEncrypted: fingerprintSecretBlob(workspace.channelConfigEncrypted) }),
    keys: hashJson(keys),
    workspace: hashJson(workspaceArea),
  };

  return {
    hash: hashJson(areas),
    areas,
  };
}
