import { describe, expect, it } from "vitest"
import {
  buildOpenClawChannelsConfig,
  preferNumericTelegramAllowFrom,
} from "@/lib/openclaw/channel-config"

describe("preferNumericTelegramAllowFrom", () => {
  it("emitted allowFrom prefers numeric when username + numeric are both present", () => {
    expect(preferNumericTelegramAllowFrom(["@trader", "1227037949", "@other"])).toEqual([
      "1227037949",
      "@trader",
      "@other",
    ])
    expect(preferNumericTelegramAllowFrom(["@trader", 424242])).toEqual([424242, "@trader"])
  })

  it("username-only without numeric is unchanged (documented limitation)", () => {
    const onlyUsername = ["@quant_trader"]
    expect(preferNumericTelegramAllowFrom(onlyUsername)).toEqual(onlyUsername)
    expect(preferNumericTelegramAllowFrom(["@a", "@b"])).toEqual(["@a", "@b"])
  })
})

describe("buildOpenClawChannelsConfig telegram allowFrom", () => {
  it("puts numeric chat id first when config has both username and numeric", () => {
    const channels = buildOpenClawChannelsConfig({
      telegram: {
        botToken: "123456789:token",
        allowFrom: ["@bound_user", "987654321"],
      },
    })
    const telegram = channels.telegram as { allowFrom: Array<string | number> }
    expect(telegram.allowFrom[0]).toBe("987654321")
    expect(telegram.allowFrom).toEqual(["987654321", "@bound_user"])
  })

  it("leaves username-only allowFrom unchanged", () => {
    const channels = buildOpenClawChannelsConfig({
      telegram: {
        botToken: "123456789:token",
        allowFrom: ["@only_username"],
      },
    })
    const telegram = channels.telegram as { allowFrom: Array<string | number> }
    expect(telegram.allowFrom).toEqual(["@only_username"])
  })
})
