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

const mockLookupGhcrManifest = vi.fn();
vi.mock('@/lib/ghcr/manifest', () => ({
  lookupGhcrManifest: (...args: unknown[]) => mockLookupGhcrManifest(...args),
}));

process.env.ADMIN_EMAILS = 'admin@test.com';

const ADMIN_USER = { id: 'admin-1', email: 'admin@test.com', name: 'Admin' };
const REGULAR_USER = { id: 'user-1', email: 'user@test.com', name: 'User' };

import { GET as getStable } from '@/app/api/versions/stable/route';
import { GET as listVersions } from '@/app/api/versions/route';
import { GET as adminListVersions } from '@/app/api/admin/versions/route';
import { POST as createVersion } from '@/app/api/admin/versions/create/route';
import { POST as promoteVersion } from '@/app/api/admin/versions/[id]/promote/route';
import { POST as forceUpdate } from '@/app/api/admin/versions/[id]/force-update/route';

const MOCK_VERSION_STABLE = {
  id: 'ver-1',
  version: '0.1.0',
  isStable: true,
  isLatest: false,
  isSecurityPatch: false,
  dockerImage: 'ghcr.io/laxcorp-research/openclaw-runtime:0.1.0',
  releaseNotes: 'Initial release',
  breakingChanges: null,
  releasedAt: new Date('2026-03-01'),
  stableAt: new Date('2026-03-05'),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_VERSION_LATEST = {
  id: 'ver-2',
  version: '0.2.0',
  isStable: false,
  isLatest: true,
  isSecurityPatch: false,
  dockerImage: 'ghcr.io/laxcorp-research/openclaw-runtime:0.2.0',
  releaseNotes: 'New features',
  breakingChanges: null,
  releasedAt: new Date('2026-03-15'),
  stableAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Version Management API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionUser.mockResolvedValue(ADMIN_USER);
    mockLookupGhcrManifest.mockResolvedValue({
      exists: true,
      digest: 'sha256:abc',
    });
  });

  describe('GET /api/versions/stable (public)', () => {
    it('returns the stable version without auth', async () => {
      mockGetSessionUser.mockResolvedValue(null);
      (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_VERSION_STABLE);

      const res = await getStable();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.version).toBe('0.1.0');
      expect(json.data.dockerImage).toContain('0.1.0');
    });

    it('returns 404 when no stable version exists', async () => {
      (prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await getStable();
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/versions (public)', () => {
    it('returns all versions', async () => {
      (prismaMock.openClawVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_VERSION_STABLE, MOCK_VERSION_LATEST]);

      const res = await listVersions();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);
    });
  });

  describe('GET /api/admin/versions', () => {
    it('returns 403 for non-admin', async () => {
      mockGetSessionUser.mockResolvedValue(REGULAR_USER);
      const res = await adminListVersions();
      expect(res.status).toBe(403);
    });

    it('returns versions with deployment counts for admin', async () => {
      (prismaMock.openClawVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MOCK_VERSION_STABLE]);
      (prismaMock.deployment.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);

      const res = await adminListVersions();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data[0].deploymentCount).toBe(5);
    });
  });

  describe('POST /api/admin/versions/create', () => {
    it('creates a new version and sets isLatest', async () => {
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const newVer = { ...MOCK_VERSION_LATEST, id: 'ver-new' };
      (prismaMock.openClawVersion.create as ReturnType<typeof vi.fn>).mockResolvedValue(newVer);
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      const req = createMockRequest('http://localhost:3000/api/admin/versions/create', {
        method: 'POST',
        body: { version: '0.2.0', dockerImage: 'ghcr.io/laxcorp-research/openclaw-runtime:0.2.0' },
      });
      const res = await createVersion(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.version).toBe('0.2.0');
    });

    it('returns 409 for duplicate version', async () => {
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_VERSION_STABLE);

      const req = createMockRequest('http://localhost:3000/api/admin/versions/create', {
        method: 'POST',
        body: { version: '0.1.0', dockerImage: 'ghcr.io/laxcorp-research/openclaw-runtime:0.1.0' },
      });
      const res = await createVersion(req);
      expect(res.status).toBe(409);
    });

    it('returns 400 for missing fields', async () => {
      const req = createMockRequest('http://localhost:3000/api/admin/versions/create', {
        method: 'POST',
        body: { version: '' },
      });
      const res = await createVersion(req);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/admin/versions/[id]/promote', () => {
    it('promotes a version to stable and demotes previous', async () => {
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(MOCK_VERSION_LATEST)
        .mockResolvedValueOnce({ ...MOCK_VERSION_LATEST, isStable: true, stableAt: new Date() });
      (prismaMock.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createMockRequest('http://localhost:3000/api/admin/versions/ver-2/promote', { method: 'POST' });
      const res = await promoteVersion(req, { params: Promise.resolve({ id: 'ver-2' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.isStable).toBe(true);
    });

    it('returns 400 if already stable', async () => {
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_VERSION_STABLE);

      const req = createMockRequest('http://localhost:3000/api/admin/versions/ver-1/promote', { method: 'POST' });
      const res = await promoteVersion(req, { params: Promise.resolve({ id: 'ver-1' }) });
      expect(res.status).toBe(400);
    });

    it('rejects never-promotable raw-calendar / seed relic (guard absent → would promote junk)', async () => {
      const junk = {
        ...MOCK_VERSION_LATEST,
        id: 'ver-junk',
        version: '2026.7.1',
        dockerImage: 'ghcr.io/laxcorp-research/openclaw-runtime:2026.7.1',
      };
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(junk);

      const req = createMockRequest('http://localhost:3000/api/admin/versions/ver-junk/promote', {
        method: 'POST',
      });
      const res = await promoteVersion(req, { params: Promise.resolve({ id: 'ver-junk' }) });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error?.message).toMatch(/raw-calendar|never promotable/i);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects promote when GHCR manifest is missing', async () => {
      mockLookupGhcrManifest.mockResolvedValue({ exists: false, digest: null });
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        MOCK_VERSION_LATEST,
      );

      const req = createMockRequest('http://localhost:3000/api/admin/versions/ver-2/promote', {
        method: 'POST',
      });
      const res = await promoteVersion(req, { params: Promise.resolve({ id: 'ver-2' }) });
      expect(res.status).toBe(400);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/versions/[id]/force-update', () => {
    it('updates affected deployments and returns count', async () => {
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_VERSION_STABLE);
      (prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'dep-1',
          containerImage: 'ghcr.io/laxcorp-research/openclaw-runtime:old',
          workspace: { id: 'ws-1', name: 'My Claw', userId: 'user-1', user: { email: 'user@test.com', name: 'User' } },
        },
      ]);
      (prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      const req = createMockRequest('http://localhost:3000/api/admin/versions/ver-1/force-update', { method: 'POST' });
      const res = await forceUpdate(req, { params: Promise.resolve({ id: 'ver-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.affectedCount).toBe(1);
    });

    it('returns 400 if version is not stable', async () => {
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_VERSION_LATEST);

      const req = createMockRequest('http://localhost:3000/api/admin/versions/ver-2/force-update', { method: 'POST' });
      const res = await forceUpdate(req, { params: Promise.resolve({ id: 'ver-2' }) });
      expect(res.status).toBe(400);
    });

    it('returns success with 0 count when no deployments need updating', async () => {
      (prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_VERSION_STABLE);
      (prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createMockRequest('http://localhost:3000/api/admin/versions/ver-1/force-update', { method: 'POST' });
      const res = await forceUpdate(req, { params: Promise.resolve({ id: 'ver-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.affectedCount).toBe(0);
    });
  });

});
