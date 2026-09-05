import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const TOKEN = "test-gateway-token-aaaaaaaa"
const METERING = "test-metering-secret-bbbbbbbb"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockRes(): any {
  return {
    statusCode: 0,
    _headers: {} as Record<string, string>,
    _body: "",
    setHeader(k: string, v: string) {
      this._headers[k.toLowerCase()] = v
    },
    end(b?: string) {
      this._body = b ?? ""
    },
    json() {
      return JSON.parse(this._body || "{}")
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockReq(opts: {
  method: string
  token?: string
  header?: "authorization" | "x-gateway-token"
  meteringSecret?: string
  body?: unknown
}): any {
  const headers: Record<string, string> = {}
  if (opts.token !== undefined) {
    if (opts.header === "x-gateway-token") headers["x-gateway-token"] = opts.token
    else headers.authorization = `Bearer ${opts.token}`
  }
  if (opts.meteringSecret !== undefined) headers["x-metering-secret"] = opts.meteringSecret
  return { method: opts.method, headers, body: opts.body ?? { path: "shared/USER.md", content: "hi" } }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handleWorkspaceFilesWrite: (req: any, res: any) => Promise<boolean>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pluginEntry: any
let dataDir = ""

beforeEach(async () => {
  vi.resetModules()
  dataDir = mkdtempSync(join(tmpdir(), "claws-ws-files-"))
  process.env.OPENCLAW_GATEWAY_TOKEN = TOKEN
  process.env.OPENCLAW_DATA_DIR = dataDir
  process.env.CLAWS_METERING_SECRET = METERING
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (await import("../../container/claws-activity-reporter/index.mjs")) as any
  handleWorkspaceFilesWrite = m.__test__.handleWorkspaceFilesWrite
  pluginEntry = m.default
})

afterEach(() => {
  delete process.env.OPENCLAW_GATEWAY_TOKEN
  delete process.env.OPENCLAW_DATA_DIR
  delete process.env.CLAWS_METERING_SECRET
  rmSync(dataDir, { recursive: true, force: true })
})

describe("/internal/workspace-files - auth", () => {
  it("rejects a missing token with 401 and does NOT write", async () => {
    const res = mockRes()
    await handleWorkspaceFilesWrite(mockReq({ method: "PUT" }), res)
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ ok: false, error: "unauthorized" })
  })

  it("rejects a wrong token with 401 (mutation guard)", async () => {
    const res = mockRes()
    await handleWorkspaceFilesWrite(mockReq({ method: "PUT", token: "wrong" }), res)
    expect(res.statusCode).toBe(401)
  })

  it("rejects metering-secret-only auth with 401 (not the write-file trust class)", async () => {
    const res = mockRes()
    await handleWorkspaceFilesWrite(
      mockReq({ method: "PUT", meteringSecret: METERING, body: { path: "shared/USER.md", content: "nope" } }),
      res,
    )
    expect(res.statusCode).toBe(401)
  })

  it("503 when OPENCLAW_GATEWAY_TOKEN is unset (fail-closed)", async () => {
    delete process.env.OPENCLAW_GATEWAY_TOKEN
    vi.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (await import("../../container/claws-activity-reporter/index.mjs")) as any
    const res = mockRes()
    await m.__test__.handleWorkspaceFilesWrite(mockReq({ method: "PUT", token: TOKEN }), res)
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: "token_unconfigured" })
  })

  it("rejects non-PUT with 405", async () => {
    const res = mockRes()
    await handleWorkspaceFilesWrite(mockReq({ method: "POST", token: TOKEN }), res)
    expect(res.statusCode).toBe(405)
  })

  it("accepts X-Gateway-Token as well as Bearer", async () => {
    const res = mockRes()
    await handleWorkspaceFilesWrite(
      mockReq({
        method: "PUT",
        token: TOKEN,
        header: "x-gateway-token",
        body: { path: "shared/VOICE.md", content: "voice" },
      }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(readFileSync(join(dataDir, "shared", "VOICE.md"), "utf8")).toBe("voice")
  })
})

describe("/internal/workspace-files - path + write", () => {
  it("writes an allowlisted shared markdown file", async () => {
    const res = mockRes()
    await handleWorkspaceFilesWrite(
      mockReq({
        method: "PUT",
        token: TOKEN,
        body: { path: "shared/USER.md", content: "# User\nChaitanya" },
      }),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, path: "shared/USER.md" })
    expect(readFileSync(join(dataDir, "shared", "USER.md"), "utf8")).toBe("# User\nChaitanya")
  })

  it("403 on openclaw.json / dotfile / memory / escape (no write)", async () => {
    for (const path of [
      "shared/openclaw.json",
      "shared/.env",
      "shared/deliverables/.hidden.md",
      "agents/main/agent/MEMORY.md",
      "cron/jobs.json",
    ]) {
      const res = mockRes()
      await handleWorkspaceFilesWrite(
        mockReq({ method: "PUT", token: TOKEN, body: { path, content: "x" } }),
        res,
      )
      expect(res.statusCode, path).toBe(403)
    }
  })

  it("413 when content exceeds the size cap", async () => {
    const res = mockRes()
    await handleWorkspaceFilesWrite(
      mockReq({
        method: "PUT",
        token: TOKEN,
        body: { path: "shared/USER.md", content: "x".repeat(256 * 1024 + 1) },
      }),
      res,
    )
    expect(res.statusCode).toBe(413)
  })
})

describe("/internal/workspace-files - route registration", () => {
  it("registers an exact, auth:plugin route at /internal/workspace-files", () => {
    const registerHttpRoute = vi.fn()
    pluginEntry.register({ on: vi.fn(), registerHttpRoute })
    const routes = registerHttpRoute.mock.calls.map(
      (c: unknown[]) => c[0] as { path: string; auth: string; match: string; handler: unknown },
    )
    const files = routes.find((r) => r.path === "/internal/workspace-files")
    expect(files).toBeDefined()
    expect(files?.auth).toBe("plugin")
    expect(files?.match).toBe("exact")
    expect(typeof files?.handler).toBe("function")
  })
})
