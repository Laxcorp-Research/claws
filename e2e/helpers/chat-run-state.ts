import { type Page } from "@playwright/test"

export const E2E_RUN_ID = "run-e2e-chat-live"
export const E2E_LIVE_REPLY = "e2e-live-reply-without-reload"
export const E2E_LONG_REPLY = "e2e-long-turn-reply-after-subagents"
export const E2E_BG_REPLY = "e2e-background-tab-reply"

export async function installChatRunStateEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class ControllableEventSource {
      url: string
      readyState = 1
      private listeners: Record<string, Array<(ev: MessageEvent | Event) => void>> = {}

      constructor(url: string) {
        this.url = String(url)
        const bag = ((window as unknown as { __CLAWS_ES?: ControllableEventSource[] }).__CLAWS_ES ||=
          [])
        bag.push(this)
        if (this.url.includes("scope=chat-run-state")) {
          ;(window as unknown as { __chatRunStateStreamUrl?: string }).__chatRunStateStreamUrl =
            this.url
        }
        queueMicrotask(() => {
          this.dispatch("open", new Event("open"))
          this.dispatch(
            "init",
            { data: JSON.stringify([]) } as MessageEvent,
          )
        })
      }

      addEventListener(type: string, fn: (ev: MessageEvent | Event) => void) {
        ;(this.listeners[type] ||= []).push(fn)
      }

      close() {
        this.readyState = 2
      }

      dispatch(type: string, ev: MessageEvent | Event) {
        for (const fn of this.listeners[type] || []) fn(ev)
      }
    }

    ;(window as unknown as { EventSource: typeof EventSource }).EventSource =
      ControllableEventSource as unknown as typeof EventSource

    ;(window as unknown as { __clawsEmitChatLog?: (entry: unknown) => void }).__clawsEmitChatLog = (
      entry: unknown,
    ) => {
      const bag =
        (window as unknown as { __CLAWS_ES?: Array<{ url: string; dispatch: (t: string, ev: MessageEvent) => void }> })
          .__CLAWS_ES || []
      for (const es of bag) {
        if (!es.url.includes("scope=chat-run-state")) continue
        es.dispatch("log", { data: JSON.stringify(entry) } as MessageEvent)
      }
    }

    ;(window as unknown as { __clawsDropChatStream?: () => void }).__clawsDropChatStream = () => {
      const bag =
        (window as unknown as { __CLAWS_ES?: Array<{ url: string; dispatch: (t: string, ev: Event) => void }> })
          .__CLAWS_ES || []
      for (const es of bag) {
        if (!es.url.includes("scope=chat-run-state")) continue
        es.dispatch("error", new Event("error"))
      }
    }
  })
}

export function activityDashboardPayload(workspaceId: string) {
  return {
    success: true,
    data: {
      workspace: {
        id: workspaceId,
        name: "E2E Chat Run State",
        status: "RUNNING",
        healthStatus: "HEALTHY",
        currentMonthApiCost: 0,
        apiSpendLimit: 100,
        costAlertThreshold: 80,
      },
      stats: {
        agentsRunning: 1,
        agentsPaused: 0,
        agentsError: 0,
        agentsOffline: 0,
        agentsDegraded: 0,
        tasksToday: 0,
        tasksYesterday: 0,
        apiCostThisMonth: 0,
        apiCostProjected: 0,
        estimatedCostToday: 0,
        estimatedCostTodayCalls: 0,
        pendingReview: 0,
      },
      agents: [
        {
          id: "e2e-orch",
          name: "Orchestrator",
          role: "ORCHESTRATOR",
          color: "#8BFCAE",
          model: "anthropic/claude-sonnet-4-6",
          agentSlug: "orchestrator",
          status: "healthy",
        },
      ],
      recentLogs: [],
      pendingApprovals: [],
      spend: null,
      expiredTools: [],
      activityPage: { nextCursor: null, hasMore: false },
    },
  }
}

export async function stubChatDashboard(page: Page, workspaceId: string): Promise<void> {
  await page.route(`**/api/activity/${workspaceId}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activityDashboardPayload(workspaceId)),
    })
  })
  await page.route(`**/api/deploy/${workspaceId}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"success":true,"data":{}}',
    }),
  )
  await page.route(`**/api/channels/${workspaceId}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"success":true,"data":{"configuredChannelIds":[],"channels":{}}}',
    }),
  )
  await page.route(`**/api/workspaces/${workspaceId}/chat/history**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { rows: [], nextCursor: null } }),
    }),
  )
  await page.route(`**/api/user/billing`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { trialUsed: true, trialEndsAt: null, hasActiveSubscription: true },
      }),
    }),
  )
  await page.route(`**/api/versions/stable`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"success":true,"data":null}',
    }),
  )
}

export async function stubChatAccepted(page: Page, workspaceId: string, runId = E2E_RUN_ID): Promise<void> {
  await page.route(new RegExp(`/api/workspaces/${workspaceId}/chat$`), async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { runId } }),
    })
  })
}

export async function emitChatLog(
  page: Page,
  entry: {
    id: string
    actionType: string
    timestamp?: string
    agentName?: string
    action: string
    detail?: string
    channelId?: string | null
    runId?: string | null
    messageId?: string | null
  },
): Promise<void> {
  await page.evaluate((row) => {
    const emit = (window as unknown as { __clawsEmitChatLog?: (e: unknown) => void }).__clawsEmitChatLog
    if (!emit) throw new Error("chat run-state EventSource mock is missing")
    emit({
      timestamp: new Date().toISOString(),
      agentName: "Orchestrator",
      ...row,
    })
  }, entry)
}

export async function dropChatStream(page: Page): Promise<void> {
  await page.evaluate(() => {
    const drop = (window as unknown as { __clawsDropChatStream?: () => void }).__clawsDropChatStream
    if (!drop) throw new Error("chat run-state EventSource mock is missing")
    drop()
  })
}

export async function chatStreamUrl(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as unknown as { __chatRunStateStreamUrl?: string }).__chatRunStateStreamUrl ?? null,
  )
}
