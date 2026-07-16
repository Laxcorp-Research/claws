// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPush = vi.fn()
let templateSlug = "medical-practice-manager"

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1", n: "2" }),
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/components/dashboard/use-workspace-redeploy", () => ({
  useWorkspaceRedeploy: () => ({
    modalOpen: false,
    redeploying: false,
    status: null,
    lastStage: null,
    error: null,
    startRedeploy: vi.fn(),
    closeModal: vi.fn(),
    retry: vi.fn(),
  }),
}))

vi.mock("@/components/dashboard/redeploy-progress-modal", () => ({
  RedeployProgressModal: () => null,
}))

import SetupStepPage from "@/app/setup/[workspaceId]/step/[n]/page"
import { MEDICAL_HIPAA_RESPONSIBILITY_NOTICE } from "@/lib/compliance-notices"

function mockStep2Fetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/workspaces/ws-1/tool-requirements")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { tools: [], required: [], recommended: [], source: "workspace" },
        }),
      } as Response
    }
    if (url.includes("/api/workspaces/ws-1")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "ws-1", status: "DRAFT", clawTemplate: { slug: templateSlug } },
        }),
      } as Response
    }
    if (url.includes("/api/tools/ws-1")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { connections: [], customConnections: [], composioOAuthAvailable: true },
        }),
      } as Response
    }
    if (url.includes("/api/deploy/ws-1/status?drift=1")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workspaceStatus: "DRAFT", drift: { isStale: false, changedAreas: [] } },
        }),
      } as Response
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
  })
}

describe("Setup Step 2 medical compliance notice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    templateSlug = "medical-practice-manager"
    mockStep2Fetch()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders the HIPAA responsibility notice for medical-practice-manager", async () => {
    render(<SetupStepPage />)

    expect(await screen.findByText(MEDICAL_HIPAA_RESPONSIBILITY_NOTICE)).toBeDefined()
  })

  it("does not render the HIPAA responsibility notice for an unregulated template", async () => {
    templateSlug = "twitter-growth-machine"

    render(<SetupStepPage />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText(MEDICAL_HIPAA_RESPONSIBILITY_NOTICE)).toBeNull()
  })
})
