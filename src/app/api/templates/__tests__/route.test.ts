import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { GET as getList } from '@/app/api/templates/route';
import { GET as getBySlug } from '@/app/api/templates/[slug]/route';

const MOCK_TEMPLATE = {
  id: 'tpl-1',
  name: 'YouTube Channel OS',
  slug: 'youtube-channel-os',
  tagline: 'A tagline',
  description: 'Full description',
  category: 'CREATOR',
  price: 149,
  isFree: false,
  creatorId: null,
  agentCount: 3,
  featured: true,
  sortOrder: 1,
  isPublished: true,
  installCount: 42,
  purchaseCount: 10,
  avgRating: 4.5,
  workspaceSnapshot: JSON.stringify({
    agents: [{ name: 'Planner', agentSlug: 'planner', role: 'ORCHESTRATOR', color: '#5BA1F5', model: 'haiku', roleDescription: 'Plans' }],
    tools: [
      { slug: 'youtube', name: 'YouTube', category: 'CONTENT', connectionType: 'OAUTH_COMPOSIO', required: true },
      { slug: 'tavily', name: 'Tavily', category: 'SEARCH', connectionType: 'API_KEY', required: false, alternatives: ['Serper'] },
    ],
    connections: [{ sourceSlug: 'planner', targetSlug: 'planner', condition: 'ON_COMPLETE' }],
    flowDescription: 'Flow desc',
    legalDisclaimer: null,
  }),
};

describe('GET /api/templates', () => {
  it('returns list of published templates', async () => {
    (prismaMock.clawTemplate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_TEMPLATE]);
    const res = await getList();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.templates).toHaveLength(1);
    expect(json.data.templates[0].slug).toBe('youtube-channel-os');
    expect(json.data.templates[0].agents).toHaveLength(1);
  });

  it('returns empty array when no templates', async () => {
    (prismaMock.clawTemplate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await getList();
    const json = await res.json();
    expect(json.data.templates).toEqual([]);
  });

  it('handles malformed snapshot gracefully', async () => {
    const badTemplate = { ...MOCK_TEMPLATE, workspaceSnapshot: 'not-valid-json' };
    (prismaMock.clawTemplate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([badTemplate]);
    const res = await getList();
    const json = await res.json();
    expect(json.data.templates[0].agents).toEqual([]);
  });
});

describe('GET /api/templates/[slug]', () => {
  it('returns full template detail', async () => {
    (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
    const req = createMockRequest('http://localhost:3000/api/templates/youtube-channel-os');
    const res = await getBySlug(req, { params: Promise.resolve({ slug: 'youtube-channel-os' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.name).toBe('YouTube Channel OS');
    expect(json.data.agents).toHaveLength(1);
    expect(json.data.tools.required).toHaveLength(1);
    expect(json.data.tools.recommended).toHaveLength(1);
    expect(json.data.isFree).toBe(false);
    expect(json.data.creatorId).toBeNull();
    expect(json.data.installCount).toBe(42);
  });

  it('returns 404 for unknown slug', async () => {
    (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = createMockRequest('http://localhost:3000/api/templates/nonexistent');
    const res = await getBySlug(req, { params: Promise.resolve({ slug: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('includes marketplace fields for community templates', async () => {
    const communityTpl = { ...MOCK_TEMPLATE, isFree: false, creatorId: 'creator-99', installCount: 100 };
    (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(communityTpl);
    const req = createMockRequest('http://localhost:3000/api/templates/youtube-channel-os');
    const res = await getBySlug(req, { params: Promise.resolve({ slug: 'youtube-channel-os' }) });
    const json = await res.json();

    expect(json.data.creatorId).toBe('creator-99');
    expect(json.data.installCount).toBe(100);
  });
});
