import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prismaMock } from '@/test/helpers/mock-prisma'

const dockerInspect = vi.hoisted(() => vi.fn())
vi.mock('dockerode', () => ({
  default: class Docker {
    getImage() {
      return { inspect: dockerInspect }
    }
  },
}))

vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

const probeAnthropicOutbound = vi.hoisted(() => vi.fn())
vi.mock('@/lib/health/anthropic-outbound', () => ({
  probeAnthropicOutbound,
}))

import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  const originalSha = process.env.VERCEL_GIT_COMMIT_SHA

  beforeEach(() => {
    delete process.env.CLAWS_PROFILE
    delete process.env.RUNTIME_IMAGE_TAG
    probeAnthropicOutbound.mockResolvedValue('ok')
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

  it('reports runtimeImage.present false when the self-host image is missing', async () => {
    process.env.CLAWS_PROFILE = 'self-host'
    process.env.RUNTIME_IMAGE_TAG = '2026.5.22-18'
    dockerInspect.mockRejectedValue(new Error('No such image'))
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.runtimeImage).toEqual({ tag: '2026.5.22-18', present: false })
    expect(json.outbound).toEqual({ anthropic: 'ok' })
  })

  it('reports tls_intercepted without failing the healthcheck', async () => {
    process.env.CLAWS_PROFILE = 'self-host'
    probeAnthropicOutbound.mockResolvedValue('tls_intercepted')
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('healthy')
    expect(json.outbound).toEqual({ anthropic: 'tls_intercepted' })
  })
})
