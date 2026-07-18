import { expect, test } from "@playwright/test"
import { signInAsTestUser } from "./helpers/auth"
import {
  E2E_OLD_MAIN,
  E2E_SNAPSHOT_AS_OF,
  E2E_TRANSCRIPT_EXCERPT,
  seedHibernatedConversationsFixture,
} from "./helpers/hibernated-conversations"

/**
 * REAL-SURFACE: hibernated workspace + real gzip snapshot in E2E DB →
 * Conversations tab banner + transcript (no route mocking of /conversations).
 */
test.describe("Conversations from snapshot (hibernated)", () => {
  test("hibernated fixture shows read-only banner, transcript, and archived rotated-main", async ({
    page,
  }) => {
    await signInAsTestUser(page)
    const { workspaceId } = await seedHibernatedConversationsFixture()

    const api = await page.request.get(`/api/workspaces/${workspaceId}/conversations`)
    expect(api.status()).toBe(200)
    const apiJson = await api.json()
    expect(apiJson.success).toBe(true)
    expect(apiJson.data).toMatchObject({
      available: true,
      mode: "snapshot",
      asOf: E2E_SNAPSHOT_AS_OF,
    })

    await page.goto(`/dashboard/${workspaceId}?tab=conversations`)
    await expect(page.getByRole("tab", { name: "Conversations" })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole("tab", { name: "Conversations" }).click()

    await expect(page.getByTestId("conversations-readonly-banner")).toHaveText(
      `Read-only · as of ${E2E_SNAPSHOT_AS_OF.replace(".000Z", "Z")}`,
      { timeout: 20_000 },
    )

    await expect(page.getByText("agent:dev-commander:main")).toBeVisible()
    await page.getByRole("button", { name: /agent:dev-commander:main/i }).click()
    await expect(page.getByText(E2E_TRANSCRIPT_EXCERPT)).toBeVisible({ timeout: 15_000 })

    await expect(page.getByTestId("conversations-archived")).toBeVisible()
    await expect(page.getByText(`orphaned:${E2E_OLD_MAIN}`)).toBeVisible()
    await expect(page.getByText(/rotated main/i)).toBeVisible()
  })
})
