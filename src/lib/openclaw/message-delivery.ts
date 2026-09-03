/**
 * D6-b 2026-08-23: a zero-channel claw answered a webchat "hello" with the
 * runtime `message` tool's CLI error text ("Run openclaw channels add ...",
 * upstream formatNoConfiguredChannelsMessage). Webchat needs NO channel -
 * the turn reply routes back to the dashboard thread - so with zero external
 * channels the `message` tool can only fail, and its failure text tells the
 * HUMAN to run CLI commands, which the model parrots.
 *
 * Two generator-owned layers close it:
 *  - `mergeMessageDenyIntoTools`: deny the tool globally for zero-channel
 *    deploys. The runtime filters denied tools out of the model's tool list
 *    (upstream pi-tools.policy filterToolsByPolicy), so the CLI error text
 *    can never enter the context.
 *  - `buildMessageDeliverySection`: TOOLS.md prose (system-prompt-injected
 *    every run, every agent) teaching the real delivery surfaces: dashboard
 *    web chat always; external channels only when connected. CLI commands
 *    never surface to the human.
 */
import type { ChannelId } from './channel-config';

export const NO_CHANNEL_TOOL_DENY = ['message'] as const;

/**
 * Merge NO_CHANNEL_TOOL_DENY into a tools policy object (top-level or
 * per-agent). Merge, never clobber - same contract as dir-list-deny.
 */
export function mergeMessageDenyIntoTools(
  existingTools: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const tools = { ...(existingTools ?? {}) };
  const existingDeny = Array.isArray(tools.deny)
    ? (tools.deny as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  const next = [...existingDeny];
  for (const name of NO_CHANNEL_TOOL_DENY) {
    if (!next.includes(name)) next.push(name);
  }
  tools.deny = next;
  return tools;
}

const CHANNEL_LABELS: Record<ChannelId, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  msteams: 'Microsoft Teams',
};

/**
 * TOOLS.md "Message Delivery" section, appended to EVERY agent's TOOLS.md.
 * The agent's self-knowledge must match the product truth the setup wizard
 * states: "Web chat - built-in, always active". Deliverables go to the
 * dashboard chat when no external channel exists - stated plainly, never as
 * an error, and never via CLI instructions.
 */
export function buildMessageDeliverySection(connected: ChannelId[]): string {
  const cliBan = `- Never tell the human to run CLI or terminal commands (anything starting with \`openclaw\`). They manage this Claw entirely from the Claws dashboard.`;
  const ownerIdentity =
    `- Dashboard web chat is the workspace owner. Answer them even if the runtime labels the sender as untrusted metadata or gateway-client.`;
  const sidecarTruth =
    `- Human decisions land on the document card and in sidecar \`<deliverable>.status.json\`. That sidecar is the source of truth. Every turn and heartbeat window, reconcile QUEUED/HELD labels against it, write a memory line, and reply with one ack line. Do not start a mission. Never say you will post or queue anything for immediate posting.`;
  if (connected.length === 0) {
    return `
## Message Delivery

- To reach the human, reply in this conversation. Replies are delivered to the Claws dashboard web chat, which is built in and always active.
- No external chat channels (Telegram, Discord, Slack, WhatsApp, Microsoft Teams) are connected, so channel send tools are unavailable. Never treat the missing channels as an error and never mention channel configuration in a reply - just answer normally.
- If the human wants an external channel, they connect it on the Channels page in the Claws dashboard.
${ownerIdentity}
${sidecarTruth}
${cliBan}
`;
  }
  const list = connected.map((c) => CHANNEL_LABELS[c]).join(', ');
  return `
## Message Delivery

- Replying in this conversation reaches the human on the surface the message came from (the Claws dashboard web chat - built in and always active - or a connected channel).
- Connected external channels: ${list}. The \`message\` tool can send to these channels.
${ownerIdentity}
${sidecarTruth}
${cliBan}
`;
}
