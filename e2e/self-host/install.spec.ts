import { expect, test } from "@playwright/test"

test("self-host store Install lands on setup step 1 with zero 4xx", async ({ page }) => {
  const failures: string[] = []
  page.on("response", (res) => {
    const url = res.url()
    if (url.includes("favicon") || url.includes("/_next/")) return
    if (res.status() >= 400) failures.push(`${res.status()} ${url}`)
  })

  await page.goto("/api/auth/test-session?redirect=/store/twitter-growth-machine")
  await page.waitForURL("**/store/twitter-growth-machine")
  await page.getByRole("button", { name: "Install" }).click()
  await page.waitForURL(/\/setup\/[^/]+\/step\/1/)
  expect(failures).toEqual([])
})
