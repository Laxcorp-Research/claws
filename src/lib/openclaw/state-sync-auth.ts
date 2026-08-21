import { NextRequest } from "next/server"

/** F3.ii: keep X-Metering-Secret - same as existing /state/upload (not activity). */
export function assertMeteringSecret(req: NextRequest): boolean {
  const expected = process.env.METERING_MASTER_SECRET
  if (!expected) return false
  return req.headers.get("X-Metering-Secret") === expected
}

export function parseStoreIdFromReadWriteToken(token: string): string {
  const [, , , storeId = ""] = token.split("_")
  return storeId
}
