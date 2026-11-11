import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { middleware } from "@/middleware"

describe("self-host blob PUT trailing slash", () => {
  it("rewrites the runtime's slash URL onto the route", () => {
    const req = new NextRequest(
      "http://app:3000/api/internal/state/blob-put/?pathname=runtime-state%2Fws-1.gz",
      { method: "PUT" },
    )
    const res = middleware(req)
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "http://app:3000/api/internal/state/blob-put?pathname=runtime-state%2Fws-1.gz",
    )
  })
})
