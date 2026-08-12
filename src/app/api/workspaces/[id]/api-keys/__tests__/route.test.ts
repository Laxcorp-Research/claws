import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-test-123",
    email: "test@example.com",
  }),
}))

vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ workspace: { id: "ws-1" }, error: null }),
}))

vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
  generateKeyHint: vi.fn((val: string) => `${val.slice(0, 4)}...`),
}))

const mockValidate = vi.fn()
vi.mock("@/lib/api-key-validation", () => ({
  validateApiKey: (...args: unknown[]) => mockValidate(...args),
}))

import { POST } from "@/app/api/workspaces/[id]/api-keys/route"

describe("POST /api/workspaces/[id]/api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidate.mockResolvedValue({ valid: true })
  })

  it("accepts OPENROUTER after live validate", async () => {
    mockValidate.mockResolvedValueOnce({ valid: true })
    ;(prismaMock.workspaceApiKey.upsert as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "wok-1",
      provider: "OPENROUTER",
    })
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1/api-keys", {
      method: "POST",
      body: { provider: "OPENROUTER", apiKey: "sk-or-test" },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "ws-1" }) })
    expect(res.status).toBe(200)
    expect(mockValidate).toHaveBeenCalledWith("OPENROUTER", "sk-or-test")
    expect(prismaMock.workspaceApiKey.upsert).toHaveBeenCalled()
  })

  it("rejects OLLAMA with 400", async () => {
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1/api-keys", {
      method: "POST",
      body: { provider: "OLLAMA", apiKey: "local" },
    })
    const res = await POST(req, { params: Promise.resolve({ id: "ws-1" }) })
    expect(res.status).toBe(400)
  })
})
