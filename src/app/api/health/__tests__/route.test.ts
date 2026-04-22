import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prismaMock } from '@/test/helpers/mock-prisma'

vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  const originalSha = process.env.VERCEL_GIT_COMMIT_SHA

  beforeEach(() => {
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
  })

  afterEach(() => {
    if (originalSha === undefined) {
      delete process.env.VERCEL_GIT_COMMIT_SHA
    } else {
      process.env.VERCEL_GIT_COMMIT_SHA = originalSha
    }
  })

  it('truncates VERCEL_GIT_COMMIT_SHA to the first 7 chars', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '83005fd1234567890abcdef1234567890abcdef0'
    const res = await GET()
    const json = await res.json()
    expect(json.commit).toBe('83005fd')
    expect(json.commit).toHaveLength(7)
  })

  it('falls back to "unknown" when VERCEL_GIT_COMMIT_SHA is unset', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
    const res = await GET()
    const json = await res.json()
    expect(json.commit).toBe('unknown')
  })

  it('returns status "healthy" and HTTP 200 when DB check passes, with commit field present', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef01'
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('healthy')
    expect(json).toHaveProperty('commit')
    expect(json.commit).toBe('abcdef0')
  })
})
