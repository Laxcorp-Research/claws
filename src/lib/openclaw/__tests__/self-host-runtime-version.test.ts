import { describe, expect, it, vi } from "vitest"
import {
  loadSelfHostRuntimeContract,
  seedSelfHostOpenClawVersion,
} from "@/lib/openclaw/self-host-runtime-version"

function db() {
  const upsert = vi.fn().mockResolvedValue({})
  const findUnique = vi.fn()
  return { upsert, findUnique, client: { openClawVersion: { upsert, findUnique } } }
}

describe("self-host OpenClawVersion seed", () => {
  it("stamps 5.22 from a 2026.5.22 tag", async () => {
    const { upsert, client } = db()
    const stamped = await seedSelfHostOpenClawVersion(client, {
      CLAWS_PROFILE: "self-host",
      RUNTIME_IMAGE_TAG: "2026.5.22-18",
    })
    expect(stamped).toEqual({ version: "2026.5.22-18", runtimeContract: "5.22" })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { version: "2026.5.22-18" },
        create: expect.objectContaining({
          runtimeContract: "5.22",
          dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-18",
          isStable: true,
        }),
        update: expect.objectContaining({ runtimeContract: "5.22", isStable: true }),
      }),
    )
  })

  it("stamps 9.4 from a 2026.9.4 tag", async () => {
    const { client } = db()
    const stamped = await seedSelfHostOpenClawVersion(client, {
      CLAWS_PROFILE: "self-host",
      RUNTIME_IMAGE_TAG: "2026.9.4-5",
    })
    expect(stamped.runtimeContract).toBe("9.4")
  })

  it("refuses to seed without RUNTIME_IMAGE_TAG", async () => {
    const { client } = db()
    await expect(
      seedSelfHostOpenClawVersion(client, { CLAWS_PROFILE: "self-host" }),
    ).rejects.toThrow(/RUNTIME_IMAGE_TAG/)
  })
})

describe("loadSelfHostRuntimeContract", () => {
  it("returns null when the seed row is missing", async () => {
    const { findUnique, client } = db()
    findUnique.mockResolvedValue(null)
    await expect(
      loadSelfHostRuntimeContract(client, { RUNTIME_IMAGE_TAG: "2026.9.4-5" }),
    ).resolves.toBeNull()
  })

  it("returns null when the stored contract is not a known branch", async () => {
    const { findUnique, client } = db()
    findUnique.mockResolvedValue({ runtimeContract: "" })
    await expect(
      loadSelfHostRuntimeContract(client, { RUNTIME_IMAGE_TAG: "2026.9.4-5" }),
    ).resolves.toBeNull()
  })

  it("returns the stamped contract", async () => {
    const { findUnique, client } = db()
    findUnique.mockResolvedValue({ runtimeContract: "9.4" })
    await expect(
      loadSelfHostRuntimeContract(client, { RUNTIME_IMAGE_TAG: "2026.9.4-5" }),
    ).resolves.toBe("9.4")
  })
})
