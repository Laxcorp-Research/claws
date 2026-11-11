import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"

const execFileAsync = promisify(execFile)

test("self-host deploy waits until the gateway is listening and chat returns fixture-reply", async ({ page }) => {
  await page.goto("/api/auth/test-session?redirect=/store")
  await page.waitForURL("**/store**")

  const templateRes = await page.request.get("/api/marketplace/templates/twitter-growth-machine")
  const templateBody = await templateRes.json()
  const templateId = templateBody?.data?.template?.id as string | undefined
  expect(templateRes.status(), JSON.stringify(templateBody)).toBe(200)
  expect(templateId).toBeTruthy()

  const wsRes = await page.request.post("/api/workspaces", {
    data: { name: "Twitter X", templateId },
  })
  const wsBody = await wsRes.json()
  const workspaceId = wsBody?.data?.id as string | undefined
  expect(wsRes.status(), JSON.stringify(wsBody)).toBeLessThan(300)
  expect(workspaceId).toBeTruthy()

  const toolRes = await page.request.post(`/api/tools/${workspaceId}`, {
    data: {
      toolSlug: "twitter-api",
      displayName: "Twitter API",
      connectionType: "API_KEY",
      credentials: { TWITTER_API_KEY: "fixture-twitter" },
    },
  })
  expect(toolRes.status(), await toolRes.text()).toBeLessThan(300)

  const keyRes = await page.request.post(`/api/workspaces/${workspaceId}/api-keys`, {
    data: { provider: "ANTHROPIC", apiKey: "fixture-model-key" },
  })
  expect(keyRes.status(), await keyRes.text()).toBeLessThan(300)

  const deployRes = await page.request.post(`/api/deploy/${workspaceId}/cloud`, {
    data: {},
    timeout: 150_000,
  })
  const deployBody = await deployRes.json()
  expect(deployRes.status(), JSON.stringify(deployBody)).toBe(201)
  expect(deployBody?.data?.deployment?.status).toBe("COMPLETED")
  expect(deployBody?.data?.deployment?.gatewayListening).toBe(true)
  const containerId = deployBody.data.deployment.containerId as string

  const { stdout } = await execFileAsync("docker", ["port", containerId, "18789/tcp"])
  const published = stdout.trim().split("\n")[0]?.split(":").pop()
  expect(published).toMatch(/^\d+$/)
  const health = await page.request.get(`http://127.0.0.1:${published}/healthz`)
  expect(health.status()).toBe(200)

  const chatRes = await page.request.post(`/api/workspaces/${workspaceId}/chat`, {
    data: { message: "hello" },
    timeout: 120_000,
  })
  const chatBody = await chatRes.json()
  const chatText = JSON.stringify(chatBody)
  expect(chatRes.status(), chatText).toBe(200)
  expect(chatBody?.data?.replyText).toBe("fixture-reply")
  expect(chatBody?.data?.usage?.input).toBeGreaterThan(0)
  expect(chatBody?.data?.usage?.output).toBeGreaterThan(0)

  const napRes = await page.request.post(`/api/dashboard/${workspaceId}/nap`, { timeout: 180_000 })
  const napBody = await napRes.json()
  expect(napRes.status(), JSON.stringify(napBody)).toBe(200)
  expect(napBody?.data?.status).toBe("HIBERNATED")
  const { stdout: running } = await execFileAsync("docker", ["inspect", "-f", "{{.State.Running}}", containerId])
  expect(running.trim()).toBe("false")

  const wakeRes = await page.request.post(`/api/workspaces/${workspaceId}/chat`, {
    data: { message: "hello again" },
    timeout: 180_000,
  })
  const wakeBody = await wakeRes.json()
  expect(wakeRes.status(), JSON.stringify(wakeBody)).toBe(200)
  expect(wakeBody?.data?.replyText).toBe("fixture-reply")
  const { stdout: logs } = await execFileAsync("docker", ["logs", containerId])
  expect(logs).toContain("Runtime state restored")
})
