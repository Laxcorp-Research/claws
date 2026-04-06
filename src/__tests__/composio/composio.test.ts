import { describe, it, expect } from "vitest"
import { getComposioUserId } from "@/lib/composio"

describe("Composio helpers", () => {
  describe("getComposioUserId", () => {
    it("prefixes user ID with claws_", () => {
      expect(getComposioUserId("user123")).toBe("claws_user123")
    })

    it("handles cuid-style ids", () => {
      const cuid = "clxyz123abc456"
      expect(getComposioUserId(cuid)).toBe(`claws_${cuid}`)
    })
  })
})
