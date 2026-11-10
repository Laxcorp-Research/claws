import { execFile } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it, afterAll } from "vitest"
import { trustedProxiesForGateway } from "@/lib/openclaw/gateway-ingress"

const execFileAsync = promisify(execFile)
const enabled = process.env.CLAWS_GATEWAY_UPGRADE_IT === "1"
const name = "claws-upgrade-it"
const image = "ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5"

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, {
    windowsHide: true,
    maxBuffer: 2_000_000,
  })
  return stdout
}

describe.skipIf(!enabled)("real 9.4-5 upgrade on the compose network", () => {
  afterAll(async () => {
    if (!enabled) return
    await execFileAsync("docker", ["rm", "-f", name]).catch(() => undefined)
  })

  it("answers 101 and a reply frame, with and without the gateway token header", async () => {
    const proxies = trustedProxiesForGateway(true)
    const config: { gateway: Record<string, unknown> } = {
      gateway: {
        mode: "local",
        bind: "lan",
        port: 18789,
        auth: { mode: "token", token: "probe-token" },
      },
    }
    if (proxies) config.gateway.trustedProxies = [...proxies]
    const dir = mkdtempSync(join(tmpdir(), "claws-upgrade-"))
    const configPath = join(dir, "openclaw.json")
    writeFileSync(configPath, JSON.stringify(config))
    await execFileAsync("docker", ["rm", "-f", name]).catch(() => undefined)
    await docker([
      "run", "-d", "--name", name, "--network", "claws",
      "-e", "OPENCLAW_GATEWAY_TOKEN=probe-token",
      "-v", `${configPath}:/home/node/.openclaw/openclaw.json:ro`,
      image,
      "openclaw", "gateway", "run",
      "--bind", "lan", "--port", "18789",
      "--auth", "token", "--token", "probe-token",
      "--allow-unconfigured",
    ])
    const deadline = Date.now() + 30_000
    let ready = false
    while (Date.now() < deadline) {
      const logged = await execFileAsync("docker", ["logs", name]).catch((err: { stdout?: string; stderr?: string }) => ({
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      }))
      const logs = `${logged.stdout}\n${logged.stderr}`
      if (logs.includes("http server listening")) {
        ready = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    expect(ready).toBe(true)

    const probe = await docker([
      "run", "--rm", "--network", "claws", "--entrypoint", "node",
      "-e", `PROBE_HOST=${name}`,
      "-e", "PROBE_TOKEN=probe-token",
      "-v", `${process.cwd()}/scripts:/scripts:ro`,
      image,
      "/scripts/gateway-upgrade-probe.mjs",
    ])
    const plain = JSON.parse(probe.split("\n").find((line) => line.startsWith("PLAIN "))!.slice("PLAIN ".length))
    const authed = JSON.parse(probe.split("\n").find((line) => line.startsWith("WITH_TOKEN "))!.slice("WITH_TOKEN ".length))
    expect(plain).toMatchObject({ event: "upgrade", status: 101 })
    expect(plain.frame).toContain('"type":"event"')
    expect(authed).toMatchObject({ event: "upgrade", status: 101 })
    expect(authed.frame).toContain('"type":"event"')
  }, 90_000)
})
