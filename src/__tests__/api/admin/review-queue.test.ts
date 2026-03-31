import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  getSessionUser: () => mockGetSessionUser(),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ id: 'email-1' }) }
  },
}));

process.env.ADMIN_EMAILS = 'admin@test.com';

const ADMIN_USER = { id: 'admin-1', email: 'admin@test.com', name: 'Admin' };
const NON_ADMIN_USER = { id: 'user-1', email: 'user@test.com', name: 'User' };

import { GET as getTemplates } from '@/app/api/admin/review-queue/templates/route';
import { GET as getSkills } from '@/app/api/admin/review-queue/skills/route';
import { POST as approveTemplate } from '@/app/api/admin/review-queue/templates/[id]/approve/route';
import { POST as rejectTemplate } from '@/app/api/admin/review-queue/templates/[id]/reject/route';
import { POST as approveSkill } from '@/app/api/admin/review-queue/skills/[id]/approve/route';
import { GET as getReports } from '@/app/api/admin/reports/route';
import { POST as resolveReport } from '@/app/api/admin/reports/[id]/resolve/route';

const MOCK_TEMPLATE = {
  id: 'tpl-1',
  name: 'Test Template',
  slug: 'test-template',
  tagline: 'A test template',
  description: 'Full description',
  category: 'CREATOR',
  trustTier: 'UNREVIEWED',
  reviewStatus: 'PENDING',
  createdAt: new Date(),
  creator: { id: 'cp-1', displayName: 'Creator', avatarUrl: null, user: { email: 'creator@test.com' } },
};

const MOCK_SKILL = {
  id: 'skill-1',
  name: 'Test Skill',
  slug: 'test-skill',
  description: 'A test skill',
  category: 'CORE',
  trustTier: 'UNREVIEWED',
  reviewStatus: 'PENDING',
  sandboxPassed: true,
  createdAt: new Date(),
  creator: { id: 'cp-1', displayName: 'Creator', avatarUrl: null, user: { email: 'creator@test.com' } },
};

const MOCK_REPORT = {
  id: 'report-1',
  reporterId: 'user-2',
  templateId: 'tpl-1',
  skillId: null,
  reviewId: null,
  reason: 'SPAM',
  details: 'Looks spammy',
  resolved: false,
  resolvedAt: null,
  resolution: null,
  createdAt: new Date(),
};

describe('Admin Review Queue API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionUser.mockResolvedValue(ADMIN_USER);
  });

  describe('GET /api/admin/review-queue/templates', () => {
    it('returns 403 for non-admin user', async () => {
      mockGetSessionUser.mockResolvedValue(NON_ADMIN_USER);
      const res = await getTemplates();
      expect(res.status).toBe(403);
    });

    it('returns 403 for unauthenticated user', async () => {
      mockGetSessionUser.mockResolvedValue(null);
      const res = await getTemplates();
      expect(res.status).toBe(403);
    });

    it('returns pending templates for admin', async () => {
      (prismaMock.clawTemplate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_TEMPLATE]);
      const res = await getTemplates();
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].name).toBe('Test Template');
    });
  });

  describe('POST /api/admin/review-queue/templates/[id]/approve', () => {
    it('approves a pending template and sets VERIFIED tier', async () => {
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      const updatedTemplate = { ...MOCK_TEMPLATE, reviewStatus: 'APPROVED', trustTier: 'VERIFIED' };
      (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedTemplate);

      const req = createMockRequest('http://localhost:3000/api/admin/review-queue/templates/tpl-1/approve', { method: 'POST' });
      const res = await approveTemplate(req, { params: Promise.resolve({ id: 'tpl-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.reviewStatus).toBe('APPROVED');
      expect(json.data.trustTier).toBe('VERIFIED');
    });

    it('returns 400 for already-approved template', async () => {
      const approved = { ...MOCK_TEMPLATE, reviewStatus: 'APPROVED' };
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(approved);

      const req = createMockRequest('http://localhost:3000/api/admin/review-queue/templates/tpl-1/approve', { method: 'POST' });
      const res = await approveTemplate(req, { params: Promise.resolve({ id: 'tpl-1' }) });
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent template', async () => {
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const req = createMockRequest('http://localhost:3000/api/admin/review-queue/templates/tpl-none/approve', { method: 'POST' });
      const res = await approveTemplate(req, { params: Promise.resolve({ id: 'tpl-none' }) });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/admin/review-queue/templates/[id]/reject', () => {
    it('rejects a pending template with reason', async () => {
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      const updated = { ...MOCK_TEMPLATE, reviewStatus: 'REJECTED', rejectionReason: 'Low quality' };
      (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const req = createMockRequest('http://localhost:3000/api/admin/review-queue/templates/tpl-1/reject', {
        method: 'POST',
        body: { reason: 'Low quality' },
      });
      const res = await rejectTemplate(req, { params: Promise.resolve({ id: 'tpl-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.reviewStatus).toBe('REJECTED');
    });

    it('returns 400 when reason is missing', async () => {
      const req = createMockRequest('http://localhost:3000/api/admin/review-queue/templates/tpl-1/reject', {
        method: 'POST',
        body: { reason: '' },
      });
      const res = await rejectTemplate(req, { params: Promise.resolve({ id: 'tpl-1' }) });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/admin/review-queue/skills', () => {
    it('returns pending skills for admin', async () => {
      (prismaMock.marketplaceSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_SKILL]);
      const res = await getSkills();
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(1);
    });
  });

  describe('POST /api/admin/review-queue/skills/[id]/approve', () => {
    it('sets VERIFIED tier when sandboxPassed is true', async () => {
      (prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_SKILL);
      const updated = { ...MOCK_SKILL, reviewStatus: 'APPROVED', trustTier: 'VERIFIED' };
      (prismaMock.marketplaceSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const req = createMockRequest('http://localhost:3000/api/admin/review-queue/skills/skill-1/approve', { method: 'POST' });
      const res = await approveSkill(req, { params: Promise.resolve({ id: 'skill-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.trustTier).toBe('VERIFIED');
    });

    it('sets SCANNED tier when sandboxPassed is false', async () => {
      const skillNoSandbox = { ...MOCK_SKILL, sandboxPassed: false };
      (prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(skillNoSandbox);
      const updated = { ...skillNoSandbox, reviewStatus: 'APPROVED', trustTier: 'SCANNED' };
      (prismaMock.marketplaceSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const req = createMockRequest('http://localhost:3000/api/admin/review-queue/skills/skill-1/approve', { method: 'POST' });
      const res = await approveSkill(req, { params: Promise.resolve({ id: 'skill-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.trustTier).toBe('SCANNED');
    });
  });

  describe('GET /api/admin/reports', () => {
    it('returns unresolved reports', async () => {
      (prismaMock.report.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_REPORT]);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Test Template' });

      const req = createMockRequest('http://localhost:3000/api/admin/reports?resolved=false');
      const res = await getReports(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].itemType).toBe('template');
    });
  });

  describe('POST /api/admin/reports/[id]/resolve', () => {
    it('resolves a report with notes', async () => {
      (prismaMock.report.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_REPORT);
      const updated = { ...MOCK_REPORT, resolved: true, resolution: 'Removed spam' };
      (prismaMock.report.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const req = createMockRequest('http://localhost:3000/api/admin/reports/report-1/resolve', {
        method: 'POST',
        body: { resolution: 'Removed spam' },
      });
      const res = await resolveReport(req, { params: Promise.resolve({ id: 'report-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.resolved).toBe(true);
    });

    it('returns 400 when resolution is missing', async () => {
      const req = createMockRequest('http://localhost:3000/api/admin/reports/report-1/resolve', {
        method: 'POST',
        body: { resolution: '' },
      });
      const res = await resolveReport(req, { params: Promise.resolve({ id: 'report-1' }) });
      expect(res.status).toBe(400);
    });

    it('returns 400 for already-resolved report', async () => {
      const resolved = { ...MOCK_REPORT, resolved: true };
      (prismaMock.report.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(resolved);

      const req = createMockRequest('http://localhost:3000/api/admin/reports/report-1/resolve', {
        method: 'POST',
        body: { resolution: 'Duplicate' },
      });
      const res = await resolveReport(req, { params: Promise.resolve({ id: 'report-1' }) });
      expect(res.status).toBe(400);
    });
  });
});
