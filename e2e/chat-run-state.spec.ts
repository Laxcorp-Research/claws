import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { signInAsTestUser } from "./helpers/auth"
import { getOrCreateWorkspaceId } from "./helpers/workspace"
import {
  E2E_BG_REPLY,
  E2E_LIVE_REPLY,
  E2E_LONG_REPLY,
  E2E_RUN_ID,
  chatStreamUrl,
  dropChatStream,
  emitChatLog,
  installChatRunStateEventSource,
  stubChatAccepted,
  stubChatDashboard,
} from "./helpers/chat-run-state"

async function openChat(page: import("@playwright/test").Page) {
  await signInAsTestUser(page)
  const workspaceId = await getOrCreateWorkspaceId(page)
  await installChatRunStateEventSource(page)
  await stubChatDashboard(page, workspaceId)
  await stubChatAccepted(page, workspaceId)
  await page.goto(`/dashboard/${workspaceId}?tab=chat`)
  await expect(page.getByRole("status", { name: "Loading briefing" })).toHaveCount(0, {
    timeout: 20_000,
  })
  const pane = page.getByRole("region", { name: "Web chat" })
  await expect(pane).toBeVisible({ timeout: 20_000 })
  return { workspaceId, pane }
}

test.describe("Chat live run-state (no reload)", () => {
  test("MUTATION: chat subscribes to activity SSE scope=chat-run-state", async ({ page }) => {
    const src = readFileSync(join(process.cwd(), "src/hooks/use-chat-run-state.ts"), "utf8")
    expect(src).toContain("new EventSource(chatRunStateStreamUrl(workspaceId))")
    expect(src).toContain("chatRunStateStreamUrl")

    await openChat(page)
    const url = await chatStreamUrl(page)
    expect(url).toBeTruthy()
    expect(url).toContain("/api/activity/")
    expect(url).toContain("/stream?scope=chat-run-state")
  })

  test("send → reply renders without reload", async ({ page }) => {
    await openChat(page)
    const urlBefore = page.url()

    await page.getByLabel("Message").fill("ping live run-state")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Accepted")).toBeVisible({ timeout: 10_000 })

    await emitChatLog(page, {
      id: "task-live",
      actionType: "TASK_START",
      action: "Task started",
      runId: E2E_RUN_ID,
    })
    await expect(page.getByText("Working", { exact: true })).toBeVisible()

    await emitChatLog(page, {
      id: "sent-live",
      actionType: "MESSAGE_SENT",
      action: `Replied: ${E2E_LIVE_REPLY}`,
      detail: E2E_LIVE_REPLY,
      channelId: "webchat",
      runId: E2E_RUN_ID,
    })

    await expect(page.getByText(E2E_LIVE_REPLY)).toBeVisible()
    await expect(page.getByText("Done", { exact: true })).toBeVisible()
    expect(page.url()).toBe(urlBefore)
  })

  test("long turn (2+ min) keeps Working honest then renders the reply", async ({ page }) => {
    test.setTimeout(45_000)
    await openChat(page)
    await page.clock.install()

    await page.getByLabel("Message").fill("long subagent turn")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Accepted")).toBeVisible({ timeout: 10_000 })

    await emitChatLog(page, {
      id: "task-long",
      actionType: "TASK_START",
      action: "Task started",
      runId: E2E_RUN_ID,
    })
    await expect(page.getByText("Working", { exact: true })).toBeVisible()
    await expect(page.locator("[data-working-indicator]")).toBeVisible()

    await page.clock.install()
    await page.clock.fastForward(2 * 60 * 1000 + 30_000)

    await expect(page.getByText("Working", { exact: true })).toBeVisible()
    await expect(page.getByText("No response")).toHaveCount(0)
    await expect(page.locator("[data-working-indicator]")).toBeVisible()

    await emitChatLog(page, {
      id: "sent-long",
      actionType: "MESSAGE_SENT",
      action: `Replied: ${E2E_LONG_REPLY}`,
      detail: E2E_LONG_REPLY,
      channelId: "webchat",
      runId: E2E_RUN_ID,
    })

    await expect(page.getByText(E2E_LONG_REPLY)).toBeVisible()
    await expect(page.getByText("Done", { exact: true })).toBeVisible()
  })

  test("backgrounded tab still renders via catch-up poll after SSE drop", async ({ page }) => {
    const { workspaceId } = await openChat(page)

    await page.route(`**/api/workspaces/${workspaceId}/chat/run-state**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            rows: [
              {
                id: "sent-bg",
                actionType: "MESSAGE_SENT",
                timestamp: new Date().toISOString(),
                agentName: "Orchestrator",
                action: `Replied: ${E2E_BG_REPLY}`,
                detail: E2E_BG_REPLY,
                channelId: "webchat",
                runId: E2E_RUN_ID,
              },
            ],
          },
        }),
      }),
    )

    await page.getByLabel("Message").fill("background tab turn")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Accepted")).toBeVisible({ timeout: 10_000 })

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true })
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await dropChatStream(page)

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false })
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })

    await expect(page.getByText(E2E_BG_REPLY)).toBeVisible({ timeout: 10_000 })
  })
})
