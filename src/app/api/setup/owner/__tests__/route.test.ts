import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import { POST } from "@/app/api/setup/owner/route"
import {
  authorizeOwnerCredentials,
  hashOwnerPassword,
  verifyOwnerPassword,
} from "@/lib/auth/owner-password"
import { credentialRejectionStatus } from "@/lib/auth/credential-lockout"

type MockFn = ReturnType<typeof vi.fn>

beforeEach(() => {
  process.env.CLAWS_PROFILE = "self-host"
  ;(prismaMock.$transaction as MockFn).mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  )
})

afterEach(() => {
  delete process.env.CLAWS_PROFILE
})

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/setup/owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  )
}

describe("first-run owner", () => {
  it("hashes a password and rejects a different one", async () => {
    const stored = await hashOwnerPassword("correct-horse")
    expect(await verifyOwnerPassword("correct-horse", stored)).toBe(true)
    expect(await verifyOwnerPassword("wrong-horse", stored)).toBe(false)
  })

  it("creates the owner only when no users exist", async () => {
    ;(prismaMock.user.count as MockFn).mockResolvedValue(0)
    ;(prismaMock.user.create as MockFn).mockResolvedValue({ id: "user-1", email: "owner@local.test" })

    const res = await post({ email: "Owner@Local.Test", password: "correct-horse", name: "Owner" })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { data: { email: string } }
    expect(json.data.email).toBe("owner@local.test")
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "owner@local.test",
          hashedPassword: expect.stringMatching(/^scrypt\$/),
        }),
      }),
    )
  })

  it("rejects a password shorter than 12 characters", async () => {
    const res = await post({ email: "owner@local.test", password: "short-pass" })
    expect(res.status).toBe(400)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it("a second call does not create another owner", async () => {
    ;(prismaMock.user.count as MockFn).mockResolvedValue(1)
    const res = await post({ email: "other@local.test", password: "correct-horse" })
    expect(res.status).toBe(409)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it("hosted profile does not expose owner creation", async () => {
    delete process.env.CLAWS_PROFILE
    const res = await post({ email: "owner@local.test", password: "correct-horse" })
    expect(res.status).toBe(404)
    expect(prismaMock.user.count).not.toHaveBeenCalled()
  })

  it("wrong password returns 401", async () => {
    const stored = await hashOwnerPassword("correct-horse")
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue({
      id: "user-1",
      email: "owner@local.test",
      name: "Owner",
      hashedPassword: stored,
    })
    expect(
      await authorizeOwnerCredentials({ email: "owner@local.test", password: "wrong-password" }),
    ).toBeNull()
    expect(credentialRejectionStatus("ok")).toBe(401)
  })

  it("credentials login accepts the owner password and rejects a wrong one", async () => {
    const stored = await hashOwnerPassword("correct-horse")
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue({
      id: "user-1",
      email: "owner@local.test",
      name: "Owner",
      hashedPassword: stored,
    })
    expect(
      await authorizeOwnerCredentials({ email: "owner@local.test", password: "correct-horse" }),
    ).toEqual({ id: "user-1", email: "owner@local.test", name: "Owner" })
    expect(
      await authorizeOwnerCredentials({ email: "owner@local.test", password: "nope-nope" }),
    ).toBeNull()
  })
})
