// D6-b 2026-08-23: zero-channel claw parroted the runtime `message` tool's
// CLI error ("Run openclaw channels add ...") to the founder in webchat.
// These tests lock both layers of the fix: the tool deny (removes the CLI
// text's only source from the model's tool list) and the TOOLS.md delivery
// prose (teaches webchat-always self-knowledge).
import { describe, expect, it } from 'vitest';
import {
  NO_CHANNEL_TOOL_DENY,
  buildMessageDeliverySection,
  mergeMessageDenyIntoTools,
} from '../message-delivery';

describe('mergeMessageDenyIntoTools', () => {
  it('denies message on an absent tools object', () => {
    const tools = mergeMessageDenyIntoTools(undefined);
    expect(tools.deny).toEqual(['message']);
  });

  it('merges into an existing deny list without clobbering (dir_list survives)', () => {
    const tools = mergeMessageDenyIntoTools({
      deny: ['dir_list'],
      web: { search: { enabled: false } },
    });
    expect(tools.deny).toEqual(['dir_list', 'message']);
    expect(tools.web).toEqual({ search: { enabled: false } });
  });

  it('is idempotent: message is never duplicated', () => {
    const once = mergeMessageDenyIntoTools({ deny: ['message'] });
    expect(once.deny).toEqual(['message']);
  });

  it('MUTATION: the deny constant names exactly the runtime message tool', () => {
    // The ActivityLog failure rows carried toolName: "message". Renaming or
    // emptying the constant would silently re-enable the CLI-error source.
    expect([...NO_CHANNEL_TOOL_DENY]).toEqual(['message']);
  });
});

describe('buildMessageDeliverySection', () => {
  it('zero channels: teaches webchat-always delivery, bans channel complaints and CLI', () => {
    const section = buildMessageDeliverySection([]);
    expect(section).toContain('## Message Delivery');
    expect(section).toContain('reply in this conversation');
    expect(section).toContain('Claws dashboard web chat');
    expect(section).toContain('built in and always active');
    expect(section).toContain('Never treat the missing channels as an error');
    expect(section).toContain('Never tell the human to run CLI or terminal commands');
    expect(section).toContain('untrusted metadata or gateway-client');
    expect(section).toContain('sidecar');
    expect(section).toContain('source of truth');
    expect(section).toContain('QUEUED/HELD');
    expect(section).toContain('immediate posting');
    // The exact strings the founder saw must never be seeded into the prompt.
    expect(section).not.toContain('channels add');
    expect(section).not.toContain('channels list');
  });

  it('connected channels: names them with human labels and keeps the message tool usable', () => {
    const section = buildMessageDeliverySection(['telegram', 'msteams']);
    expect(section).toContain('Connected external channels: Telegram, Microsoft Teams');
    expect(section).toContain('`message` tool');
    expect(section).toContain('Never tell the human to run CLI or terminal commands');
    expect(section).toContain('untrusted metadata or gateway-client');
  });

  it('connected branch never claims channels are unavailable', () => {
    const section = buildMessageDeliverySection(['slack']);
    expect(section).not.toContain('unavailable');
    expect(section).toContain('Slack');
  });
});
